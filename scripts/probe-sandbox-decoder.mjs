import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
// A sandboxed srcdoc decoder: parent sends a foreignObject SVG string, child
// decodes it and transfers an ImageBitmap back. Is the result readable
// (origin-clean) in the parent, and what does the round trip cost?
const server = createServer((req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<body></body>'));
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  console.log(await page.evaluate(async () => {
    const frame = document.createElement('iframe'); frame.sandbox = 'allow-scripts'; frame.style.display = 'none';
    frame.srcdoc = `<script>
      onmessage = async ({ data: { id, svg, width, height, mode } }) => {
        try {
          const image = new Image();
          if (mode === 'cors') image.crossOrigin = 'anonymous';
          image.src = mode === 'png' ? svg : 'data:image/svg+xml;charset=utf-8,' + svg; await image.decode();
          const bitmap = await createImageBitmap(image, { resizeWidth: width, resizeHeight: height });
          image.removeAttribute('src');
          parent.postMessage({ id, bitmap }, '*', [bitmap]);
        } catch (error) { parent.postMessage({ id, error: String(error) }, '*'); }
      };
      parent.postMessage({ ready: true }, '*');
    <\/script>`;
    const ready = new Promise(resolve => addEventListener('message', function on(e) { if (e.data?.ready) { removeEventListener('message', on); resolve(); } }));
    document.body.append(frame); await ready;
    // A photo-like PNG and a CSS-styled HTML body, like a capture frame.
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const ctx = c.getContext('2d'), noise = ctx.createImageData(1024, 1024);
    for (let i = 0; i < noise.data.length; i++) noise.data[i] = i % 4 === 3 ? 255 : Math.random() * 255;
    ctx.putImageData(noise, 0, 0);
    const png = c.toDataURL();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:1920px;height:1080px;background:rgb(10,20,200)"><img src="${png}" style="width:400px;height:400px"/></div></foreignObject></svg>`.replace(/[%#\t\n\r]/g, encodeURIComponent);
    const decode = (id, mode, body = svg) => new Promise(resolve => {
      addEventListener('message', function on(e) { if (e.data?.id === id) { removeEventListener('message', on); resolve(e.data); } });
      frame.contentWindow.postMessage({ id, svg: body, width: 1920, height: 1080, mode }, '*');
    });
    const out = { svgMb: +(svg.length / 1e6).toFixed(2) };
    out.png = (await decode('p', 'png', png)).error || 'clean';
    out.cors = (await decode('c', 'cors')).error || 'clean';
    const plain = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    out.plainSvg = (await decode('s', 'svg', plain)).error || 'clean';
    return JSON.stringify(out);
    const times = [];
    let result;
    for (let i = 0; i < 6; i++) { const t = performance.now(); result = await decode(i); times.push(Math.round(performance.now() - t)); if (result.error) return JSON.stringify({ error: result.error }); if (i < 5) result.bitmap.close(); }
    out.roundTripMs = times;
    const target = document.createElement('canvas'); target.width = 1920; target.height = 1080;
    const t2 = target.getContext('2d'); t2.drawImage(result.bitmap, 0, 0);
    try { out.pixel = [...t2.getImageData(1000, 900, 1, 1).data]; out.originClean = true; } catch (e) { out.originClean = String(e); }
    try { const vf = new VideoFrame(target, { timestamp: 0 }); vf.close(); out.videoFrame = true; } catch (e) { out.videoFrame = String(e); }
    // Same decode in-page for comparison.
    const img = new Image(); const t3 = performance.now(); img.src = 'data:image/svg+xml;charset=utf-8,' + svg; await img.decode(); t2.drawImage(img, 0, 0); out.inPageMs = Math.round(performance.now() - t3);
    return JSON.stringify(out);
  }));
} finally { await browser.close(); server.close(); }
