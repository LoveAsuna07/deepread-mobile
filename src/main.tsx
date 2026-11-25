import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/noto-serif-sc/400.css'
import '@fontsource/noto-serif-sc/500.css'
import '@fontsource/jetbrains-mono/400.css'
import './styles.css'
import App from './App'
import { installErrorLog } from './lib/errors'
import { requestPersist } from './lib/db'

installErrorLog()
void requestPersist()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
