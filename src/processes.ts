import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { CollectError } from "./errors.js";

const SCRIPT = [
  "$ProgressPreference = 'SilentlyContinue'",
  "$ErrorActionPreference = 'Continue'",
  "$WarningPreference = 'SilentlyContinue'",
  "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
  "[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false",
  "while ($true) {",
  "  $cmd = [Console]::In.ReadLine()",
  "  if ($null -eq $cmd -or $cmd -eq 'EXIT') { break }",
  "  if ($cmd -ne 'PROC') { continue }",
  "  try {",
  "    Get-Process | ForEach-Object {",
  "      $name = (('' + $_.ProcessName) -replace '[\\r\\n|]', ' ')",
  "      [Console]::WriteLine(('P|' + $_.Id + '|' + $name))",
  "    }",
  "    [Console]::WriteLine('END')",
  "  } catch {",
  "    $msg = (('' + $_.Exception.Message) -replace '[\\r\\n]', ' ')",
  "    [Console]::WriteLine(('ERR|' + $msg))",
  "    [Console]::WriteLine('END')",
  "  }",
  "  [Console]::Out.Flush()",
  "}",
].join("\n");

interface Pending {
  resolve: (names: Map<number, string>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class ProcessTable {
  private readonly child: ChildProcessWithoutNullStreams;
  private buf = "";
  private batch: Map<number, string> | null = null;
  private batchError: string | null = null;
  private pending: Pending | null = null;
  private closed = false;
  private stderr = "";

  constructor() {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const exe = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    this.child = spawn(
      exe,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodeCommand(SCRIPT)],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-2000);
    });
    this.child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        this.fail(new CollectError("未找到 powershell.exe，无法关联连接所属进程。", "NOT_FOUND"));
        return;
      }
      this.fail(new CollectError(`无法启动 powershell.exe：${error.message}`, "FAILED"));
    });
    this.child.on("exit", (code) => {
      if (this.closed) return;
      const detail = this.stderr.trim();
      this.fail(
        new CollectError(
          `关联进程失败：powershell 已退出（代码 ${code ?? "null"}）${detail ? `：${detail}` : ""}`,
          "FAILED",
        ),
      );
    });
  }

  snapshot(): Promise<Map<number, string>> {
    if (this.closed) return Promise.reject(new CollectError("进程查询已关闭", "FAILED"));
    if (this.pending) return Promise.reject(new CollectError("上一次进程查询尚未结束", "FAILED"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new CollectError("关联进程超时，无法读取进程名。", "FAILED"));
      }, 8000);
      this.pending = { resolve, reject, timer };
      this.batch = new Map();
      this.batchError = null;
      this.child.stdin.write("PROC\n");
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new CollectError("进程查询已关闭", "FAILED"));
      this.pending = null;
    }
    try {
      this.child.stdin.write("EXIT\n");
    } catch {
      // The process may already be gone.
    }
    this.child.kill();
  }

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let newline = this.buf.indexOf("\n");
    while (newline >= 0) {
      let line = this.buf.slice(0, newline);
      this.buf = this.buf.slice(newline + 1);
      line = line.replace(/\r$/, "").replace(/^\uFEFF/, "");
      this.consume(line);
      newline = this.buf.indexOf("\n");
    }
  }

  private consume(line: string): void {
    if (!this.pending || !this.batch) return;
    if (line.startsWith("P|")) {
      const first = line.indexOf("|");
      const second = line.indexOf("|", first + 1);
      if (second < 0) return;
      const pid = Number(line.slice(first + 1, second));
      if (!Number.isInteger(pid)) return;
      this.batch.set(pid, line.slice(second + 1).trim());
      return;
    }
    if (line.startsWith("ERR|")) {
      this.batchError = line.slice(4).trim();
      return;
    }
    if (line !== "END") return;
    const pending = this.pending;
    const batch = this.batch;
    const errorText = this.batchError;
    this.pending = null;
    this.batch = null;
    this.batchError = null;
    clearTimeout(pending.timer);
    if (errorText) {
      pending.reject(processFailure(errorText));
      return;
    }
    pending.resolve(batch);
  }

  private fail(error: Error): void {
    this.closed = true;
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    const pending = this.pending;
    this.pending = null;
    pending.reject(error);
  }
}

export function processName(names: Map<number, string>, pid: number): string {
  const known = names.get(pid);
  if (known) return known;
  if (pid === 4) return "System";
  return "";
}

export function matchesProcess(name: string, query: string): boolean {
  const haystack = name.toLowerCase();
  const needle = query.toLowerCase();
  return haystack.includes(needle) || `${haystack}.exe`.includes(needle);
}

function processFailure(message: string): CollectError {
  if (/access is denied|拒绝访问|unauthorized|未授权/i.test(message)) {
    return new CollectError("权限不足，无法关联连接所属进程。请用管理员身份打开 PowerShell 后重试。", "ACCESS_DENIED");
  }
  if (/not recognized|CommandNotFoundException|不是内部或外部命令/i.test(message)) {
    return new CollectError("未找到 powershell，无法关联连接所属进程。", "NOT_FOUND");
  }
  return new CollectError(`关联进程失败：${message}`, "FAILED");
}

function encodeCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}
