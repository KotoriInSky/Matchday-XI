import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const folder = 'test-results/export-resources';
const baseline = process.env.EXPORT_BASELINE === '1';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const editor = await browser.newPage();
  await editor.goto(base);
  const saved = baseline ? null : await readFile(`${folder}/state.json`, 'utf8').catch(() => null);
  const state = saved ? JSON.parse(saved) : await editor.evaluate(async base => {
    const { store } = await import(base + 'src/lib/store.ts'); await store.ready;
    const s = structuredClone(store.state);
    const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 600;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#20c090'; ctx.fillRect(50, 200, 260, 400);
    ctx.beginPath(); ctx.arc(180, 110, 80, 0, Math.PI * 2); ctx.fill();
    Object.assign(s.players[0], { name: '张三 Alexander', nameLine1: '张三', nameLine2: 'ALEXANDER', captain: true, key: true, photo: canvas.toDataURL(), photo2: canvas.toDataURL(), photoK: canvas.toDataURL(), cut: true, cutS: true, cutK: true, tag2: 'cn' });
    Object.assign(s.anim, { intro: true, manager: true, style: 'lines', per: .35 });
    return s;
  }, base);
  if (!saved) await writeFile(`${folder}/state.json`, JSON.stringify(state));
  await editor.close();
  const results = [];
  for (const template of process.env.EXPORT_VIDEO_ONLY === '1' ? [] : ['classic', 'season2627']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const cdp = await page.context().newCDPSession(page);
    await page.goto(base + '?render-export');
    await page.waitForFunction(() => window.exportRenderer);
    const result = await page.evaluate(async ({ state, template, baseline }) => {
      const api = window.exportRenderer;
      const duration = await api.init({ ...state, anim: { ...state.anim, template } }, 'zh-Hans', null);
      const target = document.createElement('canvas'); target.width = 1280; target.height = 720;
      const comparison = document.createElement('canvas'); comparison.width = 1280; comparison.height = 720;
      const compareContext = comparison.getContext('2d', { alpha: false });
      let canvases = 0, rafs = 0;
      const create = document.createElement.bind(document), raf = window.requestAnimationFrame.bind(window);
      document.createElement = (...args) => { if (args[0] === 'canvas') canvases++; return create(...args); };
      window.requestAnimationFrame = (...args) => { rafs++; return raf(...args); };
      const render = async time => {
        await api.frame(time, false);
        if (api.captureInto) await api.captureInto(target);
        else { const frame = await api.capture(1280, 720); target.getContext('2d').drawImage(frame, 0, 0); frame.width = frame.height = 0; }
      };
      const hashes = [], referenceHashes = [], differences = [];
      for (const time of [0, .75, 1.7, 5.2, duration * .5, duration - .2]) {
        await render(time);
        compareContext.clearRect(0, 0, 1280, 720); compareContext.drawImage(target, 0, 0);
        const bytes = compareContext.getImageData(0, 0, 1280, 720).data;
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
        hashes.push({ time, hash });
        const reference = await api.capture(1280, 720);
        compareContext.clearRect(0, 0, 1280, 720); compareContext.drawImage(reference, 0, 0);
        const referenceBytes = compareContext.getImageData(0, 0, 1280, 720).data;
        const referenceHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', referenceBytes))].map(x => x.toString(16).padStart(2, '0')).join('');
        referenceHashes.push({ time, hash: referenceHash }); reference.width = reference.height = 0;
        // Video frames embed photos resampled near their on-screen size, so they
        // are compared with the full-resolution capture by tolerance, not hash.
        let changed = 0, max = 0, total = 0, worstBlock = 0;
        for (let i = 0; i < bytes.length; i += 4) {
          let pixel = 0;
          for (let k = 0; k < 4; k++) { const d = Math.abs(bytes[i + k] - referenceBytes[i + k]); total += d; pixel = Math.max(pixel, d); }
          if (pixel) changed++; max = Math.max(max, pixel);
        }
        for (let by = 0; by < 720; by += 16) for (let bx = 0; bx < 1280; bx += 16) {
          let sum = 0;
          for (let y = by; y < by + 16; y++) for (let x = bx; x < bx + 16; x++) { const i = (y * 1280 + x) * 4; for (let k = 0; k < 3; k++) sum += Math.abs(bytes[i + k] - referenceBytes[i + k]); }
          worstBlock = Math.max(worstBlock, sum / 768);
        }
        differences.push({ time, changed, max, mean: total / bytes.length, worstBlock });
      }
      const preparedCanvases = canvases; const preparedRafs = rafs;
      let updateMs = 0, captureMs = 0;
      const count = 18, started = performance.now();
      for (let i = 0; i < count; i++) {
        let at = performance.now(); await api.frame(duration * (i + 1) / (count + 1), false); updateMs += performance.now() - at;
        at = performance.now();
        if (api.captureInto) await api.captureInto(target);
        else { const frame = await api.capture(1280, 720); target.getContext('2d').drawImage(frame, 0, 0); frame.width = frame.height = 0; }
        captureMs += performance.now() - at;
      }
      const totalMs = performance.now() - started;
      document.createElement = create; window.requestAnimationFrame = raf;
      target.width = target.height = comparison.width = comparison.height = 0;
      return { template, duration, hashes, referenceHashes, differences, count, updateMs, captureMs, totalMs, fps: count / totalMs * 1000,
        canvases: canvases - preparedCanvases, rafs: rafs - preparedRafs, direct: !!api.captureInto, baseline };
    }, { state, template, baseline });
    result.heap = await cdp.send('Runtime.getHeapUsage');
    results.push(result);
    console.log(JSON.stringify(result));
    await page.close();
  }
  if (results.length) await writeFile(`${folder}/${baseline ? 'before' : 'after'}.json`, JSON.stringify(results, null, 2));
  if (!baseline && results.length) {
    const before = await readFile(`${folder}/before.json`, 'utf8').then(JSON.parse).catch(() => null);
    for (const [i, result] of results.entries()) {
      // The full-resolution capture keeps the exact pre-optimization pixels.
      if (before) assert.deepEqual(result.referenceHashes, before[i].hashes, `${result.template}: full-resolution pixels must match the pre-optimization renderer`);
      for (const d of result.differences) {
        assert.ok(d.mean < 0.01 && d.worstBlock < 3 && d.max <= 64, `${result.template}/${d.time}: resampled video frame differs too much ${JSON.stringify(d)}`);
      }
      assert.ok(result.direct, 'Video capture must support rendering into a reusable canvas');
      assert.equal(result.canvases, 0, 'Steady-state frames must not allocate temporary canvases');
      assert.equal(result.rafs, 0, 'Browser canvas capture must not wait for display refresh');
    }
    console.log('Both templates preserve full-resolution pixels, keep resampled video frames within tolerance, reuse frame buffers and render without display-refresh waits.');
  }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=128x72:rate=30:duration=2', '-pix_fmt', 'yuv420p', `${folder}/background.mp4`]);
  const video = 'data:video/mp4;base64,' + (await readFile(`${folder}/background.mp4`)).toString('base64');
  for (const template of ['classic', 'season2627']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(base + '?render-export'); await page.waitForFunction(() => window.exportRenderer);
    await page.evaluate(async ({ state, template, video }) => {
      const api = window.exportRenderer;
      await api.init({ ...state, bg: { ...state.bg, mode: 'video' }, anim: { ...state.anim, template, style: 'off' } }, 'zh-Hans', video);
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      // Reading a reused output directly can switch its rendering backend after
      // a few frames. Inspect both surfaces through the same readback canvas.
      const inspection = document.createElement('canvas'); inspection.width = 1280; inspection.height = 720;
      const inspect = inspection.getContext('2d', { willReadFrequently: true });
      const pixels = image => { inspect.clearRect(0, 0, 1280, 720); inspect.drawImage(image, 0, 0); return inspect.getImageData(0, 0, 1280, 720).data; };
      const hash = async image => [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels(image)))].join(',');
      for (const time of [.1, 1.9, 2.1, 5.25]) {
        await api.frame(time, false); await api.captureInto(canvas);
        const source = document.querySelector('video');
        if (source.seeking || Math.abs(source.currentTime - time % source.duration) > .001) throw Error('Offline capture must await the requested background video frame');
        const reference = await api.capture(1280, 720);
        if (await hash(canvas) !== await hash(reference)) {
          const left = pixels(canvas), right = pixels(reference);
          let changed = 0, maxDelta = 0;
          for (let i = 0; i < left.length; i++) { const delta = Math.abs(left[i] - right[i]); if (delta) changed++; maxDelta = Math.max(maxDelta, delta); }
          throw Error(`Background video pixels changed: ${template}/${time}, channels=${changed}, maxDelta=${maxDelta}`);
        }
        reference.width = reference.height = 0;
      }
      let allocated = 0;
      const create = document.createElement.bind(document);
      document.createElement = (...args) => { if (args[0] === 'canvas') allocated++; return create(...args); };
      try { await api.frame(5.3, false); await api.captureInto(canvas); }
      finally { document.createElement = create; canvas.width = canvas.height = 0; }
      if (allocated) throw Error('Video background and output buffers must both be reused');
    }, { state, template, video });
    await page.close();
  }
  console.log('Both templates preserve looping background video frames and reuse their video buffers.');
} finally { await browser.close(); }
