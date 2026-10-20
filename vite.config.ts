import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { exportPlugin } from './server/export-plugin.mjs';

// GitHub Pages serves the site from /<repo-name>/. Change BASE_PATH if your repository has another name.
const base = process.env.BASE_PATH ?? '/matchday-xi/';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'FFMPEG_');
  return {
  base,
  plugins: [react(), tailwindcss(), exportPlugin(base, { ffmpeg: env.FFMPEG_PATH, encoder: env.FFMPEG_ENCODER })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  };
});
