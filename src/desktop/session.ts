import { ReverseDns } from "../dns.js";
import { filterSockets } from "../filter.js";
import { formatClock, formatEndpoint } from "../format.js";
import { collectSockets, stopCollection, formatLocals } from "../netstat.js";
import { ProcessTable } from "../processes.js";
import { PublicIpQuery } from "../publicIp.js";
import { summaryLine } from "../render.js";
import { Tracker } from "../track.js";
import type { Filters, Snapshot, SocketRow } from "../types.js";

export interface MonitorOptions {
  intervalMs: number;
  dns: boolean;
  filters: Filters;
}

export interface DesktopRow {
  key: string;
  mark: string;
  proto: string;
  local: string;
  remote: string;
  state: string;
  process: string;
  pid: number;
  firstSeen: string;
  lastSeen: string;
  added: boolean;
  newIp: boolean;
}

export interface DesktopFrame {
  at: number;
  error: string | null;
  stale: boolean;
  count: number;
  rows: DesktopRow[];
  summary: string;
  publicPending: boolean;
  publicIpv4: string | null;
  publicIpv6: string | null;
}

interface ProcessSource {
  snapshot(): Promise<Map<number, string>>;
  close(): void;
}

interface DnsSource {
  request(ip: string): void;
  host(ip: string): string | undefined;
}

interface PublicSource {
  ipv4: string | null;
  ipv6: string | null;
  isPending(): boolean;
  stop(): void;
  onSettled(listener: () => void): () => void;
}

export interface MonitorSources {
  collect?: () => Promise<SocketRow[]>;
  processes?: () => ProcessSource;
  dns?: (enabled: boolean) => DnsSource;
  publicIp?: () => PublicSource;
}

const FAILURE_SUMMARY = "没有可用的连接表";

export function toFrame(
  snapshot: Snapshot,
  hostOf: (ip: string) => string | undefined,
  at: number,
  error: string | null,
  stale: boolean,
  publicPending: boolean,
  publicIpv4: string | null,
  publicIpv6: string | null,
  summary = summaryLine(snapshot),
): DesktopFrame {
  return {
    at,
    error,
    stale,
    count: snapshot.rows.length,
    summary,
    publicPending,
    publicIpv4,
    publicIpv6,
    rows: snapshot.rows.map((row) => {
      const added = snapshot.addedKeys.has(row.key);
      const newIp = snapshot.newIps.has(row.remoteIp);
      const host = hostOf(row.remoteIp);
      const remote = formatEndpoint(row.remoteIp, row.remotePort);
      return {
        key: row.key,
        mark: added ? "新" : "",
        proto: row.proto,
        local: formatLocals(row.locals),
        remote: host ? `${remote} (${host})` : remote,
        state: row.state,
        process: row.process || "-",
        pid: row.pid,
        firstSeen: formatClock(row.firstSeen),
        lastSeen: formatClock(row.lastSeen),
        added,
        newIp,
      };
    }),
  };
}

export class ConnectionMonitor {
  private readonly collect: () => Promise<SocketRow[]>;
  private readonly createProcesses: () => ProcessSource;
  private readonly createDns: (enabled: boolean) => DnsSource;
  private readonly ownsCollection: boolean;
  private processes: ProcessSource;
  private tracker = new Tracker();
  private dns: DnsSource;
  private readonly publicIp: PublicSource;
  private readonly unsubscribePublic: () => void;
  private options: MonitorOptions = {
    intervalMs: 1000,
    dns: true,
    filters: { proto: "all" },
  };
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private ticking = false;
  private sampleSoon = false;
  private lastGood: Snapshot | undefined;
  private lastGoodAt = 0;
  private lastFrame: DesktopFrame | undefined;
  private readonly listeners = new Set<(frame: DesktopFrame) => void>();

  constructor(sources: MonitorSources = {}) {
    this.collect = sources.collect ?? collectSockets;
    this.ownsCollection = !sources.collect;
    this.createProcesses = sources.processes ?? (() => new ProcessTable());
    this.createDns = sources.dns ?? ((enabled) => new ReverseDns(enabled));
    this.processes = this.createProcesses();
    this.dns = this.createDns(true);
    this.publicIp = sources.publicIp?.() ?? new PublicIpQuery();
    this.unsubscribePublic = this.publicIp.onSettled(() => this.emitPublic());
  }

