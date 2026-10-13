import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { exportPlugin } from './server/export-plugin.mjs';

// GitHub Pages serves the site from /<repo-name>/. Change BASE_PATH if your repository has another name.
const base = process.env.BASE_PATH ?? '/matchday-xi/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), exportPlugin(base)],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
