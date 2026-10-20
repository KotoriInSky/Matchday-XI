import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.goto(base);
  const results = await page.evaluate(async base => {
    const { createBrowserCapture } = await import(base + 'src/lib/browser-capture.ts');
    const { store } = await import(base + 'src/lib/store.ts'); await store.ready;
    const fast = createBrowserCapture(store.state, { pruneInvisible: true });
    const reference = createBrowserCapture(store.state, { pruneInvisible: false });
    document.head.querySelectorAll('style,link[rel=stylesheet]').forEach(node => node.remove());
    document.body.style.cssText = 'margin:0';
    const root = document.createElement('div');
    root.style.cssText = 'position:relative;width:640px;height:360px;overflow:hidden;background:#234;color:white;font:18px sans-serif';
    root.innerHTML = `<div class="layer" style="position:absolute;left:0;top:0;width:300px;height:200px;opacity:0;background:orange">${'<span style="display:inline-block;padding:3px">不可见的图层</span>'.repeat(100)}</div>
      <div style="display:flex;width:600px"><span style="opacity:0;padding:20px">保留占位</span><b>Visible sibling</b></div>`;
    document.body.replaceChildren(root);
    const layer = root.querySelector('.layer');
    const inspection = document.createElement('canvas'); inspection.width = 640; inspection.height = 360;
    const context = inspection.getContext('2d', { willReadFrequently: true });
    const hash = async canvas => {
      context.clearRect(0, 0, 640, 360); context.drawImage(canvas, 0, 0);
      return String(new Uint8Array(await crypto.subtle.digest('SHA-256', context.getImageData(0, 0, 640, 360).data)));
    };
    const check = async name => {
      const getProperty = CSSStyleDeclaration.prototype.getPropertyValue;
      let reads = 0, a, b, fastReads, referenceReads;
      CSSStyleDeclaration.prototype.getPropertyValue = function(key) { reads++; return getProperty.call(this, key); };
      try {
        a = await fast(root, 640, 360); fastReads = reads;
        reads = 0; b = await reference(root, 640, 360); referenceReads = reads;
      } finally { CSSStyleDeclaration.prototype.getPropertyValue = getProperty; }
      if (await hash(a) !== await hash(b)) throw Error(`Invisible-layer capture changed pixels: ${name}`);
      a.width = a.height = b.width = b.height = 0;
      return { name, fastReads, referenceReads };
    };
    const results = [await check('transparent absolute layer and normal-flow placeholder')];
    const animation = layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, fill: 'both' }); animation.pause();
    for (const time of [0, .001, 500, 1000, 0]) {
      animation.currentTime = time;
      results.push(await check(`opacity animation ${time}`));
    }
    animation.cancel(); layer.style.opacity = '1'; layer.style.visibility = 'hidden';
    results.push(await check('hidden absolute layer'));
    layer.firstElementChild.style.visibility = 'visible';
    results.push(await check('visible descendant of hidden layer'));
    layer.firstElementChild.style.visibility = '';
    const style = document.createElement('style');
    style.textContent = '.layer::after{content:"VISIBLE PSEUDO";visibility:visible;background:red}'; document.head.append(style);
    results.push(await check('visible pseudo element of hidden layer'));
    style.textContent = '.layer span::before{content:"VISIBLE CHILD PSEUDO";visibility:visible;background:blue}';
    results.push(await check('visible descendant pseudo element of hidden layer'));
    style.remove(); layer.style.visibility = 'visible'; layer.style.opacity = '0';
    layer.innerHTML = '<svg width="100" height="100"><defs><linearGradient id="shared-gradient"><stop style="stop-color:lime"/><stop offset="1" style="stop-color:blue"/></linearGradient></defs></svg>';
    root.insertAdjacentHTML('beforeend', '<svg style="position:absolute;left:300px;top:100px" width="120" height="100"><rect width="120" height="100" fill="url(#shared-gradient)"/></svg>');
    results.push(await check('SVG definition referenced by another layer'));
    root.lastElementChild.firstElementChild.setAttribute('fill', 'URL(#shared-gradient)');
    results.push(await check('case-insensitive SVG URL reference'));
    root.lastElementChild.remove();
    layer.querySelector('svg').insertAdjacentHTML('beforeend', '<rect width="100" height="100" fill="url(#shared-gradient)"/>');
    layer.insertAdjacentHTML('beforeend', '<span style="display:inline-block;padding:3px">内部图层</span>'.repeat(100));
    results.push(await check('private SVG definition in an invisible layer'));
    root.insertAdjacentHTML('beforeend', '<svg class="external" style="position:absolute;left:300px;top:100px" width="120" height="100"><rect width="120" height="100"/></svg>');
    style.textContent = '.external rect{fill:url("#shared-gradient")}'; document.head.append(style);
    results.push(await check('SVG definition referenced by a stylesheet'));
    style.remove(); root.lastElementChild.remove();
    root.insertAdjacentHTML('beforeend', '<svg style="position:absolute;left:300px;top:100px" width="120" height="100"><rect width="120" height="100"/></svg>');
    const rect = root.lastElementChild.firstElementChild;
    const resourceAnimation = rect.animate([{ fill: 'url(#shared-gradient)' }, { fill: 'url(#shared-gradient)' }], { duration: 1000, fill: 'both' });
    resourceAnimation.pause(); resourceAnimation.currentTime = 500;
    results.push(await check('SVG definition referenced by Web Animations'));
    resourceAnimation.cancel(); root.lastElementChild.remove();
    layer.innerHTML = '<svg width="100" height="100"><g id="shared-shape"><rect width="80" height="80" fill="lime"/></g></svg>';
    root.insertAdjacentHTML('beforeend', '<svg style="position:absolute;left:300px;top:100px" width="120" height="100"><use href="#shared-shape"/></svg>');
    results.push(await check('SVG use references a hidden layer'));
    root.lastElementChild.remove();
    layer.innerHTML = '<svg width="100" height="100"><defs><linearGradient id="shared-gradient"><stop style="stop-color:lime"/><stop offset="1" style="stop-color:blue"/></linearGradient></defs></svg>';
    root.insertAdjacentHTML('beforeend', '<svg style="position:absolute;left:300px;top:100px" width="120" height="100"><rect width="120" height="100" fill="url(#shared%2Dgradient)"/></svg>');
    results.push(await check('encoded resource fragment'));
    root.lastElementChild.remove();
    layer.innerHTML = '<span>replaced content</span>'; layer.style.opacity = '1';
    results.push(await check('replaced layer becomes visible'));
    return results;
  }, base);
  assert.ok(results[0].fastReads < results[0].referenceReads / 2, 'Invisible layers should avoid reading styles for their entire contents');
  assert.ok(results.find(row => row.name === 'hidden absolute layer').fastReads < results.find(row => row.name === 'hidden absolute layer').referenceReads / 2);
  const privateResource = results.find(row => row.name === 'private SVG definition in an invisible layer');
  assert.ok(privateResource.fastReads < privateResource.referenceReads / 2, 'Private SVG definitions must not prevent invisible-layer pruning');
  console.log('Invisible-layer pixels, layout, animation boundaries, visibility overrides and shared SVG resources match the full capture.', results);
} finally { await browser.close(); }
