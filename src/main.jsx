import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ClipboardApp from './Clipboard.jsx'
import LauncherApp from './Launcher.jsx'
import NotesApp from './Notes.jsx'

const params = new URLSearchParams(window.location.search)
const hash = window.location.hash.replace(/^#/, '').trim()
const mode = hash || params.get('window')

const Root = mode === 'clipboard' ? ClipboardApp
           : mode === 'launcher'  ? LauncherApp
           : mode === 'notes'     ? NotesApp
           : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
