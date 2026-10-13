import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
await mkdir('test-results/browser-export', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  let apiRequests = 0;
  await page.route('**/api/export**', route => { apiRequests++; return route.abort(); });
  await page.goto(base);
  const state = await page.evaluate(async base => {
    const { store } = await import(base + 'src/lib/store.ts'); await store.ready;
    const s = structuredClone(store.state);
    const portrait = color => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 600;
      const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(200, 100, 75, 0, 7); ctx.fill();
      ctx.fillRect(70, 210, 260, 390); return c.toDataURL();
    };
    Object.assign(s.players[0], { name: 'Trent Alexander-Arnold', nameLine1: 'Trent', nameLine2: 'ALEXANDER-\nARNOLD', captain: true, key: true, photo: portrait('#ef4444'), photo2: portrait('#22c55e'), photoK: portrait('#3b82f6'), cut: true, cutK: true, cutS: true, fit: { z: 1.25, x: 0, y: -5 }, tag2: 'cn' });
    Object.assign(s.anim, { intro: false, manager: false, style: 'off' });
    window.exportTestState = s; return s;
  }, base);
  await writeFile('test-results/browser-export/project.json', JSON.stringify(state));
  // Compare name regions against Chromium's own rendering, so missing embedded
  // fonts cannot pass merely because a PNG/MP4 has the right dimensions.
  const reference = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await reference.goto(base + '?render-export'); await reference.waitForFunction(() => window.exportRenderer);
  await reference.evaluate(async state => { await window.exportRenderer.init(state, 'en', null); await window.exportRenderer.frame(2); }, state);
  const expected = await reference.screenshot();
  const captured = await reference.evaluate(async () => (await window.exportRenderer.capture(1280, 720)).toDataURL());
  const regions = await reference.locator('[class*="_nm_"] b').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.width), h: Math.ceil(r.height) };
  }));
  const errors = await page.evaluate(async ({ urls, regions }) => {
    const pixels = await Promise.all(urls.map(async url => {
      const image = new Image(); image.src = url; await image.decode(); const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
      const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, 1280, 720).data;
    }));
    return regions.map(r => {
      let sum = 0, count = 0;
      for (let y = Math.max(0, r.y); y < Math.min(720, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(1280, r.x + r.w); x++) for (let c = 0; c < 3; c++) {
        const i = (y * 1280 + x) * 4 + c; sum += Math.abs(pixels[0][i] - pixels[1][i]); count++;
      }
      return count ? sum / count : 0;
    });
  }, { urls: ['data:image/png;base64,' + expected.toString('base64'), captured], regions });
  assert.ok(regions.length >= 11);
  assert.ok(errors.every(error => error < 22), `Name rendering diverged from preview: ${errors}`);
  await writeFile('test-results/browser-export/name-errors.json', JSON.stringify(errors)); await reference.close();
  const cutout = await browser.newPage();
  await cutout.goto(base + '?render-cards'); await cutout.waitForFunction(() => window.cardRenderer);
  await cutout.evaluate(state => window.cardRenderer.init(state, 'en'), { ...state, anim: { ...state.anim, template: 'classic' } });
  for (const kind of ['small', 'big', 'key']) {
    const bounds = await cutout.evaluate(kind => window.cardRenderer.show(0, kind), kind);
    const factor = 1024 / Math.max(bounds.width + 144, bounds.height + 144);
    const width = Math.round((bounds.width + 144) * factor), height = Math.round((bounds.height + 144) * factor);
    await cutout.setViewportSize({ width, height });
    const protruding = await cutout.evaluate(async ({ kind, factor, bounds, width, height }) => {
      await window.cardRenderer.place(600 * factor, (72 - bounds.x) * factor, (72 - bounds.y) * factor);
      const card = document.querySelector(kind === 'small' ? '[class*="_sm-por_"]' : '[class*="_rc-in_"]');
      const top = Math.floor(card.getBoundingClientRect().top);
      const canvas = await window.cardRenderer.capture(width, height);
      const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      const channel = { small: 1, big: 0, key: 2 }[kind]; let pixels = 0;
      for (let y = 0; y < top - 2; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] > 200 && data[i + channel] > 180 && data[i + channel] > data[i + (channel + 1) % 3] * 1.4 && data[i + channel] > data[i + (channel + 2) % 3] * 1.4) pixels++;
      }
      return { top, pixels };
    }, { kind, factor, bounds, width, height });
    assert.ok(protruding.pixels > 100, `${kind}: transparent portrait above card must survive export: ${JSON.stringify(protruding)}`);
  }
  await cutout.close();
  async function cards(template, cards, size, batch = false) {
    return page.evaluate(async ({ base, template, cards, size, batch }) => {
      const { browserCards } = await import(base + 'src/lib/browser-export.ts');
      const s = structuredClone(window.exportTestState); s.anim.template = template;
      const result = await browserCards({ state: s, lang: 'en', size, cards, batch, signal: new AbortController().signal, onProgress() {} });
      const data = new Uint8Array(await (await fetch(result.url)).arrayBuffer()); URL.revokeObjectURL(result.url);
      return { bytes: [...data], dimensions: result.dimensions };
    }, { base, template, cards, size, batch });
  }
  for (const [kind, size] of [['small', 1024], ['big', 2048], ['key', 4096]]) {
    const r = await cards('classic', [{ index: 0, kind }], size);
    const png = Buffer.from(r.bytes);
    assert.equal(Math.max(png.readUInt32BE(16), png.readUInt32BE(20)), size);
    const stats = await page.evaluate(async url => {
      const img = new Image(); img.src = url; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); const data = ctx.getImageData(0, 0, img.width, img.height).data;
      let edge = 0, solid = 0, soft = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3], x = i / 4 % img.width, y = Math.floor(i / 4 / img.width);
        if (alpha && (x === 0 || y === 0 || x === img.width - 1 || y === img.height - 1)) edge++;
        if (alpha === 255) solid++; else if (alpha) soft++;
      }
      return { edge, solid, soft };
    }, 'data:image/png;base64,' + png.toString('base64'));
    assert.equal(stats.edge, 0); assert.ok(stats.solid > size * size * .02); assert.ok(stats.soft > 0);
    await writeFile(`test-results/browser-export/${kind}-${size}.png`, png);
  }
  const zipped = await cards('season2627', [{ index: 0, kind: 'big' }, { index: 0, kind: 'key' }, { index: 1, kind: 'small' }], 1024, true);
  const entries = unzipSync(new Uint8Array(zipped.bytes)); assert.equal(Object.keys(entries).length, 3);
  for (const [name, bytes] of Object.entries(entries)) await writeFile(`test-results/browser-export/${name}`, bytes);
  await page.evaluate(async base => {
    const { browserCards } = await import(base + 'src/lib/browser-export.ts');
    const ctrl = new AbortController();
    const promise = browserCards({ state: window.exportTestState, lang: 'en', size: 1024, cards: [{ index: 0, kind: 'big' }], batch: false, signal: ctrl.signal, onProgress() {} });
    ctrl.abort();
    try { await promise; throw new Error('Cancellation failed'); } catch (error) { if (error.name !== 'AbortError') throw error; }
    if (document.querySelector('iframe[title="Export renderer"]')) throw new Error('Renderer was not cleaned up');
  }, base);
  await page.evaluate(async base => {
    const { browserVideo, browserCards } = await import(base + 'src/lib/browser-export.ts');
    const ctrl = new AbortController();
    const pending = browserVideo({ state: window.exportTestState, lang: 'en', height: 720, fps: 30, signal: ctrl.signal, onProgress() { ctrl.abort(); } });
    try {
      await browserCards({ state: window.exportTestState, lang: 'en', size: 1024, cards: [{ index: 0, kind: 'big' }], batch: false, signal: new AbortController().signal, onProgress() {} });
      throw new Error('Concurrent export was not rejected');
    } catch (error) { if (error.message !== 'busy') throw error; }
    try { await pending; throw new Error('Active encoding was not cancelled'); } catch (error) { if (error.name !== 'AbortError') throw error; }
    if (document.querySelector('iframe[title="Export renderer"]')) throw new Error('Cancelled video leaked its renderer');
  }, base);
  if (process.env.BROWSER_CARDS_ONLY === '1') {
    assert.equal(apiRequests, 0); console.log('Browser card transparency, actual out-of-frame portrait pixels, name fidelity, ZIP and active cancellation passed.');
  } else {
  const height = Number(process.env.BROWSER_VIDEO_HEIGHT || 1440);
  const bytes = await page.evaluate(async ({ base, height }) => {
    const { browserVideo } = await import(base + 'src/lib/browser-export.ts');
    const url = await browserVideo({ state: window.exportTestState, lang: 'en', height, fps: 30, signal: new AbortController().signal, onProgress() {} });
    const bytes = [...new Uint8Array(await (await fetch(url)).arrayBuffer())]; URL.revokeObjectURL(url); return bytes;
  }, { base, height });
  const filename = `test-results/browser-export/browser-${height}.mp4`; await writeFile(filename, Buffer.from(bytes));
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name,r_frame_rate,nb_frames', '-of', 'json', filename], { encoding: 'utf8' })).streams[0];
  assert.equal(info.height, height); assert.equal(info.width, height * 16 / 9); assert.equal(info.codec_name, 'h264'); assert.equal(info.r_frame_rate, '30/1'); assert.ok(Number(info.nb_frames) > 30);
  assert.equal(apiRequests, 0, 'Browser export must never call the local API');
  console.log('Browser PNG sizes, transparency, ZIP selection, both templates, cancellation and real H.264 MP4 passed without an export API.', info);
  }
} finally { await browser.close(); }
