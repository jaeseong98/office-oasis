import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ClipboardApp from './Clipboard.jsx'

const params = new URLSearchParams(window.location.search)
const isClipboard = params.get('window') === 'clipboard'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isClipboard ? <ClipboardApp /> : <App />}
  </StrictMode>,
)
