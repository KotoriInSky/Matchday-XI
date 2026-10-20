import { chromium } from 'playwright';
// Can an SVG Blob with foreignObject go through createImageBitmap, and is the
// canvas still readable afterwards? Also: is reloading an identical data URL free?
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage(); await page.goto('about:blank');
console.log(await page.evaluate(async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="background:red;width:100px;height:100px"></div></foreignObject></svg>';
  const out = {};
  try { const bmp = await createImageBitmap(new Blob([svg], { type: 'image/svg+xml' })); out.bitmap = [bmp.width, bmp.height]; } catch (e) { out.bitmap = String(e); }
  return JSON.stringify(out);
}));
await browser.close();
