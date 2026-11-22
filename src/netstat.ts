import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { CollectError } from "./errors.js";
import type { Proto, SocketRow } from "./types.js";

let activeNetstat: ChildProcess | undefined;

export function stopCollection(): void {
  activeNetstat?.kill();
}

const LISTEN_STATES = new Set(["listening", "listen", "侦听", "监听"]);

const STATE_NAMES: Record<string, string> = {
  ESTABLISHED: "Established",
  SYN_SENT: "SynSent",
  SYN_RECEIVED: "SynReceived",
  FIN_WAIT_1: "FinWait1",
  FIN_WAIT_2: "FinWait2",
  TIME_WAIT: "TimeWait",
  CLOSE_WAIT: "CloseWait",
  CLOSING: "Closing",
  LAST_ACK: "LastAck",
  CLOSED: "Closed",
  DELETE_TCB: "DeleteTcb",
  BOUND: "Bound",
  CONNECTED: "Connected",
};

/**
 * Read the Windows TCP/UDP connection table.
 * `Get-NetTCPConnection` is the same table but too slow for a 200ms refresh,
 * and `Get-NetUDPEndpoint` has no remote address. `netstat -ano` is the
 * read-only view that includes both non-listen TCP and UDP peers.
 */
export function collectSockets(): Promise<SocketRow[]> {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const cmd = path.join(systemRoot, "System32", "cmd.exe");
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, ["/d", "/s", "/c", "chcp 437>nul & netstat -ano"], {
      windowsHide: true,
    });
    activeNetstat = child;
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (activeNetstat === child) activeNetstat = undefined;
      fn();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => {
        reject(new CollectError("读取连接表超时：netstat 没有在时限内返回", "FAILED"));
      });
    }, 8000);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(() => {
        if (error.code === "ENOENT") {
          reject(new CollectError("未找到 cmd.exe / netstat，无法读取本机连接表。", "NOT_FOUND"));
          return;
        }
        reject(new CollectError(`无法启动 netstat：${error.message}`, "FAILED"));
      });
    });
    child.on("close", (code) => {
      finish(() => {
        const stdout = Buffer.concat(out).toString("utf8");
        const stderr = Buffer.concat(err).toString("utf8");
        if (code !== 0) {
          reject(netstatFailure(code, stdout, stderr));
          return;
        }
        if (!stdout.trim()) {
          reject(new CollectError("读取连接表失败：netstat 没有输出", "FAILED"));
          return;
        }
        if (!/Active Connections|\bTCP\b|\bUDP\b/.test(stdout)) {
          const detail = stderr.trim();
          reject(
            new CollectError(
              `读取连接表失败：无法识别 netstat 输出${detail ? `：${detail}` : ""}`,
              "FAILED",
            ),
          );
          return;
        }
        resolve(parseNetstat(stdout));
      });
    });
  });
}

export function netstatFailure(code: number | null, stdout: string, stderr: string): CollectError {
  const detail = `${stderr}\n${stdout}`;
  if (/access is denied|requires elevation|拒绝访问|操作需要提升/i.test(detail)) {
    return new CollectError(
      "权限不足，无法读取本机连接表。请用管理员身份打开 PowerShell 后重试。",
      "ACCESS_DENIED",
    );
  }
  if (/not recognized|不是内部或外部命令|无法将["“']?netstat/i.test(detail)) {
    return new CollectError(
      "未找到 netstat，无法读取本机连接表。请确认 C:\\Windows\\System32\\netstat.exe 存在。",
      "NOT_FOUND",
    );
  }
  const extra = stderr.trim();
  return new CollectError(
    `读取连接表失败：netstat 退出码 ${code ?? "null"}${extra ? `：${extra}` : ""}`,
    "FAILED",
  );
}

export function parseNetstat(text: string): SocketRow[] {
  const rows: SocketRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const tokens = raw.trim().split(/\s+/);
    const protoToken = tokens[0]?.toUpperCase();
    if (protoToken !== "TCP" && protoToken !== "UDP") continue;
    if (tokens.length < 4) continue;
    const pidToken = tokens[tokens.length - 1] ?? "";
    if (!/^\d+$/.test(pidToken)) continue;
    const local = splitHostPort(tokens[1] ?? "");
    const remote = splitHostPort(tokens[2] ?? "");
    if (!local || !remote) continue;
    const stateToken = tokens.length >= 5 ? (tokens[3] ?? "") : "";
    if (isListening(stateToken)) continue;
    if (remote.port === 0 || isUnspecified(remote.host) || isLoopback(remote.host)) continue;
    const proto = protoToken as Proto;
    rows.push({
      proto,
      localAddress: normalizeHost(local.host),
      localPort: local.port,
      remoteAddress: normalizeHost(remote.host),
      remotePort: remote.port,
      state: proto === "UDP" && !stateToken ? "Connected" : normalizeState(stateToken),
      pid: Number(pidToken),
    });
  }
  return rows;
}

export function splitHostPort(token: string): { host: string; port: number } | null {
  if (token === "*:*" || token === "*") return { host: "*", port: 0 };
  let host = "";
  let portText = "";
  if (token.startsWith("[")) {
    const end = token.indexOf("]");
    if (end < 0 || token[end + 1] !== ":") return null;
    host = token.slice(1, end);
    portText = token.slice(end + 2);
  } else {
    const colon = token.lastIndexOf(":");
    if (colon <= 0) return null;
    host = token.slice(0, colon);
    portText = token.slice(colon + 1);
  }
  if (!/^\d+$/.test(portText)) return null;
  const port = Number(portText);
  if (port > 65535) return null;
  return { host, port };
}

function isListening(state: string): boolean {
  return LISTEN_STATES.has(state.toLowerCase());
}

function isLoopback(host: string): boolean {
  let value = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (value.startsWith("::ffff:")) value = value.slice("::ffff:".length);
  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "127") return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255);
}

function isUnspecified(host: string): boolean {
  const value = host.toLowerCase().replace(/^\[|\]$/g, "");
  return value === "*" || value === "0.0.0.0" || value === "::" || value === "0:0:0:0:0:0:0:0";
}

function normalizeHost(host: string): string {
  const value = host.trim();
  return value.includes(":") ? value.toLowerCase() : value;
}

function normalizeState(token: string): string {
  if (!token) return "Unknown";
  return STATE_NAMES[token.toUpperCase()] ?? token;
}

export function formatLocals(locals: string[]): string {
  if (locals.length === 0) return "-";
  if (locals.length === 1) return locals[0] ?? "-";
  return `${locals[0]} (+${locals.length - 1})`;
}
