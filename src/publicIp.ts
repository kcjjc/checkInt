import https from "node:https";
import net from "node:net";
import os from "node:os";

export interface PublicAddresses {
  ipv4: string | null;
  ipv6: string | null;
}

export type TextFetcher = (url: string, family: 4 | 6, timeoutMs: number, signal?: AbortSignal) => Promise<string>;

const IPV4_URLS = ["https://api.ipify.org", "https://ipv4.icanhazip.com", "https://v4.ident.me"];
const IPV6_URLS = ["https://api6.ipify.org", "https://ipv6.icanhazip.com", "https://v6.ident.me"];
const LOOKUP_TIMEOUT_MS = 2000;

export async function lookupPublicAddresses(fetchText: TextFetcher = httpsGetText): Promise<PublicAddresses> {
  const [ipv4, ipv6] = await Promise.all([
    firstAddress(IPV4_URLS, 4, fetchText),
    firstAddress(IPV6_URLS, 6, fetchText),
  ]);
  return { ipv4, ipv6 };
}

export function parseEchoAddress(body: string, family: 4 | 6): string | null {
  const value = body.trim().split(/\s+/)[0] ?? "";
  if (net.isIP(value) !== family) return null;
  if (family === 4 && isUnusableIPv4(value)) return null;
  if (family === 6 && isUnusableIPv6(value)) return null;
  return value;
}

export function formatPublicIp(addresses: PublicAddresses, json: boolean): string {
  if (json) return `${JSON.stringify({ ipv4: addresses.ipv4, ipv6: addresses.ipv6 })}\n`;
  return `IPv4  ${addresses.ipv4 ?? "不可用"}\nIPv6  ${addresses.ipv6 ?? "不可用"}\n`;
}

export class PublicIpQuery {
  ipv4: string | null = null;
  ipv6: string | null = null;
  private pending = true;
  private inflight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | undefined;
  private readonly settled = new Set<() => void>();

  constructor(private readonly lookup: () => Promise<PublicAddresses> = lookupPublicAddresses) {
    void this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, 5 * 60 * 1000);
    this.timer.unref();
  }

  line(): string {
    if (this.pending) return "公网 查询中";
    return `公网 IPv4 ${this.ipv4 ?? "不可用"}  IPv6 ${this.ipv6 ?? "不可用"}`;
  }

  isPending(): boolean {
    return this.pending;
  }

  onSettled(listener: () => void): () => void {
    this.settled.add(listener);
    return () => this.settled.delete(listener);
  }

  settle(timeoutMs: number): Promise<void> {
    const current = this.inflight ?? Promise.resolve();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    return Promise.race([current, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.lookup()
      .then((result) => {
        this.ipv4 = result.ipv4;
        this.ipv6 = result.ipv6;
      })
      .catch(() => {
        // A thrown lookup keeps the last answer. A completed lookup with nulls clears it.
      })
      .finally(() => {
        this.pending = false;
        this.inflight = null;
        for (const listener of this.settled) listener();
      });
    return this.inflight;
  }
}

async function firstAddress(urls: string[], family: 4 | 6, fetchText: TextFetcher): Promise<string | null> {
  if (family === 6 && !hasGlobalIPv6()) return null;
  const controller = new AbortController();
  try {
    return await new Promise((resolve) => {
      let pending = urls.length;
      let settled = false;
      let timeout: NodeJS.Timeout | undefined;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        controller.abort();
        resolve(value);
      };
      timeout = setTimeout(() => finish(null), LOOKUP_TIMEOUT_MS);
      for (const url of urls) {
        fetchText(url, family, LOOKUP_TIMEOUT_MS, controller.signal).then(
          (body) => {
            const address = parseEchoAddress(body, family);
            if (address) finish(address);
            else if (--pending === 0) finish(null);
          },
          () => {
            if (--pending === 0) finish(null);
          },
        );
      }
    });
  } finally {
    controller.abort();
  }
}

const UNUSABLE_IPV6 = new net.BlockList();
UNUSABLE_IPV6.addSubnet("::", 128, "ipv6");
UNUSABLE_IPV6.addSubnet("::1", 128, "ipv6");
UNUSABLE_IPV6.addSubnet("fe80::", 10, "ipv6");
UNUSABLE_IPV6.addSubnet("fc00::", 7, "ipv6");
UNUSABLE_IPV6.addSubnet("ff00::", 8, "ipv6");
UNUSABLE_IPV6.addSubnet("::ffff:0:0", 96, "ipv6");

function hasGlobalIPv6(): boolean {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = entry.family as string | number;
      if (family !== "IPv6" && family !== 6) continue;
      if (entry.internal) continue;
      if (!isUnusableIPv6(entry.address)) return true;
    }
  }
  return false;
}

function httpsGetText(url: string, family: 4 | 6, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new Error("aborted"));
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const req = https.get(
      url,
      { family, signal, headers: { "User-Agent": "check-int", Accept: "text/plain" } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300) {
          res.on("error", () => {});
          res.resume();
          reject(new Error(status < 400 ? "公网地址服务发生了重定向" : `公网地址服务返回 HTTP ${status}`));
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > 512) {
            req.destroy(new Error("公网地址响应过长"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        res.on("end", () => {
          clearTimeout(timer);
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      },
    );
    timer = setTimeout(() => req.destroy(new Error("查询公网地址超时")), timeoutMs);
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.on("close", () => clearTimeout(timer));
  });
}

function isUnusableIPv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const first = parts[0] ?? -1;
  const second = parts[1] ?? -1;
  if (first === 0 || first === 10 || first === 127 || first >= 224) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  return false;
}

function isUnusableIPv6(value: string): boolean {
  if (net.isIP(value) !== 6) return true;
  return UNUSABLE_IPV6.check(value, "ipv6");
}
