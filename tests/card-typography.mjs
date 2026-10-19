import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const output = 'test-results/card-typography';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const editor = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await editor.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'en'));
  await editor.goto(base);
  const migration = await editor.evaluate(async base => {
    const { normalize } = await import(base + 'src/engine/state.ts');
    const legacy = normalize({ players: [{ nameSize2: 135 }] }).players[0];
    const current = normalize({ players: [{ nameSize1: 30, nameSize2: 250, nameSizeSmall: 35 }] }).players[0];
    const invalid = normalize({ players: [{ nameSize1: -5, nameSize2: 500, nameSizeSmall: 500 }] }).players[0];
    return [legacy.nameSizeSmall, current.nameSize1, current.nameSize2, current.nameSizeSmall, invalid.nameSize1, invalid.nameSize2, invalid.nameSizeSmall];
  }, base);
  assert.deepEqual(migration, [135, 30, 250, 35, 30, 250, 250]);
  await editor.evaluate(async () => {
    window.typeStore = (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith('/src/lib/store.ts')).name)).store;
    await window.typeStore.ready;
  });
  await editor.getByRole('tab', { name: 'Lineup', exact: true }).click();
  await editor.locator('.player-index-row').first().click();
  const dialog = editor.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Pitch card', exact: true }).click();
  await dialog.getByRole('slider', { name: 'Pitch-card text size', exact: true }).press('End');
  assert.deepEqual(await editor.evaluate(() => { const p = window.typeStore.state.players[0]; return [p.nameSizeSmall, p.nameSize1, p.nameSize2]; }), [250, 100, 85]);
  await dialog.getByRole('button', { name: 'Player card', exact: true }).click();
  await dialog.getByRole('slider', { name: 'First-line text size', exact: true }).press('Home');
  await dialog.getByRole('slider', { name: 'Second-line text size', exact: true }).press('End');
  assert.deepEqual(await editor.evaluate(() => { const p = window.typeStore.state.players[0]; return [p.nameSizeSmall, p.nameSize1, p.nameSize2]; }), [250, 30, 250]);
  await editor.screenshot({ path: `${output}/controls-desktop.png` });
  await editor.setViewportSize({ width: 390, height: 844 });
  assert.ok(await editor.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await editor.screenshot({ path: `${output}/controls-mobile.png` });
  await editor.waitForTimeout(750); await editor.reload();
  assert.deepEqual(await editor.evaluate(async () => { const { store } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith('/src/lib/store.ts')).name); await store.ready; const p = store.state.players[0]; return [p.nameSizeSmall, p.nameSize1, p.nameSize2]; }), [250, 30, 250]);

  const renderer = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  await renderer.goto(base + '?render-cards'); await renderer.waitForFunction(() => !!window.cardRenderer);
  const state = await renderer.evaluate(async base => {
    const { normalize } = await import(base + 'src/engine/state.ts'); const s = normalize({});
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 500;
    canvas.getContext('2d').fillStyle = '#75aadb'; canvas.getContext('2d').fillRect(0, 0, 300, 500);
    Object.assign(s.players[0], { num: '3', name: 'Rúben Dias', nameLine1: 'Rúben', nameLine2: 'Dias', nameSize1: 100, nameSize2: 100, nameSizeSmall: 100, photo: canvas.toDataURL(), cut: false, tag1: '', tag2: '', captain: false, key: false });
    window.measureCardType = kind => {
      const frame = document.querySelector(kind === 'small' ? '[class*="_sm-por_"]' : '[class*="s26-preview-column_"]') || document.querySelector('[class*="_rc_"]');
      const rect = frame.getBoundingClientRect();
      const columns = frame.matches('[class*="s26-preview-column_"]');
      const typeWidth = columns ? rect.height * 22.5 / 56.25 : rect.width;
      const nodes = kind === 'small' ? [...frame.querySelectorAll('[data-card-text] b')] : [...frame.querySelectorAll('[data-card-text] span, [data-card-text] b')];
      const measure = node => {
        const style = getComputedStyle(node), box = node.getBoundingClientRect(), font = parseFloat(style.fontSize), line = parseFloat(style.lineHeight);
        const scale = box.height / line;
        const context = document.createElement('canvas').getContext('2d'); context.font = `${style.fontWeight} ${font}px ${style.fontFamily}`;
        const m = context.measureText(node.textContent);
        const baseline = box.y + ((line - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent) * scale;
        return { text: node.textContent, ratio: font * scale / typeWidth, left: (box.x - m.actualBoundingBoxLeft * scale - rect.x) / rect.width, top: (baseline - m.actualBoundingBoxAscent * scale - rect.y) / rect.height, bottom: (rect.bottom - baseline - m.actualBoundingBoxDescent * scale) / rect.height };
      };
      const number = frame.querySelector('[class*="_rc-num_"], [class*="s26-number_"]');
      const badge = frame.querySelector('[class*="s26-tags_"]')?.getBoundingClientRect();
      return { width: rect.width, height: rect.height, text: nodes.map(measure), ...(number ? { number: measure(number) } : {}), ...(badge ? { badge: { top: (badge.top - rect.top) / rect.height, bottom: (rect.bottom - badge.bottom) / rect.height } } : {}) };
    };
    return s;
  }, base);
  const measurements = [];
  for (const template of ['classic', 'season2627']) for (const kind of ['small', 'big', 'key']) {
    state.anim.template = template;
    await renderer.evaluate(state => window.cardRenderer.init(state, 'en'), state);
    await renderer.evaluate(kind => window.cardRenderer.show(0, kind), kind);
    const original = await renderer.evaluate(kind => window.measureCardType(kind), kind);
    const expected = kind === 'small' ? [.157] : [.083, .153];
    original.text.forEach((text, index) => assert.ok(Math.abs(text.ratio - expected[index]) < .002, `${template}/${kind}: ${JSON.stringify(original)}`));
    if (kind === 'small') {
      assert.ok(Math.abs(original.text[0].bottom - .05) < .006, `${template}: small name bottom`);
    } else {
      const [first, last] = original.text;
      if (template === 'classic') assert.ok(Math.abs(last.bottom - .03) < .006, `${template}/${kind}: surname bottom`);
      else {
        assert.ok(last.bottom > 1 - original.badge.top, 'Name must sit above the reserved badge row');
        assert.ok(Math.abs(original.badge.bottom - .03) < .002, 'Badge row must stay at the global bottom inset');
      }
      const gap = last.top - (1 - first.bottom);
      assert.ok(Math.abs(gap - .011) < .006, `${template}/${kind}: visible name gap ${gap}`);
      assert.ok(Math.abs(original.number.ratio - .479) < .002, `${template}/${kind}: number size`);
      assert.ok(Math.abs(original.number.top - .03) < .015, `${template}/${kind}: number top`);
    }
    await renderer.screenshot({ path: `${output}/${template}-${kind}.png` });
    await renderer.evaluate(() => window.cardRenderer.place(1200, 0, 0));
    const enlarged = await renderer.evaluate(kind => window.measureCardType(kind), kind);
    enlarged.text.forEach((text, index) => assert.ok(Math.abs(text.ratio - expected[index]) < .002));
    measurements.push({ template, kind, original, enlarged });
  }
  // Live pitch cards use their own width at every global card-size setting.
  const live = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await live.goto(base + '?render-export'); await live.waitForFunction(() => !!window.exportRenderer);
  for (const template of ['classic', 'season2627']) for (const size of [70, 100, 150]) {
    state.anim.template = template; state.look.smallSize = size;
    const ratios = await live.evaluate(async state => {
      const total = await window.exportRenderer.init(state, 'en', null);
      await window.exportRenderer.frame(total);
      const slot = document.querySelector('[data-i="0"]');
      const frame = slot.querySelector('[class*="_sm-por_"]');
      const name = frame.querySelector('[data-card-text] b');
      const number = slot.querySelector('[class*="_sm-num_"] b');
      return [parseFloat(getComputedStyle(name).fontSize) / frame.offsetWidth, parseFloat(getComputedStyle(number).fontSize) / frame.offsetWidth];
    }, state);
    assert.ok(Math.abs(ratios[0] - .157) < .003, `${template}/${size}: live name ratio ${ratios}`);
    assert.ok(Math.abs(ratios[1] - .857) < .015, `${template}/${size}: live number ratio ${ratios}`);
  }
  // The small-card name bar grows upward while keeping its width, bottom edge and text centre.
  const smallNameLayouts = [];
  for (const template of ['classic', 'season2627']) for (const cutout of [false, true]) for (const name of ['Dias', 'Alexander-\nArnold', '鲁本·迪亚斯']) {
    let originalFrame, previousHeight = 0;
    for (const size of [30, 100, 250]) {
      const smallState = structuredClone(state);
      smallState.anim.template = template;
      Object.assign(smallState.players[0], { nameLine2: name, nameSizeSmall: size, cut: cutout });
      await renderer.evaluate(state => window.cardRenderer.init(state, 'zh-Hans'), smallState);
      await renderer.evaluate(() => window.cardRenderer.show(0, 'small'));
      const layout = await renderer.evaluate(() => {
        const frame = document.querySelector('[class*="_sm-por_"]').getBoundingClientRect();
        const photo = document.querySelector('[class*="_sm-por_"] [class*="_ph_"]').getBoundingClientRect();
        const bar = document.querySelector('[class*="_nm_"]').getBoundingClientRect();
        const text = document.querySelector('[class*="_nm_"] b').getBoundingClientRect();
        return {
          frameWidth: frame.width, frameHeight: frame.height, height: bar.height,
          width: bar.width / frame.width, left: (bar.left - frame.left) / frame.width,
          bottom: (bar.bottom - frame.bottom) / frame.width,
          photoOverlap: (photo.bottom - bar.top) / frame.width,
          centerX: (text.left + text.width / 2 - bar.left - bar.width / 2) / frame.width,
          centerY: (text.top + text.height / 2 - bar.top - bar.height / 2) / frame.width,
        };
      });
      const context = `${template}/${cutout ? 'cut-out' : 'opaque'}/${JSON.stringify(name)}/${size}: ${JSON.stringify(layout)}`;
      originalFrame ??= [layout.frameWidth, layout.frameHeight];
      assert.deepEqual([layout.frameWidth, layout.frameHeight], originalFrame, `Changing the small name size must preserve the card frame: ${context}`);
      assert.ok(Math.abs(layout.width - 1) < .001 && Math.abs(layout.left) < .001, `The name bar must match the card width: ${context}`);
      assert.ok(Math.abs(layout.bottom) < .001, `The name bar bottom must stay anchored: ${context}`);
      assert.ok(layout.photoOverlap >= -.001, `The photo and name bar must meet without a transparent gap: ${context}`);
      assert.ok(Math.abs(layout.centerX) < .001 && Math.abs(layout.centerY) < .001, `The text must remain centred in the name bar: ${context}`);
      assert.ok(layout.height > previousHeight, `The name bar must grow with the selected font size: ${context}`);
      previousHeight = layout.height;
      smallNameLayouts.push({ template, cutout, name, size, ...layout });
      if (template === 'classic' && !cutout && name === 'Dias') await renderer.screenshot({ path: `${output}/small-name-size-${size}.png` });
    }
  }
  // Long and localized names keep the card frame fixed even at maximum text size.
  for (const template of ['classic', 'season2627']) for (const kind of ['small', 'big']) {
    state.anim.template = template;
    const widths = [];
    for (const name of ['Dias', 'Alexander-\nArnold', '鲁本·迪亚斯']) {
      state.players[0].nameLine2 = name; state.players[0].nameSize2 = 250; state.players[0].nameSizeSmall = 250;
      await renderer.evaluate(state => window.cardRenderer.init(state, 'zh-Hans'), state);
      const bounds = await renderer.evaluate(kind => window.cardRenderer.show(0, kind), kind);
      widths.push([bounds.frameWidth, bounds.frameHeight]);
    }
    widths.forEach(width => assert.deepEqual(width, widths[0]));
  }
  await writeFile(`${output}/measurements.json`, JSON.stringify({ measurements, smallNameLayouts }, null, 2));
  console.log('Card typography: legacy migration, independent controls, 30–250% persistence, both templates/Highlight, resolution scaling and stable frames for long/CJK names passed.');
  console.log(JSON.stringify(measurements.filter(item => item.kind !== 'key').map(item => ({ template: item.template, kind: item.kind, text: item.original.text }))));
} finally { await browser.close(); }
