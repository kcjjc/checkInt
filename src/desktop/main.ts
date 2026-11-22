import { app, BrowserWindow, clipboard, ipcMain, type IpcMainEvent } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConnectionMonitor, type MonitorOptions } from "./session.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const monitor = new ConnectionMonitor();
let window: BrowserWindow | undefined;

function createWindow(): void {
  window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 520,
    backgroundColor: "#12151a",
    title: "check-int",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.once("ready-to-show", () => window?.show());
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void window.loadFile(path.join(here, "index.html"));
  window.on("closed", () => {
    window = undefined;
  });
}

app.whenReady().then(() => {
  createWindow();
  monitor.onFrame((frame) => {
    if (window && !window.isDestroyed()) window.webContents.send("monitor:frame", frame);
  });
  ipcMain.on("monitor:configure", (event, options: MonitorOptions) => {
    if (!fromWindow(event) || !options || typeof options !== "object" || !options.filters) return;
    monitor.update(options);
  });
  ipcMain.on("clipboard:write", (event, text: unknown) => {
    if (!fromWindow(event) || typeof text !== "string" || text.length === 0 || text.length >= 500) return;
    clipboard.writeText(text);
  });
});

function fromWindow(event: IpcMainEvent): boolean {
  const contents = window?.webContents;
  return !!contents && !contents.isDestroyed() && event.sender === contents;
}

app.on("window-all-closed", () => {
  monitor.stop();
  app.quit();
});
