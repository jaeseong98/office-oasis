import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ClipboardApp from './Clipboard.jsx'
import LauncherApp from './Launcher.jsx'

const params = new URLSearchParams(window.location.search)
const mode = params.get('window')

const Root = mode === 'clipboard' ? ClipboardApp
           : mode === 'launcher'  ? LauncherApp
           : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
