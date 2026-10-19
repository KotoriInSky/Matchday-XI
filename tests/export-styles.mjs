import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } }); await page.goto(base);
  const result = await page.evaluate(async base => {
    const { createBrowserCapture } = await import(base + 'src/lib/browser-capture.ts');
    const { store } = await import(base + 'src/lib/store.ts'); await store.ready;
    const optimized = createBrowserCapture(store.state), reference = createBrowserCapture(store.state, { allProperties: true });
    document.head.querySelectorAll('style,link[rel=stylesheet]').forEach(node => node.remove());
    document.body.style.cssText = 'margin:0';
    const root = document.createElement('div'); root.style.cssText = 'width:640px;height:360px;background:#234;color:white';
    root.innerHTML = '<div class="sample" style="width:180px;height:100px;background:#e87;margin:30px">Dynamic <b>文字</b></div>';
    document.body.replaceChildren(root);
    const sample = root.firstElementChild;
    const inspection = document.createElement('canvas'); inspection.width = 640; inspection.height = 360;
    const context = inspection.getContext('2d', { willReadFrequently: true });
    const hash = async canvas => {
      context.clearRect(0, 0, 640, 360); context.drawImage(canvas, 0, 0);
      return String(new Uint8Array(await crypto.subtle.digest('SHA-256', context.getImageData(0, 0, 640, 360).data)));
    };
    let reads = 0; const getProperty = CSSStyleDeclaration.prototype.getPropertyValue;
    const check = async name => {
      CSSStyleDeclaration.prototype.getPropertyValue = function(key) { reads++; return getProperty.call(this, key); };
      let fast, full, fastReads, fullReads;
      try {
        reads = 0; fast = await optimized(root, 640, 360); fastReads = reads;
        reads = 0; full = await reference(root, 640, 360); fullReads = reads;
      } finally { CSSStyleDeclaration.prototype.getPropertyValue = getProperty; }
      if (await hash(fast) !== await hash(full)) throw Error(`Style filtering changed pixels: ${name}`);
      fast.width = fast.height = full.width = full.height = 0;
      return { name, fastReads, fullReads };
    };
    const results = [await check('inline and inherited styles')];
    sample.style.cssText += ';text-shadow:3px 2px 1px #000;transform:rotate(8deg);border:3px dashed yellow;font:italic 25px serif';
    results.push(await check('new inline properties and expanded shorthands'));
    const style = document.createElement('style'); style.textContent = '.sample::before{content:"★";display:block;filter:blur(.2px)}@keyframes change{from{letter-spacing:0}to{letter-spacing:5px}}.sample{animation:change 1s linear both;clip-path:inset(2px round 12px)}';
    document.head.append(style);
    for (const animation of root.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 450; }
    results.push(await check('new stylesheet, pseudo element and animated property'));
    style.sheet.insertRule('.sample{outline:6px dotted cyan;box-shadow:10px 10px 3px #708}', style.sheet.cssRules.length);
    results.push(await check('insertRule on existing stylesheet'));
    sample.style.backgroundImage = 'linear-gradient(45deg, #f90 25%, #067 25%, #067 75%, #f90 75%)';
    sample.style.backgroundSize = '30px 30px'; sample.style.backgroundPosition = '11px 7px';
    sample.style.maskImage = 'linear-gradient(white 70%,transparent)'; sample.style.maskPosition = '3px 8px';
    results.push(await check('computed shorthands and expanded position longhands'));
    const adopted = new CSSStyleSheet(); adopted.replaceSync('.sample{border-radius:30px;opacity:.8}'); document.adoptedStyleSheets = [adopted];
    results.push(await check('adopted stylesheet'));
    adopted.replaceSync('.sample{all:initial;display:block;background:orange;width:200px;height:120px}');
    results.push(await check('all shorthand fallback'));
    document.adoptedStyleSheets = []; style.remove(); sample.removeAttribute('style');
    results.push(await check('removed stylesheet and inline declarations'));
    const animation = sample.animate([{ backgroundColor: '#00f', clipPath: 'circle(20% at center)', filter: 'blur(2px)' }, { backgroundColor: '#f00', clipPath: 'circle(80% at center)', filter: 'blur(0px)' }], { duration: 1000, fill: 'both' });
    animation.pause(); animation.currentTime = 500;
    results.push(await check('Web Animations API properties'));
    document.head.append(style);
    Object.defineProperty(style.sheet, 'cssRules', { get() { throw new DOMException('Not readable', 'SecurityError'); }, configurable: true });
    results.push(await check('unreadable stylesheet fallback'));
    return results;
  }, base);
  assert.ok(result[0].fastReads < result[0].fullReads / 2, 'Unused browser properties should not be read');
  assert.equal(result.find(row => row.name === 'all shorthand fallback').fastReads, result.find(row => row.name === 'all shorthand fallback').fullReads);
  assert.equal(result.find(row => row.name === 'unreadable stylesheet fallback').fastReads, result.find(row => row.name === 'unreadable stylesheet fallback').fullReads);
  console.log('Filtered/full-style pixels match across dynamic CSS, pseudo elements and animations', result);
} finally { await browser.close(); }
