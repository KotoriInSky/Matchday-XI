import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
// Does a sandboxed iframe (opaque origin) get its own renderer process, and is
// the SVG-image memory it accumulates released when the iframe is removed?
const mib = ids => ids.length ? Math.round(Number(String(execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Measure-Object PrivateMemorySize64 -Sum).Sum`])).trim()) / 2 ** 20) : 0;
const child = `<script>
onmessage = async () => { try {
  const pad = 'x'.repeat(10e6), image = new Image();
  for (let i = 0; i < 60; i++) {
    image.src = 'data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">' + i + '<!--' + pad + '--></div></foreignObject></svg>';
    await image.decode(); image.removeAttribute('src');
  }
  const bitmap = await createImageBitmap((() => { const c = new OffscreenCanvas(4, 4); c.getContext('2d').fillRect(0, 0, 4, 4); return c; })());
  parent.postMessage(bitmap, "*", [bitmap]); } catch (e) { parent.postMessage(String(e), "*"); }
};
</script>`;
const server = createServer((req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end(req.url === '/child' ? child : '<body></body>'));
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const cdp = await browser.newBrowserCDPSession();
  const renderers = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo.filter(p => p.type === 'renderer').map(p => p.id);
  const before = await renderers();
  await page.evaluate(() => new Promise(resolve => {
    const frame = document.createElement('iframe'); frame.sandbox = 'allow-scripts'; frame.src = '/child';
    frame.onload = () => { addEventListener('message', e => { window.__got = e.data instanceof ImageBitmap || String(e.data); resolve(); }, { once: true }); frame.contentWindow.postMessage('go', '*'); };
    document.body.append(frame); window.__frame = frame;
  }));
  const during = await renderers();
  const row = { renderersBefore: before.length, renderersDuring: during.length, bitmapTransferred: await page.evaluate(() => window.__got), mibDuring: mib(during) };
  await page.evaluate(() => window.__frame.remove());
  row.after = [];
  for (let s = 1; s <= 12; s += 1) { await new Promise(r => setTimeout(r, 1000)); const ids = await renderers(); row.after.push([s, ids.length, mib(ids)]); }
  console.log(JSON.stringify(row));
} finally { await browser.close(); server.close(); }
