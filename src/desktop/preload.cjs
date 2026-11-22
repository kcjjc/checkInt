const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("checkInt", {
  configure(options) {
    ipcRenderer.send("monitor:configure", options);
  },
  onFrame(listener) {
    const wrapped = (_event, frame) => listener(frame);
    ipcRenderer.on("monitor:frame", wrapped);
    return () => ipcRenderer.removeListener("monitor:frame", wrapped);
  },
  copyText(text) {
    ipcRenderer.send("clipboard:write", text);
  },
});
