import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

// Pixel difference of browser-export frames (renderer in an iframe: WebP/JPEG
// embedded images) against the lossless top-level renderer, same build and times.
// COMPARE_PROJECT, COMPARE_HEIGHT (1080), COMPARE_DIST (dist), COMPARE_BACKGROUND (video file).
const state = JSON.parse(await readFile(process.env.COMPARE_PROJECT || 'E:/Downloads/matchday-lineup (1).json', 'utf8'));
const height = Number(process.env.COMPARE_HEIGHT || 1080), width = height * 16 / 9;
const root = resolve(process.env.COMPARE_DIST || 'dist'), prefix = '/matchday-xi/';
const background = process.env.COMPARE_BACKGROUND ? await readFile(process.env.COMPARE_BACKGROUND) : null;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === prefix + 'compare-parent.html') { res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<body style="margin:0"><iframe src="${prefix}?render-export" style="border:0;width:${width}px;height:${height}px"></iframe></body>`); return; }
  if (path === prefix + 'background.mp4' && background) { res.writeHead(200, { 'Content-Type': 'video/mp4' }).end(background); return; }
  const file = resolve(root, decodeURIComponent(path.slice(prefix.length)) || 'index.html');
  if (!path.startsWith(prefix) || !file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
  try {
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}${prefix}`;
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const open = async iframe => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(base + (iframe ? 'compare-parent.html' : '?render-export'));
    const target = iframe ? await (await page.waitForSelector('iframe')).contentFrame() : page;
    await target.waitForFunction(() => window.exportRenderer);
    return target;
  };
  const lossless = await open(false), compact = await open(true);
  for (const template of ['classic', 'season2627']) {
    const input = { ...state, anim: { ...state.anim, template, intro: false, manager: false, style: 'off' }, ...(background ? { bg: { ...state.bg, mode: 'video' } } : {}) };
    const frames = async target => target.evaluate(async ({ input, width, height, video, fps }) => {
      const api = window.exportRenderer;
      const duration = await api.init(input, 'zh-Hans', video);
      const count = Math.ceil(duration * fps);
      if (video) await api.prepareVideo(fps, count);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      // Sequential output frames, as the export takes them; keep 8 spread samples.
      const keep = new Set([.08, .2, .32, .45, .58, .7, .83, .97].map(f => Math.floor(count * f)));
      const out = [];
      for (let i = 0; i < count; i++) {
        await api.frame(i / fps, false);
        if (!keep.has(i) && !video) continue; // Video frames must stay sequential.
        await api.captureInto(canvas);
        if (keep.has(i)) out.push({ i, png: canvas.toDataURL('image/png') });
      }
      return out;
    }, { input, width, height, video: background ? base + 'background.mp4' : null, fps: 30 });
    const a = await frames(lossless), b = await frames(compact);
    const rows = await compact.evaluate(async ({ a, b, width, height }) => {
      const read = async url => { const img = new Image(); img.src = url; await img.decode(); const c = new OffscreenCanvas(width, height); const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, width, height).data; };
      const rows = [];
      for (let k = 0; k < a.length; k++) {
        const pa = await read(a[k].png), pb = await read(b[k].png);
        let total = 0, changed = 0, over16 = 0, max = 0, worstBlock = 0, worstAt = [0, 0];
        for (let i = 0; i < pa.length; i += 4) {
          let pixel = 0;
          for (let c = 0; c < 4; c++) { const d = Math.abs(pa[i + c] - pb[i + c]); total += d; pixel = Math.max(pixel, d); }
          if (pixel) changed++; if (pixel > 16) over16++; max = Math.max(max, pixel);
        }
        for (let by = 0; by < height; by += 16) for (let bx = 0; bx < width; bx += 16) {
          let sum = 0, n = 0;
          for (let y = by; y < Math.min(by + 16, height); y++) for (let x = bx; x < Math.min(bx + 16, width); x++) { const i = (y * width + x) * 4; for (let c = 0; c < 4; c++) sum += Math.abs(pa[i + c] - pb[i + c]); n += 4; }
          if (sum / n > worstBlock) { worstBlock = sum / n; worstAt = [bx, by]; }
        }
        const pixels = pa.length / 4;
        // 2x crops (lossless | compact) around the worst block, for visual review.
        const crop = async url => { const img = new Image(); img.src = url; await img.decode(); return img; };
        const [ia, ib] = [await crop(a[k].png), await crop(b[k].png)];
        const side = 160, sx = Math.max(0, Math.min(width - side, worstAt[0] - side / 2)), sy = Math.max(0, Math.min(height - side, worstAt[1] - side / 2));
        const view = document.createElement('canvas'); view.width = side * 4 + 8; view.height = side * 2;
        const vx = view.getContext('2d'); vx.imageSmoothingEnabled = false; vx.fillStyle = '#f0f'; vx.fillRect(0, 0, view.width, view.height);
        vx.drawImage(ia, sx, sy, side, side, 0, 0, side * 2, side * 2); vx.drawImage(ib, sx, sy, side, side, side * 2 + 8, 0, side * 2, side * 2);
        rows.at(-1); window.__crops ||= []; window.__crops.push(view.toDataURL());
        rows.push({ frame: a[k].i, worstAt, mean: +(total / pa.length).toFixed(3), changedPct: +(changed / pixels * 100).toFixed(1), over16Pct: +(over16 / pixels * 100).toFixed(2), worstBlock: +worstBlock.toFixed(1), max });
      }
      return { rows, crops: window.__crops.splice(0) };
    }, { a, b, width, height }).then(async ({ rows, crops }) => {
      const { writeFile, mkdir } = await import('node:fs/promises');
      await mkdir('test-results/compact-frames', { recursive: true });
      for (const [k, url] of crops.entries()) await writeFile(`test-results/compact-frames/${template}-${rows[k].frame}.png`, Buffer.from(url.split(',')[1], 'base64'));
      return rows;
    });
    console.log(template); for (const row of rows) console.log(JSON.stringify(row));
  }
} finally { await browser.close(); server.close(); }
