const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('oasis', {
  isElectron: true,

  // 스캔 제어
  startScan: (roots) => ipcRenderer.invoke('scan:start', roots),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  defaultRoots: () => ipcRenderer.invoke('scan:default-roots'),
  pickFolder: () => ipcRenderer.invoke('pick:folder'),

  // 실제 청소
  trashMany: (paths) => ipcRenderer.invoke('trash:many', paths),

  // 셸 연동
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  open: (p) => ipcRenderer.invoke('shell:open', p),

  // 진행률 구독
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.removeListener('scan:progress', handler)
  },
})
