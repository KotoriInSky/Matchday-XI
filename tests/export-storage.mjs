import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage(); await page.goto(base);
  const result = await page.evaluate(async base => {
    const module = await import(base + 'src/lib/export-file.ts').catch(() => null);
    if (!module) return { missing: true };
    const { createExportFile, releaseDownload } = module;
    const check = (ok, reason) => { if (!ok) throw Error(reason); };
    const directory = await navigator.storage.getDirectory();
    const entries = async () => {
      const dir = await directory.getDirectoryHandle('matchday-xi-exports', { create: true });
      return (await Array.fromAsync(dir.keys())).filter(name => !name.endsWith('.crswap')).sort();
    };
    const originalGetDirectory = navigator.storage.getDirectory;
    const modes = [];
    for (const fallback of [false, true]) {
      if (fallback) navigator.storage.getDirectory = async () => { throw new DOMException('Unavailable', 'SecurityError'); };
      const file = await createExportFile(); modes.push(file.storage);
      await file.write(new Uint8Array([1, 2, 3, 4]));
      await file.write(new Uint8Array([8, 9]), 6);
      await file.write(new Uint8Array([7, 6]), 1);
      const url = await file.finish('application/octet-stream');
      // Disposing the producer must keep a successfully transferred download alive.
      await file.dispose();
      const blob = await (await fetch(url)).blob();
      check(blob.type === 'application/octet-stream', 'Download MIME must survive streaming');
      check(String(new Uint8Array(await blob.arrayBuffer())) === '1,7,6,4,0,0,8,9', 'Random-access metadata patches must preserve other bytes');
      const cancelled = await createExportFile(); await cancelled.write(new Uint8Array(1024)); await cancelled.dispose();
      await releaseDownload(url);
      navigator.storage.getDirectory = originalGetDirectory;
    }
    check(modes[0] === 'file' && modes[1] === 'memory', 'Both disk-backed output and unsupported-browser fallback must run');
    check((await entries()).length === 0, 'Finished/revoked and cancelled temporary files must be removed');

    // A second producer must not remove another still-downloadable result.
    const first = await createExportFile(); await first.write(new Uint8Array([11]));
    const firstUrl = await first.finish('video/mp4');
    const second = await createExportFile(); await second.write(new Uint8Array([22]));
    const active = await entries();
    check(active.length === 2, `Active output leases must survive stale-file cleanup: ${first.storage}/${second.storage} ${JSON.stringify(active)}`);
    check(new Uint8Array(await (await fetch(firstUrl)).arrayBuffer())[0] === 11, 'Existing downloads remain readable during a new export');
    await second.dispose(); await releaseDownload(firstUrl);
    check((await entries()).length === 0, 'All output files are reclaimed after their last consumer');

    // Orphaned outputs from a closed/crashed tab are reclaimed on the next export.
    const dir = await directory.getDirectoryHandle('matchday-xi-exports');
    const orphan = 'export-00000000-0000-0000-0000-000000000000';
    await dir.getFileHandle(orphan, { create: true });
    const third = await createExportFile();
    check(!(await entries()).includes(orphan), 'Stale export files should not accumulate across page sessions');
    await third.dispose();

    const failed = await createExportFile();
    const nativeWrite = FileSystemWritableFileStream.prototype.write;
    FileSystemWritableFileStream.prototype.write = () => Promise.reject(new DOMException('Quota exhausted', 'QuotaExceededError'));
    try {
      let rejected = false;
      try { await failed.write(new Uint8Array([1])); } catch (error) { rejected = error.name === 'QuotaExceededError'; }
      check(rejected, 'A mid-export disk error must reach the caller');
    } finally { FileSystemWritableFileStream.prototype.write = nativeWrite; await failed.dispose(); }
    check((await entries()).length === 0, 'Failed file writes must not leave temporary outputs behind');

    const failedClose = await createExportFile(); await failedClose.write(new Uint8Array([1]));
    const nativeClose = FileSystemWritableFileStream.prototype.close;
    FileSystemWritableFileStream.prototype.close = () => Promise.reject(new DOMException('Commit failed', 'QuotaExceededError'));
    try {
      let rejected = false;
      try { await failedClose.finish('video/mp4'); } catch (error) { rejected = error.name === 'QuotaExceededError'; }
      check(rejected, 'A final file commit error must reach the caller');
    } finally { FileSystemWritableFileStream.prototype.close = nativeClose; await failedClose.dispose(); }
    const exportDirectory = await directory.getDirectoryHandle('matchday-xi-exports');
    check((await Array.fromAsync(exportDirectory.keys())).length === 0, 'Failed commits must abort their writer and remove its swap file');

    const { store } = await import(base + 'src/lib/store.ts'); await store.ready;
    const { browserVideo } = await import(base + 'src/lib/browser-export.ts');
    const state = structuredClone(store.state); Object.assign(state.anim, { intro: false, manager: false, style: 'off' });
    const controller = new AbortController();
    let aborted = false;
    try {
      await browserVideo({ state, lang: 'en', height: 720, fps: 30, signal: controller.signal,
        onProgress(value, phase) { if (phase === 'rendering' && value > 0) controller.abort(); } });
    } catch (error) { aborted = error.name === 'AbortError'; }
    check(aborted, 'Cancelling an active encoder must propagate the abort');
    check(!document.querySelector('iframe[title="Export renderer"]'), 'Cancelling an active encoder must remove its rendering frame');
    check((await entries()).length === 0, 'Cancelling active video encoding must release its temporary file');
    return { modes, remaining: await entries() };
  }, base);
  assert.ok(!result.missing, 'A temporary export sink is required to avoid retaining full output buffers');
  const archive = await page.evaluate(async base => {
    const { createExportFile, releaseDownload } = await import(base + 'src/lib/export-file.ts');
    const module = await import(base + 'src/lib/export-zip.ts').catch(() => null);
    if (!module) return null;
    const file = await createExportFile();
    const zip = await module.createZipArchive(file.write);
    try {
      const signal = new AbortController().signal;
      await zip.add('透明立绘.png', new Blob([new Uint8Array([1, 2, 3])]), signal);
      await zip.add('second.png', new Blob([new Uint8Array(256 * 1024).fill(42)]), signal);
      await zip.finish();
      const url = await file.finish('application/zip');
      const bytes = [...new Uint8Array(await (await fetch(url)).arrayBuffer())];
      await releaseDownload(url); return bytes;
    } finally { zip.dispose(); await file.dispose(); }
  }, base);
  assert.ok(archive, 'Card archives must support incremental output');
  const files = unzipSync(new Uint8Array(archive));
  assert.deepEqual([...files['透明立绘.png']], [1, 2, 3]);
  assert.equal(files['second.png'].length, 256 * 1024); assert.ok(files['second.png'].every(x => x === 42));
  console.log('Export storage: random-access writes, fallback, cancellation, result lifetime, active leases, orphan cleanup and incremental ZIP passed.', result);
} finally { await browser.close(); }
