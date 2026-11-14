import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import UserSite from './UserSite.jsx'
import AppDialogProvider from './components/AppDialogProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppDialogProvider><UserSite /></AppDialogProvider>
  </StrictMode>,
)
