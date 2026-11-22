import { formatEndpoint } from "./format.js";
import { processName } from "./processes.js";
import type { LiveRow, Snapshot, SocketRow } from "./types.js";

export class Tracker {
  private rows = new Map<string, LiveRow>();
  private ips = new Set<string>();
  private primed = false;

  update(sockets: SocketRow[], names: Map<number, string>, now: number): Snapshot {
    const groups = new Map<string, SocketRow[]>();
    for (const socket of sockets) {
      const key = `${socket.proto}|${socket.remoteAddress}|${socket.remotePort}|${socket.pid}`;
      const group = groups.get(key);
      if (group) group.push(socket);
      else groups.set(key, [socket]);
    }

    const next = new Map<string, LiveRow>();
    const ips = new Set<string>();
    const added: LiveRow[] = [];

    for (const [key, group] of groups) {
      const sample = group[0];
      if (!sample) continue;
      ips.add(sample.remoteAddress);
      const locals = uniqueLocals(group);
      const state = [...new Set(group.map((socket) => socket.state))].sort().join(",");
      const previous = this.rows.get(key);
      const row: LiveRow = {
        key,
        proto: sample.proto,
        locals,
        remoteIp: sample.remoteAddress,
        remotePort: sample.remotePort,
        state,
        process: processName(names, sample.pid),
        pid: sample.pid,
        firstSeen: previous?.firstSeen ?? now,
        lastSeen: now,
      };
      next.set(key, row);
      if (this.primed && !previous) added.push(row);
    }

    const removed: LiveRow[] = [];
    if (this.primed) {
      for (const [key, row] of this.rows) {
        if (!next.has(key)) removed.push(row);
      }
    }

    const newIps = new Set<string>();
    if (this.primed) {
      for (const ip of ips) {
        if (!this.ips.has(ip)) newIps.add(ip);
      }
    }

    this.rows = next;
    this.ips = ips;
    this.primed = true;
    added.sort(byEndpoint);
    removed.sort(byEndpoint);
    const addedKeys = new Set(added.map((row) => row.key));
    const rows = [...next.values()].sort((left, right) => {
      const leftNew = addedKeys.has(left.key) ? 0 : 1;
      const rightNew = addedKeys.has(right.key) ? 0 : 1;
      return leftNew - rightNew || byEndpoint(left, right);
    });
    return { rows, added, removed, newIps, addedKeys };
  }
}

function uniqueLocals(group: SocketRow[]): string[] {
  const sorted = [...group].sort(
    (left, right) =>
      left.localAddress.localeCompare(right.localAddress) || left.localPort - right.localPort,
  );
  const locals: string[] = [];
  for (const socket of sorted) {
    const label = formatEndpoint(socket.localAddress, socket.localPort);
    if (!locals.includes(label)) locals.push(label);
  }
  return locals;
}

function byEndpoint(left: LiveRow, right: LiveRow): number {
  return (
    left.remoteIp.localeCompare(right.remoteIp) ||
    left.remotePort - right.remotePort ||
    left.proto.localeCompare(right.proto) ||
    left.pid - right.pid
  );
}
