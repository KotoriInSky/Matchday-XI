import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = 'http://127.0.0.1:5173/matchday-xi/';
const output = new URL('../test-results/hci/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'zh-Hans'));
const attach = () => page.evaluate(async () => {
  window.hciStore = (await import(performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith('/src/lib/store.ts')).name)).store;
  window.hciStage = (await import('/matchday-xi/src/lib/stage-instance.ts')).getStage;
  await window.hciStore.ready;
});
const tab = name => page.getByRole('tab', { name, exact: true }).click();
const dialog = page.getByRole('dialog');
try {
  await page.goto(base); await attach();
  // Scene navigation is explicit, stable and reversible in both templates.
  for (const template of ['classic', 'season2627']) {
    await page.evaluate(template => window.hciStore.update(s => { s.anim.template = template; s.anim.manager = true; }), template);
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.hciStage().pause(); window.hciStage().seek(1); });
    for (const name of ['主教练', '球队']) {
      await tab(name);
      assert.equal(await page.evaluate(() => window.hciStage().getSnapshot().t), 1);
      await page.getByRole('button', { name: '预览此场景', exact: true }).click();
      assert.equal(await page.evaluate(() => window.hciStage().getSnapshot().scene), 'manager');
      if (name === '主教练') {
        const time = await page.evaluate(() => window.hciStage().getSnapshot().t);
        await page.getByLabel('姓名', { exact: true }).fill('Preview coach');
        await page.waitForTimeout(200);
        assert.ok(Math.abs(await page.evaluate(() => window.hciStage().getSnapshot().t) - time) < .05);
      }
      await page.getByRole('button', { name: '返回原位置', exact: true }).click();
      assert.ok(Math.abs(await page.evaluate(() => window.hciStage().getSnapshot().t) - 1) < .05);
    }
  }
  // Per-player tag edits cannot mutate the shared asset or a teammate.
  await page.evaluate(() => window.hciStore.update(s => {
    s.players[0].tag1 = 'it'; s.players[1].tag1 = 'it';
    s.tags.find(tag => tag.id === 'it').fit = { x: 3, y: 4, z: 1.1 };
  }));
  await tab('阵容'); await page.locator('.player-index-row').first().click();
  await dialog.getByRole('button', { name: /调整标签/ }).first().click();
  const horizontal = dialog.getByLabel('水平位置', { exact: true });
  await horizontal.focus(); await page.keyboard.press('ArrowRight');
  assert.deepEqual(await page.evaluate(() => [window.hciStore.state.players[0].tagFits.it.x, window.hciStore.state.players[1].tagFits, window.hciStore.state.tags.find(t => t.id === 'it').fit.x]), [4, null, 3]);
  await dialog.getByRole('button', { name: '恢复共享位置', exact: true }).click();
  assert.equal(await horizontal.inputValue(), '3');
  // One long pointer gesture, including pauses, is one undo step.
  await horizontal.scrollIntoViewIfNeeded();
  const box = await horizontal.boundingBox();
  await page.mouse.move(box.x + box.width * .52, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .65, box.y + box.height / 2); await page.waitForTimeout(550);
  await page.mouse.move(box.x + box.width * .8, box.y + box.height / 2); await page.waitForTimeout(550); await page.mouse.up();
  assert.notEqual(await horizontal.inputValue(), '3');
  await dialog.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await horizontal.inputValue(), '3');
  await horizontal.focus(); await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700); await page.reload(); await attach();
  assert.equal(await page.evaluate(() => window.hciStore.state.players[0].tagFits.it.x), 4);
  const markup = await page.evaluate(async () => {
    const { playerCardHTML } = await import('/matchday-xi/src/engine/markup.ts');
    const { seasonPlayerHTML } = await import('/matchday-xi/src/engine/season2627.ts');
    return [playerCardHTML(window.hciStore.state, 0), seasonPlayerHTML(window.hciStore.state, 0)];
  });
  for (const html of markup) assert.match(html, /data-fit="pt:0:it" style="[^"]*--fx:4\.00%/);
  await tab('标签'); await page.locator('.tag-index button').filter({ hasText: 'Italy' }).click();
  const sharedX = dialog.getByLabel('水平位置', { exact: true });
  assert.equal(await sharedX.inputValue(), '3');
  await sharedX.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  assert.deepEqual(await page.evaluate(async () => {
    const { fitRef } = await import('/matchday-xi/src/engine/state.ts');
    return [fitRef(window.hciStore.state, 'pt:0:it').x, fitRef(window.hciStore.state, 'pt:1:it').x];
  }), [4, 5]);
  await page.keyboard.press('Escape');
  // Mobile preview stays visible alongside lower controls and can expand.
  await page.setViewportSize({ width: 390, height: 844 });
  await tab('阵容'); await page.locator('.player-index-row').first().click();
  const secondLine = dialog.getByLabel('第二行', { exact: true });
  await secondLine.evaluate(el => el.scrollIntoView({ block: 'end' }));
  const previewBox = await dialog.locator('.card-dialog-preview').boundingBox();
  const fieldBox = await secondLine.boundingBox();
  assert.ok(previewBox.y >= 0 && previewBox.y + previewBox.height < fieldBox.y, 'Preview must not cover the edited field');
  await dialog.getByRole('button', { name: /调整标签/ }).first().click();
  await dialog.getByLabel('水平位置', { exact: true }).evaluate(el => el.scrollIntoView({ block: 'end' }));
  const lowerPreview = await dialog.locator('.card-dialog-preview').boundingBox();
  const lowerControl = await dialog.getByLabel('水平位置', { exact: true }).boundingBox();
  assert.ok(lowerPreview.y >= 0 && lowerPreview.y + lowerPreview.height < lowerControl.y, 'Preview stays visible at lower framing controls');
  await page.screenshot({ path: output + '/mobile-compact.png' });
  await dialog.getByRole('button', { name: '展开大图', exact: true }).click();
  assert.equal(await dialog.getAttribute('data-preview-expanded'), 'true');
  await dialog.getByRole('button', { name: '收起大图', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByLabel('场景', { exact: true }).selectOption('0');
  assert.ok(await page.getByLabel('场景', { exact: true }).isVisible());
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Palette changes preserve explicit details by default and can reset them.
  await page.evaluate(() => window.hciStore.update(s => { s.colorOverrides = { name: '#112233' }; }));
  await tab('样式'); await page.getByText('更换', { exact: true }).click();
  await page.getByRole('button', { name: '中国龙', exact: true }).click();
  assert.equal(await page.evaluate(() => window.hciStore.state.colorOverrides.name), '#112233');
  await page.getByText('更换', { exact: true }).click();
  await page.getByRole('switch', { name: '保留细节颜色', exact: true }).click();
  await page.getByRole('button', { name: '中国龙', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.hciStore.state.colorOverrides), {});
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await page.evaluate(() => window.hciStore.state.colorOverrides.name), '#112233');
  // Invalid files and pasted text have separate errors; neither replaces the project.
  await tab('备份');
  const nameBefore = await page.evaluate(() => window.hciStore.state.team.name);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入项目', exact: true }).click();
  await (await chooser).setFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await page.getByRole('alert').filter({ hasText: 'broken.json' }).waitFor();
  await page.getByText('复制与粘贴 JSON', { exact: true }).click();
  await page.getByLabel('粘贴复制的设置', { exact: true }).fill('{bad');
  await page.getByRole('button', { name: '载入设置', exact: true }).click();
  assert.equal(await page.getByLabel('粘贴复制的设置', { exact: true }).getAttribute('aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => window.hciStore.state.team.name), nameBefore);
  // Export metadata and stale snapshots: mocked service, no actual encoding.
  let rejectExport = false;
  await page.route('**/api/export**', route => {
    const post = route.request().method() === 'POST';
    return route.fulfill({ status: post && rejectExport ? 500 : 200, json: post ? { id: 'hci-test' } : route.request().url().endsWith('/api/export') ? { available: true } : { status: 'complete', progress: 100 } });
  });
  await page.reload(); await attach(); await tab('备份');
  await page.getByLabel('导出方式', { exact: true }).selectOption('local');
  await page.getByRole('button', { name: '导出视频', exact: true }).click();
  await page.locator('[data-export-receipt]').waitFor();
  assert.match(await page.locator('[data-export-receipt]').innerText(), /1920 × 1080.*30 fps/);
  await page.evaluate(() => window.hciStore.update(s => { s.team.name = 'Edited after export'; }));
  await page.getByText('项目已修改，下载文件仍为上次导出的版本。', { exact: true }).waitFor();
  rejectExport = true;
  await page.getByRole('button', { name: '重新导出', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '导出失败' }).waitFor();
  assert.ok(await page.getByRole('link', { name: /下载 MP4/ }).isVisible());
  await page.screenshot({ path: output + '/desktop-export.png' });
  assert.deepEqual(errors, []);
  console.log('HCI: scene return, independent tag framing + reload + both renderers, grouped undo, mobile preview, palette preservation, import errors and export snapshot metadata passed. Export service was mocked.');
} finally { await browser.close(); }
