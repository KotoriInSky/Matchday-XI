import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const luminance = channels => channels.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
const browser = await chromium.launch({ channel: 'chrome' });
await mkdir('test-results/header-theme', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.addInitScript(() => { if (!localStorage.getItem('matchday-xi-lang')) localStorage.setItem('matchday-xi-lang', 'en'); });
  await page.goto(base);
  for (const theme of ['dark', 'light']) {
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    const colors = await page.locator('.app-header option').evaluateAll(options => options.map(option => ({ color: getComputedStyle(option).color, background: getComputedStyle(option).backgroundColor })));
    for (const pair of colors) {
      assert.ok(!pair.background.startsWith('rgba'), `Native popup needs an opaque surface: ${JSON.stringify(pair)}`);
      const fg = luminance(pair.color.match(/[\d.]+/g).slice(0, 3).map(Number));
      const bg = luminance(pair.background.match(/[\d.]+/g).slice(0, 3).map(Number));
      assert.ok((Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) >= 4.5, 'Popup text contrast must be at least 4.5:1');
    }
    await page.getByRole('combobox', { name: 'Language', exact: true }).click();
    await page.screenshot({ path: `test-results/header-theme/${theme}-language.png` }); await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: 'Theme', exact: true }).click();
    await page.screenshot({ path: `test-results/header-theme/${theme}-theme.png` }); await page.keyboard.press('Escape');
  }
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-Hans');
  assert.ok(await page.locator('html').evaluate(el => el.classList.contains('dark')));
  await page.reload();
  assert.equal(await page.locator('.app-header select').first().inputValue(), 'zh-Hans');
  assert.ok(await page.locator('html').evaluate(el => el.classList.contains('dark')));
  console.log('Language and theme popups retain readable contrast in both themes; language/theme preferences persist.');
} finally { await browser.close(); }
