const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prism', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, fn) => {
    const h = (_e, ...args) => fn(...args);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
});
