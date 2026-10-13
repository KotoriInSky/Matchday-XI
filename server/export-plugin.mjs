import { chromium } from 'playwright';
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { renderCards, validCards } from './card-renderer.mjs';

// Local-only companion renderer. Never accepts a destination URL or a filesystem path.
export function exportPlugin(base) {
  const jobs = new Map();
  let active = null;
  const prefix = `${base}api/export`;
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const remove = async (job) => { job.cancelled = true; job.encoder?.kill(); await job.browser?.close().catch(() => {}); if (job.dir) await rm(job.dir, { recursive: true, force: true }); jobs.delete(job.id); };
  async function render(job, payload, origin) {
    try {
      job.dir = await mkdtemp(join(tmpdir(), 'matchday-export-'));
      job.file = join(job.dir, 'lineup.mp4');
      try { job.browser = await chromium.launch({ channel: 'chrome', headless: true }); }
      catch { job.browser = await chromium.launch({ headless: true }); }
      if (job.cancelled) return;
      const cards = payload.kind === 'cards';
      const width = cards ? 1000 : payload.height * 16 / 9;
      const page = await job.browser.newPage({ viewport: { width, height: cards ? 1000 : payload.height }, deviceScaleFactor: 1 });
      await page.routeWebSocket('**/*', (socket) => socket.close());
      // Prevent imported assets from causing arbitrary network access in the local renderer.
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        return url.origin === origin
          ? route.continue() : route.abort();
      });
      await page.goto(`${origin}${base}?${cards ? 'render-cards' : 'render-export'}`, { waitUntil: 'networkidle' });
      if (cards) { await renderCards(page, job, payload); return; }
      job.mime = 'video/mp4'; job.filename = 'matchday-lineup.mp4';
      await page.waitForFunction(() => !!window.exportRenderer);
      const duration = await page.evaluate(({ state, lang, video }) => window.exportRenderer.init(state, lang, video), payload);
      if (!(duration > 0 && duration < 600)) throw new Error('Invalid timeline duration');
      const frames = Math.ceil(duration * payload.fps);
      job.total = frames; job.status = 'rendering';
      const encoder = job.encoder = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(payload.fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', job.file], { windowsHide: true });
      let error = '';
      encoder.stdin.on('error', () => {});
      encoder.stderr.on('data', (chunk) => { error = (error + chunk).slice(-2000); });
      const completed = new Promise((resolve, reject) => {
        encoder.on('error', reject);
        encoder.on('close', (code) => code === 0 ? resolve() : reject(new Error(error || 'Encoding failed')));
      });
      completed.catch(() => {});
      for (let frame = 0; frame < frames; frame++) {
        if (job.cancelled) return;
        await page.evaluate((time) => window.exportRenderer.frame(time), frame / payload.fps);
        const png = await page.screenshot({ type: 'png', animations: 'allow', caret: 'hide' });
        await new Promise((resolve, reject) => encoder.stdin.write(png, (err) => err ? reject(err) : resolve()));
        job.progress = Math.floor((frame + 1) / frames * 99);
      }
      encoder.stdin.end(); job.status = 'encoding';
      await completed;
      job.status = 'finishing'; job.progress = 99;
    } catch (e) {
      if (!job.cancelled) { job.status = 'failed'; job.error = 'Render failed. Check local Chrome and restart the export service.'; console.error('[video export]', e); }
    } finally {
      job.encoder?.kill(); await job.browser?.close().catch(() => {});
      if (active === job) active = null;
      if (!job.cancelled && job.status === 'finishing') { job.status = 'complete'; job.progress = 100; }
      if (job.cancelled) await remove(job);
      else { const timer = setTimeout(() => void remove(job), 30 * 60 * 1000); timer.unref(); }
    }
  }
  const install = (server) => {
    server.httpServer?.once('close', () => { for (const job of jobs.values()) void remove(job); });
    server.middlewares.use(async (req, res, next) => {
      const path = (req.url || '').split('?')[0];
      if (!path.startsWith(prefix)) return next();
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return json(res, 403, { error: 'Local export only' });
      const origin = `http://${host}`;
      if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Origin rejected' });
      if (req.method === 'GET' && path === prefix) return json(res, 200, { available: true });
      if (req.method === 'POST' && path === prefix) {
        if (active) return json(res, 409, { error: 'An export is already running' });
        // Reserve a slot before reading large uploads.
        const job = { id: randomUUID(), status: 'preparing', progress: 0, cancelled: false };
        active = job;
        try {
          if (!String(req.headers['content-type']).includes('application/json')) throw new Error('JSON required');
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 200 * 1024 * 1024) throw new Error('Project exceeds 200 MB'); chunks.push(chunk); }
          const payload = JSON.parse(Buffer.concat(chunks).toString());
          if (!payload.state || typeof payload.lang !== 'string') throw new Error('Invalid export settings');
          if (payload.kind === 'cards' ? !validCards(payload) : payload.kind != null || ![720, 1080, 1440, 2160].includes(payload.height) || ![30, 60].includes(payload.fps)) throw new Error('Invalid export settings');
          if (payload.video && !/^data:video\/[\w.+-]+;base64,/.test(payload.video)) throw new Error('Invalid video');
          jobs.set(job.id, job);
          json(res, 202, { id: job.id });
          job.done = render(job, payload, origin);
        } catch (e) { active = null; json(res, 400, { error: e.message }); }
        return;
      }
      const [id, action] = path.slice(prefix.length + 1).split('/');
      const job = jobs.get(id);
      if (!job) return json(res, 404, { error: 'Export unavailable. Please retry.' });
      if (req.method === 'DELETE') { job.cancelled = true; await remove(job); await job.done; return json(res, 200, { cancelled: true }); }
      if (req.method === 'GET' && action === 'file' && job.status === 'complete') {
        const info = await stat(job.file);
        res.writeHead(200, { 'Content-Type': job.mime, 'Content-Length': info.size, 'Content-Disposition': `attachment; filename="${job.mime === 'video/mp4' ? 'matchday-lineup.mp4' : job.mime === 'image/png' ? 'matchday-card.png' : 'matchday-cards.zip'}"; filename*=UTF-8''${encodeURIComponent(job.filename)}` });
        createReadStream(job.file).pipe(res); return;
      }
      if (req.method === 'GET' && !action) return json(res, 200, { status: job.status, progress: job.progress, error: job.error, filename: job.filename, outputs: job.outputs });
      json(res, 405, { error: 'Unsupported request' });
    });
  };
  return { name: 'local-video-export', configureServer: install, configurePreviewServer: install };
}
