import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './i18n';
import App from './App';
import { store } from './lib/store';
import './index.css';

if (new URLSearchParams(location.search).has('render-cards')) {
  void import('./render-cards').then(({ mountCardRenderer }) => mountCardRenderer());
} else if (new URLSearchParams(location.search).has('render-export')) {
  void import('./render-export').then(({ mountExportRenderer }) => mountExportRenderer());
} else void store.ready.then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
));
