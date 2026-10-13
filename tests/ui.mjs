import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const output = new URL('../test-results/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'zh-Hans'));
try {
  await page.goto('http://127.0.0.1:5173/matchday-xi/');
  await page.getByRole('tab', { name: '样式' }).click();
  await page.getByText('更换', { exact: true }).click();
  await page.getByRole('button', { name: '中国龙', exact: true }).click();
  await page.waitForTimeout(550);
  const c1 = await page.evaluate(async () => (await import(performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith('/src/lib/store.ts')).name)).store.state.colors.c1);
  assert.equal(c1, '#D71920');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.notEqual(await page.evaluate(async () => (await import(performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith('/src/lib/store.ts')).name)).store.state.colors.c1), c1);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.waitForTimeout(700);
  await page.reload();
  assert.equal(await page.evaluate(async () => { const { store } = await import(performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith('/src/lib/store.ts')).name); await store.ready; return store.state.colors.c1; }), c1);
  await page.getByRole('tab', { name: '样式' }).click();
  await page.screenshot({ path: output + '/workspace-desktop.png' });
  await page.getByText('自定义颜色', { exact: true }).click();
  const colors = page.locator('#editor input[type=color]');
  assert.equal(await colors.count(), 14);
  await page.getByLabel(/^姓名文字/).fill('#112233');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(async () => (await import(performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith('/src/lib/store.ts')).name)).store.state.colorOverrides.name), '#112233');
  for (const width of [1440, 1003, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    let baseline;
    for (const name of ['球队', '阵容', '主教练', '标签', '样式', '动画', '备份']) {
      await page.getByRole('tab', { name, exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} overflow at ${width}`);
      if (width >= 900) {
        const box = await page.locator('.preview-column').boundingBox();
        if (!baseline) baseline = box;
        assert.equal(box.x, baseline.x); assert.equal(box.y, baseline.y);
      }
    }
    if (width === 390) await page.screenshot({ path: output + '/backup-mobile.png', fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('tab', { name: '备份', exact: true }).click();
  assert.deepEqual(await page.getByLabel('分辨率', { exact: true }).locator('option').evaluateAll((els) => els.map((e) => e.value)), ['720', '1080', '1440', '2160']);
  await page.screenshot({ path: output + '/backup-desktop.png' });
  await page.getByRole('tab', { name: '阵容', exact: true }).click();
  await page.locator('.player-index-row').first().click();
  for (const name of ['小卡', '大卡', 'Highlight']) await page.getByRole('button', { name, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const playerSelect = dialog.locator('select').first();
  const rosterBefore = await playerSelect.locator('option').allTextContents();
  await dialog.getByRole('button', { name: '下一位球员', exact: true }).click();
  assert.equal(await playerSelect.inputValue(), '1');
  assert.equal(await dialog.getByRole('button', { name: 'Highlight', exact: true }).getAttribute('aria-pressed'), 'true');
  await dialog.getByRole('button', { name: '上一位球员', exact: true }).click();
  assert.deepEqual(await playerSelect.locator('option').allTextContents(), rosterBefore);
  const originalLines = await Promise.all(['第一行', '第二行'].map(name => dialog.getByLabel(name, { exact: true }).inputValue()));
  await dialog.getByLabel('完整姓名', { exact: true }).fill('Micky van de Ven');
  assert.deepEqual(await Promise.all(['第一行', '第二行'].map(name => dialog.getByLabel(name, { exact: true }).inputValue())), originalLines);
  await page.waitForTimeout(550);
  await dialog.getByRole('button', { name: '从完整姓名生成', exact: true }).click();
  assert.equal(await dialog.getByLabel('生成第二行', { exact: true }).inputValue(), 'van de Ven');
  assert.equal(await dialog.getByLabel('第二行', { exact: true }).inputValue(), originalLines[1]);
  await dialog.getByRole('button', { name: '应用姓名', exact: true }).click();
  assert.equal(await dialog.getByLabel('第二行', { exact: true }).inputValue(), 'van de Ven');
  await dialog.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await dialog.getByLabel('第二行', { exact: true }).inputValue(), originalLines[1]);
  const size = dialog.locator('input[type=range]').first();
  const previousSize = await size.inputValue();
  await size.focus();
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await size.inputValue(), previousSize);
  await page.keyboard.press('Control+z');
  assert.equal(await size.inputValue(), previousSize);
  await page.screenshot({ path: output + '/three-images.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: output + '/card-controls-mobile.png' });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Palette, undo/redo, IndexedDB reload, detailed colours, layout at 4 widths, export options and card navigation passed');
} finally { await browser.close(); }
