import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

// Benchmark a production build served as static files, with no renderer API.
const label = process.env.BENCH_LABEL || 'current';
if (!/^[\w-]+$/.test(label)) throw Error('BENCH_LABEL must contain only letters, numbers, _ or -');
const height = Number(process.env.BENCH_HEIGHT || 720), fps = Number(process.env.BENCH_FPS || 30);
const runs = Number(process.env.BENCH_RUNS || 5), frameCount = 18;
const videoRuns = Number(process.env.BENCH_VIDEO_RUNS || 3);
const fullStyle = process.env.BENCH_FULL_STYLE || 'off';
const reference = process.env.BENCH_REFERENCE === '1';
// Capture options for the injected reference, e.g. '{"pruneInvisible":true}'
// reproduces the previous default video capture. Implies a reference run.
const captureOptions = process.env.BENCH_CAPTURE ? JSON.parse(process.env.BENCH_CAPTURE) : null;
const nativeVideo = process.env.BENCH_NATIVE_VIDEO === '1';
const compareVideo = process.env.BENCH_COMPARE_VIDEO === '1';
const background = process.env.BENCH_BACKGROUND;
assert.ok([720, 1080, 1440, 2160].includes(height) && [30, 60].includes(fps));
assert.ok(Number.isInteger(runs) && runs > 0 && runs <= 20);
assert.ok(Number.isInteger(videoRuns) && videoRuns > 0 && videoRuns <= 20);
assert.ok(['off', 'lines'].includes(fullStyle));
assert.ok(!captureOptions || reference, 'BENCH_CAPTURE requires BENCH_REFERENCE=1');
assert.ok(!reference || !background || nativeVideo, 'A full-capture reference with video requires BENCH_NATIVE_VIDEO=1');
assert.ok(!compareVideo || (!nativeVideo && !reference && background), 'Video comparison requires a background, BENCH_NATIVE_VIDEO=0 and BENCH_REFERENCE=0');
const state = JSON.parse(await readFile(process.env.BENCH_PROJECT || 'test-results/export-resources/state.json', 'utf8'));
const output = 'test-results/browser-performance'; await mkdir(output, { recursive: true });
const root = resolve('dist'), prefix = '/matchday-xi/';
let apiRequests = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.includes('/api/export')) apiRequests++;
  if (!path.startsWith(prefix)) { res.writeHead(404).end(); return; }
  const file = resolve(root, decodeURIComponent(path.slice(prefix.length)) || 'index.html');
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}${prefix}`;
let browser;
const median = values => { const sorted = [...values].sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2; };
try {
  // BENCH_CHROME_ARGS, e.g. '--enable-blink-features=CanvasDrawElement' for HTML-in-Canvas.
  browser = await chromium.launch({ channel: 'chrome', args: process.env.BENCH_CHROME_ARGS?.split(' ').filter(Boolean) });
  const context = await browser.newContext();
  // The retained full capture provides a reference within the exact same build.
  // Instrument only the benchmark browser; no test switches enter the product.
  {
    const file = (await readdir(resolve(root, 'assets'))).find(name => /^browser-capture-.*\.js$/.test(name));
    assert.ok(file, 'Build the project before running the benchmark');
    const captureURL = reference ? base + 'assets/' + file : null;
    await context.addInitScript(({ captureURL, captureOptions, nativeVideo, compareVideo, background, fps }) => {
      let renderer;
      Object.defineProperty(window, 'exportRenderer', {
        configurable: true, get: () => renderer,
        set(api) {
          renderer = api;
          const prepare = api.prepareVideo.bind(api);
          api.prepareVideo = async (...args) => {
            const used = nativeVideo || window.parent.__benchmarkNativeVideo ? false : await prepare(...args);
            window.parent.__benchmarkVideoDecode = used;
            return used;
          };
          const forceVideo = background && (compareVideo || !nativeVideo);
          if (!captureURL && !forceVideo) return;
          const init = api.init.bind(api); let capture;
          api.init = async (input, ...args) => {
            const duration = await init(input, ...args);
            // Probe the non-default decoder on season2627 without adding an
            // experimental switch to the product UI or default export path.
            if (forceVideo && input.bg.mode === 'video' && input.anim.template === 'season2627') await api.prepareVideo(fps, Math.ceil(duration * fps));
            if (captureURL) {
              const module = await import(captureURL);
              const createCapture = Object.values(module).find(value => typeof value === 'function');
              capture = createCapture(input, captureOptions || undefined);
            }
            return duration;
          };
          if (captureURL) api.captureInto = canvas => capture(document.getElementById('root'), canvas.width, canvas.height, canvas);
        },
      });
    }, { captureURL, captureOptions, nativeVideo, compareVideo, background, fps });
  }
  const report = { label, reference, captureOptions, chromeArgs: process.env.BENCH_CHROME_ARGS || null, nativeVideo, compareVideo, background: background || null, date: new Date().toISOString(), platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model, browser: browser.version(), height, fps, frameCount, runs, videoRuns, fullExportScenario: { style: fullStyle, intro: false, manager: false }, results: [] };
  for (const template of ['classic', 'season2627']) {
    const page = await context.newPage(); await page.setViewportSize({ width: height * 16 / 9, height });
    await page.goto(base + '?render-export'); await page.waitForFunction(() => window.exportRenderer);
    const frames = await page.evaluate(async ({ state, template, height, runs, frameCount }) => {
      const api = window.exportRenderer;
      const duration = await api.init({ ...state, anim: { ...state.anim, template } }, 'zh-Hans', null);
      const canvas = document.createElement('canvas'); canvas.width = height * 16 / 9; canvas.height = height;
      const rounds = [], perFrame = [];
      try {
        for (let run = -1; run < runs; run++) {
          const started = performance.now();
          for (let i = 0; i < frameCount; i++) {
            const at = performance.now();
            await api.frame(duration * (i + 1) / (frameCount + 1), false); await api.captureInto(canvas);
            if (run >= 0) perFrame.push(performance.now() - at);
          }
          if (run >= 0) rounds.push(performance.now() - started);
        }
      } finally { canvas.width = canvas.height = 0; }
      perFrame.sort((a, b) => a - b);
      return { duration, rounds, frameP95Ms: perFrame[Math.ceil(perFrame.length * .95) - 1] };
    }, { state, template, height, runs, frameCount });
    await page.close();
    const result = { template, ...frames, medianFrameBatchMs: median(frames.rounds) };
    result.captureFps = frameCount * 1000 / result.medianFrameBatchMs;
    console.log(JSON.stringify(result));

    // Complete export through the actual UI. A short fixture covers initialization,
    // composition, WebCodecs, MP4 finalization and OPFS, without a test-only encoder.
    if (process.env.BENCH_SKIP_VIDEO !== '1') {
      const editor = await context.newPage(); await editor.setViewportSize({ width: 1440, height: 1000 });
      await editor.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'zh-Hans'));
      await editor.goto(base); await editor.getByRole('tab', { name: '备份', exact: true }).click();
      const project = resolve(output, `${label}-${template}-project.json`);
      await writeFile(project, JSON.stringify({ ...state, anim: { ...state.anim, template, intro: false, manager: false, style: fullStyle } }));
      const chooser = editor.waitForEvent('filechooser'); await editor.getByRole('button', { name: '导入项目', exact: true }).click();
      await (await chooser).setFiles(project);
      await editor.getByRole('tab', { name: '动画', exact: true }).click();
      await editor.getByLabel('模板', { exact: true }).selectOption(template);
      assert.equal(await editor.getByLabel('模板', { exact: true }).inputValue(), template);
      if (background) {
        await editor.getByRole('tab', { name: '样式', exact: true }).click();
        await editor.getByLabel('背景', { exact: true }).selectOption('video');
        const videoChooser = editor.waitForEvent('filechooser');
        await editor.getByRole('button', { name: '添加视频', exact: true }).click();
        await (await videoChooser).setFiles(resolve(background));
        await editor.locator('video').first().waitFor();
      }
      await editor.getByRole('tab', { name: '备份', exact: true }).click();
      await editor.getByLabel('分辨率', { exact: true }).selectOption(String(height));
      await editor.getByLabel('帧率', { exact: true }).selectOption(String(fps));
      result.fullExportRounds = []; result.decodedVideoRounds = []; result.videoComparisons = [];
      const modes = compareVideo ? Array.from({ length: videoRuns }, (_, i) => i % 2 ? [false, true] : [true, false]).flat() : Array(videoRuns).fill(nativeVideo);
      for (const [run, forceNative] of modes.entries()) {
        await editor.evaluate(value => { window.__benchmarkNativeVideo = value; window.__benchmarkVideoDecode = false; }, forceNative);
        const started = performance.now();
        await editor.getByRole('button', { name: run ? '重新导出' : '导出视频', exact: true }).click();
        await editor.getByRole('button', { name: '取消导出', exact: true }).waitFor();
        await editor.getByRole('button', { name: '重新导出', exact: true }).waitFor({ timeout: 600000 });
        result.fullExportRounds.push(performance.now() - started);
        result.decodedVideoRounds.push(await editor.evaluate(() => window.__benchmarkVideoDecode));
        result.videoComparisons.push({ native: forceNative, decoded: result.decodedVideoRounds.at(-1), ms: result.fullExportRounds.at(-1) });
        console.log(JSON.stringify({ template, run, ...result.videoComparisons.at(-1) }));
      }
      result.fullExportMs = median(result.fullExportRounds);
      if (compareVideo) {
        result.nativeVideoMedianMs = median(result.videoComparisons.filter(row => row.native).map(row => row.ms));
        result.decodedVideoMedianMs = median(result.videoComparisons.filter(row => !row.native).map(row => row.ms));
      }
      const download = editor.waitForEvent('download'); await editor.getByRole('link', { name: '下载 MP4', exact: true }).click();
      await (await download).saveAs(resolve(output, `${label}-${template}-${height}.mp4`));
      await editor.close();
      console.log(JSON.stringify({ template, fullExportMs: result.fullExportMs }));
    }
    report.results.push(result);
  }
  assert.equal(apiRequests, 0, 'Online export must never require a local export API');
  report.apiRequests = apiRequests;
  await writeFile(`${output}/${label}.json`, JSON.stringify(report, null, 2));
} finally {
  await browser?.close(); server.close(); await once(server, 'close');
}
