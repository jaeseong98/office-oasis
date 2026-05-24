// 환경에 ELECTRON_RUN_AS_NODE=1 이 박혀 있으면 Electron이 Node 모드로 돌아 ipcMain 등이 undefined가 됨.
// 이 래퍼는 그 변수를 명시적으로 제거한 뒤 electron 바이너리를 spawn 한다.

const { spawn } = require('node:child_process')
const path = require('node:path')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronPath = require('electron')
const child = spawn(electronPath, [path.resolve(__dirname, '..')], {
  stdio: 'inherit',
  env,
  windowsHide: false,
})

child.on('exit', (code) => process.exit(code ?? 0))