  onFrame(listener: (frame: DesktopFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(options: MonitorOptions): void {
    const next = sanitize(options);
    if (next.portRejected) next.filters.port = this.options.filters.port;
    if (filterKey(next.filters) !== filterKey(this.options.filters)) this.tracker = new Tracker();
    if (next.dns !== this.options.dns) this.dns = this.createDns(next.dns);
    this.options = { intervalMs: next.intervalMs, dns: next.dns, filters: next.filters };
    if (!this.running) {
      this.running = true;
      this.schedule(0);
      return;
    }
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    this.sampleSoon = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.ownsCollection) stopCollection();
    this.unsubscribePublic();
    this.publicIp.stop();
    this.processes.close();
  }

  private emit(frame: DesktopFrame): void {
    this.lastFrame = frame;
    for (const listener of this.listeners) listener(frame);
  }

  private emitPublic(): void {
    if (!this.running || !this.lastFrame) return;
    this.emit({
      ...this.lastFrame,
      publicPending: this.publicIp.isPending(),
      publicIpv4: this.publicIp.ipv4,
      publicIpv6: this.publicIp.ipv6,
    });
  }

  private schedule(delay: number): void {
    if (!this.running) return;
    if (this.ticking) {
      this.sampleSoon = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick();
    }, delay);
  }

  private async tick(): Promise<void> {
    if (!this.running || this.ticking) return;
    this.ticking = true;
    const started = Date.now();
    try {
      const [names, sockets] = await Promise.all([this.processNames(), this.collect()]);
      if (!this.running) return;
      const filtered = filterSockets(sockets, this.options.filters, names);
      const now = Date.now();
      const snapshot = this.tracker.update(filtered, names, now);
      if (this.options.dns) {
        for (const row of snapshot.rows) this.dns.request(row.remoteIp);
      }
      this.lastGood = snapshot;
      this.lastGoodAt = now;
      this.emit(this.frame(snapshot, null, false, now));
    } catch (error) {
      if (!this.running) return;
      const message = error instanceof Error ? error.message : String(error);
      if (this.lastGood) this.emit(this.frame(this.lastGood, message, true, this.lastGoodAt));
      else this.emit(this.frame(emptySnapshot(), message, false, Date.now(), FAILURE_SUMMARY));
    } finally {
      this.ticking = false;
      if (!this.running) return;
      const delay = this.sampleSoon ? 0 : Math.max(0, this.options.intervalMs - (Date.now() - started));
      this.sampleSoon = false;
      this.schedule(delay);
    }
  }

  private frame(
    snapshot: Snapshot,
    error: string | null,
    stale: boolean,
    at: number,
    summary?: string,
  ): DesktopFrame {
    return toFrame(
      snapshot,
      (ip) => this.dns.host(ip),
      at,
      error,
      stale,
      this.publicIp.isPending(),
      this.publicIp.ipv4,
      this.publicIp.ipv6,
      summary,
    );
  }

  private async processNames(): Promise<Map<number, string>> {
    try {
      return await this.processes.snapshot();
    } catch (error) {
      this.processes.close();
      if (!this.running) throw error;
      this.processes = this.createProcesses();
      try {
        return await this.processes.snapshot();
      } catch {
        throw error;
      }
    }
  }
}

function sanitize(options: MonitorOptions): MonitorOptions & { portRejected: boolean } {
  const interval = Number.isFinite(options.intervalMs) ? Math.floor(options.intervalMs) : 1000;
  const port = options.filters?.port;
  const portRejected = port !== undefined && !validPort(port);
  const ipPrefix = typeof options.filters?.ipPrefix === "string" ? options.filters.ipPrefix.trim() : "";
  const process = typeof options.filters?.process === "string" ? options.filters.process.trim() : "";
  return {
    intervalMs: Math.min(Math.max(interval, 200), 60_000),
    dns: options.dns === true,
    portRejected,
    filters: {
      proto: options.filters?.proto === "tcp" || options.filters?.proto === "udp" ? options.filters.proto : "all",
      ipPrefix: ipPrefix || undefined,
      port: portRejected || port === undefined ? undefined : port,
      process: process || undefined,
    },
  };
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function filterKey(filters: Filters): string {
  return `${filters.proto}|${filters.ipPrefix ?? ""}|${filters.port ?? ""}|${filters.process ?? ""}`;
}

function emptySnapshot(): Snapshot {
  return { rows: [], added: [], removed: [], newIps: new Set(), addedKeys: new Set() };
}
