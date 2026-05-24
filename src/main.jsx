import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ClipboardApp from './Clipboard.jsx'

// 클립보드는 별도 팝업 창 (전역 단축키로 호출).
// 청소·런처·노트는 모두 메인 App 안의 탭.
const params = new URLSearchParams(window.location.search)
const hash = window.location.hash.replace(/^#/, '').trim()
const mode = hash || params.get('window')

const Root = mode === 'clipboard' ? ClipboardApp : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
