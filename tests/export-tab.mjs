import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Browser video export in its own tab: separate renderer process, MP4 handed
// to the editor through OPFS, the tab closes itself, and cancellation, a closed
// tab and a tab that never starts are all reported to the editor.
const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const state = JSON.parse(await readFile('test-results/export-resources/state.json', 'utf8').catch(() => {
  throw new Error('Run npm run test:export-resources first to create its fixture');
}));
const video = (await readFile('test-results/browser-video-frames/24.mp4')).toString('base64');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const editor = await context.newPage();
  await editor.goto(base); await editor.waitForFunction(() => document.querySelector('#root')?.children.length);
  const cdp = await browser.newBrowserCDPSession();
  const renderers = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo.filter(p => p.type === 'renderer').length;
  await editor.evaluate(async ({ base, state }) => {
    window.tabTest = { ...await import(base + 'src/lib/export-tab.ts'), ...await import(base + 'src/lib/export-file.ts') };
    window.tabState = { ...state, anim: { ...state.anim, intro: false, manager: false, style: 'off' } };
  }, { base, state });
  const exportFiles = () => editor.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('matchday-xi-exports', { create: true });
    return (await Array.fromAsync(dir.keys())).filter(name => !name.endsWith('.crswap'));
  });

  // 1. A complete export, with a background video handed over as a Blob.
  const before = await renderers(), filesBefore = (await exportFiles()).length;
  const opened = context.waitForEvent('page');
  const running = editor.evaluate(async video => {
    const { getStage } = await import(location.origin + '/matchday-xi/src/lib/stage-instance.ts');
    const blob = await (await fetch('data:video/mp4;base64,' + video)).blob();
    getStage().setVideo(URL.createObjectURL(blob));
    const statuses = new Set();
    const tab = window.tabTest.openExportTab();
    const url = await window.tabTest.browserVideoInTab({ tab, state: { ...window.tabState, bg: { ...window.tabState.bg, mode: 'video' } }, lang: 'en', height: 720, fps: 30,
      signal: new AbortController().signal, onProgress(value, status) { statuses.add(status); } });
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    window.lastURL = url;
    return { url, size: bytes.length, ftyp: String.fromCharCode(...bytes.slice(4, 8)), statuses: [...statuses] };
  }, video);
  const tab = await opened;
  assert.match(tab.url(), /\?export-video=[\da-f-]{36}$/);
  await tab.waitForFunction(() => document.querySelector('progress')?.value > 0, null, { timeout: 60000 });
  const during = await renderers();
  const result = await running;
  assert.ok(during > before, `the export tab must run in its own renderer process (${before} -> ${during})`);
  assert.equal(result.ftyp, 'ftyp'); assert.ok(result.size > 10000);
  assert.ok(result.statuses.includes('rendering') && result.statuses.includes('complete'), JSON.stringify(result.statuses));
  await tab.waitForEvent('close', { timeout: 10000 }).catch(() => {});
  assert.ok(tab.isClosed(), 'the export tab must close itself');
  assert.equal((await exportFiles()).length, filesBefore + 1, 'the adopted MP4 stays in OPFS while its download is offered');
  await editor.evaluate(() => window.tabTest.releaseDownload(window.lastURL));
  assert.equal((await exportFiles()).length, filesBefore, 'releasing the download removes the adopted file');

  // 2. Cancelling from the editor closes the tab and keeps no file.
  const cancelled = context.waitForEvent('page');
  const cancelling = editor.evaluate(async () => {
    const controller = new AbortController(), tab = window.tabTest.openExportTab();
    try {
      await window.tabTest.browserVideoInTab({ tab, state: window.tabState, lang: 'en', height: 720, fps: 30, signal: controller.signal,
        onProgress(value) { if (value >= 5) controller.abort(); } });
      return 'completed';
    } catch (error) { return error.name; }
  });
  const cancelTab = await cancelled;
  assert.equal(await cancelling, 'AbortError');
  await cancelTab.waitForEvent('close', { timeout: 15000 }).catch(() => {});
  assert.ok(cancelTab.isClosed(), 'a cancelled export tab must close');
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal((await exportFiles()).length, filesBefore, 'a cancelled export must not keep its file');

  // 3. Closing the tab during the export fails the editor's export.
  const closing = context.waitForEvent('page');
  const closed = editor.evaluate(async () => {
    const tab = window.tabTest.openExportTab();
    try {
      await window.tabTest.browserVideoInTab({ tab, state: window.tabState, lang: 'en', height: 720, fps: 30, signal: new AbortController().signal, onProgress() {} });
      return 'completed';
    } catch (error) { return error.message; }
  });
  const closeTab = await closing;
  await closeTab.waitForFunction(() => document.querySelector('progress')?.value > 0, null, { timeout: 60000 });
  await closeTab.close();
  assert.equal(await closed, 'failed');

  // 4. A tab that never starts (a blocked pop-up) is reported for the fallback.
  const blocked = await editor.evaluate(async () => {
    const open = window.open; window.open = () => null;
    try {
      const tab = window.tabTest.openExportTab();
      await window.tabTest.browserVideoInTab({ tab, state: window.tabState, lang: 'en', height: 720, fps: 30, signal: new AbortController().signal, onProgress() {} });
      return 'completed';
    } catch (error) { return error.message; } finally { window.open = open; }
  });
  assert.equal(blocked, 'tab');
  console.log('Export tab: own process, Blob video, OPFS hand-off, self-close, cancellation, closed tab and blocked pop-up passed.');
} finally { await browser.close(); }
