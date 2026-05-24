const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('oasis', {
  isElectron: true,

  // ─── 스캐너 ───
  startScan: (roots) => ipcRenderer.invoke('scan:start', roots),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  defaultRoots: () => ipcRenderer.invoke('scan:default-roots'),
  pickFolder: () => ipcRenderer.invoke('pick:folder'),

  // ─── 실제 삭제 ───
  trashMany: (paths) => ipcRenderer.invoke('trash:many', paths),
  permanentMany: (paths) => ipcRenderer.invoke('permanent:many', paths),

  // ─── 셸 ───
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  open: (p) => ipcRenderer.invoke('shell:open', p),

  // ─── 진행률 ───
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.removeListener('scan:progress', handler)
  },

  // ─── 클립보드 매니저 ───
  clipboardList: () => ipcRenderer.invoke('clipboard:list'),
  clipboardPaste: (id) => ipcRenderer.invoke('clipboard:paste', id),
  clipboardDelete: (id) => ipcRenderer.invoke('clipboard:delete', id),
  clipboardPin: (id) => ipcRenderer.invoke('clipboard:pin', id),
  clipboardClear: () => ipcRenderer.invoke('clipboard:clear'),
  clipboardHide: () => ipcRenderer.invoke('clipboard:hide'),
  clipboardSetPaused: (paused) => ipcRenderer.invoke('clipboard:set-paused', paused),
  onClipboardUpdate: (cb) => {
    const handler = (_e, list) => cb(list)
    ipcRenderer.on('clipboard:update', handler)
    return () => ipcRenderer.removeListener('clipboard:update', handler)
  },
})
