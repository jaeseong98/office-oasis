import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ClipboardApp from './Clipboard.jsx'
import LauncherApp from './Launcher.jsx'

// 두 가지 라우팅 방식 모두 받음 — production에서 loadFile + query 가 asar 환경에
// 따라 누락되는 사례가 있어 hash 를 1순위로 사용한다.
const params = new URLSearchParams(window.location.search)
const hash = window.location.hash.replace(/^#/, '').trim()
const mode = hash || params.get('window')

const Root = mode === 'clipboard' ? ClipboardApp
           : mode === 'launcher'  ? LauncherApp
           : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
