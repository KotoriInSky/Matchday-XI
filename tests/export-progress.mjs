import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
await mkdir('test-results/export-progress', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'zh-Hans'));
  let job = { status: 'preparing', progress: 0 }, cancelled = 0;
  await page.route('**/api/export**', route => {
    const request = route.request();
    if (request.method() === 'DELETE') cancelled++;
    return route.fulfill({ json: request.method() === 'POST' ? { id: 'eta-test' }
      : request.url().endsWith('/api/export') ? { available: true } : job });
  });
  await page.goto(base);
  await page.getByRole('tab', { name: '备份', exact: true }).click();
  await page.getByLabel('导出方式', { exact: true }).selectOption('local');
  await page.getByRole('button', { name: '导出视频', exact: true }).click();
  await page.getByRole('button', { name: '取消导出', exact: true }).waitFor();
  const timing = page.locator('[data-export-timing]'), eta = page.locator('[data-export-eta]');
  assert.equal(await timing.count(), 1, 'An active export must show elapsed time and an ETA state');
  assert.match(await timing.innerText(), /已用时/);
  assert.match(await eta.innerText(), /估算/);
  job = { status: 'rendering', progress: 0 };
  await page.getByText('渲染画面 · 0%', { exact: true }).waitFor();
  await page.waitForTimeout(2200);
  job = { status: 'rendering', progress: 20 };
  await page.getByText('渲染画面 · 20%', { exact: true }).waitFor();
  assert.match(await eta.innerText(), /预计剩余约/);
  await page.setViewportSize({ width: 390, height: 844 });
  await timing.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/export-progress/mobile.png' });
  job = { status: 'encoding', progress: 99 };
  await page.getByText('生成 MP4 · 99%', { exact: true }).waitFor();
  assert.match(await eta.innerText(), /收尾/);
  assert.doesNotMatch(await eta.innerText(), /剩余/);
  job = { status: 'complete', progress: 100 };
  await page.getByRole('link', { name: /下载 MP4/ }).waitFor();
  assert.equal(await timing.count(), 0, 'Completion removes the running clock');
  job = { status: 'preparing', progress: 0 };
  await page.getByRole('button', { name: '重新导出', exact: true }).click();
  await timing.waitFor();
  assert.match(await timing.innerText(), /已用时 0秒/);
  assert.match(await eta.innerText(), /估算/);
  await page.getByRole('button', { name: '取消导出', exact: true }).click();
  await timing.waitFor({ state: 'detached' });
  assert.ok(cancelled > 0, 'Cancelling still releases the export job');
  job = { status: 'failed', progress: 0 };
  await page.getByRole('button', { name: '重新导出', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '导出失败' }).waitFor();
  assert.equal(await timing.count(), 0, 'Failure removes the running clock');

  // Deterministic timing fixtures cover speed changes, repeated progress and stalled jobs.
  await page.evaluate(async base => {
    const { ExportProgress, formatExportDuration } = await import(base + 'src/lib/export-progress.ts');
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const estimate = new ExportProgress();
    estimate.start(0);
    check(estimate.snapshot(30000).remainingSeconds === null, 'Preparation has no ETA');
    estimate.update(0, 'rendering', 30000);
    estimate.update(10, 'rendering', 32000);
    check(estimate.snapshot(32000).remainingSeconds === 18, 'Preparation must not inflate the render estimate');
    estimate.update(10, 'rendering', 33000);
    estimate.update(20, 'rendering', 34000);
    check(estimate.snapshot(34000).remainingSeconds === 16, 'Repeated percentages must not distort speed');
    estimate.update(30, 'rendering', 38000);
    const slower = estimate.snapshot(38000).remainingSeconds;
    check(slower > 14 && slower < 28, 'Speed changes should be smoothed');
    check(estimate.snapshot(60000).remainingSeconds === null, 'Stalled jobs must not keep a stale ETA');
    check(estimate.snapshot(60000).elapsedSeconds === 60, 'Elapsed time includes preparation and stalls');
    estimate.update(99, 'encoding', 61000);
    check(estimate.snapshot(62000).remainingSeconds === null, 'Final encoding must not reuse the render estimate');
    estimate.start(70000);
    check(estimate.snapshot(70000).elapsedSeconds === 0 && estimate.snapshot(70000).remainingSeconds === null, 'Restart resets all timing');
    estimate.update(0, 'rendering', 70000); estimate.update(5, 'rendering', 70500);
    check(estimate.snapshot(70500).remainingSeconds === null, 'Wait for enough observations');
    estimate.update(2, 'rendering', 71000);
    check(estimate.snapshot(71000).remainingSeconds === null, 'Progress regression resets the estimate');
    check(formatExportDuration(65, true) === '1分5秒', 'Chinese minute formatting');
    check(formatExportDuration(3661, false) === '1h 1m', 'Long exports use hours');
  }, base);

  // Exercise the real browser card exporter, including its rendering and packaging phases.
  await page.setViewportSize({ width: 1280, height: 900 });
  const cards = page.locator('section').filter({ has: page.getByRole('heading', { name: '卡片导出', exact: true }) });
  await cards.getByRole('button', { name: '取消全选', exact: true }).click();
  for (let i = 0; i < 3; i++) await cards.getByRole('checkbox').nth(i).check();
  await cards.getByLabel('卡框长边', { exact: true }).selectOption('1024');
  await cards.getByRole('button', { name: '导出卡片 ZIP', exact: true }).click();
  await cards.locator('[data-export-timing]').waitFor();
  assert.match(await cards.locator('[data-export-timing]').innerText(), /已用时/);
  const download = cards.getByRole('link', { name: '下载 ZIP', exact: true });
  const estimated = await Promise.race([
    cards.locator('[data-export-eta]').filter({ hasText: '预计剩余约' }).waitFor({ timeout: 90000 }).then(() => true),
    download.waitFor({ timeout: 90000 }).then(() => false),
  ]);
  if (estimated) {
    await cards.locator('[data-export-timing]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/export-progress/cards.png' });
  }
  await download.waitFor({ timeout: 90000 });
  assert.equal(await cards.locator('[data-export-timing]').count(), 0, 'Card completion removes the running clock');
  console.log('Export timing: elapsed/ETA, preparation, changing speed, stalls, finishing, restart, cancellation, failure, mobile layout and real browser card ZIP passed. Local video progress was mocked.');
} finally { await browser.close(); }
