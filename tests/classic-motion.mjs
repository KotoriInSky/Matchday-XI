import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const output = 'test-results/classic-motion';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], measurements = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '?render-export');
  await page.waitForFunction(() => !!window.exportRenderer);
  const sample = await page.evaluate(async base => {
    const [{ SAMPLE }, { normalize }] = await Promise.all([
      import(base + 'src/engine/constants.ts'), import(base + 'src/engine/state.ts'),
    ]);
    const state = normalize(SAMPLE);
    Object.assign(state.anim, { template: 'classic', style: 'lines', intro: false, manager: false });
    return state;
  }, base);
  const cases = [
    { formation: '4-3-3', gk: 'top', bigSize: 100, width: 1280 },
    { formation: '4-3-3', gk: 'bottom', bigSize: 100, width: 1280 },
    { formation: '4-2-3-1', gk: 'top', bigSize: 70, width: 390 },
    { formation: '3-4-2-1', gk: 'bottom', bigSize: 140, width: 2560 },
    { formation: '5-4-1', gk: 'top', bigSize: 140, width: 1920 },
    { formation: '4-1-4-1', gk: 'bottom', bigSize: 70, width: 320 },
    { formation: '7-3-0', gk: 'top', bigSize: 100, width: 1280 },
    { formation: '4-3-3', gk: 'top', bigSize: 100, width: 1280, moved: true },
    { formation: '4-3-3', gk: 'top', bigSize: 70, width: 1280 },
    { formation: '4-3-3', gk: 'top', bigSize: 140, width: 1280 },
  ];
  const sizes = new Map();
  for (const [caseIndex, config] of cases.entries()) {
    await page.setViewportSize({ width: config.width, height: Math.ceil(config.width * 9 / 16) });
    const state = structuredClone(sample);
    state.formation = config.formation;
    Object.assign(state.look, { gk: config.gk, bigSize: config.bigSize });
    if (config.moved) state.players.forEach((_, i) => { state.slotPos[i] = { x: 12 + i * 7, y: i % 2 ? 12 : 92 }; });
    const groups = await page.evaluate(async state => {
      await window.exportRenderer.init(state, 'en', null);
      const groups = new Map();
      for (const card of document.querySelectorAll('[class*="_bigc_"]')) {
        const move = card.getAnimations()[0];
        const flip = card.querySelector('[class*="_flip_"]').getAnimations()[0];
        const timing = flip.effect.getTiming(), moveTiming = move.effect.getTiming();
        const frames = flip.effect.getKeyframes();
        const landed = timing.delay + frames.find(frame => frame.transform === 'rotateY(0deg)').offset * timing.duration;
        const leaving = moveTiming.delay + move.effect.getKeyframes().at(-2).offset * moveTiming.duration;
        if (!groups.has(landed)) groups.set(landed, { landed: landed / 1000, leaving: leaving / 1000, ids: [] });
        groups.get(landed).ids.push(card.dataset.i);
      }
      return [...groups.values()];
    }, state);
    assert.ok(groups.length >= 3, 'The test must exercise every formation row');
    let baseSize;
    for (const [groupIndex, group] of groups.entries()) {
      for (const time of [group.landed, group.landed + .4, group.leaving - .1]) {
        await page.evaluate(time => window.exportRenderer.frame(time), time);
        const result = await page.evaluate(ids => {
          const stage = document.querySelector('[class*="_stage_"]').getBoundingClientRect();
          const panel = document.querySelector('[class*="_bpanel_"]').getBoundingClientRect();
          const center = stage.y + stage.height / 2;
          return ids.map(id => {
            const card = document.querySelector(`[class*="_bigc_"][data-i="${id}"]`);
            const bounds = card.getBoundingClientRect();
            return { id, width: bounds.width, height: bounds.height, center: bounds.y + bounds.height / 2, expected: center, opacity: Number(getComputedStyle(card).opacity), left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, stageLeft: stage.left, panelLeft: panel.left, stageTop: stage.top, stageBottom: stage.bottom };
          });
        }, group.ids);
        measurements.push({ config, groupIndex, time, cards: result });
        if (caseIndex === 0 && time === group.landed) await page.screenshot({ path: `${output}/row-${groupIndex}.png` });
        if (config.formation === '4-3-3' && config.width === 1280 && config.bigSize !== 100 && time === group.landed)
          await page.screenshot({ path: `${output}/size-${config.bigSize}-row-${groupIndex}.png` });
        baseSize ??= { width: result[0].width, height: result[0].height };
        for (const card of result) {
          assert.ok(card.opacity > .99, 'The card must be fully visible when measured');
          assert.ok(Math.abs(card.center - card.expected) < .1,
            `Big card ${card.id} must stop at the frame's short-axis center: ${JSON.stringify({ config, time, ...card })}`);
          assert.ok(card.top >= card.stageTop && card.bottom <= card.stageBottom, 'The settled card frame must remain inside the broadcast frame');
          assert.ok(card.left >= card.stageLeft && card.right <= card.panelLeft, 'Expanded cards must stay inside the frame and clear of the sidebar');
          // Compare the goalkeeper and outside cards across rows. Centre cards may be larger.
          const standardSize = result.length !== 2 && (card === result[0] || card === result.at(-1));
          for (const dimension of ['width', 'height']) {
            if (standardSize) assert.ok(Math.abs(card[dimension] - baseSize[dimension]) < .1,
              `Rows must share the same unfolded card size: ${JSON.stringify({ config, groupIndex, id: card.id, dimension, actual: card[dimension], expected: baseSize[dimension] })}`);
            assert.ok(card[dimension] >= baseSize[dimension] - .1 && card[dimension] <= baseSize[dimension] * 1.1 + .1,
              'Within-row emphasis must remain close to the shared card size');
          }
        }
      }
    }
    if (config.formation === '4-3-3' && config.width === 1280 && config.gk === 'top' && !config.moved) sizes.set(config.bigSize, baseSize.width);
    if (sizes.has(70)) assert.ok(sizes.get(70) < sizes.get(100) * .8, 'Reducing the big-card slider must visibly shrink cards');
    if (sizes.has(140)) assert.ok(sizes.get(140) > sizes.get(100) * 1.3, 'Increasing the big-card slider must visibly enlarge cards');
    await page.evaluate(time => window.exportRenderer.frame(time), groups.at(-1).leaving + 1.5);
    assert.ok(await page.locator('[class*="_bigc_"]').evaluateAll(cards => cards.every(card => Number(getComputedStyle(card).opacity) === 0)), 'Big cards must return to the pitch after their reveal');
  }
  const editor = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  editor.on('pageerror', error => errors.push(error.message));
  await editor.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'zh-Hans'));
  await editor.goto(base);
  await editor.evaluate(async base => {
    const resource = path => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith(path)).name;
    const [{ store }, { getStage }] = await Promise.all([import(resource('/src/lib/store.ts')), import(resource('/src/lib/stage-instance.ts'))]);
    await store.ready;
    store.update(state => {
      state.formation = '4-3-3'; state.look.bigSize = 100;
      Object.assign(state.anim, { template: 'classic', style: 'lines', intro: false, manager: false });
    });
    window.sizeStore = store; window.sizeStage = getStage;
    const stage = getStage(); stage.refresh(); stage.pause();
    const flip = stage.stage.querySelector('[class*="_bigc_"] [class*="_flip_"]').getAnimations()[0];
    const timing = flip.effect.getTiming();
    window.sizeTime = (timing.delay + timing.duration * flip.effect.getKeyframes().find(frame => frame.transform === 'rotateY(0deg)').offset) / 1000;
    stage.seek(window.sizeTime);
  }, base);
  await editor.getByRole('tab', { name: '样式', exact: true }).click();
  let previousWidth = await editor.locator('[class*="_bigc_"]').first().evaluate(card => card.getBoundingClientRect().width);
  const slider = editor.getByRole('slider', { name: '大卡大小', exact: true });
  for (const [key, value] of [['Home', 70], ['End', 140]]) {
    await slider.press(key);
    await editor.waitForFunction(({ value, previousWidth }) => {
      const stage = window.sizeStage(); stage.pause(); stage.seek(window.sizeTime);
      const width = stage.stage.querySelector('[class*="_bigc_"]').getBoundingClientRect().width;
      return window.sizeStore.state.look.bigSize === value && Math.abs(width - previousWidth) > 1;
    }, { value, previousWidth });
    const width = await editor.locator('[class*="_bigc_"]').first().evaluate(card => card.getBoundingClientRect().width);
    assert.ok(value === 70 ? width < previousWidth * .8 : width > previousWidth * 1.8, 'The actual size slider must resize the editor preview');
    previousWidth = width;
  }
  await editor.screenshot({ path: `${output}/size-control-desktop.png` });
  await editor.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await slider.inputValue(), '100');
  await editor.getByRole('button', { name: '重做', exact: true }).click();
  assert.equal(await slider.inputValue(), '140');
  await editor.setViewportSize({ width: 390, height: 844 });
  assert.ok(await editor.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await editor.screenshot({ path: `${output}/size-control-mobile.png` });
  // Let the redo finish its debounced save before checking persistence.
  await editor.waitForTimeout(700);
  await editor.waitForFunction(async base => {
    const { readProject } = await import(base + 'src/lib/project-db.ts');
    return (await readProject())?.look.bigSize === 140;
  }, base);
  await editor.reload();
  await editor.waitForFunction(async () => {
    const { store } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith('/src/lib/store.ts')).name);
    await store.ready; return store.state.look.bigSize === 140;
  }, null, { timeout: 5000 });
  await editor.getByRole('tab', { name: '阵容', exact: true }).click();
  await editor.getByRole('tab', { name: '样式', exact: true }).click();
  assert.equal(await editor.getByRole('slider', { name: '大卡大小', exact: true }).inputValue(), '140', 'The chosen size must survive a reload');
  assert.deepEqual(errors, []);
  console.log(`Classic big-card rotation: ${cases.length} configurations, ${measurements.length} frames centered within 0.1px, consistent sizes across rows with within-row emphasis; size slider, undo/redo and return animation passed.`);
} finally {
  await writeFile(`${output}/measurements.json`, JSON.stringify({ measurements, errors }, null, 2));
  await browser.close();
}
