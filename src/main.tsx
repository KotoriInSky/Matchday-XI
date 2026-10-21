import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './i18n';
import App from './App';
import { store } from './lib/store';
import './index.css';

const params = new URLSearchParams(location.search);
if (params.get('export-video')) {
  void import('./lib/export-tab').then(({ mountExportTab }) => mountExportTab(params.get('export-video')!));
} else if (new URLSearchParams(location.search).has('render-cards')) {
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
