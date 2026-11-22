import assert from "node:assert/strict";
import test from "node:test";
import { formatPublicIp, lookupPublicAddresses, parseEchoAddress, PublicIpQuery } from "../src/publicIp.js";

test("accepts an echo-service address and rejects loopback", () => {
  assert.equal(parseEchoAddress(" 198.51.100.10\n", 4), "198.51.100.10");
  assert.equal(parseEchoAddress("127.0.0.1", 4), null);
  assert.equal(parseEchoAddress("10.1.2.3", 4), null);
  assert.equal(parseEchoAddress("192.168.1.1", 4), null);
  assert.equal(parseEchoAddress("172.16.0.1", 4), null);
  assert.equal(parseEchoAddress("100.64.0.1", 4), null);
  assert.equal(parseEchoAddress("2001:db8::1", 6), "2001:db8::1");
  assert.equal(parseEchoAddress("::1", 6), null);
  assert.equal(parseEchoAddress("0::1", 6), null);
  assert.equal(parseEchoAddress("fe80::1", 6), null);
  assert.equal(parseEchoAddress("fe90::1", 6), null);
  assert.equal(parseEchoAddress("fd00::1", 6), null);
  assert.equal(parseEchoAddress("ff02::1", 6), null);
  assert.equal(parseEchoAddress("::ffff:10.0.0.1", 6), null);
  assert.equal(parseEchoAddress("::ffff:127.0.0.1", 6), null);
  assert.equal(parseEchoAddress("<html>", 4), null);
});

test("returns nulls when every echo service fails", async () => {
  const addresses = await lookupPublicAddresses(async () => {
    throw new Error("down");
  });
  assert.deepEqual(addresses, { ipv4: null, ipv6: null });
});

test("uses the next echo service when the first response is unusable", async () => {
  const calls: string[] = [];
  const addresses = await lookupPublicAddresses(async (url, family) => {
    calls.push(`${family} ${url}`);
    if (url.includes("ipify")) throw new Error("down");
    if (family === 4) return "203.0.113.8\n";
    return "not-an-ip";
  });
  assert.equal(addresses.ipv4, "203.0.113.8");
  assert.equal(addresses.ipv6, null);
  assert.ok(calls.some((call) => call.includes("icanhazip")));
});

test("formats text and json without inventing an address", () => {
  assert.equal(formatPublicIp({ ipv4: "198.51.100.10", ipv6: null }, false), "IPv4  198.51.100.10\nIPv6  不可用\n");
  assert.deepEqual(JSON.parse(formatPublicIp({ ipv4: null, ipv6: "2001:db8::2" }, true)), {
    ipv4: null,
    ipv6: "2001:db8::2",
  });
});

test("public ip query does not block before the lookup finishes", async () => {
  let release: (value: { ipv4: string | null; ipv6: string | null }) => void = () => {};
  const pending = new Promise<{ ipv4: string | null; ipv6: string | null }>((resolve) => {
    release = resolve;
  });
  const query = new PublicIpQuery(() => pending);
  assert.equal(query.line(), "公网 查询中");
  const early = query.settle(20);
  await early;
  assert.equal(query.line(), "公网 查询中");
  release({ ipv4: "198.51.100.8", ipv6: null });
  await query.settle(200);
  assert.equal(query.line(), "公网 IPv4 198.51.100.8  IPv6 不可用");
  query.stop();
});
