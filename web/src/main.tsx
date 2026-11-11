import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Roboto (the font Wallet and other Material apps use), shipped with the site so every device shows the same font.
import '@fontsource-variable/roboto';
import './styles.css';
// The 2.0 design: tokens and the shared components, used by the newer cards while the older screens move over.
import './design/tokens.css';
import './design/components.css';
import { App } from './ui/App';
import { NoticeProvider } from './ui/common';
import { applyTheme } from './ui/settings';

applyTheme();

// The service worker keeps the app shell for offline use. Not in development, where it would hide new code.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <NoticeProvider>
        <App />
      </NoticeProvider>
    </BrowserRouter>
  </StrictMode>,
);
