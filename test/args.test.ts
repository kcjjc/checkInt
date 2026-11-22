import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../src/args.js";
import { ArgError } from "../src/errors.js";

test("defaults to a one second watch of every protocol", () => {
  const options = parseArgs([]);
  assert.equal(options.once, false);
  assert.equal(options.intervalMs, 1000);
  assert.equal(options.proto, "all");
  assert.equal(options.json, false);
  assert.equal(options.dns, true);
  assert.equal(options.publicIp, false);
});

test("reads flags in both spaced and equals forms", () => {
  const options = parseArgs([
    "--once",
    "--interval",
    "250",
    "--proto=udp",
    "--ip",
    "10.23",
    "--port=443",
    "--process",
    "Chrome",
    "--json",
    "--no-dns",
    "--public-ip",
  ]);
  assert.equal(options.once, true);
  assert.equal(options.intervalMs, 250);
  assert.equal(options.proto, "udp");
  assert.equal(options.ipPrefix, "10.23");
  assert.equal(options.port, 443);
  assert.equal(options.process, "Chrome");
  assert.equal(options.json, true);
  assert.equal(options.dns, false);
  assert.equal(options.publicIp, true);
});

test("rejects an interval below 200ms and unknown flags", () => {
  assert.throws(() => parseArgs(["--interval", "199"]), ArgError);
  assert.throws(() => parseArgs(["--proto", "icmp"]), ArgError);
  assert.throws(() => parseArgs(["--port", "0"]), ArgError);
  assert.throws(() => parseArgs(["--ip"]), ArgError);
  assert.throws(() => parseArgs(["--extra"]), /未知参数/);
});
