import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
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
