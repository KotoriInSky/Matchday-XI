import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

// What fills the non-image part of a browser-export frame SVG: @font-face rules
// (and duplicates), capture style rules, and the most common declarations.
const state = JSON.parse(await readFile(process.env.INSPECT_PROJECT || 'E:/Downloads/matchday-lineup (1).json', 'utf8'));
const width = 1920, height = 1080, root = resolve(process.env.INSPECT_DIST || 'dist'), prefix = '/matchday-xi/';
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === prefix + 'inspect-parent.html') { res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<body style="margin:0"><iframe src="${prefix}?render-export" style="border:0;width:${width}px;height:${height}px"></iframe></body>`); return; }
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
  await page.goto(`http://127.0.0.1:${server.address().port}${prefix}inspect-parent.html`);
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForFunction(() => window.exportRenderer);
  for (const template of ['classic', 'season2627']) {
    console.log(template, await frame.evaluate(async ({ state, template, width, height }) => {
      const api = window.exportRenderer;
      const duration = await api.init({ ...state, anim: { ...state.anim, template, intro: false, manager: false, style: 'off' } }, 'zh-Hans', null);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      await api.frame(duration * .6, false); await api.captureInto(canvas);
      const svg = decodeURIComponent(window.__last.slice(window.__last.indexOf(',') + 1));
      const style = svg.slice(svg.indexOf('<style>') + 7, svg.indexOf('</style>'));
      const faces = style.match(/@font-face\s*\{[^}]*\}/g) || [];
      const urls = faces.map(f => /url\("([^"]+)"\)/.exec(f)?.[1] || '');
      const families = faces.map(f => /font-family:\s*([^;]+)/.exec(f)?.[1] + ' ' + (/unicode-range:\s*([^;]+)/.exec(f)?.[1] || '').slice(0, 20) + ' ' + Math.round((/url\("([^"]+)"\)/.exec(f)?.[1] || '').length / 1000) + 'KB');
      const rules = style.slice(faces.join('').length).match(/\.capture-\d+[^{]*\{[^}]*\}/g) || [];
      const decls = new Map();
      for (const rule of rules) for (const d of rule.slice(rule.indexOf('{') + 1, -1).split(';')) if (d) decls.set(d, (decls.get(d) || 0) + 1);
      const body = svg.slice(svg.indexOf('</style>') + 8);
      const noImages = body.replace(/data:[^"]+/g, '');
      return JSON.stringify({
        svgKB: Math.round(svg.length / 1000), fontFacesKB: Math.round(faces.join('').length / 1000), faces: faces.length, uniqueFontUrls: new Set(urls).size, families,
        ruleKB: Math.round(rules.join('').length / 1000), rules: rules.length, avgRuleBytes: Math.round(rules.join('').length / rules.length),
        commonDecls: [...decls].sort((a, b) => b[1] * b[0].length - a[1] * a[0].length).slice(0, 12).map(([d, n]) => `${n}x ${d}`),
        bodyKBWithoutImages: Math.round(noImages.length / 1000), elements: (body.match(/<[a-z]/g) || []).length,
      }, null, 1);
    }, { state, template, width, height }));
  }
} finally { await browser.close(); server.close(); }
