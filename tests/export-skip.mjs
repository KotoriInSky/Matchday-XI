import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Video capture skips serializing a frame when the document, its animations,
// fonts and video frame are unchanged. Every sequential output frame must match
// a capture made without any reuse, pixel for pixel.
// EXPORT_PROJECT selects another project; SKIP_FPS (default 15) the frame rate.
const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const state = JSON.parse(await readFile(process.env.EXPORT_PROJECT || 'test-results/export-resources/state.json', 'utf8').catch(() => {
  throw new Error('Run npm run test:export-resources first to create its fixture');
}));
const fps = Number(process.env.SKIP_FPS || 15);
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const template of ['classic', 'season2627']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(base + '?render-export'); await page.waitForFunction(() => window.exportRenderer);
    const result = await page.evaluate(async ({ state, template, base, fps }) => {
      const api = window.exportRenderer;
      const input = { ...state, anim: { ...state.anim, template, intro: true, manager: true, style: 'lines' } };
      const duration = await api.init(input, 'zh-Hans', null);
      const { createBrowserCapture } = await import(base + 'src/lib/browser-capture.ts');
      const { normalize } = await import(base + 'src/engine/state.ts');
      // The product's video-frame options, without reuse.
      const reference = createBrowserCapture(normalize(input), { pruneInvisible: true, imageHeadroom: 3, lightEncoding: true, subsetFonts: true });
      let serialized = 0, decoded = 0, counting = false;
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function (...args) { if (counting) decoded++; return decode.apply(this, args); };
      const serialize = XMLSerializer.prototype.serializeToString;
      XMLSerializer.prototype.serializeToString = function (...args) { if (counting) serialized++; return serialize.apply(this, args); };
      const product = document.createElement('canvas'), expected = document.createElement('canvas');
      product.width = expected.width = 1280; product.height = expected.height = 720;
      const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, 1280, 720).data;
      const frames = Math.ceil(duration * fps), mismatches = [];
      try {
        for (let i = 0; i < frames; i++) {
          await api.frame(i / fps, false);
          counting = true; await api.captureInto(product); counting = false;
          await reference(document.getElementById('root'), 1280, 720, expected);
          const a = pixels(product), b = pixels(expected);
          let differ = false;
          for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) { differ = true; break; }
          if (differ) mismatches.push(i);
        }
      } finally { XMLSerializer.prototype.serializeToString = serialize; HTMLImageElement.prototype.decode = decode; }
      // decoded < serialized: frames that serialized identically and reused pixels.
      return { frames, serialized, decoded, mismatches: mismatches.slice(0, 10), mismatchCount: mismatches.length };
    }, { state, template, base, fps });
    console.log(JSON.stringify({ template, ...result, skipped: result.frames - result.serialized }));
    assert.equal(result.mismatchCount, 0, `${template}: frames ${result.mismatches.join(', ')} differ from a capture without reuse`);
    // classic keeps ambient loops (beams, holo shimmer) running, so no frame repeats.
    // season2627 holds most of its layout; most frames that end up identical
    // must be detected before serializing.
    if (template === 'season2627') assert.ok(result.frames - result.serialized >= .7 * (result.frames - result.decoded), `${template}: held frames must skip serialization`);
    await page.close();
  }
  console.log('Skipped and reused video frames match captures without reuse in both templates.');
} finally { await browser.close(); }
