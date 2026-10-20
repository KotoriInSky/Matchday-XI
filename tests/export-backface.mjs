import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const output = 'test-results/export-backface';
await mkdir(output, { recursive: true });
// CHROME_ARGS='--enable-blink-features=CanvasDrawElement' checks the HTML-in-Canvas path.
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: process.env.CHROME_ARGS?.split(' ').filter(Boolean) });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  await page.goto(base);
  await page.evaluate(async base => {
    const { createBrowserCapture } = await import(base + 'src/lib/browser-capture.ts');
    const { SAMPLE } = await import(base + 'src/engine/constants.ts');
    document.head.querySelectorAll('style,link[rel=stylesheet]').forEach(node => node.remove());
    document.body.style.cssText = 'margin:0';
    const style = document.createElement('style');
    style.textContent = '.view{position:absolute;left:180px;top:60px;width:280px;height:240px;perspective:900px}.flip{position:absolute;inset:0;transform-style:preserve-3d}.face{position:absolute;inset:0;backface-visibility:hidden}.front{background:rgb(0,220,40)}.back{background:rgb(240,20,40);transform:rotateY(180deg)}';
    document.head.append(style);
    const root = document.createElement('div');
    root.style.cssText = 'position:relative;width:640px;height:360px;overflow:hidden;background:rgb(20,30,40)';
    root.innerHTML = '<div class="view"><div class="flip"><div class="face front"></div><div class="face back"></div></div></div>';
    document.body.replaceChildren(root);
    window.backfaceFixture = { root, captures: [createBrowserCapture(SAMPLE), createBrowserCapture(SAMPLE, { allProperties: true, pruneInvisible: true })] };
  }, base);
  const results = [];
  for (const angle of [0, -65, 65, 89, 91, 115, 180, -180, -115, -91, -89, 0]) {
    await page.evaluate(angle => { document.querySelector('.flip').style.transform = `rotateY(${angle}deg)`; }, angle);
    const native = await page.screenshot();
    for (const captureIndex of [0, 1]) {
      const data = await page.evaluate(async index => {
        const { root, captures } = window.backfaceFixture;
        const before = root.innerHTML;
        const canvas = await captures[index](root, 640, 360);
        if (root.innerHTML !== before) throw Error('Capture changed the live animation DOM');
        return canvas.toDataURL().split(',')[1];
      }, captureIndex);
      const sample = await page.evaluate(async ({ native, captured }) => {
        const read = async src => {
          const image = new Image(); image.src = 'data:image/png;base64,' + src; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          return [...context.getImageData(320, 180, 1, 1).data];
        };
        return { native: await read(native), captured: await read(captured) };
      }, { native: native.toString('base64'), captured: data });
      results.push({ angle, captureIndex, ...sample });
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
      assert.deepEqual(sample.captured, sample.native, `Export must show the same card face as preview at ${angle} degrees (capture ${captureIndex})`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(base + '?render-export');
  const state = await page.evaluate(async base => {
    const { SAMPLE } = await import(base + 'src/engine/constants.ts');
    const state = structuredClone(SAMPLE);
    const photo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#00dc28"/></svg>');
    for (const player of state.players) Object.assign(player, { photo, photo2: photo, cut: true, cutS: true });
    return state;
  }, base);
  for (const template of ['classic', 'season2627']) {
    Object.assign(state.anim, { template, style: 'lines' });
    const total = await page.evaluate(state => window.exportRenderer.init(state, 'en', null), state);
    if (process.env.CHROME_ARGS?.includes('CanvasDrawElement')) assert.equal(await page.evaluate(() => window.exportRenderer.captureMode), 'element', 'HTML-in-Canvas must pass validation for this check');
    await page.evaluate(time => window.exportRenderer.frame(time), total - 1 / 60);
    const points = await page.evaluate(() => [...document.querySelectorAll('[data-i]')].flatMap(slot => {
      const photo = slot.querySelector('[data-fit$=":fitS"]');
      if (!photo) return [];
      const rect = photo.getBoundingClientRect();
      return [{ player: slot.dataset.i, x: Math.floor(rect.x + rect.width / 2), y: Math.floor(rect.y + rect.height / 2) }];
    }));
    assert.equal(points.length, 11, 'The final lineup must contain all eleven portraits');
    const native = await page.screenshot();
    const captured = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      await window.exportRenderer.captureInto(canvas); return canvas.toDataURL().split(',')[1];
    });
    await writeFile(`${output}/${template}-native.png`, native);
    await writeFile(`${output}/${template}-captured.png`, Buffer.from(captured, 'base64'));
    const samples = await page.evaluate(async ({ native, captured, points }) => {
      const read = async src => {
        const image = new Image(); image.src = 'data:image/png;base64,' + src; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return points.map(({ x, y }) => [...context.getImageData(x, y, 1, 1).data]);
      };
      return { native: await read(native), captured: await read(captured) };
    }, { native: native.toString('base64'), captured, points });
    for (let i = 0; i < points.length; i++) {
      assert.deepEqual(samples.native[i], [0, 220, 40, 255], `Preview fixture portrait ${points[i].player} must be visible`);
      assert.deepEqual(samples.captured[i], samples.native[i], `${template}: final portrait ${points[i].player} must not be covered by the mirrored back`);
    }
  }
  console.log('Export front/back visibility matches native rendering across flips, edge-on boundaries and backward seeks; all eleven final portraits match in both templates, and the live DOM is unchanged.');
} finally { await browser.close(); }
