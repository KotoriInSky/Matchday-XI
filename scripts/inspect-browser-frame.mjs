import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

// Breaks down the SVG that browser video capture decodes for each frame:
// embedded fonts, images (with duplicates), video frames and markup.
// INSPECT_PROJECT, INSPECT_HEIGHT (default 1080), INSPECT_DIST (default dist).
const state = JSON.parse(await readFile(process.env.INSPECT_PROJECT || 'test-results/export-resources/state.json', 'utf8'));
const height = Number(process.env.INSPECT_HEIGHT || 1080), width = height * 16 / 9;
const root = resolve(process.env.INSPECT_DIST || 'dist'), prefix = '/matchday-xi/';
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  // The browser export hosts the renderer in an iframe; so does this script.
  if (path === prefix + 'inspect-parent.html') { res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<body style="margin:0"><iframe src="${prefix}?render-export" style="border:0;width:${width}px;height:${height}px"></iframe></body>`); return; }
  const file = resolve(root, decodeURIComponent(path.slice(prefix.length)) || 'index.html');
  if (!path.startsWith(prefix) || !file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
  try {
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    window.__svgs = [];
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...descriptor,
      set(value) { if (String(value).startsWith('data:image/svg+xml')) window.__svgs.push(String(value)); descriptor.set.call(this, value); },
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}${prefix}inspect-parent.html`);
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForFunction(() => window.exportRenderer);
  for (const template of ['classic', 'season2627']) {
    const rows = await frame.evaluate(async ({ state, template, width, height }) => {
      const api = window.exportRenderer;
      const duration = await api.init({ ...state, anim: { ...state.anim, template, intro: false, manager: false, style: 'off' } }, 'zh-Hans', null);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const rows = [];
      for (const f of [.1, .3, .5, .7, .9, .99]) {
        window.__svgs.length = 0;
        await api.frame(duration * f, false);
        const started = performance.now(); await api.captureInto(canvas); const ms = performance.now() - started;
        const svg = window.__svgs.at(-1);
        if (!svg) { rows.push({ at: f, ms, reused: true }); continue; }
        const urls = [...svg.matchAll(/data:([\w/+.-]+)[;,][^"')\s]*/g)].map(m => ({ type: m[1], length: m[0].length, key: m[0].slice(-64) + m[0].length }));
        const by = {}; const seen = new Map();
        for (const url of urls) {
          const kind = url.type.startsWith('font') || url.type.includes('woff') || url.type.includes('octet') ? 'font' : url.type.startsWith('image') ? 'image' : url.type;
          by[kind] ||= { count: 0, mb: 0, duplicateMb: 0 };
          by[kind].count++; by[kind].mb += url.length / 1e6;
          if (seen.has(url.key)) by[kind].duplicateMb += url.length / 1e6; else seen.set(url.key, 1);
        }
        for (const v of Object.values(by)) { v.mb = +v.mb.toFixed(2); v.duplicateMb = +v.duplicateMb.toFixed(2); }
        const embedded = urls.reduce((a, u) => a + u.length, 0);
        // Largest embedded images, matched to their live <img> by data URL tail.
        const live = [...document.querySelectorAll('#root img')].map(img => {
          const box = img.getBoundingClientRect();
          return { cls: (img.closest('[class]')?.className || '').toString().slice(0, 40), natural: img.naturalWidth + 'x' + img.naturalHeight, box: Math.round(box.width) + 'x' + Math.round(box.height), srcMb: +((img.currentSrc || img.src).length / 1e6).toFixed(2) };
        });
        const top = urls.filter(u => u.type.startsWith('image')).sort((a, b) => b.length - a.length).slice(0, 6).map(u => +(u.length / 1e6).toFixed(2));
        if (f === .5) rows.push({ topImagesMb: top, liveLargest: live.sort((a, b) => b.srcMb - a.srcMb).slice(0, 8) });
        rows.push({ at: f, ms: Math.round(ms), svgMb: +(svg.length / 1e6).toFixed(2), markupMb: +((svg.length - embedded) / 1e6).toFixed(2), nonLatin1: /[^\x00-\xff]/.test(svg), ...by });
      }
      canvas.width = canvas.height = 0;
      return rows;
    }, { state, template, width, height });
    console.log(template); for (const row of rows) console.log(JSON.stringify(row));
  }
} finally { await browser.close(); server.close(); }
