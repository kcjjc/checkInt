import { ArgError } from "./errors.js";
import type { Filters, ProtoFilter } from "./types.js";

export interface CliOptions extends Filters {
  once: boolean;
  intervalMs: number;
  json: boolean;
  dns: boolean;
  help: boolean;
}

export const HELP = `本机对外连接监视

用法
  npm run dev -- [参数]
  node dist/index.js [参数]

默认进入监视模式：每 1000ms 清屏刷新一次。Ctrl+C 退出。

参数
  --once                 只打印当前快照后退出
  --interval <ms>        刷新间隔，默认 1000，最小 200
  --proto <tcp|udp|all>  协议，默认 all
  --ip <prefix>          只保留远端 IP 以该前缀开头的行
  --port <n>             只保留远端端口
  --process <name>       按进程名子串过滤，不区分大小写
  --json                 每行一条 JSON
  --no-dns               关闭远端 IP 反查
  --help                 显示此说明
`;

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    once: false,
    intervalMs: 1000,
    proto: "all",
    json: false,
    dns: true,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--once") {
      options.once = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--no-dns") {
      options.dns = false;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--interval" || arg.startsWith("--interval=")) {
      options.intervalMs = parseInterval(readValue(argv, index, "--interval"));
      if (!arg.startsWith("--interval=")) index += 1;
    } else if (arg === "--proto" || arg.startsWith("--proto=")) {
      options.proto = parseProto(readValue(argv, index, "--proto"));
      if (!arg.startsWith("--proto=")) index += 1;
    } else if (arg === "--ip" || arg.startsWith("--ip=")) {
      const value = readValue(argv, index, "--ip");
      if (!value) throw new ArgError("--ip 需要一个远端 IP 前缀");
      options.ipPrefix = value;
      if (!arg.startsWith("--ip=")) index += 1;
    } else if (arg === "--port" || arg.startsWith("--port=")) {
      options.port = parsePort(readValue(argv, index, "--port"));
      if (!arg.startsWith("--port=")) index += 1;
    } else if (arg === "--process" || arg.startsWith("--process=")) {
      const value = readValue(argv, index, "--process");
      if (!value) throw new ArgError("--process 需要一个进程名");
      options.process = value;
      if (!arg.startsWith("--process=")) index += 1;
    } else {
      throw new ArgError(`未知参数：${arg}`);
    }
  }

  return options;
}

function readValue(argv: string[], index: number, name: string): string {
  const arg = argv[index] ?? "";
  if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new ArgError(`缺少 ${name} 的参数`);
  return value;
}

function parseInterval(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new ArgError(`无效的刷新间隔：${raw}`);
  const value = Number(raw);
  if (value < 200) throw new ArgError("刷新间隔不能小于 200 毫秒");
  if (value > 2_147_483_647) throw new ArgError(`无效的刷新间隔：${raw}`);
  return value;
}

function parseProto(raw: string): ProtoFilter {
  const value = raw.toLowerCase();
  if (value === "tcp" || value === "udp" || value === "all") return value;
  throw new ArgError(`无效的协议：${raw}。可选 tcp、udp、all`);
}

function parsePort(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new ArgError(`无效的远端端口：${raw}`);
  const value = Number(raw);
  if (value < 1 || value > 65535) throw new ArgError(`无效的远端端口：${raw}`);
  return value;
}
