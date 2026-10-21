import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

// Cost of assigning one real capture frame to image.src, and of decoding it,
// for different data URL encodings. The frame comes from browser export
// (renderer in an iframe), mid-timeline.
const state = JSON.parse(await readFile(process.env.PROBE_PROJECT || 'E:/Downloads/matchday-lineup (1).json', 'utf8'));
const width = 1920, height = 1080, root = resolve(process.env.PROBE_DIST || 'dist'), prefix = '/matchday-xi/';
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === prefix + 'probe-parent.html') { res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<body style="margin:0"><iframe src="${prefix}?render-export" style="border:0;width:${width}px;height:${height}px"></iframe></body>`); return; }
  const file = resolve(root, decodeURIComponent(path.slice(prefix.length)) || 'index.html');
  if (!path.startsWith(prefix) || !file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
  try { res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(() => {
    const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', { ...d, set(v) { if (String(v).startsWith('data:image/svg+xml')) window.__last = String(v); d.set.call(this, v); } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}${prefix}probe-parent.html`);
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForFunction(() => window.exportRenderer);
  for (const template of ['classic', 'season2627']) {
    console.log(template, await frame.evaluate(async ({ state, template, width, height }) => {
      const api = window.exportRenderer;
      const duration = await api.init({ ...state, anim: { ...state.anim, template, intro: false, manager: false, style: 'off' } }, 'zh-Hans', null);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      await api.frame(duration * .6, false); await api.captureInto(canvas);
      const light = window.__last, svg = decodeURIComponent(light.slice(light.indexOf(',') + 1));
      const bytes = new TextEncoder().encode(svg);
      const variants = {
        light: () => light,
        full: () => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
        base64: () => 'data:image/svg+xml;base64,' + bytes.toBase64(),
      };
      const out = { svgMb: +(svg.length / 1e6).toFixed(2) };
      for (const [name, make] of Object.entries(variants)) {
        const runs = [];
        for (let r = 0; r < 4; r++) {
          // Unique per run (a trailing comment), so nothing is served from a cache.
          const t0 = performance.now(); let url = make(); url = name === 'base64' ? url : url + encodeURIComponent(`<!--${r}${name}-->`);
          if (name === 'base64') url = 'data:image/svg+xml;base64,' + new TextEncoder().encode(svg + `<!--${r}-->`).toBase64();
          const t1 = performance.now();
          const image = new Image(); image.src = url; const t2 = performance.now();
          await image.decode(); const t3 = performance.now();
          canvas.getContext('2d').drawImage(image, 0, 0); const t4 = performance.now();
          runs.push([Math.round(t1 - t0), Math.round(t2 - t1), Math.round(t3 - t2), Math.round(t4 - t3)]);
        }
        out[name] = { urlMb: +(make().length / 1e6).toFixed(2), 'make/src/decode/draw': runs.slice(1) };
      }
      return JSON.stringify(out);
    }, { state, template, width, height }));
  }
} finally { await browser.close(); server.close(); }
