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
  const capturePNG = async () => Buffer.from(await page.evaluate(async () => (await window.exportRenderer.capture(innerWidth, innerHeight)).toDataURL().split(',')[1]), 'base64');
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
    if (caseIndex === 0) {
      await page.evaluate(time => window.exportRenderer.frame(time), groups[0].landed - 1.2);
      const pending = await page.locator('[class*="_slot_"]').evaluateAll(slots => slots.map(slot => {
        const number = slot.querySelector('[class*="_sm-num_"]');
        return {
          face: getComputedStyle(slot.querySelector('[class*="_sm-face_"]')).opacity,
          number: getComputedStyle(number).opacity,
          label: number.textContent.trim(),
          expected: number.querySelector('b').textContent,
        };
      }));
      assert.ok(pending.every(card => card.face === '0' && card.number === '1'), 'Unrevealed players must show the number side');
      assert.ok(pending.every(card => card.label === card.expected), 'Placeholders must contain only the shirt number until the player is revealed');
      await page.screenshot({ path: `${output}/number-placeholders.png` });
      const withNumbers = await capturePNG();
      await page.locator('[class*="_sm-num_"] b').evaluateAll(numbers => numbers.forEach(number => { number.style.visibility = 'hidden'; }));
      assert.ok(!withNumbers.equals(await capturePNG()), 'Browser video capture must render the waiting shirt numbers');
      await page.locator('[class*="_sm-num_"] b').evaluateAll(numbers => numbers.forEach(number => { number.style.visibility = ''; }));
      await writeFile(`${output}/number-placeholders-capture.png`, withNumbers);
      assert.equal(await page.locator('[class*="_wipe_"]').count(), 0, 'Line-by-line reveals must keep the colour transition inside the sidebar');
      const transitions = await page.locator('[class*="_pflash_"]').evaluateAll(flashes => flashes.map(flash => {
        const animation = flash.getAnimations()[0], timing = animation?.effect.getTiming();
        return timing ? { start: timing.delay / 1000, duration: timing.duration / 1000 } : null;
      }));
      assert.equal(transitions.length, await page.locator('[class*="_secw_"]').count(), 'Each new position label needs one sidebar colour transition');
      assert.ok(transitions.every(Boolean), 'Every colour transition must use the shared seekable timeline');
      for (const [index, transition] of transitions.entries()) {
        const time = transition.start + transition.duration * .38;
        await page.evaluate(time => window.exportRenderer.frame(time), time);
        const bounds = await page.locator('[class*="_pflash_"]').nth(index).evaluate(flash => {
          const box = flash.getBoundingClientRect(), panel = flash.parentElement.getBoundingClientRect();
          const crest = document.querySelector('[class*="_pcrest_"]').getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, panelTop: panel.top, panelBottom: panel.bottom, panelLeft: panel.left, background: getComputedStyle(flash).backgroundImage, overflow: getComputedStyle(flash.parentElement).overflow, crest: { x: crest.x, y: crest.y } };
        });
        assert.ok(bounds.bottom > bounds.panelTop && bounds.top < bounds.panelBottom, 'The colour wash must cross the visible sidebar');
        assert.equal(bounds.overflow, 'hidden', 'The sidebar must clip the colour wash to its rounded panel');
        assert.match(bounds.background, /linear-gradient/, 'The sidebar must retain its fixed cyan/violet wash');
        if (index === 1) {
          const paletteIndependence = await page.evaluate(() => {
            const stage = document.querySelector('[class*="_stage_"]');
            const sweeps = [...stage.querySelectorAll('[class*="_pflash_"]')];
            const before = sweeps.map(sweep => getComputedStyle(sweep).backgroundImage);
            const original = stage.getAttribute('style');
            stage.style.setProperty('--c1', '#001f5b');
            stage.style.setProperty('--c2', '#ffffff');
            stage.style.setProperty('--c3', '#ff8800');
            const after = sweeps.map(sweep => getComputedStyle(sweep).backgroundImage);
            stage.setAttribute('style', original);
            return { before, after };
          });
          assert.deepEqual(paletteIndependence.after, paletteIndependence.before, 'Changing the team palette must preserve the fixed cyan/violet wash');
          await page.screenshot({ path: `${output}/colour-transition.png` });
          const withSweep = await capturePNG();
          const pitchClip = { x: 0, y: 0, width: Math.floor(bounds.panelLeft - 1), height: 720 };
          const pitch = await page.screenshot({ clip: pitchClip });
          await page.locator('[class*="_pflash_"]').nth(index).evaluate(flash => { flash.style.visibility = 'hidden'; });
          assert.ok(!withSweep.equals(await capturePNG()), 'Browser video capture must include the sidebar colour wash');
          assert.ok(pitch.equals(await page.screenshot({ clip: pitchClip })), 'The sidebar colour wash must leave all pitch pixels untouched');
          await page.locator('[class*="_pflash_"]').nth(index).evaluate(flash => { flash.style.visibility = ''; });
          await writeFile(`${output}/colour-transition-capture.png`, withSweep);
          await page.evaluate(time => window.exportRenderer.frame(time), time + 2);
          await page.evaluate(time => window.exportRenderer.frame(time), time);
          assert.ok(withSweep.equals(await capturePNG()), 'Seeking backward must restore the exact colour transition frame');
        }
        await page.evaluate(time => window.exportRenderer.frame(time), transition.start + transition.duration + .01);
        assert.ok(await page.locator('[class*="_pflash_"]').nth(index).evaluate(flash => flash.getBoundingClientRect().top >= flash.parentElement.getBoundingClientRect().bottom), 'The wash must clear the panel and restore the team colours after the transition');
        const crest = await page.locator('[class*="_pcrest_"]').evaluate(crest => { const box = crest.getBoundingClientRect(); return { x: box.x, y: box.y }; });
        assert.deepEqual(crest, bounds.crest, 'The crest must stay fixed while the position label and colour wash move');
      }
      // Seeking backward must restore every waiting number and the exact same colour phase.
      await page.evaluate(time => window.exportRenderer.frame(time), groups[0].landed - 1.2);
      assert.ok(await page.locator('[class*="_sm-face_"]').evaluateAll(faces => faces.every(face => getComputedStyle(face).opacity === '0')), 'Seeking backward must restore the unrevealed state');
    }
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
        const revealed = groups.slice(0, groupIndex).flatMap(group => group.ids);
        assert.ok(await page.locator('[class*="_slot_"]').evaluateAll((slots, revealed) => slots.every(slot => {
          const face = getComputedStyle(slot.querySelector('[class*="_sm-face_"]')).opacity;
          const number = getComputedStyle(slot.querySelector('[class*="_sm-num_"]')).opacity;
          return revealed.includes(slot.dataset.i) ? face === '1' && number === '0' : face === '0' && number === '1';
        }), revealed), 'Completed rows must show portraits while all waiting rows keep their shirt numbers');
      }
    }
    if (config.formation === '4-3-3' && config.width === 1280 && config.gk === 'top' && !config.moved) sizes.set(config.bigSize, baseSize.width);
    if (sizes.has(70)) assert.ok(sizes.get(70) < sizes.get(100) * .8, 'Reducing the big-card slider must visibly shrink cards');
    if (sizes.has(140)) assert.ok(sizes.get(140) > sizes.get(100) * 1.3, 'Increasing the big-card slider must visibly enlarge cards');
    await page.evaluate(time => window.exportRenderer.frame(time), groups.at(-1).leaving + 1.5);
    assert.ok(await page.locator('[class*="_bigc_"]').evaluateAll(cards => cards.every(card => Number(getComputedStyle(card).opacity) === 0)), 'Big cards must return to the pitch after their reveal');
    assert.ok(await page.locator('[class*="_sm-face_"]').evaluateAll(faces => faces.every(face => getComputedStyle(face).opacity === '1')), 'The final lineup must show every portrait');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(state => window.exportRenderer.init(state, 'en', null), sample);
  assert.ok(await page.locator('[class*="_wipe_"], [class*="_pflash_"]').evaluateAll(sweeps => sweeps.every(sweep => sweep.getAnimations().length === 0)), 'Reduced motion must suppress the colour sweeps');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
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
  console.log(`Classic motion: number-only placeholders, portrait handoff, fixed cyan/violet sidebar transitions with untouched pitch and stationary crest, deterministic seeking, browser capture and reduced-motion sweeps passed; ${cases.length} configurations, ${measurements.length} frames centered within 0.1px, consistent card sizes, size slider, undo/redo and return animation passed.`);
} finally {
  await writeFile(`${output}/measurements.json`, JSON.stringify({ measurements, errors }, null, 2));
  await browser.close();
}
