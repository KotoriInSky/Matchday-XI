import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const output = 'test-results/classic-opening';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], evidence = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '?render-export');
  await page.waitForFunction(() => window.exportRenderer);
  await page.evaluate(async base => {
    const [{ SAMPLE }, { normalize }, { planClassicOpening }] = await Promise.all([
      import(base + 'src/engine/constants.ts'), import(base + 'src/engine/state.ts'), import(base + 'src/engine/classic-opening.ts'),
    ]);
    window.openingInit = async (options = {}) => {
      const state = normalize(SAMPLE);
      Object.assign(state.anim, { template: 'classic', style: 'lines', intro: false, manager: true, openingLights: true, ...options.anim });
      Object.assign(state.team, options.team);
      if (options.photo) Object.assign(state.coach, { cut: false, photo: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="700"><rect width="400" height="700" fill="#ff0044"/></svg>') });
      Object.assign(state.bg, { mode: 'image', dim: 0, image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#90b6c2"/><path d="M0 300H1280V720H0Z" fill="#239860"/></svg>'), ...options.bg });
      state.look.crest = options.crest ?? true;
      const total = await window.exportRenderer.init(state, 'en', null);
      return { ...planClassicOpening(state, state.anim.intro ? state.anim.introLen : 0), total };
    };
    window.openingRead = () => {
      const q = name => document.querySelector(`[class*="_${name}_"]`), css = name => getComputedStyle(q(name));
      const box = name => q(name).getBoundingClientRect();
      const panel = box('m-panel'), crest = q('m-crest-y') && box('m-crest-y');
      const bounds = name => { const range = document.createRange(); range.selectNodeContents(q(name)); const r = range.getBoundingClientRect(); return { left: r.left, right: r.right }; };
      const filled = [], outlined = [];
      document.querySelectorAll('[class*="_m-col_"] span').forEach((row, i) => {
        const style = getComputedStyle(row);
        if (Number(style.opacity) > .5) (style.color === 'rgba(0, 0, 0, 0)' ? outlined : filled).push(i);
      });
      if (Number(css('m-solid').opacity) > .5) filled.push(3);
      return { filled, outlined, edge: panel.left, crestX: crest && crest.left + crest.width / 2,
        crestY: crest && crest.top + crest.height / 2, solid: bounds('m-solid'), name: bounds('m-team'),
        solidOpacity: Number(css('m-solid').opacity), nameOpacity: Number(css('m-teamw').opacity),
        sweepOpacity: Number(css('m-sweep').opacity), sweepTransform: css('m-sweep').transform,
        sweepBackgroundPosition: css('m-sweep').backgroundPosition,
        sweepTeamMask: css('m-sweep-team').maskPosition, panelOpacity: Number(css('m-panel').opacity), width: innerWidth };
    };
  }, base);
  assert.deepEqual(await page.evaluate(async base => {
    const { normalize } = await import(base + 'src/engine/state.ts');
    return [{}, { manager: true }, { openingLights: true }, { openingLights: false }, { openingLights: 'true' }]
      .map(anim => normalize({ anim }).anim.openingLights);
  }, base), [false, false, true, false, false], 'New and old projects must opt in explicitly, with strict boolean validation');
  const frame = async time => { await page.evaluate(t => window.exportRenderer.frame(t), time); return page.evaluate(() => window.openingRead()); };
  const phase = (plan, fraction) => plan.rollStart + (plan.rollEnd - plan.rollStart) * fraction;
  const samePixels = async (left, right) => {
    if (left.equals(right)) return true;
    // Chromium may round a composited pixel by one 8-bit level after a seek.
    return page.evaluate(async urls => {
      const pixels = await Promise.all(urls.map(async src => {
        const image = new Image(); image.src = src; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, image.width, image.height).data;
      }));
      return pixels[0].every((value, i) => Math.abs(value - pixels[1][i]) <= 1);
    }, [left, right].map(buffer => 'data:image/png;base64,' + buffer.toString('base64')));
  };

  // The bands appear instantly, then keep their position while colour flows into the panel.
  const flashPlan = await page.evaluate(() => window.openingInit());
  assert.equal((await frame(flashPlan.start - .01)).sweepOpacity, 0);
  const flashStates = [];
  for (let time = flashPlan.start + .01; time < flashPlan.open; time += 1 / 60) {
    const shot = await frame(time);
    assert.equal(shot.sweepTransform, 'none', 'Opening bands must flash in place without translation');
    assert.ok(shot.sweepOpacity > 0, 'The opening must not blink back to uncovered footage during its colour transition');
    if (time < flashPlan.colourReady) assert.equal(shot.sweepOpacity, .94, 'Bands must appear immediately without an entry fade');
    flashStates.push(shot);
  }
  assert.ok(flashStates.some(shot => !['0% 50%', '100% 50%'].includes(shot.sweepTeamMask)), 'Club colours must pass continuously through the fixed bands');
  assert.notEqual(flashStates[0].sweepBackgroundPosition, flashStates.at(-1).sweepBackgroundPosition, 'The colour light must travel inside the stationary pattern');
  for (let i = 1; i < flashStates.length; i++) {
    assert.ok(Math.abs(parseFloat(flashStates[i].sweepTeamMask) - parseFloat(flashStates[i - 1].sweepTeamMask)) < 15, 'The club colour must not hard-cut into place');
    assert.ok(flashStates[i].panelOpacity >= flashStates[i - 1].panelOpacity, 'The underlying panel must build continuously');
  }
  const coloured = await frame(flashPlan.colourReady);
  assert.equal(coloured.sweepTeamMask, '0% 50%');
  assert.ok(coloured.panelOpacity > 0 && coloured.panelOpacity < 1, 'Panel fill must overlap the colour transition');
  const textureMatches = await page.evaluate(() => {
    const pattern = getComputedStyle(document.querySelector('[class*="_m-panel_"] [class*="_stripes-bg_"]')).backgroundImage;
    const overlay = document.querySelector('[class*="_m-sweep-team_"]');
    const panel = document.querySelector('[class*="_m-panel_"]');
    const a = overlay.getBoundingClientRect(), b = panel.getBoundingClientRect();
    return pattern === getComputedStyle(overlay).backgroundImage && Math.abs(a.left - b.left) < .1 && Math.abs(a.width - b.width) < .1;
  });
  assert.ok(textureMatches, 'The colour overlay and closed panel must share their texture and geometry');
  assert.equal((await frame(flashPlan.open)).panelOpacity, 1, 'The panel must be complete when the fixed bands hand over');
  assert.equal((await frame(flashPlan.open + .01)).sweepOpacity, 0);
  assert.equal((await frame(flashPlan.start + .35)).panelOpacity, 0, 'The band gaps must retain the background until club colour has started to arrive');
  const middle = await page.screenshot();
  const team = page.locator('[class*="_m-sweep-team_"]');
  await team.evaluate(el => { el.style.visibility = 'hidden'; });
  const uncoloured = await page.screenshot();
  await team.evaluate(el => { el.style.visibility = ''; el.style.maskImage = 'none'; });
  const fullyColoured = await page.screenshot();
  await team.evaluate(el => { el.style.maskImage = ''; });
  const coverage = await page.evaluate(async urls => {
    const pixels = await Promise.all(urls.map(async src => {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, image.width, image.height);
    }));
    const sums = [0, 0], counts = [0, 0];
    for (let i = 0; i < pixels[0].data.length; i += 4) {
      const x = (i / 4) % pixels[0].width, side = x < pixels[0].width * .25 ? 0 : x > pixels[0].width * .75 ? 1 : -1;
      if (side < 0) continue;
      let delta = 0, full = 0;
      for (let c = 0; c < 3; c++) {
        delta += Math.abs(pixels[0].data[i + c] - pixels[1].data[i + c]);
        full += Math.abs(pixels[2].data[i + c] - pixels[1].data[i + c]);
      }
      if (full > 30) { sums[side] += delta / full; counts[side]++; }
    }
    return sums.map((sum, i) => sum / counts[i]);
  }, [middle, uncoloured, fullyColoured].map(buffer => 'data:image/png;base64,' + buffer.toString('base64')));
  assert.ok(coverage[0] > .95 && coverage[1] < .05, `Club colour must reach the left bands before the right bands: ${coverage}`);
  for (const offset of [.04, .16, .35, .55]) {
    const before = await frame(flashPlan.start + offset); const beforeSeek = await page.screenshot();
    await frame(flashPlan.nameReady); const after = await frame(flashPlan.start + offset);
    const afterSeek = await page.screenshot();
    assert.deepEqual(after, before, 'Backward seeking must restore exact band, colour and panel states');
    const restored = await samePixels(beforeSeek, afterSeek);
    if (!restored) {
      await writeFile(`${output}/flash-seek-before.png`, beforeSeek);
      await writeFile(`${output}/flash-seek-after.png`, afterSeek);
      await writeFile(`${output}/flash-seek.json`, JSON.stringify({ offset, before, after }, null, 2));
    }
    assert.ok(restored, `Backward seeking must restore each colour transition frame (${offset})`);
  }
  evidence.push({ opening: 'instant stationary bands, left-to-right club colour, delayed panel fill, matching texture/geometry, deterministic backward seek', coverage });

  // Opting out removes only the coloured lead-in, with no blank wait before the manager panel.
  const plainPlan = await page.evaluate(() => window.openingInit({ anim: { openingLights: false } }));
  assert.ok(plainPlan.open - plainPlan.start < .2, 'An uncoloured opening must start promptly');
  assert.ok((await frame(plainPlan.start + .08)).panelOpacity > 0);
  for (const time of [plainPlan.start, plainPlan.open, plainPlan.landed, plainPlan.nameReady, plainPlan.handoff])
    assert.equal((await frame(time)).sweepOpacity, 0, 'The coloured bands must stay absent when switched off');
  assert.equal((await frame(plainPlan.nameReady)).nameOpacity, 1, 'The manager and name sequence must still play without the coloured lead-in');

  for (const mgrLen of [4, 6, 10]) {
    const plan = await page.evaluate(mgrLen => window.openingInit({ anim: { mgrLen } }), mgrLen);
    await frame(0);
    assert.equal(await page.locator('[class*="_bg_"]').evaluate(bg => getComputedStyle(bg).opacity), '1', 'An image background must be visible before the opening pass');
    const phases = [];
    for (const fraction of [.05, .15, .25, .35, .45, .55, .65, .75, .85, .95, 1]) phases.push(await frame(phase(plan, fraction)));
    assert.deepEqual(phases.map(p => p.filled), [[0], [1], [2], [3], [4], [5], [6], [0], [1], [2], [3]], 'Filled letters must pass down the column and settle at the centre');
    assert.deepEqual(phases.map(p => p.outlined), [[], [0], [0, 1], [0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6], [0, 2, 3, 4, 5, 6], [0, 1, 3, 4, 5, 6], [0, 1, 2, 4, 5, 6]]);
    let previous;
    for (let step = 0; step <= 12; step++) {
      const shot = await frame(plan.open + (plan.landed - plan.open) * step / 12);
      assert.ok(Math.abs(shot.crestX - shot.edge) < .1, 'Crest must ride the moving panel edge');
      if (previous) assert.ok(shot.edge >= previous.edge - .1 && shot.crestY <= previous.crestY + .1, 'Panel and crest must settle without overshoot');
      previous = shot;
    }
    assert.ok(Math.abs(previous.edge - 1280 * .33) < .1 && Math.abs(previous.crestY - 360) < .1);
    for (let step = 0; step <= 24; step++) {
      const shot = await frame(plan.nameStart + (plan.nameReady - plan.nameStart) * step / 24);
      if (shot.solidOpacity > 0 && shot.solid.left < shot.width) assert.equal(shot.solidOpacity, 1, 'The outgoing abbreviation must stay opaque');
      if (shot.solidOpacity > 0 && shot.nameOpacity > 0 && shot.name.right > shot.edge && shot.solid.left < shot.width)
        assert.ok(shot.name.right <= shot.solid.left + 1, `Name overlaps the abbreviation: ${JSON.stringify(shot)}`);
    }
    assert.ok(plan.nameReady < plan.leave - .5, 'Even the shortest opening needs time to read the full name');
    const seekTime = phase(plan, .46);
    await frame(seekTime); const beforeSeek = await page.screenshot();
    await frame(plan.handoff + .2); await frame(seekTime);
    assert.ok(beforeSeek.equals(await page.screenshot()), 'Backward seeking must restore letter, panel and sweep states exactly');
    const landed = await frame(plan.landed), departing = await frame(plan.leave + .4), arrived = await frame(plan.handoff);
    assert.ok(departing.edge > landed.edge && arrived.edge > departing.edge);
    assert.ok(Math.abs(arrived.crestX - arrived.edge) < .1 && Math.abs(arrived.edge - 1280 * .85) < .1, 'The manager panel must arrive at the sidebar boundary');
    const leavingName = await frame(plan.leave + .15);
    assert.ok(leavingName.nameOpacity > 0 && leavingName.name.left > leavingName.edge, 'The departing title must stay on its moving panel');
    evidence.push({ mgrLen, letterBeats: phases.map(p => p.filled[0]), backwardSeek: true });
  }

  // An opaque portrait is physically uncovered by the drawer, rather than appearing over it.
  let plan = await page.evaluate(() => window.openingInit({ photo: true }));
  await frame(plan.open + .1);
  const clip = { x: 250, y: 120, width: 130, height: 240 };
  const withPhoto = await page.screenshot({ clip });
  await page.locator('[class*="_m-photo_"]').evaluate(photo => { photo.style.visibility = 'hidden'; });
  assert.ok(withPhoto.equals(await page.screenshot({ clip })), 'The closed part of the panel must cover the coach photo');
  await page.locator('[class*="_m-photo_"]').evaluate(photo => { photo.style.visibility = ''; });

  // Verify both the fixed band mask and directional team-colour mask in actual export pixels.
  await frame(plan.start + .35);
  const preview = await page.screenshot();
  const capture = await page.evaluate(async () => (await window.exportRenderer.capture(innerWidth, innerHeight)).toDataURL());
  const pixelError = await page.evaluate(async ({ preview, capture }) => {
    const pixels = await Promise.all([preview, capture].map(async src => {
      const image = new Image(); image.src = src; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = innerWidth; canvas.height = innerHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, innerWidth, innerHeight).data;
    }));
    let sum = 0, count = 0;
    for (let i = 0; i < pixels[0].length; i += 4) for (let c = 0; c < 3; c++) { sum += Math.abs(pixels[0][i + c] - pixels[1][i + c]); count++; }
    return sum / count;
  }, { preview: 'data:image/png;base64,' + preview.toString('base64'), capture });
  assert.ok(pixelError < 3, `Export lost the opening colour mask: mean pixel error ${pixelError}`);
  await writeFile(`${output}/colour-pass.png`, preview);
  await writeFile(`${output}/colour-pass-export.png`, Buffer.from(capture.split(',')[1], 'base64'));
  for (const [name, time] of [['drawer', plan.open + .25], ['centre', plan.rollEnd + .15], ['name', plan.nameReady + .1], ['sidebar', plan.handoff + .3]]) {
    await frame(time); await page.screenshot({ path: `${output}/${name}.png` });
  }

  for (const width of [390, 1920]) for (const name of ['Borussia Mönchengladbach', '台北足球俱樂部']) {
    await page.setViewportSize({ width, height: Math.ceil(width * 9 / 16) });
    plan = await page.evaluate(name => window.openingInit({ team: { name }, anim: { intro: true, introLen: 2 }, crest: false }), name);
    const shot = await frame(plan.nameReady + .2);
    assert.ok(shot.name.right <= width && shot.name.left >= width * .39, 'Localized names must fit the opened panel');
    assert.equal(await page.locator('[class*="_m-crest_"]').count(), 0);
  }
  for (const mode of ['solid', 'gradient', 'stripes']) {
    plan = await page.evaluate(mode => window.openingInit({ bg: { mode, image: null } }), mode);
    assert.ok((await frame(plan.rollEnd + .1)).filled.includes(3), `Opening failed on ${mode}`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  plan = await page.evaluate(() => window.openingInit());
  const reduced = await frame(plan.open + .15);
  assert.equal(reduced.sweepOpacity, 0, 'Reduced motion must remove the sweeping colour pass');
  assert.ok(Math.abs(reduced.edge - reduced.width * .33) < .1 && Math.abs(reduced.crestY - reduced.width * .28125) < .1, 'Reduced motion must remove drawer travel and badge rise');
  assert.deepEqual(reduced.filled, [3]);
  assert.deepEqual(reduced.outlined, [0, 1, 2, 4, 5, 6]);
  for (const time of [plan.nameStart + .2, plan.nameStart + .38, plan.nameReady]) {
    const shot = await frame(time);
    assert.ok(shot.solidOpacity === 0 || shot.nameOpacity === 0, 'Reduced motion must switch names without an overlapping double image');
  }
  await page.evaluate(() => window.openingInit({ anim: { manager: false } }));
  assert.equal(await page.locator('[class*="_mgr_"]').count(), 0, 'Disabling the manager must remove the whole opening');

  const editor = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  editor.on('pageerror', error => errors.push(error.message));
  await editor.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'en'));
  const editorStore = fn => editor.evaluate(async fn => {
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith('/src/lib/store.ts')).name;
    const { store } = await import(url); await store.ready;
    return new Function('store', fn)(store);
  }, fn);
  await editor.goto(base);
  await editor.getByRole('tab', { name: 'Animation', exact: true }).click();
  const toggle = editor.getByRole('switch', { name: 'Coloured opening transition', exact: true });
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  await toggle.click();
  assert.equal(await editorStore('return store.state.anim.openingLights'), true);
  await editorStore('store.undo()');
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  await editorStore('store.redo()');
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  await editorStore('store.replace(JSON.parse(JSON.stringify(store.state)))');
  assert.equal(await editorStore('return store.state.anim.openingLights'), true, 'Project JSON round trips must preserve the switch');
  await editor.waitForTimeout(700);
  await editor.reload();
  await editor.getByRole('tab', { name: 'Animation', exact: true }).click();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true', 'The setting must survive a saved-project reload');
  await editor.getByLabel('Template', { exact: true }).selectOption('season2627');
  assert.equal(await toggle.count(), 0, 'The switch belongs only to the classic template');
  await editor.getByLabel('Template', { exact: true }).selectOption('classic');
  assert.equal(await toggle.getAttribute('aria-checked'), 'true', 'Changing templates must retain the preference');
  await editor.getByRole('switch', { name: 'Manager intro', exact: true }).click();
  assert.equal(await toggle.count(), 0, 'The setting must only appear with its manager scene');
  await editor.getByRole('switch', { name: 'Manager intro', exact: true }).click();
  await toggle.click();
  await editor.waitForTimeout(700);
  await editor.reload();
  assert.equal(await editorStore('return store.state.anim.openingLights'), false, 'An explicit off preference must also survive reload');
  await editor.close();
  assert.deepEqual(errors, []);
  await writeFile(`${output}/checks.json`, JSON.stringify({ evidence, pixelError, errors }, null, 2));
  console.log('Classic opening: optional persisted setting, stationary bands, directional colour/export, delayed panel fill, letter beats, attached crest, drawer reveal, name handoff, durations, localized names, backward seek and reduced motion passed.');
} finally { await browser.close(); }
