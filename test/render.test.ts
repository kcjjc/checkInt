import assert from "node:assert/strict";
import test from "node:test";
import { renderJson, renderTable } from "../src/render.js";
import { Tracker } from "../src/track.js";
import type { SocketRow } from "../src/types.js";

const base: SocketRow = {
  proto: "TCP",
  localAddress: "10.0.0.8",
  localPort: 50000,
  remoteAddress: "203.0.113.10",
  remotePort: 9,
  state: "Established",
  pid: 42,
};

test("marks a new remote ip and lists it in the summary", () => {
  const tracker = new Tracker();
  const names = new Map([[42, "node"]]);
  tracker.update([], names, 1_000);
  const snapshot = tracker.update([base], names, 2_000);
  const text = renderTable(snapshot, {
    now: 2_000,
    intervalMs: 1000,
    filters: { proto: "all" },
    color: true,
    columns: 120,
    hostOf: () => "blackhole.test",
  });
  assert.match(text, /新/);
  assert.match(text, /203\.0\.113\.10:9 \(blackhole\.test\)/);
  assert.match(text, /\x1b\[93m/);
  assert.match(text, /新增 1/);
  assert.match(text, /消失 0/);
  assert.doesNotMatch(text, /LISTENING|Listen/);

  const gone = tracker.update([], names, 3_000);
  const after = renderTable(gone, {
    now: 3_000,
    intervalMs: 1000,
    filters: { proto: "all" },
    color: false,
    columns: 80,
    hostOf: () => undefined,
  });
  assert.match(after, /当前没有符合条件的对外连接/);
  assert.match(after, /消失 1/);
  assert.match(after, /203\.0\.113\.10:9/);
});

test("json mode prints one object per line", () => {
  const tracker = new Tracker();
  const names = new Map([[42, "node"]]);
  const snapshot = tracker.update([base], names, Date.parse("2026-11-22T02:00:00Z"));
  const text = renderJson(snapshot, () => undefined, { summary: false, at: Date.parse("2026-11-22T02:00:00Z") });
  const lines = text.trim().split("\n");
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0] ?? "") as { remoteIp: string; pid: number; remoteHost: null; state: string };
  assert.equal(row.remoteIp, "203.0.113.10");
  assert.equal(row.pid, 42);
  assert.equal(row.remoteHost, null);
  assert.equal(row.state, "Established");
});
