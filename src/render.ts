import {
  displayWidth,
  formatClock,
  formatDateTime,
  formatEndpoint,
  padEndWidth,
  padStartWidth,
  truncateWidth,
} from "./format.js";
import { formatLocals } from "./netstat.js";
import type { Filters, LiveRow, Snapshot } from "./types.js";

export interface TableView {
  now: number;
  intervalMs: number;
  filters: Filters;
  color: boolean;
  columns: number;
  hostOf(ip: string): string | undefined;
}

const HEADERS = ["标记", "协议", "本地地址", "远端", "状态", "进程", "PID", "首次发现", "最近可见"];
const PID_COLUMN = 6;

export function renderTable(snapshot: Snapshot, view: TableView): string {
  const rendered = snapshot.rows.map((row) => {
    const host = view.hostOf(row.remoteIp);
    const remote = host
      ? `${formatEndpoint(row.remoteIp, row.remotePort)} (${truncateWidth(host, 40)})`
      : formatEndpoint(row.remoteIp, row.remotePort);
    return {
      added: snapshot.addedKeys.has(row.key),
      newIp: snapshot.newIps.has(row.remoteIp),
      cells: [
        snapshot.addedKeys.has(row.key) ? "新" : "",
        row.proto,
        formatLocals(row.locals),
        remote,
        row.state,
        row.process || "-",
        String(row.pid),
        formatClock(row.firstSeen),
        formatClock(row.lastSeen),
      ],
    };
  });

  const widths = HEADERS.map((header, index) => {
    let width = displayWidth(header);
    for (const row of rendered) width = Math.max(width, displayWidth(row.cells[index] ?? ""));
    return width;
  });

  const join = (cells: string[]) =>
    cells
      .map((cell, index) => {
        const width = widths[index] ?? 0;
        return index === PID_COLUMN ? padStartWidth(cell, width) : padEndWidth(cell, width);
      })
      .join("  ");

  const lines = [
    `${formatDateTime(view.now)}  对外连接 ${snapshot.rows.length} 条  间隔 ${view.intervalMs}ms`,
  ];
  const filterLine = describeFilters(view.filters);
  if (filterLine) lines.push(`筛选  ${filterLine}`);
  lines.push(join(HEADERS));
  lines.push(widths.map((width) => "-".repeat(width)).join("  "));
  if (rendered.length === 0) {
    lines.push("当前没有符合条件的对外连接");
  } else {
    for (const row of rendered) {
      let line = join(row.cells);
      if (view.color && row.newIp) line = `\x1b[93m${line}\x1b[0m`;
      else if (view.color && row.added) line = `\x1b[1m${line}\x1b[0m`;
      lines.push(line);
    }
  }
  lines.push(fitLine(summaryLine(snapshot), view.columns));
  return `${lines.join("\n")}\n`;
}

export function renderJson(
  snapshot: Snapshot,
  hostOf: (ip: string) => string | undefined,
  options: { summary: boolean; at: number },
): string {
  const lines: string[] = [];
  if (options.summary) {
    lines.push(
      JSON.stringify({
        type: "snapshot",
        at: new Date(options.at).toISOString(),
        count: snapshot.rows.length,
      }),
    );
  }
  for (const row of snapshot.rows) {
    lines.push(
      JSON.stringify({
        type: "conn",
        proto: row.proto,
        local: row.locals[0] ?? "",
        locals: row.locals,
        localCount: row.locals.length,
        remoteIp: row.remoteIp,
        remotePort: row.remotePort,
        remote: formatEndpoint(row.remoteIp, row.remotePort),
        remoteHost: hostOf(row.remoteIp) ?? null,
        state: row.state,
        process: row.process || null,
        pid: row.pid,
        firstSeen: new Date(row.firstSeen).toISOString(),
        lastSeen: new Date(row.lastSeen).toISOString(),
        newIp: snapshot.newIps.has(row.remoteIp),
        added: snapshot.addedKeys.has(row.key),
      }),
    );
  }
  if (options.summary) {
    lines.push(
      JSON.stringify({
        type: "summary",
        added: snapshot.added.map(brief),
        removed: snapshot.removed.map(brief),
        at: new Date(options.at).toISOString(),
      }),
    );
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function brief(row: LiveRow): {
  proto: LiveRow["proto"];
  remoteIp: string;
  remotePort: number;
  remote: string;
  state: string;
  process: string | null;
  pid: number;
} {
  return {
    proto: row.proto,
    remoteIp: row.remoteIp,
    remotePort: row.remotePort,
    remote: formatEndpoint(row.remoteIp, row.remotePort),
    state: row.state,
    process: row.process || null,
    pid: row.pid,
  };
}

export function summaryLine(snapshot: Snapshot): string {
  return `${describeChanges("新增", snapshot.added, snapshot.newIps)}  |  ${describeChanges("消失", snapshot.removed, snapshot.newIps)}`;
}

function describeChanges(label: string, rows: LiveRow[], newIps: Set<string>): string {
  if (rows.length === 0) return `${label} 0`;
  const shown = rows.slice(0, 8).map((row) => {
    const mark = newIps.has(row.remoteIp) ? "*" : "";
    const name = row.process || "-";
    return `${mark}${row.proto} ${formatEndpoint(row.remoteIp, row.remotePort)} ${name}/${row.pid}`;
  });
  const extra = rows.length > 8 ? ` ...(+${rows.length - 8})` : "";
  return `${label} ${rows.length}  ${shown.join(", ")}${extra}`;
}

function describeFilters(filters: Filters): string {
  const parts: string[] = [];
  if (filters.proto !== "all") parts.push(`协议=${filters.proto}`);
  if (filters.ipPrefix) parts.push(`远端IP前缀=${filters.ipPrefix}`);
  if (filters.port !== undefined) parts.push(`远端端口=${filters.port}`);
  if (filters.process) parts.push(`进程=${filters.process}`);
  return parts.join("  ");
}

function fitLine(text: string, columns: number): string {
  return truncateWidth(text, Math.max(columns, 40));
}
