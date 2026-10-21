import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
// Does a same-origin tab opened with noopener get its own renderer process,
// can it talk to the opener over BroadcastChannel and close itself, and is the
// foreignObject SVG memory it accumulates released when it closes?
const mib = ids => ids.length ? Math.round(Number(String(execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Measure-Object PrivateMemorySize64 -Sum).Sum`])).trim()) / 2 ** 20) : 0;
const worker = `<script>
const channel = new BroadcastChannel('probe');
channel.onmessage = async ({ data }) => {
  if (data !== 'go') return;
  const pad = 'x'.repeat(10e6), image = new Image();
  for (let i = 0; i < 60; i++) {
    image.src = 'data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">' + i + '<!--' + pad + '--></div></foreignObject></svg>';
    await image.decode(); image.removeAttribute('src');
  }
  const canvas = new OffscreenCanvas(4, 4); canvas.getContext('2d').fillRect(0, 0, 4, 4);
  channel.postMessage({ done: true, opener: window.opener === null, blob: await canvas.convertToBlob() });
};
channel.postMessage({ ready: true });
</script>`;
const server = createServer((req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end(req.url === '/worker' ? worker : '<body><button id=b>export</button></body>'));
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext();
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const cdp = await browser.newBrowserCDPSession();
  const renderers = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo.filter(p => p.type === 'renderer').map(p => p.id);
  const before = await renderers();
  await page.evaluate(() => {
    window.__channel = new BroadcastChannel('probe');
    window.__ready = new Promise(r => window.__channel.addEventListener('message', e => e.data.ready && r(), { once: false }));
    window.__done = new Promise(r => window.__channel.addEventListener('message', e => e.data.done && r(e.data)));
    document.getElementById('b').onclick = () => { window.__handle = window.open('/worker', '_blank', 'noopener'); };
  });
  const popup = context.waitForEvent('page');
  await page.click('#b'); const tab = await popup; await tab.waitForLoadState();
  await page.evaluate(() => window.__ready);
  const during = await renderers();
  await page.evaluate(() => window.__channel.postMessage('go'));
  const done = await page.evaluate(async () => { const d = await window.__done; return { opener: d.opener, blobSize: d.blob.size, handleIsNull: window.__handle === null }; });
  const row = { renderersBefore: before.length, renderersDuring: during.length, separateProcess: during.length > before.length, ...done, mibWithTab: mib(await renderers()) };
  // The tab closes itself, as a finished export tab would.
  await tab.evaluate(() => window.close()).catch(() => {});
  row.after = [];
  for (let s = 1; s <= 8; s++) { await new Promise(r => setTimeout(r, 1000)); const ids = await renderers(); row.after.push([s, ids.length, mib(ids)]); }
  row.tabClosed = tab.isClosed();
  console.log(JSON.stringify(row));
} finally { await browser.close(); server.close(); }
