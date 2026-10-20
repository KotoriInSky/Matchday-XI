import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

// Which part of browser video capture holds renderer memory? Each variant runs
// in a fresh browser: PROBE_VARIANTS=current,software,nodraw,serialize.
//   current   - the product path (captureInto a plain canvas)
//   software  - target canvas created with willReadFrequently (CPU raster)
//   nodraw    - SVG data URLs are decoded but never drawn
//   serialize - SVG markup is built but never assigned to an image
const state = JSON.parse(await readFile(process.env.PROBE_PROJECT || 'E:/Downloads/matchday-lineup (1).json', 'utf8'));
const height = Number(process.env.PROBE_HEIGHT || 1080), width = height * 16 / 9;
const frames = Number(process.env.PROBE_FRAMES || 360), step = 60, fps = 60;
const template = process.env.PROBE_TEMPLATE || 'classic';
const root = resolve(process.env.PROBE_DIST || 'dist'), prefix = '/matchday-xi/';
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  // PROBE_IFRAME=1 hosts the renderer in an iframe, as the browser export does.
  if (path === prefix + 'probe-parent.html') { res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<body style="margin:0"><iframe src="${prefix}?render-export" style="border:0;width:${width}px;height:${height}px"></iframe></body>`); return; }
  const file = resolve(root, decodeURIComponent(path.slice(prefix.length)) || 'index.html');
  if (!path.startsWith(prefix) || !file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
  try {
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const privateMiB = ids => {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Measure-Object PrivateMemorySize64 -Sum).Sum`]);
  return Math.round(Number(String(out).trim()) / 2 ** 20);
};
try {
  for (const variant of (process.env.PROBE_VARIANTS || 'current,software,nodraw,serialize').split(',')) {
    const browser = await chromium.launch({ channel: 'chrome', args: ['--js-flags=--expose-gc'] });
    try {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.addInitScript(variant => {
        if (variant === 'serialize') {
          const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
          Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set(value) { if (!String(value).startsWith('data:image/svg+xml')) descriptor.set.call(this, value); } });
          const decode = HTMLImageElement.prototype.decode;
          HTMLImageElement.prototype.decode = function () { return this.getAttribute('src') ? decode.call(this) : Promise.resolve(); };
        }
        if (variant === 'nodraw' || variant === 'serialize') {
          const draw = CanvasRenderingContext2D.prototype.drawImage;
          CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
            if (image instanceof HTMLImageElement && /^data:image\/svg/.test(image.src)) return;
            if (variant === 'serialize' && image instanceof HTMLImageElement && !image.getAttribute('src')) return;
            return draw.call(this, image, ...args);
          };
        }
      }, variant);
      const iframe = process.env.PROBE_IFRAME === '1';
      await page.goto(`http://127.0.0.1:${server.address().port}${prefix}${iframe ? 'probe-parent.html' : '?render-export'}`);
      const target = iframe ? await (await page.waitForSelector('iframe')).contentFrame() : page;
      await target.waitForFunction(() => window.exportRenderer);
      const cdp = await browser.newBrowserCDPSession();
      const renderers = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo.filter(p => p.type === 'renderer').map(p => p.id);
      const gpu = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo.filter(p => p.type === 'GPU').map(p => p.id);
      await target.evaluate(async ({ state, template, width, height, variant }) => {
        window.__duration = await window.exportRenderer.init({ ...state, anim: { ...state.anim, template, intro: false, manager: false, style: 'off' } }, 'zh-Hans', null);
        window.__canvas = document.createElement('canvas'); window.__canvas.width = width; window.__canvas.height = height;
        if (variant === 'software') window.__canvas.getContext('2d', { willReadFrequently: true });
      }, { state, template, width, height, variant });
      const row = { variant, template, height, samples: [[0, privateMiB(await renderers()), privateMiB(await gpu())]] };
      const started = Date.now();
      for (let done = 0; done < frames; done += step) {
        await target.evaluate(async ({ from, count, fps }) => {
          for (let i = from; i < from + count; i++) { await window.exportRenderer.frame(i / fps, false); await window.exportRenderer.captureInto(window.__canvas); }
        }, { from: done, count: step, fps });
        row.samples.push([done + step, privateMiB(await renderers()), privateMiB(await gpu())]);
      }
      row.msPerFrame = Math.round((Date.now() - started) / frames);
      await target.evaluate(() => { window.gc?.(); return new Promise(r => setTimeout(r, 3000)); });
      row.afterIdle = [privateMiB(await renderers()), privateMiB(await gpu())];
      console.log(JSON.stringify(row));
    } finally { await browser.close(); }
  }
} finally { server.close(); }
