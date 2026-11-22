import assert from "node:assert/strict";
import test from "node:test";
import { Tracker } from "../src/track.js";
import type { SocketRow } from "../src/types.js";

function socket(overrides: Partial<SocketRow> = {}): SocketRow {
  return {
    proto: "TCP",
    localAddress: "10.0.0.5",
    localPort: 40000,
    remoteAddress: "1.1.1.1",
    remotePort: 443,
    state: "Established",
    pid: 10,
    ...overrides,
  };
}

test("dedups by remote ip, port, and pid, then reports add and remove", () => {
  const tracker = new Tracker();
  const names = new Map<number, string>([[10, "node"]]);
  const first = tracker.update(
    [socket(), socket({ localPort: 40001 }), socket({ localPort: 40002 })],
    names,
    1_000,
  );
  assert.equal(first.rows.length, 1);
  assert.deepEqual(first.rows[0]?.locals, ["10.0.0.5:40000", "10.0.0.5:40001", "10.0.0.5:40002"]);
  assert.equal(first.added.length, 0);
  assert.equal(first.removed.length, 0);
  assert.equal(first.newIps.size, 0);
  assert.equal(first.rows[0]?.firstSeen, 1_000);

  const second = tracker.update(
    [socket({ localPort: 40003 }), socket({ remoteAddress: "8.8.8.8", remotePort: 53, pid: 11 })],
    new Map([
      [10, "node"],
      [11, "svchost"],
    ]),
    2_000,
  );
  assert.equal(second.rows.length, 2);
  assert.equal(second.rows[0]?.remoteIp, "8.8.8.8");
  assert.equal(second.added.length, 1);
  assert.equal(second.added[0]?.process, "svchost");
  assert.equal(second.newIps.has("8.8.8.8"), true);
  assert.equal(second.newIps.has("1.1.1.1"), false);
  const kept = second.rows.find((row) => row.remoteIp === "1.1.1.1");
  assert.equal(kept?.firstSeen, 1_000);
  assert.equal(kept?.lastSeen, 2_000);

  const third = tracker.update([socket()], names, 3_000);
  assert.equal(third.rows.length, 1);
  assert.equal(third.removed.length, 1);
  assert.equal(third.removed[0]?.remoteIp, "8.8.8.8");
  assert.equal(third.added.length, 0);
});
