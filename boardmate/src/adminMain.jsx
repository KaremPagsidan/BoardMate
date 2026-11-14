import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './admin.css';
import AdminApp from './AdminApp.jsx';
import AppDialogProvider from './components/AppDialogProvider.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppDialogProvider><AdminApp /></AppDialogProvider>
  </StrictMode>,
);
