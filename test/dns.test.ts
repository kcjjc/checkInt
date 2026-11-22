import assert from "node:assert/strict";
import test from "node:test";
import { ReverseDns } from "../src/dns.js";

test("resolves each ip once and does not block the caller", async () => {
  let calls = 0;
  let release: (names: string[]) => void = () => {};
  const pending = new Promise<string[]>((resolve) => {
    release = resolve;
  });
  const dns = new ReverseDns(true, () => {
    calls += 1;
    return pending;
  });

  dns.request("1.1.1.1");
  dns.request("1.1.1.1");
  assert.equal(calls, 1);
  assert.equal(dns.host("1.1.1.1"), undefined);

  const settled = dns.settle(30);
  await settled;
  assert.equal(dns.host("1.1.1.1"), undefined);

  release(["one.one.one.one"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dns.host("1.1.1.1"), "one.one.one.one");
  dns.request("1.1.1.1");
  assert.equal(calls, 1);
});

test("keeps the ip when lookup fails and can be disabled", async () => {
  const failed = new ReverseDns(true, async () => {
    throw new Error("nxdomain");
  });
  failed.request("8.8.8.8");
  await failed.settle(200);
  assert.equal(failed.host("8.8.8.8"), undefined);

  let calls = 0;
  const disabled = new ReverseDns(false, async () => {
    calls += 1;
    return ["nope.example"];
  });
  disabled.request("8.8.8.8");
  assert.equal(calls, 0);
  assert.equal(disabled.host("8.8.8.8"), undefined);
});
