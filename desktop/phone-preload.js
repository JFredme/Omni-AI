const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("omniPhone", {
  state: () => ipcRenderer.invoke("phone:state"),
  set: (enabled) => ipcRenderer.invoke("phone:set", enabled),
});
