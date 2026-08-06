import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@factoru/ui/tokens.css'
import './styles.css'

const container = document.getElementById('root')
if (container === null) {
  throw new Error('Factoru Desktop could not find its root element')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
