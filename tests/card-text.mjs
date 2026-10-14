import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'en'));
  await page.goto(base);
  await page.evaluate(async () => {
    window.textStore = (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith('/src/lib/store.ts')).name)).store;
    await window.textStore.ready;
  });
  await page.getByRole('tab', { name: 'Lineup', exact: true }).click();
  await page.locator('.player-index-row').first().click();
  const dialog = page.getByRole('dialog');
  for (const template of ['classic', 'season2627']) {
    await page.evaluate(template => window.textStore.update(s => {
      s.anim.template = template;
      const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 500;
      canvas.getContext('2d').fillRect(0, 0, 300, 500);
      Object.assign(s.players[0], { photo: canvas.toDataURL(), cut: false, fit: { x: 0, y: 0, z: 1 } });
    }), template);
    const name = dialog.locator('.card-inspector-canvas [data-card-text]').last();
    await name.scrollIntoViewIfNeeded();
    const box = await name.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 20, { steps: 5 }); await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.textStore.state.players[0].fit), { x: 0, y: 0, z: 1 }, `${template}: text selection must not move the portrait`);
    const image = dialog.locator('.card-inspector-canvas img[data-fit]').first();
    const photo = await image.boundingBox();
    const x = photo.x + photo.width * .65, y = photo.y + photo.height * .35;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 35, y + 25, { steps: 5 }); await page.mouse.up();
    assert.notEqual(await page.evaluate(() => window.textStore.state.players[0].fit.x), 0, `${template}: image dragging still works`);
    await dialog.getByLabel('Second line', { exact: true }).fill('Dias');
    assert.equal(await page.evaluate(() => window.textStore.state.players[0].nameLine2), 'Dias');
  }
  console.log('Card text: editable fields, text selection without portrait movement, and separate image dragging passed in both templates.');
} finally { await browser.close(); }
