import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { renderCards } from '../server/card-renderer.mjs';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
await mkdir('test-results/card-sizing', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  await page.goto(base);
  const state = await page.evaluate(async base => {
    const { SAMPLE } = await import(base + 'src/engine/constants.ts');
    const s = structuredClone(SAMPLE);
    const c = document.createElement('canvas'); c.width = 400; c.height = 600;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#00ee00';
    ctx.beginPath(); ctx.arc(200, 85, 70, 0, 7); ctx.fill(); ctx.fillRect(110, 190, 180, 410);
    Object.assign(s.colors, { c1: '#dd00dd', k2: '#dd00dd', c2: '#dd00dd' });
    Object.assign(s.players[0], { photo: c.toDataURL(), cut: true, tag1: '', tag2: '', captain: false, key: false });
    return s;
  }, base);
  for (const template of ['classic', 'season2627']) for (const method of ['browser', 'local']) for (const shape of ['rounded', 'angled']) {
    state.anim.template = template; state.look.shape = shape;
    const samples = [];
    for (const zoom of [1, 1.8]) {
      let localURL;
      if (method === 'local') {
        const renderer = await browser.newPage(); await renderer.goto(base + '?render-cards');
        const localState = structuredClone(state); localState.players[0].fit = { z: zoom, x: 0, y: -10 };
        const job = { dir: 'test-results/card-sizing' };
        await renderCards(renderer, job, { state: localState, lang: 'en', size: 1024, cards: [{ index: 0, kind: 'big' }] });
        localURL = 'data:image/png;base64,' + (await readFile(job.file)).toString('base64');
        await renderer.close();
      }
      const result = await page.evaluate(async ({ base, state, zoom, localURL }) => {
        const { browserCards } = await import(base + 'src/lib/browser-export.ts');
        state.players[0].fit = { z: zoom, x: 0, y: -10 };
        const result = localURL ? { url: localURL } : await browserCards({ state, lang: 'en', size: 1024, cards: [{ index: 0, kind: 'big' }], batch: false, signal: new AbortController().signal, onProgress() {} });
        const img = new Image(); img.src = result.url; await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
        let cardWidth = 0, green = 0, edge = 0, firstGreenWidth = 0, maxGreenWidth = 0;
        for (let y = 0; y < img.height; y++) {
          let first = img.width, last = -1, rowGreen = 0;
          for (let x = 0; x < img.width; x++) {
            const i = (y * img.width + x) * 4;
            if (pixels[i + 3] > 240 && pixels[i] > 80 && pixels[i + 2] > 60 && pixels[i + 1] < Math.min(pixels[i], pixels[i + 2]) * .45) { first = Math.min(first, x); last = x; }
            if (pixels[i + 3] > 240 && pixels[i + 1] > 180 && pixels[i] < 80 && pixels[i + 2] < 80) { green++; rowGreen++; }
            if (pixels[i + 3] && (x === 0 || y === 0 || x === img.width - 1 || y === img.height - 1)) edge++;
          }
          cardWidth = Math.max(cardWidth, last - first + 1);
          if (rowGreen && !firstGreenWidth) firstGreenWidth = rowGreen;
          maxGreenWidth = Math.max(maxGreenWidth, rowGreen);
        }
        const bytes = [...new Uint8Array(await (await fetch(result.url)).arrayBuffer())]; URL.revokeObjectURL(result.url);
        return { width: img.width, height: img.height, cardWidth, green, edge, firstGreenWidth, maxGreenWidth, bytes };
      }, { base, state: structuredClone(state), zoom, localURL });
      await writeFile(`test-results/card-sizing/${template}-${method}-${shape}-zoom-${zoom}.png`, Buffer.from(result.bytes));
      const { bytes, ...stats } = result; samples.push(stats);
      assert.equal(stats.edge, 0, 'Portraits and shadows must have a transparent border');
      assert.ok(stats.green > 1000, 'The exported PNG must contain the portrait');
      assert.ok(stats.firstGreenWidth < stats.maxGreenWidth * .2, 'The round portrait head must retain its top, without an internal clipping line');
    }
    assert.ok(Math.abs(samples[0].cardWidth - samples[1].cardWidth) <= 2, `Portrait overflow must not resize the card frame: ${JSON.stringify(samples)}`);
    const expectedWidth = template === 'classic' ? 1024 * 29 / 44.5 : 1024 * 384 / 636;
    assert.ok(samples.every(sample => Math.abs(sample.cardWidth - expectedWidth) <= 2), 'The exported frame must match the selected long edge');
    assert.ok(samples[1].height > samples[0].height, 'More portrait overflow must extend the canvas');
    console.log(`${template} ${method} ${shape}: complete portrait, fixed frame and expanded canvas.`, samples);
  }
} finally { await browser.close(); }
