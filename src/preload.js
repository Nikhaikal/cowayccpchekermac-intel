const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cowayApp", {
  licenseStatus: () => ipcRenderer.invoke("license-status"),
  activateLicense: (data) => ipcRenderer.invoke("activate-license", data),
  selectExcel: () => ipcRenderer.invoke("select-excel"),
  startCheck: () => ipcRenderer.invoke("start-check"),
  saveExcel: () => ipcRenderer.invoke("save-excel"),

  onProgress: (callback) => {
    ipcRenderer.on("progress", (_, data) => callback(data));
  },

  onStatus: (callback) => {
    ipcRenderer.on("status", (_, data) => callback(data));
  }
});
