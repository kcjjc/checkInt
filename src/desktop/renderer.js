const proto = document.querySelector("#proto");
const ip = document.querySelector("#ip");
const port = document.querySelector("#port");
const processName = document.querySelector("#process");
const interval = document.querySelector("#interval");
const dns = document.querySelector("#dns");
const status = document.querySelector("#status");
const publicText = document.querySelector("#public-text");
const publicBox = document.querySelector("#public-ip");
const banner = document.querySelector("#banner");
const rows = document.querySelector("#rows");
const empty = document.querySelector("#empty");
const summary = document.querySelector("#summary");
let latest = null;
let acceptedPort;

function intervalMs() {
  const value = Number(interval.value);
  if (!Number.isFinite(value)) return 1000;
  return Math.min(60000, Math.max(200, Math.floor(value)));
}

function readPort() {
  const portValue = port.value.trim();
  if (portValue === "") {
    port.setCustomValidity("");
    acceptedPort = undefined;
    return undefined;
  }
  const portNumber = Number(portValue);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    port.setCustomValidity("远端端口需为 1 到 65535 的整数");
    return acceptedPort;
  }
  port.setCustomValidity("");
  acceptedPort = portNumber;
  return portNumber;
}

function options() {
  return {
    intervalMs: intervalMs(),
    dns: dns.checked,
    filters: {
      proto: proto.value,
      ipPrefix: ip.value,
      port: readPort(),
      process: processName.value,
    },
  };
}

function send() {
  window.checkInt.configure(options());
}

function cell(text, className) {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function render(frame) {
  latest = frame;
  const clock = new Date(frame.at).toLocaleTimeString("zh-CN", { hour12: false });
  const unread = frame.error && !frame.stale;
  status.textContent = unread
    ? `${clock}  读取失败`
    : frame.stale
      ? `${clock}  显示上次成功的 ${frame.count} 条`
      : `${clock}  对外连接 ${frame.count} 条`;

  publicText.textContent = frame.publicPending && !frame.publicIpv4 && !frame.publicIpv6
    ? "查询中"
    : `IPv4 ${frame.publicIpv4 ?? "不可用"}    IPv6 ${frame.publicIpv6 ?? "不可用"}`;

  banner.hidden = !frame.error;
  banner.textContent = frame.error ? `读取失败：${frame.error}` : "";

  rows.replaceChildren();
  for (const row of frame.rows) {
    const tr = document.createElement("tr");
    if (row.newIp) tr.className = "new-ip";
    else if (row.added) tr.className = "new";
    tr.append(
      cell(row.mark),
      cell(row.proto),
      cell(row.local, "mono"),
      cell(row.remote, "mono"),
      cell(row.state),
      cell(row.process),
      cell(String(row.pid), "mono"),
      cell(row.firstSeen, "mono"),
      cell(row.lastSeen, "mono"),
    );
    rows.append(tr);
  }
  empty.hidden = frame.rows.length > 0 || Boolean(frame.error && !frame.stale);
  if (frame.error && !frame.stale && frame.rows.length === 0) {
    empty.hidden = false;
    empty.textContent = "未能读取连接表";
  } else if (frame.rows.length === 0) {
    empty.textContent = "当前没有符合条件的对外连接";
  }
  summary.textContent = frame.summary;
}

function commitInterval() {
  interval.value = String(intervalMs());
  send();
}

document.querySelector("#filters").addEventListener("submit", (event) => {
  event.preventDefault();
  commitInterval();
});

for (const input of [ip, processName]) {
  input.addEventListener("input", send);
}
let portTimer;
port.addEventListener("input", () => {
  clearTimeout(portTimer);
  portTimer = setTimeout(send, 400);
});
port.addEventListener("change", () => {
  clearTimeout(portTimer);
  send();
});
for (const input of [proto, dns]) {
  input.addEventListener("change", send);
}
interval.addEventListener("change", commitInterval);

publicBox.addEventListener("click", () => {
  if (!latest || latest.publicPending) return;
  const addresses = [latest.publicIpv4, latest.publicIpv6].filter((address) => address);
  if (addresses.length === 0) return;
  window.checkInt.copyText(addresses.join("\n"));
  status.textContent = "已复制公网地址";
});

window.checkInt.onFrame(render);
send();
