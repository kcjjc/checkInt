import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import dgram from "node:dgram";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectSockets } from "../src/netstat.js";
import { ProcessTable } from "../src/processes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "src", "index.ts");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], timeoutMs = 20000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", entry, ...args], {
      cwd: root,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout\n${stderr}\n${stdout.slice(0, 800)}`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function jsonLines(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("reads the live connection table and process names", async () => {
  const rows = await collectSockets();
  for (const row of rows) {
    assert.notEqual(row.state.toLowerCase(), "listen");
    assert.notEqual(row.state.toLowerCase(), "listening");
    assert.ok(row.remotePort > 0);
    assert.notEqual(row.remoteAddress, "0.0.0.0");
    assert.notEqual(row.remoteAddress, "::");
    assert.notEqual(row.remoteAddress, "*");
  }
  const table = new ProcessTable();
  try {
    const names = await table.snapshot();
    assert.ok(names.size > 0);
    const named = rows.filter((row) => names.has(row.pid) || row.pid === 0 || row.pid === 4);
    if (rows.length > 0) assert.ok(named.length > 0);
  } finally {
    table.close();
  }
});

test("cli snapshot and filters", async () => {
  const once = await runCli(["--json", "--once", "--no-dns"]);
  assert.equal(once.code, 0, once.stderr);
  const connections = jsonLines(once.stdout);
  assert.ok(connections.length > 0, once.stdout);
  for (const row of connections) {
    assert.equal(row.type, "conn");
    assert.notEqual(String(row.state).toLowerCase(), "listening");
    assert.equal(typeof row.remoteIp, "string");
    assert.equal(typeof row.remotePort, "number");
    assert.equal(typeof row.local, "string");
    assert.equal(typeof row.pid, "number");
    assert.equal(typeof row.firstSeen, "string");
    assert.equal(typeof row.lastSeen, "string");
    assert.equal(row.remoteHost, null);
    assert.ok(row.proto === "TCP" || row.proto === "UDP");
  }

  const port = await runCli(["--json", "--once", "--no-dns", "--port", "443"]);
  assert.equal(port.code, 0, port.stderr);
  for (const row of jsonLines(port.stdout)) assert.equal(row.remotePort, 443);

  const ip = await runCli(["--json", "--once", "--no-dns", "--ip", "203.0.113."]);
  assert.equal(ip.code, 0, ip.stderr);
  assert.equal(jsonLines(ip.stdout).length, 0);

  const missing = await runCli(["--json", "--once", "--no-dns", "--process", "___no_such_process___"]);
  assert.equal(missing.code, 0, missing.stderr);
  assert.equal(jsonLines(missing.stdout).length, 0);

  const tcp = await runCli(["--json", "--once", "--no-dns", "--proto", "tcp"]);
  assert.equal(tcp.code, 0, tcp.stderr);
  for (const row of jsonLines(tcp.stdout)) assert.equal(row.proto, "TCP");

  const bad = await runCli(["--interval", "50"]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.stderr, /200/);
});

test("watch mode reports a new udp peer and then its removal", async () => {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", entry, "--json", "--interval", "300", "--ip", "203.0.113.10", "--port", "9", "--no-dns"],
    { cwd: root, windowsHide: true },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const waitFor = async (predicate: () => boolean, timeoutMs: number) => {
    const started = Date.now();
    while (!predicate()) {
      if (child.exitCode !== null) {
        throw new Error(`cli exited ${child.exitCode}\n${stderr}\n${stdout}`);
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timeout\n${stderr}\n${stdout}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  };

  try {
    await waitFor(() => stdout.includes('"type":"summary"'), 15000);
    const socket = dgram.createSocket("udp4");
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.connect(9, "203.0.113.10", () => {
          socket.send(Buffer.from("x"), (error) => (error ? reject(error) : resolve()));
        });
      });
      await waitFor(() => {
        return stdout.split(/\r?\n/).some((line) => {
          if (!line.includes("203.0.113.10")) return false;
          try {
            const row = JSON.parse(line) as { type?: string; added?: boolean; remotePort?: number };
            return row.type === "conn" && row.added === true && row.remotePort === 9;
          } catch {
            return false;
          }
        });
      }, 8000);
    } finally {
      socket.close();
    }

    await waitFor(() => {
      return stdout.split(/\r?\n/).some((line) => {
        if (!line.includes('"removed"') || !line.includes("203.0.113.10")) return false;
        try {
          const row = JSON.parse(line) as { type?: string; removed?: Array<{ remoteIp?: string }> };
          return row.type === "summary" && row.removed?.some((item) => item.remoteIp === "203.0.113.10");
        } catch {
          return false;
        }
      });
    }, 8000);
  } finally {
    child.kill();
  }
});
