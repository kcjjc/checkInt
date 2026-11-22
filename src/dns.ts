import dns from "node:dns";

export type ReverseLookup = (ip: string) => Promise<string[]>;

interface CacheEntry {
  status: "pending" | "ok" | "fail";
  host?: string;
}

export class ReverseDns {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly queue: string[] = [];
  private readonly pending = new Set<string>();
  private active = 0;

  constructor(
    private readonly enabled: boolean,
    private readonly lookup: ReverseLookup = reverseWithTimeout,
    private readonly concurrency = 8,
  ) {}

  host(ip: string): string | undefined {
    const entry = this.cache.get(ip);
    return entry?.status === "ok" ? entry.host : undefined;
  }

  request(ip: string): void {
    if (!this.enabled || this.cache.has(ip)) return;
    this.cache.set(ip, { status: "pending" });
    this.pending.add(ip);
    this.queue.push(ip);
    this.pump();
  }

  async settle(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.pending.size > 0 && Date.now() < deadline) {
      await delay(25);
    }
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const ip = this.queue.shift();
      if (!ip) return;
      this.active += 1;
      this.lookup(ip).then(
        (names) => {
          const host = names.map((name) => name.trim()).find((name) => name.length > 0 && name !== ip);
          if (host) this.cache.set(ip, { status: "ok", host });
          else if (this.cache.get(ip)?.status === "pending") this.cache.set(ip, { status: "fail" });
        },
        () => {
          if (this.cache.get(ip)?.status === "pending") this.cache.set(ip, { status: "fail" });
        },
      ).finally(() => {
        this.pending.delete(ip);
        this.active -= 1;
        this.pump();
      });
    }
  }
}

function reverseWithTimeout(ip: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("timeout"));
    }, 2000);
    dns.reverse(ip, (error, names) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(names);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
