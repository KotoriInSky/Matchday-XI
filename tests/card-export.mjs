import { chromium } from 'playwright';
import { unzipSync } from 'fflate';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pixelDifference } from './pixel-difference.mjs';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const endpoint = base + 'api/export', origin = new URL(base).origin;
const output = new URL('../test-results/card-export/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'zh-Hans'));
const post = payload => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(payload) });
const ids = [];
page.on('response', async response => {
  if (response.url() === endpoint && response.request().method() === 'POST' && response.status() === 202) ids.push((await response.json()).id);
});
async function render(payload) {
  const response = await post(payload);
  assert.equal(response.status, 202, await response.clone().text());
  const { id } = await response.json(); ids.push(id);
  const deadline = Date.now() + 90000;
  for (;;) {
    const job = await (await fetch(`${endpoint}/${id}`)).json();
    assert.notEqual(job.status, 'failed', JSON.stringify(job));
    if (job.status === 'complete') {
      const response = await fetch(`${endpoint}/${id}/file`);
      assert.equal(response.status, 200);
      return { bytes: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type'), filename: job.filename };
    }
    assert.ok(Date.now() < deadline, 'Card export timed out');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}
async function checkPNG(bytes, size, softEdge = true) {
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.ok(Math.max(width, height) > size, 'Canvas includes the selected frame size plus transparent overflow margins');
  const pixels = await page.evaluate(async data => {
    const image = new Image(); image.src = data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const { data: rgba } = ctx.getImageData(0, 0, image.width, image.height);
    let solid = 0, soft = 0, edge = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const alpha = rgba[(y * image.width + x) * 4 + 3];
      if (alpha === 255) solid++;
      if (alpha > 0 && alpha < 255) soft++;
      if ((x === 0 || y === 0 || x === image.width - 1 || y === image.height - 1) && alpha) edge++;
    }
    return { solid, soft, edge };
  }, 'data:image/png;base64,' + bytes.toString('base64'));
  assert.equal(pixels.edge, 0, 'No visible artwork or shadow may touch the canvas edge');
  assert.ok(pixels.solid > width * height * .03 && (!softEdge || pixels.soft > 0), `Image must contain artwork and preserve its alpha edges: ${JSON.stringify({ width, height, ...pixels })}`);
  return { width, height, ...pixels };
}
try {
  await page.goto(base);
  const state = await page.evaluate(async () => {
    const { store } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith('/src/lib/store.ts')).name);
    await store.ready;
    const portrait = color => {
      const canvas = document.createElement('canvas'); canvas.width = 500; canvas.height = 700;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(250, 130, 90, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(80, 700); ctx.lineTo(100, 350); ctx.quadraticCurveTo(250, 200, 400, 350); ctx.lineTo(420, 700); ctx.fill();
      return canvas.toDataURL();
    };
    store.update(s => {
      Object.assign(s.players[0], { name: 'Trent Alexander-Arnold', nameLine1: 'Trent', nameLine2: 'ALEXANDER-\nARNOLD', captain: true, key: true, photo: portrait('#dc2626'), photo2: portrait('#16a34a'), photoK: portrait('#2563eb'), cut: true, cutS: true, cutK: true, fit: { z: 1.25, x: 0, y: -5 }, tag2: 'cn' });
      s.anim.template = 'classic'; s.colorOverrides.name = '#ffffff';
    });
    return structuredClone(store.state);
  });
  const common = { kind: 'cards', state, lang: 'zh-Hans', batch: false };
  const findings = [];
  for (const [kind, size] of [['small', 1024], ['big', 2048], ['key', 4096]]) {
    const result = await render({ ...common, size, cards: [{ index: 0, kind }] });
    assert.equal(result.type, 'image/png');
    findings.push({ kind, size, ...await checkPNG(result.bytes, size) });
    await writeFile(new URL(`classic-${kind}-${size}.png`, output), result.bytes);
  }
  const repeatPayload = { ...common, size: 1024, cards: [{ index: 0, kind: 'key' }] };
  const repeatA = await render(repeatPayload), repeatB = await render(repeatPayload);
  await writeFile(new URL('repeat-a.png', output), repeatA.bytes);
  await writeFile(new URL('repeat-b.png', output), repeatB.bytes);
  if (createHash('sha256').update(repeatA.bytes).digest('hex') !== createHash('sha256').update(repeatB.bytes).digest('hex')) {
    // Native compositing can round an alpha-edge channel by one between processes.
    const difference = await pixelDifference(page, repeatA.bytes, repeatB.bytes);
    assert.ok(difference.maxDelta <= 1, `Static Highlight exports must preserve their pixels: ${JSON.stringify(difference)}`);
  }
  const batch = await render({ ...common, state: { ...state, anim: { ...state.anim, template: 'season2627' } }, batch: true, size: 1024, cards: [{ index: 0, kind: 'big' }, { index: 0, kind: 'key' }, { index: 1, kind: 'small' }] });
  assert.equal(batch.type, 'application/zip');
  const entries = unzipSync(batch.bytes);
  assert.equal(Object.keys(entries).length, 3);
  for (const [name, bytes] of Object.entries(entries)) {
    assert.ok(!/[\\/]/.test(name));
    await writeFile(new URL('season-' + name, output), bytes);
    await checkPNG(Buffer.from(bytes), 1024, false);
  }
  await writeFile(new URL('selected-cards.zip', output), batch.bytes);
  assert.equal((await post({ ...common, size: 999, cards: [{ index: 0, kind: 'big' }] })).status, 400);
  assert.equal((await post({ ...common, size: 1024, cards: [{ index: 99, kind: 'big' }] })).status, 400);
  const pending = await post(repeatPayload); const { id } = await pending.json(); ids.push(id);
  assert.equal((await post(repeatPayload)).status, 409);
  await fetch(`${endpoint}/${id}`, { method: 'DELETE' });
  assert.equal((await fetch(`${endpoint}/${id}`)).status, 404);
  await page.getByRole('tab', { name: '阵容', exact: true }).click();
  await page.locator('.player-index-row').first().click();
  await page.getByRole('dialog').getByRole('button', { name: '导出卡片 PNG', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('dialog').getByLabel('卡框长边', { exact: true }).selectOption('1024');
  await page.getByRole('dialog').getByRole('button', { name: '导出卡片 PNG', exact: true }).click();
  await page.getByRole('link', { name: '下载 PNG', exact: true }).waitFor({ timeout: 90000 });
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 PNG', exact: true }).click();
  await (await download).saveAs(new URL('ui-download.png', output).pathname.replace(/^\/([A-Z]:)/, '$1'));
  await page.screenshot({ path: new URL('single-ui.png', output).pathname.replace(/^\/([A-Z]:)/, '$1') });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '备份', exact: true }).click();
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: '卡片导出', exact: true }) });
  await panel.getByRole('button', { name: '取消全选', exact: true }).click();
  assert.ok(await panel.getByRole('button', { name: '导出卡片 ZIP', exact: true }).isDisabled());
  await panel.getByRole('checkbox').first().check();
  assert.ok(await panel.getByRole('button', { name: '导出卡片 ZIP', exact: true }).isEnabled());
  await panel.getByLabel('卡框长边', { exact: true }).selectOption('1024');
  await panel.getByRole('button', { name: '导出卡片 ZIP', exact: true }).click();
  await page.getByRole('tab', { name: '球队', exact: true }).click();
  await page.getByRole('tab', { name: '备份', exact: true }).click();
  await panel.getByRole('link', { name: '下载 ZIP', exact: true }).waitFor({ timeout: 90000 });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: new URL('batch-ui.png', output).pathname.replace(/^\/([A-Z]:)/, '$1') });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole('button', { name: '导出卡片 ZIP', exact: true }).scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: new URL('batch-mobile.png', output).pathname.replace(/^\/([A-Z]:)/, '$1') });
  await writeFile(new URL('checks.json', output), JSON.stringify(findings, null, 2));
  console.log('Actual transparent PNG at 1024/2048/4096, overflow margin, deterministic Highlight, selected ZIP, both templates, validation and cancellation passed.');
} finally {
  for (const id of ids) await fetch(`${endpoint}/${id}`, { method: 'DELETE' }).catch(() => {});
  await browser.close();
}
