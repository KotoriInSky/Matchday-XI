import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const endpoint = base + 'api/export';
const fixture = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=128x72:r=30:d=1', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']);
const browser = await chromium.launch({ channel: 'chrome' });
let id;
try {
  const page = await browser.newPage(); await page.goto(base);
  const state = await page.evaluate(async ({ base, video }) => {
    const { store } = await import(base + 'src/lib/store.ts'); await store.ready;
    const { getStage } = await import(base + 'src/lib/stage-instance.ts');
    getStage().setVideo(URL.createObjectURL(await (await fetch(video)).blob()));
    store.update(s => { s.bg.mode = 'video'; Object.assign(s.anim, { intro: false, manager: false, style: 'off' }); });
    return structuredClone(store.state);
  }, { base, video: 'data:video/mp4;base64,' + fixture.toString('base64') });
  const start = () => page.evaluate(async base => {
    const { exportVideo } = await import(base + 'src/lib/video-export.ts');
    const { store } = await import(base + 'src/lib/store.ts');
    const controller = window.testUploadController = new AbortController();
    try {
      await exportVideo({ state: structuredClone(store.state), lang: 'en', height: 720, fps: 30, signal: controller.signal, onProgress() {} });
      return 'unexpected success';
    } catch (error) { return controller.signal.aborted ? 'aborted' : error.message; }
  }, base);
  const gone = async () => { assert.equal((await fetch(`${endpoint}/${id}`)).status, 404); id = null; };

  // Abort after the service has reserved a slot, before the ID reaches the client.
  let release, created;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { created = resolve; });
  await page.route(endpoint, async route => {
    const response = await route.fetch(); assert.equal(response.status(), 202);
    id = (await response.json()).id; created(); await gate; await route.fulfill({ response });
  });
  let running = start(); await ready;
  await page.evaluate(() => window.testUploadController.abort()); release();
  assert.equal(await running, 'aborted'); await gone(); await page.unroute(endpoint);

  // A rejected upload must also delete the slot when no AbortSignal fires.
  const videoRoute = '**/api/export/*/video';
  await page.route(videoRoute, route => {
    id = new URL(route.request().url()).pathname.split('/').at(-2);
    return route.fulfill({ status: 413, body: 'Too large' });
  });
  assert.equal(await start(), 'failed'); await gone(); await page.unroute(videoRoute);

  let releaseUpload, reachedUpload;
  const uploadGate = new Promise(resolve => { releaseUpload = resolve; }), uploadReady = new Promise(resolve => { reachedUpload = resolve; });
  await page.route(videoRoute, async route => {
    id = new URL(route.request().url()).pathname.split('/').at(-2); reachedUpload();
    await uploadGate; await route.abort().catch(() => {});
  });
  running = start(); await uploadReady; await page.evaluate(() => window.testUploadController.abort());
  assert.equal(await running, 'aborted'); releaseUpload(); await gone(); await page.unrouteAll({ behavior: 'wait' });

  // Existing JSON clients still get a seekable job-scoped URL inside the renderer.
  const legacy = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, lang: 'en', height: 720, fps: 30, video: 'data:video/mp4;base64,' + fixture.toString('base64') }) });
  assert.equal(legacy.status, 202); id = (await legacy.json()).id;
  const media = await fetch(`${endpoint}/${id}/media`, { headers: { Range: 'bytes=7-99' } });
  assert.equal(media.status, 206); assert.ok(Buffer.from(await media.arrayBuffer()).equals(fixture.subarray(7, 100)));
  const started = Date.now();
  for (;;) {
    const status = await (await fetch(`${endpoint}/${id}`)).json();
    assert.notEqual(status.status, 'failed');
    if (status.status === 'rendering') break;
    assert.ok(Date.now() - started < 30000, 'Legacy video must initialize the real renderer');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await fetch(`${endpoint}/${id}`, { method: 'DELETE' }); await gone();
  console.log('Client cancellation before ID/during upload, failed-upload cleanup and legacy video compatibility passed');
} finally { if (id) await fetch(`${endpoint}/${id}`, { method: 'DELETE' }); await browser.close(); }
