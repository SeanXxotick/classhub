import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Roboto (the font Wallet and other Material apps use), shipped with the site so every device shows the same font.
import '@fontsource-variable/roboto';
import './styles.css';
import { App } from './ui/App';
import { NoticeProvider } from './ui/common';
import { applyTheme } from './ui/settings';

applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <NoticeProvider>
        <App />
      </NoticeProvider>
    </BrowserRouter>
  </StrictMode>,
);
