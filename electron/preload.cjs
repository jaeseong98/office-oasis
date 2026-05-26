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

  // ─── 클립보드 ───
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
  launcherListApps: () => ipcRenderer.invoke('launcher:list-apps'),
  onLauncherUpdate: (cb) => {
    const handler = (_e, list) => cb(list)
    ipcRenderer.on('launcher:update', handler)
    return () => ipcRenderer.removeListener('launcher:update', handler)
  },

  // ─── 노트 ───
  notesList: () => ipcRenderer.invoke('notes:list'),
  notesCreate: () => ipcRenderer.invoke('notes:create'),
  notesSave: (id, body) => ipcRenderer.invoke('notes:save', { id, body }),
  notesDelete: (id) => ipcRenderer.invoke('notes:delete', id),
  notesRestore: (id) => ipcRenderer.invoke('notes:restore', id),
  notesPurge: (id) => ipcRenderer.invoke('notes:purge', id),
  notesExport: () => ipcRenderer.invoke('notes:export'),
  notesImport: () => ipcRenderer.invoke('notes:import'),
  onNotesUpdate: (cb) => {
    const handler = (_e, list) => cb(list)
    ipcRenderer.on('notes:update', handler)
    return () => ipcRenderer.removeListener('notes:update', handler)
  },

  // ─── 다른 윈도우/탭 열기 ───
  openLauncher: () => ipcRenderer.invoke('ui:open-launcher'),
  openClipboard: () => ipcRenderer.invoke('ui:open-clipboard'),
  openNotes: () => ipcRenderer.invoke('ui:open-notes'),
  onSwitchTab: (cb) => {
    const handler = (_e, tab) => cb(tab)
    ipcRenderer.on('main:switch-tab', handler)
    return () => ipcRenderer.removeListener('main:switch-tab', handler)
  },

  // ─── 윈도우 컨트롤 (frameless 창용) ───
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winMaximizeToggle: () => ipcRenderer.invoke('win:maximize-toggle'),
  winHide: () => ipcRenderer.invoke('win:hide'),
  winIsMaximized: () => ipcRenderer.invoke('win:is-maximized'),
  winToggleFullscreen: () => ipcRenderer.invoke('win:toggle-fullscreen'),

  // ─── 설정 ───
  getAutoLaunch: () => ipcRenderer.invoke('settings:get-auto-launch'),
  setAutoLaunch: (payload) => ipcRenderer.invoke('settings:set-auto-launch', payload),

  // ─── 구내식당 ───
  cafeteriaFetch: (force) => ipcRenderer.invoke('cafeteria:fetch', force),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  appVersion: undefined,
})

// 버전을 동기로 노출하기 위해 별도 호출
ipcRenderer.invoke('app:get-version').then((v) => {
  try {
    Object.defineProperty(window.oasis, 'appVersion', { value: v, writable: false })
  } catch { /* ignore */ }
})
