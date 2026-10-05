import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { TickerProvider } from './lib/ticker.jsx'
import { installGuards } from './lib/protect.js'
import './styles.css'

installGuards()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TickerProvider>
      <App />
    </TickerProvider>
  </StrictMode>,
)
