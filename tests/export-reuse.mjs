import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Video frames whose markup is unchanged reuse the target's pixels; any change
// in the sampled artwork must be decoded again.
const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const state = JSON.parse(await readFile('test-results/export-resources/state.json', 'utf8').catch(() => {
  throw new Error('Run npm run test:export-resources first to create its fixture');
}));
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const template of ['classic', 'season2627']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(base + '?render-export'); await page.waitForFunction(() => window.exportRenderer);
    const result = await page.evaluate(async ({ state, template }) => {
      const api = window.exportRenderer;
      const duration = await api.init({ ...state, anim: { ...state.anim, template } }, 'zh-Hans', null);
      let decodes = 0; const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () { decodes++; return decode.call(this); };
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const inspection = document.createElement('canvas'); inspection.width = 1280; inspection.height = 720;
      const inspect = inspection.getContext('2d', { willReadFrequently: true });
      const hash = async () => {
        inspect.clearRect(0, 0, 1280, 720); inspect.drawImage(canvas, 0, 0);
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', inspect.getImageData(0, 0, 1280, 720).data))].join(',');
      };
      const step = async time => { const before = decodes; await api.frame(time, false); await api.captureInto(canvas); return { decoded: decodes - before, hash: await hash() }; };
      const first = await step(duration * .5), repeat = await step(duration * .5), moved = await step(duration * .25), back = await step(duration * .5);
      HTMLImageElement.prototype.decode = decode;
      return { first, repeat, moved, back, sameAsFirst: back.hash === first.hash };
    }, { state, template });
    assert.equal(result.first.decoded, 1, `${template}: the first frame must be decoded`);
    assert.equal(result.repeat.decoded, 0, `${template}: an unchanged frame must reuse the target`);
    assert.equal(result.repeat.hash, result.first.hash, `${template}: a reused frame must keep its pixels`);
    assert.equal(result.moved.decoded, 1, `${template}: a changed frame must be decoded`);
    assert.notEqual(result.moved.hash, result.first.hash, `${template}: a changed frame must update its pixels`);
    assert.equal(result.back.decoded, 1, `${template}: returning to an earlier frame must decode it again`);
    assert.ok(result.sameAsFirst, `${template}: decoding the same time again must give the same pixels`);
    await page.close();
  }
  console.log('Unchanged video frames reuse their pixels; changed frames are decoded in both templates.');
} finally { await browser.close(); }
