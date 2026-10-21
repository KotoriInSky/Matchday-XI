import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

// CPU profile of browser video capture (renderer in an iframe, as in browser
// export): self time per function over PROFILE_FRAMES sequential frames.
// PROFILE_PROJECT, PROFILE_DIST (dist), PROFILE_TEMPLATE (classic), PROFILE_HEIGHT (1080).
const state = JSON.parse(await readFile(process.env.PROFILE_PROJECT || 'E:/Downloads/matchday-lineup (1).json', 'utf8'));
const height = Number(process.env.PROFILE_HEIGHT || 1080), width = height * 16 / 9, fps = 60;
const frames = Number(process.env.PROFILE_FRAMES || 120), template = process.env.PROFILE_TEMPLATE || 'classic';
const root = resolve(process.env.PROFILE_DIST || 'dist'), prefix = '/matchday-xi/';
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === prefix + 'profile-parent.html') { res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<body style="margin:0"><iframe src="${prefix}?render-export" style="border:0;width:${width}px;height:${height}px"></iframe></body>`); return; }
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
  await page.goto(`http://127.0.0.1:${server.address().port}${prefix}profile-parent.html`);
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForFunction(() => window.exportRenderer);
  const count = await frame.evaluate(async ({ state, template, width, height, fps }) => {
    const duration = await window.exportRenderer.init({ ...state, anim: { ...state.anim, template, intro: false, manager: false, style: 'off' } }, 'zh-Hans', null);
    window.__canvas = document.createElement('canvas'); window.__canvas.width = width; window.__canvas.height = height;
    return Math.ceil(duration * fps);
  }, { state, template, width, height, fps });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
  // Frames spread over the whole timeline, sequential within each block.
  const ms = await frame.evaluate(async ({ count, frames, fps }) => {
    const t = performance.now();
    for (let i = 0; i < frames; i++) { const k = Math.floor(i * count / frames); await window.exportRenderer.frame(k / fps, false); await window.exportRenderer.captureInto(window.__canvas); }
    return performance.now() - t;
  }, { count, frames, fps });
  const { profile } = await cdp.send('Profiler.stop');
  await mkdir('test-results/browser-performance', { recursive: true });
  await writeFile(`test-results/browser-performance/capture-${template}.cpuprofile`, JSON.stringify(profile));
  // Self time per node, aggregated by function and location.
  const dt = new Map(); profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) || 0) + (profile.timeDeltas[i] || 0)));
  const by = new Map(); let total = 0;
  for (const node of profile.nodes) {
    const t = (dt.get(node.id) || 0) / 1000; total += t;
    const f = node.callFrame, key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
    by.set(key, (by.get(key) || 0) + t);
  }
  console.log(JSON.stringify({ template, frames, msPerFrame: Math.round(ms / frames), profiledMs: Math.round(total) }));
  for (const [key, t] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${(t / total * 100).toFixed(1).padStart(5)}%  ${Math.round(t)} ms  ${key}`);
} finally { await browser.close(); server.close(); }
