import assert from "node:assert/strict";
import test from "node:test";
import { CollectError } from "../src/errors.js";
import { netstatFailure, parseNetstat } from "../src/netstat.js";

const SAMPLE = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1672
  TCP    [::]:135               [::]:0                 LISTENING       1672
  TCP    10.23.100.79:49176     52.21.130.202:443      ESTABLISHED     10100
  TCP    10.23.100.79:49290     113.96.24.117:18021    ESTABLISHED     16408
  TCP    10.23.100.79:50001     113.96.24.117:18021    ESTABLISHED     16408
  TCP    10.23.100.79:54283     123.58.184.232:443     CLOSE_WAIT      22360
  TCP    10.23.100.79:60000     9.9.9.9:53             TIME_WAIT       16408
  TCP    10.23.100.79:60001     1.1.1.1:443            SYN_SENT        50
  TCP    10.23.100.79:60002     1.0.0.1:443            FIN_WAIT_1      51
  TCP    10.23.100.79:60003     1.0.0.1:443            FIN_WAIT_2      51
  TCP    127.0.0.1:5037         127.0.0.1:54321        ESTABLISHED     70
  TCP    [::1]:52283            [::1]:13688            ESTABLISHED     80
  TCP    [2409:8a00::1]:49999   [2607:f8b0:4001:c00::bc]:443  ESTABLISHED  5678
  UDP    0.0.0.0:5050           *:*                                    9796
  UDP    0.0.0.0:51030          119.29.29.29:53                        16408
  UDP    [::]:5353              *:*                                    2452
  UDP    [fe80::1]:53000        [fe80::2]:53                           80
`;

test("keeps established outbound sockets and drops listeners", () => {
  const rows = parseNetstat(SAMPLE);
  assert.equal(rows.some((row) => row.state.toLowerCase().includes("listen")), false);
  assert.equal(rows.some((row) => row.remoteAddress === "*" || row.remotePort === 0), false);

  const established = rows.find((row) => row.remoteAddress === "52.21.130.202");
  assert.ok(established);
  assert.equal(established.proto, "TCP");
  assert.equal(established.localAddress, "10.23.100.79");
  assert.equal(established.localPort, 49176);
  assert.equal(established.remotePort, 443);
  assert.equal(established.state, "Established");
  assert.equal(established.pid, 10100);

  assert.equal(rows.find((row) => row.remoteAddress === "123.58.184.232")?.state, "CloseWait");
  assert.equal(rows.find((row) => row.remoteAddress === "9.9.9.9")?.state, "TimeWait");
  assert.equal(rows.find((row) => row.remoteAddress === "1.1.1.1")?.state, "SynSent");
  assert.equal(rows.filter((row) => row.remoteAddress === "1.0.0.1").map((row) => row.state).sort().join(","), "FinWait1,FinWait2");
  assert.equal(rows.find((row) => row.remoteAddress === "119.29.29.29")?.state, "Connected");
  assert.equal(rows.find((row) => row.remoteAddress === "119.29.29.29")?.proto, "UDP");
  assert.equal(rows.find((row) => row.remoteAddress === "2607:f8b0:4001:c00::bc")?.remotePort, 443);
  assert.equal(rows.find((row) => row.remoteAddress === "fe80::2")?.proto, "UDP");
  assert.equal(rows.some((row) => row.remoteAddress === "127.0.0.1" || row.remoteAddress === "::1"), false);
});

test("names permission and missing-command failures", () => {
  assert.equal(netstatFailure(1, "", "Access is denied.").code, "ACCESS_DENIED");
  assert.equal(netstatFailure(1, "", "请求的操作需要提升。").code, "ACCESS_DENIED");
  assert.match(netstatFailure(1, "'netstat' is not recognized", "").message, /未找到 netstat/);
  assert.equal(new CollectError("x", "FAILED").code, "FAILED");
});
