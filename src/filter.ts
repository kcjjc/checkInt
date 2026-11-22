import { matchesProcess, processName } from "./processes.js";
import type { Filters, SocketRow } from "./types.js";

export function filterSockets(
  rows: SocketRow[],
  filters: Filters,
  names: Map<number, string>,
): SocketRow[] {
  const ipPrefix = filters.ipPrefix?.toLowerCase();
  return rows.filter((row) => {
    if (filters.proto !== "all" && row.proto.toLowerCase() !== filters.proto) return false;
    if (ipPrefix && !row.remoteAddress.toLowerCase().startsWith(ipPrefix)) return false;
    if (filters.port !== undefined && row.remotePort !== filters.port) return false;
    if (filters.process && !matchesProcess(processName(names, row.pid), filters.process)) return false;
    return true;
  });
}
