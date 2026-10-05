import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { TickerProvider } from './lib/ticker.jsx'
import { GUARD_STATE, installGuards } from './lib/protect.js'
import './styles.css'

installGuards()

// dev only: lets you confirm the guards actually installed instead of guessing
if (import.meta.env.DEV) window.__repentGuards = GUARD_STATE

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TickerProvider>
      <App />
    </TickerProvider>
  </StrictMode>,
)
