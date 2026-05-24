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

  // ─── 런처 ───
  launcherList: () => ipcRenderer.invoke('launcher:list'),
  launcherAdd: (draft) => ipcRenderer.invoke('launcher:add', draft),
  launcherUpdate: (id, patch) => ipcRenderer.invoke('launcher:update', { id, patch }),
  launcherDelete: (id) => ipcRenderer.invoke('launcher:delete', id),
  launcherReorder: (orderedIds) => ipcRenderer.invoke('launcher:reorder', orderedIds),
  launcherLaunch: (id) => ipcRenderer.invoke('launcher:launch', id),
  launcherPickFile: () => ipcRenderer.invoke('launcher:pick-file'),
  launcherPickFolder: () => ipcRenderer.invoke('launcher:pick-folder'),
  launcherDroppedPaths: (paths) => ipcRenderer.invoke('launcher:dropped-paths', paths),
  launcherHide: () => ipcRenderer.invoke('launcher:hide'),
  launcherToggleFullscreen: () => ipcRenderer.invoke('launcher:toggle-fullscreen'),
  launcherIsFullscreen: () => ipcRenderer.invoke('launcher:is-fullscreen'),
  onLauncherUpdate: (cb) => {
    const handler = (_e, list) => cb(list)
    ipcRenderer.on('launcher:update', handler)
    return () => ipcRenderer.removeListener('launcher:update', handler)
  },

  // ─── 다른 윈도우 열기 ───
  openLauncher: () => ipcRenderer.invoke('ui:open-launcher'),
  openClipboard: () => ipcRenderer.invoke('ui:open-clipboard'),
})
