import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pixelDifference } from './pixel-difference.mjs';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const output = 'test-results/card-compositing';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const failures = [], findings = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
  await page.goto(base);
  await page.evaluate(async base => {
    const [{ SAMPLE }, { normalize }, { cardArtwork }, markup, { default: styles }, { createBrowserCapture }, { readPhoto }] = await Promise.all([
      import(base + 'src/engine/constants.ts'), import(base + 'src/engine/state.ts'),
      import(base + 'src/engine/card-artwork.ts'), import(base + 'src/engine/markup.ts'),
      import(base + 'src/engine/stage.module.css'), import(base + 'src/lib/browser-capture.ts'), import(base + 'src/lib/images.ts'),
    ]);
    const source = document.createElement('canvas'); source.width = 400; source.height = 600;
    const ctx = source.getContext('2d'); ctx.fillStyle = '#00ee00'; ctx.fillRect(40, 40, 320, 560);
    const s = normalize(SAMPLE);
    Object.assign(s.colors, { c1: '#dd00dd', k2: '#dd00dd', c2: '#dd00dd' });
    const upload = await readPhoto(new File([await new Promise(resolve => source.toBlob(resolve))], 'portrait.png', { type: 'image/png' }), 1200);
    if (!upload.cut) throw new Error('Transparent uploaded portraits must be detected as cut-outs');
    Object.assign(s.players[0], { photo: upload.data, cut: upload.cut, photo2: null, photoK: null,
      num: '', name: '', nameLine1: '', nameLine2: '', tag1: '', tag2: '', captain: false, key: true,
      fit: { z: 2, x: 0, y: 35 }, fitS: { z: 2, x: 0, y: 65 }, fitK: { z: 2, x: 0, y: 35 } });
    Object.assign(s.anim, { template: 'classic', style: 'row' });
    const root = document.createElement('div'); document.body.replaceChildren(root);
    root.style.cssText = 'position:relative;width:1000px;height:1000px;container-type:inline-size';
    const still = document.createElement('style'); still.textContent = '*{animation:none!important;transition:none!important}'; document.head.append(still);
    window.compositing = { s, root, styles, cardArtwork, markup, capture: createBrowserCapture(s) };
    window.showCard = async ({ kind, preview, shape, full = false }) => {
      s.look.shape = shape; s.players[0].cut = !full; s.players[0].cutK = !full;
      const art = cardArtwork(s, 0, kind, 'en');
      const stage = document.createElement('div'); stage.className = preview ? art.className : styles.stage;
      stage.dataset.shape = shape;
      for (const [key, value] of Object.entries(art.css)) stage.style.setProperty(key, String(value));
      stage.style.cssText += ';width:1000px;height:1000px;aspect-ratio:auto;background:transparent;overflow:visible';
      if (preview) stage.innerHTML = art.html;
      else {
        const holder = document.createElement('div');
        holder.innerHTML = markup.stageHTML({ s, videoURL: null }).replace(/class="([^"]*)"/g, (_, names) => `class="${names.split(/\s+/).map(name => styles[name] || name).join(' ')}"`);
        stage.append(holder.querySelector(kind === 'small' ? `.${styles['sm-face']}` : `.${styles.rowscene} .${styles.rc}`));
      }
      root.replaceChildren(stage);
      const frame = stage.querySelector(kind === 'small' ? `.${styles['sm-por']}` : `.${styles.rc}`);
      const position = kind === 'small' ? frame.parentElement : frame;
      position.style.cssText = 'position:absolute;left:400px;top:300px;transform:none;--card-w:290px;--card-h:445px;width:290px;height:445px';
      for (const node of stage.querySelectorAll(`.${styles['rc-shade']},.${styles['rc-name']},.${styles.nm}`)) node.style.visibility = 'hidden';
      if (kind === 'key') {
        stage.querySelector(`.${styles['rc-photo']}`).style.opacity = '0';
        stage.querySelector(`.${styles['rc-kphoto']}`).style.opacity = '1';
        stage.querySelector(`.${styles['rc-metal']}`).style.opacity = '1';
      }
      await Promise.all([...stage.querySelectorAll('img')].map(img => img.decode()));
      await document.fonts.ready;
      return { x: 400, y: 300, width: 290, height: 445 };
    };
    window.inspectPixels = async ({ data, frame }) => {
      let canvas;
      if (data) {
        const img = new Image(); img.src = data; await img.decode();
        canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
      } else canvas = await window.compositing.capture(root, 1000, 1000);
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let top = 0, upperSides = 0, lowerSides = 0, bottom = 0, green = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (pixels[i] > 40 || pixels[i + 1] < 180 || pixels[i + 2] > 40 || pixels[i + 3] < 240) continue;
        green++;
        const outside = x < frame.x - 1 || x >= frame.x + frame.width + 1;
        if (y < frame.y) top++;
        if (outside && y >= frame.y && y < frame.y + frame.height * 2 / 3 - 1) upperSides++;
        if (outside && y >= frame.y + frame.height * 2 / 3 + 1 && y < frame.y + frame.height) lowerSides++;
        if (y >= frame.y + frame.height + 1) bottom++;
      }
      return { top, upperSides, lowerSides, bottom, green };
    };
  }, base);
  for (const shape of ['rounded', 'sharp', 'angled']) for (const kind of ['small', 'big', 'key']) {
    const images = [], stats = [];
    for (const preview of [false, true]) {
      const frame = await page.evaluate(config => window.showCard(config), { kind, preview, shape });
      const bytes = await page.screenshot({ clip: { x: 0, y: 0, width: 1000, height: 1000 }, omitBackground: true });
      images.push(bytes);
      const native = await page.evaluate(args => window.inspectPixels(args), { data: 'data:image/png;base64,' + bytes.toString('base64'), frame });
      const exported = await page.evaluate(args => window.inspectPixels(args), { frame });
      stats.push(native);
      findings.push({ shape, kind, preview, native, exported });
      for (const [method, pixels] of Object.entries({ native, exported })) {
        const label = `${shape} ${kind} ${preview ? 'preview' : 'live'} ${method}`;
        check(pixels.top > 0, `${label}: a cut-out must extend over the top`);
        check(pixels.bottom === 0, `${label}: portrait must stop at the card bottom (${pixels.bottom} leaked pixels)`);
        check(pixels.lowerSides === 0, `${label}: lower third must stay inside the sides (${pixels.lowerSides} leaked pixels)`);
        if (kind !== 'small') check(pixels.upperSides > 0, `${label}: upper two-thirds must allow side overflow`);
      }
      await writeFile(`${output}/${shape}-${kind}-${preview ? 'preview' : 'live'}.png`, bytes);
    }
    check(JSON.stringify(stats[0]) === JSON.stringify(stats[1]), `${shape} ${kind}: preview and live must share portrait geometry`);
    const diff = await pixelDifference(page, images[0], images[1]);
    // Chromium's compositor can round antialiased pixels by one channel value.
    check(diff.maxDelta <= 1, `${shape} ${kind}: preview and live pixels differ (${JSON.stringify(diff)})`);
  }
  // An animated light may brighten the backing, but must leave opaque portrait pixels alone.
  for (const effect of ['sheen', 'rc-flash', 'rc-holo']) {
    await page.evaluate(() => window.showCard({ kind: 'big', preview: false, shape: 'rounded' }));
    const pixels = await page.evaluate(async effect => {
      const { root, styles, capture } = window.compositing;
      const node = root.querySelector(`.${styles[effect]}`);
      node.style.cssText += ';display:block;opacity:0;transform:none;inset:0;width:100%;background-position:50% 0';
      const before = (await capture(root, 1000, 1000)).getContext('2d').getImageData(520, 420, 1, 1).data;
      node.style.opacity = '1';
      const after = (await capture(root, 1000, 1000)).getContext('2d').getImageData(520, 420, 1, 1).data;
      return { before: [...before], after: [...after] };
    }, effect);
    check(JSON.stringify(pixels.before) === JSON.stringify(pixels.after), `${effect}: light must stay behind the opaque portrait (${JSON.stringify(pixels)})`);
  }
  // Ordinary photos still fill their frame, even when zoomed or moved.
  for (const kind of ['big', 'key']) for (const preview of [false, true]) {
    const frame = await page.evaluate(config => window.showCard(config), { kind, preview, shape: 'rounded', full: true });
    const pixels = await page.evaluate(args => window.inspectPixels(args), { frame });
    check(pixels.top === 0 && pixels.upperSides === 0 && pixels.lowerSides === 0 && pixels.bottom === 0,
      `${kind} ordinary photo must remain clipped to the frame: ${JSON.stringify(pixels)}`);
  }
  const seasonLight = await page.evaluate(async base => {
    const { root, s, cardArtwork, capture } = window.compositing;
    const { default: season } = await import(base + 'src/engine/season2627.module.css');
    s.anim.template = 'season2627'; s.players[0].cut = true;
    const art = cardArtwork(s, 0, 'key', 'en');
    const stage = document.createElement('div'); stage.className = art.className;
    for (const [key, value] of Object.entries(art.css)) stage.style.setProperty(key, String(value));
    stage.innerHTML = art.html; root.replaceChildren(stage);
    await Promise.all([...root.querySelectorAll('img')].map(img => img.decode()));
    const coat = root.querySelector(`.${season['s26-key-coat']}`);
    const bounds = root.querySelector(`.${season['s26-column']}`).getBoundingClientRect();
    const x = Math.round(bounds.x + bounds.width * .5), y = Math.round(bounds.y + bounds.height * .45);
    coat.style.opacity = '0';
    const before = [...(await capture(root, 1000, 1100)).getContext('2d').getImageData(x, y, 1, 1).data];
    coat.style.opacity = '1';
    const after = [...(await capture(root, 1000, 1100)).getContext('2d').getImageData(x, y, 1, 1).data];
    return { before, after };
  }, base);
  check(JSON.stringify(seasonLight.before) === JSON.stringify(seasonLight.after), `26/27 foil light must stay behind the portrait: ${JSON.stringify(seasonLight)}`);
  for (const size of [70, 100, 140]) {
    const ratios = await page.evaluate(size => {
      const { s, root, cardArtwork, markup, styles } = window.compositing;
      s.look.smallSize = size; s.anim.template = 'classic';
      return [false, true].map(preview => {
        const art = cardArtwork(s, 0, 'small', 'en');
        const stage = document.createElement('div'); stage.className = preview ? art.className : styles.stage;
        for (const [key, value] of Object.entries(art.css)) stage.style.setProperty(key, String(value));
        stage.innerHTML = preview ? art.html : markup.stageHTML({ s, videoURL: null }).replace(/class="([^"]*)"/g,
          (_, names) => `class="${names.split(/\s+/).map(name => styles[name] || name).join(' ')}"`);
        root.replaceChildren(stage);
        const rect = stage.querySelector(`.${styles['sm-por']}`).getBoundingClientRect();
        return rect.width / rect.height;
      });
    }, size);
    check(Math.abs(ratios[0] - ratios[1]) < .001, `Small-card preview proportions must match the live card at ${size}%: ${ratios}`);
  }
  const state = await page.evaluate(() => {
    const { s } = window.compositing;
    s.anim.template = 'classic'; s.players[0].cut = true; s.players[0].cutK = true;
    s.look.smallSize = 100;
    return s;
  });
  // Exercise the real PNG entry point, including its transparent overflow canvas.
  const png = await browser.newPage();
  await png.goto(base + '?render-cards');
  await png.waitForFunction(() => !!window.cardRenderer);
  await png.evaluate(state => window.cardRenderer.init(state, 'en'), state);
  for (const kind of ['small', 'big', 'key']) {
    const result = await png.evaluate(async kind => {
      const bounds = await window.cardRenderer.show(0, kind);
      const factor = 1024 / Math.max(bounds.frameWidth, bounds.frameHeight);
      const width = Math.round((bounds.width + bounds.padding * 2) * factor), height = Math.round((bounds.height + bounds.padding * 2) * factor);
      await window.cardRenderer.place(600 * factor, (bounds.padding - bounds.x) * factor, (bounds.padding - bounds.y) * factor);
      const rect = document.querySelector(kind === 'small' ? '[class*="_sm-por_"]' : '[class*="_rc_"]').getBoundingClientRect();
      const canvas = await window.cardRenderer.capture(width, height);
      return { url: canvas.toDataURL(), alpha: canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3],
        frame: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    }, kind);
    const pixels = await page.evaluate(args => window.inspectPixels(args), { data: result.url, frame: result.frame });
    check(result.alpha === 0, `${kind} PNG must have a transparent canvas`);
    check(pixels.bottom === 0 && pixels.lowerSides === 0 && pixels.top > 0 && (kind === 'small' || pixels.upperSides > 0),
      `${kind} PNG must use the preview crop: ${JSON.stringify(pixels)}`);
    await writeFile(`${output}/export-${kind}.png`, Buffer.from(result.url.split(',')[1], 'base64'));
  }
  await png.close();
  // The video renderer must use the same fixed crop during the actual reveal.
  const video = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await video.goto(base + '?render-export');
  await video.waitForFunction(() => !!window.exportRenderer);
  Object.assign(state.anim, { style: 'lines', intro: false, manager: false }); state.players[0].key = false;
  const time = await video.evaluate(async state => {
    await window.exportRenderer.init(state, 'en', null);
    const animation = document.querySelector('[class*="_bigc_"] [class*="_flip_"]').getAnimations()[0];
    const timing = animation.effect.getTiming();
    return (timing.delay + timing.duration * animation.effect.getKeyframes().find(frame => frame.transform === 'rotateY(0deg)').offset) / 1000 + .1;
  }, state);
  await video.evaluate(time => window.exportRenderer.frame(time), time);
  const frame = await video.locator('[class*="_bigc_"]').first().evaluate(node => {
    const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const captured = await video.evaluate(async () => (await window.exportRenderer.capture(1280, 720)).toDataURL());
  const native = await video.screenshot();
  for (const [method, data] of Object.entries({ native: 'data:image/png;base64,' + native.toString('base64'), exported: captured })) {
    const pixels = await page.evaluate(args => window.inspectPixels(args), { data, frame });
    check(pixels.bottom === 0 && pixels.lowerSides === 0 && pixels.top > 0 && pixels.upperSides > 0,
      `video ${method} must use the preview crop: ${JSON.stringify(pixels)}`);
  }
  await writeFile(`${output}/video-frame.png`, Buffer.from(captured.split(',')[1], 'base64'));
  await video.close();
  await writeFile(`${output}/checks.json`, JSON.stringify({ findings, failures }, null, 2));
  assert.deepEqual(failures, []);
  console.log('Card compositing: shared preview/live pixels, top and upper-side breakout, bottom clipping, transparent capture and lights behind portraits passed.');
} finally { await browser.close(); }
