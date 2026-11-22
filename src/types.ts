export type Proto = "TCP" | "UDP";

export type ProtoFilter = "tcp" | "udp" | "all";

export interface SocketRow {
  proto: Proto;
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
  pid: number;
}

export interface LiveRow {
  key: string;
  proto: Proto;
  locals: string[];
  remoteIp: string;
  remotePort: number;
  state: string;
  process: string;
  pid: number;
  firstSeen: number;
  lastSeen: number;
}

export interface Snapshot {
  rows: LiveRow[];
  added: LiveRow[];
  removed: LiveRow[];
  newIps: Set<string>;
  addedKeys: Set<string>;
}

export interface Filters {
  proto: ProtoFilter;
  ipPrefix?: string;
  port?: number;
  process?: string;
}
