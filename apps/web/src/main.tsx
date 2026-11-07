// Temporary standalone entry (FND-12): renders the UI kit gallery.
// FND-13 replaces this with the router and mounts <Gallery/> at /_dev/ui.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { Gallery } from './components/ui/gallery'
import { ToastProvider } from './components/ui/toast'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <Gallery />
    </ToastProvider>
  </StrictMode>,
)
