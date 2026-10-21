import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

// Does the export tab keep its speed when the user returns to the editor and
// the tab is hidden? Playwright normally disables background throttling; this
// probe launches Chrome without those switches.
const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const state = JSON.parse(await readFile('test-results/export-resources/state.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.PROBE_HEADED !== '1',
  ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const editor = await context.newPage();
  await editor.goto(base); await editor.waitForFunction(() => document.querySelector('#root')?.children.length);
  await editor.evaluate(async ({ base, state }) => {
    window.tabTest = await import(base + 'src/lib/export-tab.ts');
    window.tabState = { ...state, anim: { ...state.anim, intro: false, manager: false, style: 'off' } };
  }, { base, state });
  for (const hidden of [false, true, false, true]) {
    const opened = context.waitForEvent('page');
    const run = editor.evaluate(async () => {
      const t = performance.now(), tab = window.tabTest.openExportTab();
      await window.tabTest.browserVideoInTab({ tab, state: window.tabState, lang: 'en', height: 720, fps: 30, signal: new AbortController().signal, onProgress() {} });
      return performance.now() - t;
    });
    const tab = await opened;
    await tab.waitForFunction(() => document.querySelector('progress')?.value > 0, null, { timeout: 60000 });
    if (hidden) await editor.bringToFront(); else await tab.bringToFront();
    const visibility = await tab.evaluate(() => document.visibilityState).catch(() => 'closed');
    const ms = await run;
    console.log(JSON.stringify({ hidden, visibility, seconds: +(ms / 1000).toFixed(1) }));
  }
} finally { await browser.close(); }
