# check-int

在 Windows 上实时查看本机对外的 TCP / UDP 连接，并标出对端 IP。只读取系统连接表，不抓包、不修改配置、不安装驱动。

数据来自 `netstat -ano`（与 `Get-NetTCPConnection` 同一张只读 TCP 表）。`Get-NetUDPEndpoint` 没有远端地址，所以已关联远端的 UDP 也从 `netstat -ano` 读取。进程名用只读的 `Get-Process` 关联。下面这些行不会出现：监听套接字、没有远端地址的行（`0.0.0.0:0`、`[::]:0`、`*:*`），以及环回地址（`127.0.0.0/8`、`::1`）。

同一协议、同一远端 IP、同一远端端口、同一 PID 的多条套接字合并成一行。本地地址显示其中一条，并用 `(+N)` 标出其余条数。反查按远端 IP 缓存，失败或尚未返回时只显示 IP，不会挡住刷新。

## 环境

- Windows 10 / 11，PowerShell
- Node.js 20 或更新版本

## 安装

```powershell
npm install
```

## 监视模式

默认每 1000 毫秒清屏刷新。新出现的连接在「标记」列显示 `新`；其中远端 IP 是这一拍新出现的，整行用高亮标出。连接从系统表消失后，下一拍从主表去掉，并写在底部摘要里。Ctrl+C 退出，退出码为 0。

```powershell
npm run dev
```

TCP 主动断开后，系统经常会把该连接留在 `TimeWait`，直到它从连接表删除才会进入「消失」。

## 只看当前快照

```powershell
npm run dev -- --once
```

编译后再运行：

```powershell
npm run build
node dist/index.js --once
```

## 参数

刷新间隔，单位毫秒，最小 200：

```powershell
npm run dev -- --interval 500
```

只看 TCP、只看 UDP，或两者都看（默认 `all`）：

```powershell
npm run dev -- --proto tcp --once
```

```powershell
npm run dev -- --proto udp --once
```

```powershell
npm run dev -- --proto all --once
```

远端 IP 按字符串前缀匹配。`10.` 匹配 `10.1.2.3`，不匹配 `104.1.2.3`：

```powershell
npm run dev -- --ip 10. --once
```

只保留某个远端端口：

```powershell
npm run dev -- --port 443 --once
```

按进程名子串过滤，不区分大小写。`chrome` 和 `chrome.exe` 都能匹配进程名 `chrome`：

```powershell
npm run dev -- --process svchost --once
```

每行一条 JSON，方便管道处理。监视模式下每一拍先输出连接，再输出一行 `type` 为 `summary` 的对象：

```powershell
npm run dev -- --json --once
```

```powershell
npm run dev -- --json --interval 1000
```

关闭反向 DNS：

```powershell
npm run dev -- --no-dns --once
```

查询本机公网 IPv4 和 IPv6。没有该协议的地址时显示「不可用」；两个都查不到则以非 0 退出。`--json` 输出一行，缺失的协议为 `null`：

```powershell
npm run dev -- --public-ip
```

```powershell
npm run dev -- --public-ip --json
```

文本表格的表头也会显示公网地址。查询在后台进行，不会挡住连接表刷新；单次快照会最多再等 2.5 秒。本机没有可用的 IPv6 出口时，IPv6 显示为「不可用」。`--json` 的连接输出不包含公网地址，需要单独执行上面的命令。

查看参数说明：

```powershell
npm run dev -- --help
```

## 表格列

标记、协议、本地地址、远端、状态、进程、PID、首次发现、最近可见。

远端反查成功时显示为 `1.1.1.1:443 (one.one.one.one)`。`--json` 里对应字段是 `remoteIp`、`remotePort`、`remoteHost`、`local`、`state`、`process`、`pid`、`firstSeen`、`lastSeen`。`remoteHost` 为 `null` 表示没有域名。

## 失败

读不到连接表时，在标准错误打印原因（权限不足或找不到 `netstat`）并以非 0 退出，不会打印一张空表假装成功。
