import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Uploaded fonts are embedded as subsets of the displayed characters. Frames
// must match the full-font capture, including CJK text and WOFF2 uploads.
const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const cjk = process.env.FONT_CJK || 'C:/Windows/Fonts/simhei.ttf';
const woff2 = 'public/fonts/anton/767e9249d109359e4061.woff2';
const state = JSON.parse(await readFile('test-results/export-resources/state.json', 'utf8').catch(() => {
  throw new Error('Run npm run test:export-resources first to create its fixture');
}));
const font = async (file, type) => ({ name: file.split('/').pop(), data: `data:${type};base64,` + (await readFile(file)).toString('base64') });
state.customFonts = { display: await font(woff2, 'font/woff2'), body: await font(cjk, 'font/ttf'), number: null };
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const template of ['classic', 'season2627']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', error => console.error('pageerror', error.message));
    await page.goto(base + '?render-export'); await page.waitForFunction(() => window.exportRenderer);
    const result = await page.evaluate(async ({ state, template, base }) => {
      const { createBrowserCapture } = await import(base + 'src/lib/browser-capture.ts');
      const api = window.exportRenderer, root = document.getElementById('root');
      const input = { ...state, anim: { ...state.anim, template } };
      const duration = await api.init(input, 'zh-Hans', null);
      const full = createBrowserCapture(input, { pruneInvisible: true, lightEncoding: true });
      const subset = createBrowserCapture(input, { pruneInvisible: true, lightEncoding: true, subsetFonts: true });
      const a = document.createElement('canvas'), b = document.createElement('canvas');
      a.width = b.width = 1280; a.height = b.height = 720;
      const rows = [];
      for (const time of [duration * .2, duration * .5, duration * .8, duration - .2]) {
        await api.frame(time, false);
        let at = performance.now(); await full(root, 1280, 720, a); const fullMs = performance.now() - at;
        at = performance.now(); await subset(root, 1280, 720, b); const subsetMs = performance.now() - at;
        const pa = a.getContext('2d').getImageData(0, 0, 1280, 720).data, pb = b.getContext('2d').getImageData(0, 0, 1280, 720).data;
        let changed = 0, max = 0;
        for (let i = 0; i < pa.length; i++) { const d = Math.abs(pa[i] - pb[i]); if (d) changed++; max = Math.max(max, d); }
        rows.push({ time: +time.toFixed(2), changed, max, fullMs: Math.round(fullMs), subsetMs: Math.round(subsetMs) });
      }
      return rows;
    }, { state, template, base });
    console.log(template, JSON.stringify(result));
    for (const row of result) assert.equal(row.changed, 0, `${template}/${row.time}: subset fonts must render the same pixels (max ${row.max})`);
    // After the first frame builds the subsets, embedding them must be cheaper.
    const later = result.slice(1);
    assert.ok(later.reduce((s, r) => s + r.subsetMs, 0) < later.reduce((s, r) => s + r.fullMs, 0), `${template}: subset frames should capture faster`);
    await page.close();
  }
  console.log('Uploaded TTF and WOFF2 fonts are subset without changing pixels in both templates.');
} finally { await browser.close(); }
