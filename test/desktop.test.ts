import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ConnectionMonitor, toFrame, type MonitorOptions } from "../src/desktop/session.js";
import { Tracker } from "../src/track.js";
import type { SocketRow } from "../src/types.js";

const socket: SocketRow = {
  proto: "TCP",
  localAddress: "10.0.0.8",
  localPort: 50000,
  remoteAddress: "203.0.113.10",
  remotePort: 9,
  state: "Established",
  pid: 42,
};

test("desktop frame marks a new remote and keeps the public address separate", () => {
  const tracker = new Tracker();
  const names = new Map([[42, "node"]]);
  tracker.update([], names, 1_000);
  const snapshot = tracker.update([socket], names, 2_000);
  const frame = toFrame(snapshot, () => "blackhole.test", 2_000, null, false, false, "198.51.100.20", null);
  assert.equal(frame.count, 1);
  assert.equal(frame.rows[0]?.mark, "新");
  assert.equal(frame.rows[0]?.newIp, true);
  assert.equal(frame.rows[0]?.remote, "203.0.113.10:9 (blackhole.test)");
  assert.match(frame.summary, /新增 1/);
  assert.equal(frame.publicIpv4, "198.51.100.20");
  assert.equal(frame.publicIpv6, null);
  assert.equal(frame.error, null);
});

function monitorWith(
  t: TestContext,
  collect: () => Promise<SocketRow[]>,
  addresses: { ipv4: string | null; ipv6: string | null } = { ipv4: "198.51.100.10", ipv6: null },
) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let notify = (): void => {};
  const monitor = new ConnectionMonitor({
    collect,
    processes: () => ({
      snapshot: async () => new Map([[42, "node"]]),
      close() {},
    }),
    dns: () => ({ request() {}, host: () => undefined }),
    publicIp: () => ({
      get ipv4() {
        return addresses.ipv4;
      },
      get ipv6() {
        return addresses.ipv6;
      },
      isPending: () => false,
      stop() {},
      onSettled(listener: () => void) {
        notify = listener;
        return () => {};
      },
    }),
  });
  return {
    monitor,
    notify: () => notify(),
    async step(ms = 0) {
      t.mock.timers.tick(ms);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

const baseOptions: MonitorOptions = {
  intervalMs: 1000,
  dns: false,
  filters: { proto: "all" },
};

test("an out-of-range port keeps the previous port filter", async (t) => {
  const { monitor, step } = monitorWith(t, async () => [socket]);
  const frames: { count: number }[] = [];
  monitor.onFrame((frame) => frames.push(frame));
  monitor.update({ ...baseOptions, filters: { proto: "all", port: 9 } });
  await step();
  assert.equal(frames.at(-1)?.count, 1);
  monitor.update({ ...baseOptions, filters: { proto: "all", port: 70_000 } });
  await step();
  assert.equal(frames.at(-1)?.count, 1);
  monitor.update({ ...baseOptions, filters: { proto: "all", port: 443 } });
  await step();
  assert.equal(frames.at(-1)?.count, 0);
  monitor.stop();
});

test("shrinking the interval samples again without waiting out the old timer", async (t) => {
  let reads = 0;
  const { monitor, step } = monitorWith(t, async () => {
    reads += 1;
    return [socket];
  });
  monitor.onFrame(() => {});
  monitor.update({ ...baseOptions, intervalMs: 60_000 });
  await step();
  assert.equal(reads, 1);
  await step(59_999);
  assert.equal(reads, 1);
  monitor.update({ ...baseOptions, intervalMs: 200 });
  await step();
  assert.equal(reads, 2);
  monitor.stop();
});

test("the first failed read is not reported as an empty success", async (t) => {
  const { monitor, step } = monitorWith(t, async () => {
    throw new Error("netstat failed");
  });
  let frame;
  monitor.onFrame((next) => {
    frame = next;
  });
  monitor.update(baseOptions);
  await step();
  assert.equal(frame?.error, "netstat failed");
  assert.equal(frame?.stale, false);
  assert.equal(frame?.count, 0);
  assert.equal(frame?.summary, "没有可用的连接表");
  monitor.stop();
});

test("a later failure keeps the last good rows and their time", async (t) => {
  let fail = false;
  const { monitor, step } = monitorWith(t, async () => {
    if (fail) throw new Error("netstat failed");
    return [socket];
  });
  let frame;
  monitor.onFrame((next) => {
    frame = next;
  });
  monitor.update(baseOptions);
  await step();
  const seenAt = frame?.at ?? 0;
  assert.equal(frame?.count, 1);
  fail = true;
  await step(1000);
  assert.equal(frame?.stale, true);
  assert.equal(frame?.error, "netstat failed");
  assert.equal(frame?.count, 1);
  assert.equal(frame?.at, seenAt);
  monitor.stop();
});

test("changing the filter starts a new baseline instead of marking every match new", async (t) => {
  const { monitor, step } = monitorWith(t, async () => [socket]);
  let frame;
  monitor.onFrame((next) => {
    frame = next;
  });
  monitor.update({ ...baseOptions, filters: { proto: "all", port: 80 } });
  await step();
  assert.equal(frame?.count, 0);
  monitor.update({ ...baseOptions, filters: { proto: "all" } });
  await step();
  assert.equal(frame?.count, 1);
  assert.equal(frame?.rows[0]?.mark, "");
  monitor.stop();
});

test("a settled public address updates the latest frame without another socket read", async (t) => {
  const addresses: { ipv4: string | null; ipv6: string | null } = { ipv4: null, ipv6: null };
  let reads = 0;
  const { monitor, notify, step } = monitorWith(t, async () => {
    reads += 1;
    return [socket];
  }, addresses);
  let frame;
  monitor.onFrame((next) => {
    frame = next;
  });
  monitor.update(baseOptions);
  await step();
  assert.equal(reads, 1);
  assert.equal(frame?.publicIpv4, null);
  addresses.ipv4 = "198.51.100.20";
  notify();
  assert.equal(frame?.publicIpv4, "198.51.100.20");
  assert.equal(reads, 1);
  monitor.stop();
});
