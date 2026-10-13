import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(base);
  const state = await page.evaluate(async () => {
    const { store } = await import(performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith('/src/lib/store.ts')).name);
    await store.ready;
    const state = structuredClone(store.state);
    Object.assign(state.anim, { intro: false, manager: false, style: 'off' });
    return state;
  });
  if (process.env.TEST_TEMPLATE === 'season2627') Object.assign(state.anim, { template: 'season2627', manager: true, mgrLen: 4, style: 'lines', per: .4 });
  const endpoint = base + 'api/export';
  for (const [height, fps] of (process.env.EXPORT_CASES ? JSON.parse(process.env.EXPORT_CASES) : [[720, 60], [2160, 30]])) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin }, body: JSON.stringify({ state, lang: 'en', height, fps, video: null }) });
    assert.equal(response.status, 202);
    const { id } = await response.json();
    let status;
    const started = Date.now();
    do {
      await new Promise((r) => setTimeout(r, 1000));
      status = await (await fetch(`${endpoint}/${id}`)).json();
      if (Date.now() - started > 600000) throw new Error('Export timeout');
      assert.notEqual(status.status, 'failed', JSON.stringify(status));
    } while (status.status !== 'complete');
    const file = new URL(`export-${process.env.TEST_TEMPLATE || 'classic'}-${height}-${fps}.mp4`, output);
    await writeFile(file, Buffer.from(await (await fetch(`${endpoint}/${id}/file`)).arrayBuffer()));
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,codec_name,nb_frames,duration', '-of', 'json', file.pathname.replace(/^\/([A-Z]:)/, '$1')], { encoding: 'utf8' }));
    assert.equal(info.streams[0].height, height);
    assert.equal(info.streams[0].r_frame_rate, `${fps}/1`);
    assert.equal(info.streams[0].codec_name, 'h264');
    assert.ok(Number(info.streams[0].nb_frames) > fps);
    console.log(JSON.stringify(info.streams[0]));
    await fetch(`${endpoint}/${id}`, { method: 'DELETE' });
  }
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, lang: 'en', height: 1080, fps: 30 }) });
  const { id } = await response.json();
  await fetch(`${endpoint}/${id}`, { method: 'DELETE' });
  assert.equal((await fetch(`${endpoint}/${id}`)).status, 404);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  console.log('Cancellation and origin checks passed');
} finally { await browser.close(); }
