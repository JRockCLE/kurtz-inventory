import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ScansApp from './ScansApp.jsx'
import { UIProvider } from './components/ui/UIProvider'

// Register a minimal service worker so the page qualifies for PWA install.
// Only in production builds (Vite dev server has its own HMR machinery that
// conflicts with SW caching).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <UIProvider>
      <ScansApp />
    </UIProvider>
  </StrictMode>,
)
