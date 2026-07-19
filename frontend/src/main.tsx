import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Scrolling over a focused number input silently changes its value in
// Chrome/Edge — every number field in the app blurs itself on wheel instead
// of forwarding the scroll, so mouse-wheel scrolling never edits a value.
document.addEventListener(
  'wheel',
  (e) => {
    const target = e.target as HTMLElement | null
    if (target instanceof HTMLInputElement && target.type === 'number' && document.activeElement === target) {
      target.blur()
    }
  },
  { passive: true }
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
