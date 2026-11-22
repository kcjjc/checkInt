import { parseArgs, HELP } from "./args.js";
import { ReverseDns } from "./dns.js";
import { ArgError } from "./errors.js";
import { filterSockets } from "./filter.js";
import { collectSockets, stopCollection } from "./netstat.js";
import { ProcessTable } from "./processes.js";
import { renderJson, renderTable } from "./render.js";
import { Tracker } from "./track.js";

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof ArgError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  if (process.platform !== "win32") {
    console.error("此工具只支持 Windows。");
    process.exit(1);
  }

  const processes = new ProcessTable();
  const tracker = new Tracker();
  const dnsCache = new ReverseDns(options.dns);
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;

  const stop = (code: number) => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    stopCollection();
    processes.close();
    process.exit(code);
  };

  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") stop(0);
  });

  const tick = async (): Promise<void> => {
    if (stopping) return;
    const started = Date.now();
    try {
      const [sockets, names] = await Promise.all([collectSockets(), processes.snapshot()]);
      if (stopping) return;
      const filtered = filterSockets(sockets, options, names);
      const now = Date.now();
      const snapshot = tracker.update(filtered, names, now);
      for (const row of snapshot.rows) dnsCache.request(row.remoteIp);
      if (options.once) await dnsCache.settle(400);
      if (stopping) return;

      const text = options.json
        ? renderJson(snapshot, (ip) => dnsCache.host(ip), { summary: !options.once, at: now })
        : renderTable(snapshot, {
            now,
            intervalMs: options.intervalMs,
            filters: options,
            color: useColor(),
            columns: process.stdout.columns ?? 120,
            hostOf: (ip) => dnsCache.host(ip),
          });

      if (!options.once && !options.json && process.stdout.isTTY) console.clear();
      if (text) process.stdout.write(text);
      if (options.once) {
        stop(0);
        return;
      }
      const wait = Math.max(0, options.intervalMs - (Date.now() - started));
      timer = setTimeout(() => {
        void tick();
      }, wait);
    } catch (error) {
      if (stopping) return;
      console.error(error instanceof Error ? error.message : String(error));
      stop(1);
    }
  };

  await tick();
}

function useColor(): boolean {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
}
