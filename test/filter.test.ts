import assert from "node:assert/strict";
import test from "node:test";
import { filterSockets } from "../src/filter.js";
import type { SocketRow } from "../src/types.js";

const rows: SocketRow[] = [
  {
    proto: "TCP",
    localAddress: "10.0.0.5",
    localPort: 1,
    remoteAddress: "10.1.2.3",
    remotePort: 443,
    state: "Established",
    pid: 1,
  },
  {
    proto: "UDP",
    localAddress: "10.0.0.5",
    localPort: 2,
    remoteAddress: "8.8.8.8",
    remotePort: 53,
    state: "Connected",
    pid: 2,
  },
];

const names = new Map<number, string>([
  [1, "chrome"],
  [2, "svchost"],
]);

test("filters by protocol, ip prefix, port, and process substring", () => {
  assert.deepEqual(
    filterSockets(rows, { proto: "udp" }, names).map((row) => row.remoteAddress),
    ["8.8.8.8"],
  );
  assert.deepEqual(
    filterSockets(rows, { proto: "all", ipPrefix: "10." }, names).map((row) => row.remotePort),
    [443],
  );
  assert.equal(filterSockets(rows, { proto: "all", ipPrefix: "10" }, names).length, 1);
  assert.equal(filterSockets(rows, { proto: "all", port: 53 }, names).length, 1);
  assert.equal(filterSockets(rows, { proto: "all", process: "Chrome" }, names)[0]?.pid, 1);
  assert.equal(filterSockets(rows, { proto: "all", process: "chrome.exe" }, names)[0]?.pid, 1);
  assert.equal(filterSockets(rows, { proto: "all", process: "nope" }, names).length, 0);
});
