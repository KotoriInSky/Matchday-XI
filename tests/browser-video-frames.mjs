import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const folder = 'test-results/browser-video-frames';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const untaggedFile = `${folder}/untagged.mp4`;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', untaggedFile]);
  const untagged = 'data:video/mp4;base64,' + (await readFile(untaggedFile)).toString('base64');
  for (const [rate, template] of [[24, 'classic'], [60, 'classic'], [24, 'season2627'], [60, 'season2627']]) {
    const file = `${folder}/${rate}.mp4`;
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=160x90:rate=${rate}:duration=1`, '-c:v', 'libx264', '-bf', '2', '-g', String(rate), '-pix_fmt', 'yuv420p', '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off', file]);
    const video = 'data:video/mp4;base64,' + (await readFile(file)).toString('base64');
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.goto(base + '?render-export'); await page.waitForFunction(() => window.exportRenderer);
    const result = await page.evaluate(async ({ base, video, untagged, template }) => {
      const { store } = await import(base + 'src/lib/store.ts'); await store.ready;
      const state = structuredClone(store.state);
      state.bg.mode = 'video'; state.bg.dim = 20; state.bg.fit = { z: 1.2, x: 3, y: -2 };
      Object.assign(state.anim, { template, intro: false, manager: false, style: 'off' });
      const api = window.exportRenderer;
      const fps = 30, frames = 66, indices = [0, 1, 7, 28, 29, 30, 31, 59, 60, 65];
      await api.init(state, 'zh-Hans', video);
      const read = document.createElement('canvas'); read.width = 640; read.height = 360;
      const context = read.getContext('2d', { willReadFrequently: true });
      const pixels = canvas => { context.clearRect(0, 0, 640, 360); context.drawImage(canvas, 0, 0); return context.getImageData(0, 0, 640, 360).data.slice(); };
      const expected = new Map();
      for (const i of indices) {
        await api.frame(i / fps, false);
        // Native seeks round down some exact frame boundaries. Sample just
        // inside the same source interval for an unambiguous frame oracle.
        const native = document.querySelector('video');
        await new Promise(resolve => { native.addEventListener('seeked', resolve, { once: true }); native.currentTime = (i / fps) % native.duration + .00001; });
        const canvas = await api.capture(640, 360);
        expected.set(i, pixels(canvas)); canvas.width = canvas.height = 0;
      }
      await api.init(state, 'zh-Hans', video);
      if (!await api.prepareVideo(fps, frames)) throw Error('Supported H.264 backgrounds should use Mediabunny');
      if (!document.querySelector('video')) throw Error('Decoded frames should feed capture directly without a live PNG image');
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const differences = [];
      let seeks = 0, pngEncodes = 0;
      const toDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) { pngEncodes++; return toDataURL.apply(this, args); };
      const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { ...descriptor, set(value) { seeks++; descriptor.set.call(this, value); } });
      try {
        for (let i = 0; i < frames; i++) {
          await api.frame(i / fps, false);
          if (!expected.has(i)) continue;
          await api.captureInto(canvas);
          const actual = pixels(canvas), reference = expected.get(i); let total = 0, max = 0;
          for (let p = 0; p < actual.length; p++) { const delta = Math.abs(actual[p] - reference[p]); total += delta; max = Math.max(max, delta); }
          const full = await api.capture(640, 360), fullPixels = pixels(full); let fullTotal = 0, fullMax = 0;
          for (let p = 0; p < fullPixels.length; p++) { const delta = Math.abs(fullPixels[p] - reference[p]); fullTotal += delta; fullMax = Math.max(fullMax, delta); }
          full.width = full.height = 0;
          differences.push({ frame: i, mean: total / actual.length, max, fullMean: fullTotal / fullPixels.length, fullMax });
        }
      } finally { Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', descriptor); HTMLCanvasElement.prototype.toDataURL = toDataURL; }
      api.dispose();
      // Disposing and initializing again must release the decoder and allow reuse.
      await api.init(state, 'zh-Hans', video);
      const supported = VideoDecoder.isConfigSupported;
      VideoDecoder.isConfigSupported = async config => ({ supported: false, config });
      let fallback;
      try { fallback = await api.prepareVideo(fps, frames); }
      finally { VideoDecoder.isConfigSupported = supported; }
      if (fallback !== false || !document.querySelector('video')) throw Error('Unsupported decoding must retain native video capture');
      await api.frame(.5, false); await api.captureInto(canvas);
      await api.init(state, 'zh-Hans', untagged);
      if (await api.prepareVideo(fps, frames) !== false || !document.querySelector('video')) throw Error('Untagged color spaces must keep native video decoding');
      await api.init(state, 'zh-Hans', video); await api.prepareVideo(fps, frames);
      await api.frame(0, false); api.dispose();
      api.dispose(); canvas.width = canvas.height = read.width = read.height = 0;
      return { seeks, pngEncodes, differences };
    }, { base, video, untagged, template });
    assert.equal(result.seeks, 0, 'Export frames should not seek an HTML video');
    if (rate === 24) assert.ok(result.pngEncodes < 65, 'Repeated source frames should reuse the current PNG instead of encoding it again');
    // Repeated SVG rasterization can round a few blurred/antialiased edge
    // channels differently, including with the full capture. Keep a tight mean
    // bound as well as a per-channel cap so wrong frames or colors still fail.
    assert.ok(result.differences.every(row => row.mean < .001 && row.max <= 8 && row.fullMean < .001 && row.fullMax <= 8), `Decoded background differs from native capture at ${template}/${rate} fps: ${JSON.stringify(result)}`);
    console.log(`${template}, ${rate} fps: frame fidelity, 30 fps output, loops, fitting, disposal and fallbacks passed.`, { seeks: result.seeks, pngEncodes: result.pngEncodes, maxMean: Math.max(...result.differences.map(row => Math.max(row.mean, row.fullMean))), maxChannelDelta: Math.max(...result.differences.map(row => Math.max(row.max, row.fullMax))) });
    await page.close();
  }
  const editor = await browser.newPage(); await editor.goto(base);
  await editor.evaluate(async ({ base, video }) => {
    const { store } = await import(base + 'src/lib/store.ts'); await store.ready;
    const { getStage } = await import(base + 'src/lib/stage-instance.ts');
    const { browserVideo } = await import(base + 'src/lib/browser-export.ts');
    getStage().setVideo(URL.createObjectURL(await (await fetch(video)).blob()));
    const state = structuredClone(store.state); state.bg.mode = 'video';
    Object.assign(state.anim, { intro: false, manager: false, style: 'off' });
    for (const template of ['classic', 'season2627']) {
      state.anim.template = template;
      const controller = new AbortController(); let disposed = false, externalDecoder = false;
      try {
        await browserVideo({ state, lang: 'en', height: 720, fps: 30, signal: controller.signal, onProgress(value) {
          if (value < 1) return;
          const frame = document.querySelector('iframe[title="Export renderer"]');
          const api = frame.contentWindow.exportRenderer;
          externalDecoder = frame.contentDocument.querySelector('video').getAttribute('src') === null;
          const dispose = api.dispose; api.dispose = () => { disposed = true; dispose(); };
          controller.abort();
        } });
        throw Error('Video export did not cancel');
      } catch (error) { if (error.name !== 'AbortError') throw error; }
      if (!disposed || document.querySelector('iframe[title="Export renderer"]')) throw Error('Cancellation must dispose the background decoder and iframe');
      // Both templates decode background video with Mediabunny by default (1f55421).
      if (!externalDecoder) throw Error(`Default decoder selection changed for ${template}`);
    }
  }, { base, video: 'data:video/mp4;base64,' + (await readFile(`${folder}/24.mp4`)).toString('base64') });
  await editor.close();
  console.log('Default decoder selection and active cancellation cleanup passed for both templates.');
} finally { await browser.close(); }
