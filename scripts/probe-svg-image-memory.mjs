import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

// Minimal reproduction: does decoding unique foreignObject SVG data URLs retain
// renderer memory, and which variant avoids it? 120 iterations per variant.
const privateMiB = ids => Math.round(Number(String(execFileSync('powershell', ['-NoProfile', '-Command',
  `(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Measure-Object PrivateMemorySize64 -Sum).Sum`])).trim()) / 2 ** 20);
const variants = (process.env.PROBE_VARIANTS || 'nested,text,fresh,svgimage,blobnested').split(',');
const iterations = Number(process.env.PROBE_ITERATIONS || 120);
for (const variant of variants) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--js-flags=--expose-gc'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto('about:blank');
    const cdp = await browser.newBrowserCDPSession();
    const renderer = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo.filter(p => p.type === 'renderer').map(p => p.id);
    // A 2 MiB-ish photo-like PNG (noise), embedded at 1024 x 1024.
    await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = c.height = 1024;
      const ctx = c.getContext('2d'), data = ctx.createImageData(1024, 1024);
      for (let i = 0; i < data.data.length; i++) data.data[i] = (i % 4 === 3) ? 255 : Math.random() * 255;
      ctx.putImageData(data, 0, 0);
      window.__png = c.toDataURL('image/png');
      // 'flat': a solid 2048 x 2048 PNG, a few KB of data URL but 16 MiB decoded.
      const f = document.createElement('canvas'); f.width = f.height = 2048; f.getContext('2d').fillStyle = '#c33'; f.getContext('2d').fillRect(0, 0, 2048, 2048);
      window.__flat = f.toDataURL('image/png');
      window.__image = new Image();
      window.__target = document.createElement('canvas'); window.__target.width = 1920; window.__target.height = 1080;
    });
    const row = { variant, pngMb: +(await page.evaluate(() => window.__png.length / 1e6)).toFixed(2), samples: [[0, privateMiB(await renderer())]] };
    for (let done = 0; done < iterations; done += 20) {
      await page.evaluate(async ({ variant, from }) => {
        const pad = 'x'.repeat(window.__png.length);
        const image = window.__image;
        for (let i = from; i < from + 20; i++) {
          // 'small'/'half': tiny markup at full or half raster size. Retention that
          // follows the raster rather than the string points at decoded bitmaps.
          const size = variant === 'half' ? [960, 540] : [1920, 1080];
          if (variant === 'small' || variant === 'half') {
            image.src = `data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="${size[0]}" height="${size[1]}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="font:40px sans-serif">${i}</div></foreignObject></svg>`;
            await image.decode();
            const ctx = window.__target.getContext('2d'); ctx.clearRect(0, 0, 1920, 1080); ctx.drawImage(image, 0, 0);
            image.removeAttribute('src');
            continue;
          }
          const html = variant === 'flat' ? `<div>${i}<img src="${window.__flat}" style="width:300px;height:300px"/></div>` : variant === 'text' ? `<div>${i}<!--${pad}--></div>`
            : `<div>${i}<img src="${window.__png}" style="width:300px;height:300px"/><img src="${window.__png}" style="width:200px;height:200px"/></div>`;
          const svg = variant === 'svgimage'
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><text y="20">${i}</text><image href="${window.__png}" width="300" height="300"/></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${html}</div></foreignObject></svg>`;
          // 'rotate': decode inside a disposable about:blank iframe, replaced every 20 images.
          if (variant === 'rotate' && (i % 20 === 0 || !window.__frame)) {
            window.__frame?.remove();
            const frame = window.__frame = document.createElement('iframe'); frame.style.display = 'none'; document.body.append(frame);
          }
          const decoder = variant === 'fresh' ? new Image() : variant === 'rotate' ? new window.__frame.contentWindow.Image() : window.__image;
          decoder.src = 'data:image/svg+xml;charset=utf-8,' + svg.replace(/[%#\t\n\r]/g, encodeURIComponent);
          await decoder.decode();
          const ctx = window.__target.getContext('2d'); ctx.clearRect(0, 0, 1920, 1080); ctx.drawImage(decoder, 0, 0);
          decoder.removeAttribute('src');
        }
      }, { variant, from: done });
      row.samples.push([done + 20, privateMiB(await renderer())]);
    }
    await page.evaluate(() => { window.gc?.(); return new Promise(r => setTimeout(r, 3000)); });
    row.afterIdle = privateMiB(await renderer());
    console.log(JSON.stringify(row));
  } finally { await browser.close(); }
}
