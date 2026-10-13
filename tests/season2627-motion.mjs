import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const output = new URL('../test-results/season2627-motion/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], evidence = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '?render-export');
  await page.waitForFunction(() => !!window.exportRenderer);
  await page.evaluate(async (base) => {
    const [{ SAMPLE }, { normalize }, { planSeason2627 }] = await Promise.all([
      import(base + 'src/engine/constants.ts'), import(base + 'src/engine/state.ts'), import(base + 'src/engine/season2627.ts'),
    ]);
    window.motionState = normalize(SAMPLE);
    window.motionState.anim.template = 'season2627';
    window.motionPlan = planSeason2627;
    window.motionInit = async (shape = 'rounded', full = false) => {
      const state = structuredClone(window.motionState);
      state.look.shape = shape;
      // Alpha and opaque geometry fixtures exercise image framing, not photographic artwork.
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="500">' +
        (full ? '<rect width="300" height="500" fill="#385875"/>' : '') +
        '<path d="M40 500V180Q40 140 85 140H215Q260 140 260 180V500Z" fill="#db2733"/><rect x="100" y="15" width="100" height="105" rx="45" fill="#dfb69a"/></svg>';
      const photo = 'data:image/svg+xml,' + encodeURIComponent(svg);
      for (const index of [3, 8]) {
        Object.assign(state.players[index], { photo, photo2: photo, photoK: photo, cut: !full, cutS: !full, cutK: !full });
      }
      await window.exportRenderer.init(state, 'en', null);
      window.plan = window.motionPlan(state);
      return window.plan;
    };
  }, base);

  let plan = await page.evaluate(() => window.motionInit());
  // The filled lettering reveals an outline trail, including the centre, before settling there.
  for (const mgrLen of [4, 6, 10]) {
    plan = await page.evaluate(async (length) => {
      window.motionState.anim.mgrLen = length;
      return window.motionInit();
    }, mgrLen);
    const manager = plan.manager;
    const openingPositions = [];
    for (const time of [manager.start + .05, manager.start + .2, manager.start + .55]) {
      await page.evaluate(time => window.exportRenderer.frame(time), time);
      openingPositions.push(await page.evaluate(() => {
        const panel = document.querySelector('[class*="s26-panel_"]').getBoundingClientRect();
        const crest = document.querySelector('[class*="s26-crest-y_"]').getBoundingClientRect();
        return { x: panel.left, crest: crest.left + crest.width / 2, width: innerWidth };
      }));
    }
    assert.ok(openingPositions[0].x < openingPositions[1].x && openingPositions[1].x < openingPositions[2].x, 'Opening panel must move right as it appears');
    for (const position of openingPositions) assert.ok(Math.abs(position.crest - position.x) < .1, 'Opening crest detached from panel');
    assert.ok(Math.abs(openingPositions[2].x - openingPositions[2].width * .29) < .1, 'Opening panel did not settle at the manager boundary');
    const outlinePositions = [];
    for (const time of [manager.rollStart, manager.rollStart + (manager.rollEnd - manager.rollStart) * .4, manager.rollEnd]) {
      await page.evaluate((time) => window.exportRenderer.frame(time), time);
      const phase = await page.evaluate(() => {
        const solid = document.querySelector('[class*="s26-solid_"]'), gap = document.querySelector('[data-title-row="3"]');
        const name = document.querySelector('[class*="s26-team_"]');
        return { delta: Math.abs(solid.getBoundingClientRect().y - gap.getBoundingClientRect().y), y: solid.getBoundingClientRect().y, outlineY: gap.getBoundingClientRect().y, name: getComputedStyle(name).opacity };
      });
      assert.ok(phase.delta < .1, 'Central lettering moved instead of switching fixed letter states');
      assert.equal(phase.name, '0', 'Full name appeared during the abbreviation roll');
      outlinePositions.push(phase.outlineY);
    }
    assert.ok(outlinePositions.every(y => Math.abs(y - outlinePositions[0]) < .1), 'Outline background moved during the filled abbreviation roll');
    const letterState = async fraction => {
      await page.evaluate(time => window.exportRenderer.frame(time), manager.rollStart + (manager.rollEnd - manager.rollStart) * fraction);
      return page.evaluate(() => {
        const rows = [...document.querySelectorAll('[class*="s26-outline_"] span')];
        const solid = document.querySelector('[class*="s26-solid_"]');
        const visible = row => Number(getComputedStyle(row).opacity) > .5 && getComputedStyle(row).visibility !== 'hidden';
        const filled = rows.flatMap((row, index) => visible(row) && getComputedStyle(row).color !== 'rgba(0, 0, 0, 0)' ? [index] : []);
        const outlined = rows.flatMap((row, index) => visible(row) && getComputedStyle(row).color === 'rgba(0, 0, 0, 0)' ? [index] : []);
        if (Number(getComputedStyle(solid).opacity) > .5) filled.push(3);
        return { filled, outlined, positions: rows.map(row => row.getBoundingClientRect().y), centre: solid.getBoundingClientRect().y };
      });
    };
    const beforeLetters = await letterState(-.02);
    assert.deepEqual(beforeLetters.filled, [], 'Filled letters appeared before the letter sequence');
    assert.deepEqual(beforeLetters.outlined, [], 'Outline placeholders appeared before the filled letters revealed them');
    const phases = [];
    // Native m4s frames: mostly two-frame holds, with a shorter first-pass row and longer final approach.
    const beats = [0, 2, 3, 5, 7, 9, 11, 13, 15, 17, 20].map(frame => frame / 20);
    for (let phase = 0; phase < beats.length - 1; phase++) {
      const span = beats[phase + 1] - beats[phase];
      const held = await letterState(beats[phase] + span * .25);
      assert.equal(held.filled.length, 1, 'Exactly one fixed letter row must be filled');
      assert.deepEqual(await letterState(beats[phase] + span * .75), held, 'Letter states drifted between frame-like changes');
      if (phases.length) {
        assert.deepEqual(held.positions, phases[0].positions, 'Outline letters moved between state changes');
        assert.equal(held.centre, phases[0].centre, 'Centre lettering moved between state changes');
      }
      phases.push(held);
    }
    assert.deepEqual(phases.map(phase => phase.filled[0]), [0, 1, 2, 3, 4, 5, 6, 0, 1, 2], 'Filled letter states must advance down the fixed rows and wrap once');
    assert.deepEqual(phases.map(phase => phase.outlined), [
      [], [0], [0, 1], [0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5, 6], [0, 2, 3, 4, 5, 6], [0, 1, 3, 4, 5, 6],
    ], 'Outline trail must unfold after the filled letters, retaining the centre outline on the second pass');
    const finalLetters = await letterState(1);
    assert.deepEqual(finalLetters.filled, [3], 'Final letter state must hold at the centre');
    assert.deepEqual(finalLetters.outlined, [0, 1, 2, 4, 5, 6], 'Final filled centre did not replace its temporary outline');
    const handoff = [];
    for (let fraction = 0; fraction <= 1; fraction += .05) {
      const time = manager.nameStart + (manager.nameReady - manager.nameStart) * fraction;
      await page.evaluate(time => window.exportRenderer.frame(time), time);
      handoff.push(await page.evaluate(() => {
        const solid = document.querySelector('[class*="s26-solid_"]'), name = document.querySelector('[class*="s26-team_"]');
        const bounds = element => { const range = document.createRange(); range.selectNodeContents(element); const rect = range.getBoundingClientRect(); return { left: rect.left, right: rect.right }; };
        return { solid: bounds(solid), name: bounds(name), solidOpacity: Number(getComputedStyle(solid).opacity), nameOpacity: Number(getComputedStyle(name).opacity), edge: document.querySelector('[class*="s26-panel_"]').getBoundingClientRect().left, width: innerWidth };
      }));
    }
    for (const frame of handoff) {
      if (frame.solidOpacity > 0 && frame.solid.left < frame.width) assert.equal(frame.solidOpacity, 1, 'Abbreviation faded while still on screen');
      if (frame.solidOpacity > 0 && frame.nameOpacity > 0 && frame.name.right > frame.edge && frame.solid.left < frame.width) {
        assert.ok(frame.name.right <= frame.solid.left + 1, 'Full name overlaps the departing abbreviation');
      }
    }
    for (const time of [manager.rollStart + (manager.rollEnd - manager.rollStart) * .45, manager.rollEnd]) {
      await page.evaluate(time => window.exportRenderer.frame(time), time);
      const beforeSeek = await page.screenshot();
      await page.evaluate(time => window.exportRenderer.frame(time), manager.nameReady);
      await page.evaluate(time => window.exportRenderer.frame(time), time);
      assert.ok(beforeSeek.equals(await page.screenshot()), 'Backward seek changed a held letter state');
    }
    await page.evaluate((time) => window.exportRenderer.frame(time), manager.nameReady + .01);
    const namePhase = await page.evaluate(() => ({
      solid: getComputedStyle(document.querySelector('[class*="s26-solid_"]')).opacity,
      name: getComputedStyle(document.querySelector('[class*="s26-team_"]')).opacity,
    }));
    assert.deepEqual(namePhase, { solid: '0', name: '1' });
    evidence.push({ managerLength: mgrLen, title: 'rightward opening, unfolding outline trail, temporary centre outline, final filled centre, opaque slide without overlap, deterministic backward seek' });
  }
  plan = await page.evaluate(async () => { window.motionState.anim.mgrLen = 6; return window.motionInit(); });
  for (const [name, time] of [
    ['title-rolling', plan.manager.rollStart + .45], ['title-settled', plan.manager.rollEnd + .1], ['title-name', plan.manager.nameReady + .1],
    ['entry-early', plan.groups[1].start + .22], ['entry-late', plan.groups[1].start + .56],
    ['settled', plan.groups[1].settled + .1],
    ['key-before', plan.groups[3].cut - 1 / 30], ['key-after', plan.groups[3].cut],
    ['pitch-entry', plan.final.start + .65], ['final-rounded', plan.total],
  ]) {
    await page.evaluate((time) => window.exportRenderer.frame(time), time);
    await page.screenshot({ path: `${output}/${name}.png` });
  }

  // The boundary shadow must change actual pixels on the next card, not hide under its background.
  await page.evaluate((time) => window.exportRenderer.frame(time), plan.groups[3].cut - 1 / 30);
  const seam = await page.evaluate(() => {
    const card = document.querySelector('[data-group="3"] [class*="s26-column-position_"]');
    const rect = card.getBoundingClientRect();
    return { x: Math.ceil(rect.right + 1), y: 100, width: 18, height: 36 };
  });
  const withShadow = await page.screenshot({ clip: seam });
  await page.evaluate(() => { document.querySelector('[data-group="3"] [class*="s26-column-position_"]').style.boxShadow = 'none'; });
  const withoutShadow = await page.screenshot({ clip: seam });
  assert.ok(!withShadow.equals(withoutShadow), 'Adjacent card covered the boundary shadow');
  evidence.push({ adjacentShadow: 'changes rendered pixels on the next card' });
  await page.evaluate(() => { document.querySelector('[data-group="3"] [class*="s26-column-position_"]').style.boxShadow = ''; });

  // A hard cut is followed by local material reflection; reverse seeking restores its exact phase.
  const reflection = async (time) => {
    await page.evaluate((time) => window.exportRenderer.frame(time), time);
    return page.evaluate(() => {
      const column = document.querySelector('[data-player="8"]');
      return {
        position: getComputedStyle(column.querySelector('[class*="s26-reflection_"]')).backgroundPosition,
        metal: getComputedStyle(column.querySelector('[class*="s26-metal_"]')).opacity,
        coat: getComputedStyle(column.querySelector('[class*="s26-key-coat_"]')).opacity,
      };
    });
  };
  const cutSurface = await reflection(plan.groups[3].cut);
  const reflectiveSurface = await reflection(plan.groups[3].cut + .7);
  assert.equal(cutSurface.metal, '1'); assert.equal(cutSurface.coat, '1');
  assert.equal(reflectiveSurface.metal, '1'); assert.notEqual(cutSurface.position, reflectiveSurface.position);
  await page.screenshot({ path: `${output}/key-reflection.png` });
  assert.deepEqual(await reflection(plan.groups[3].cut), cutSurface);
  evidence.push({ reflection: { atCut: cutSurface, afterCut: reflectiveSurface, backwardSeek: 'restores original material phase' } });

  // All entrance movement finishes before the hold, for both normal and Highlight portraits.
  for (const formation of ['4-3-3', '3-5-2', '1-6-3', '1-2-7']) {
    plan = await page.evaluate(async (formation) => {
      window.motionState.formation = formation;
      return window.motionInit();
    }, formation);
    for (const group of plan.groups) {
      await page.evaluate((time) => window.exportRenderer.frame(time), group.settled + 1 / 30);
      const settled = await page.evaluate((gi) => {
        const group = document.querySelector(`[data-group="${gi}"]`);
        return [...group.querySelectorAll('[data-player]')].map((column) => {
          const select = (name) => column.querySelector(`[class*="${name}"]`);
          const normal = getComputedStyle(select('s26-photo_'));
          const key = select('s26-key-photo_');
          const name = getComputedStyle(select('s26-name_'));
          const tags = select('s26-tags_');
          const light = getComputedStyle(select('s26-entry-light_'));
          return { normal: normal.transform, key: key && getComputedStyle(key).transform, name: name.opacity, tags: tags && getComputedStyle(tags).opacity, light: light.opacity };
        });
      }, plan.groups.indexOf(group));
      for (const item of settled) {
        assert.equal(item.normal, 'matrix(1, 0, 0, 1, 0, 0)');
        if (item.key) assert.equal(item.key, item.normal);
        assert.equal(item.name, '1'); if (item.tags) assert.equal(item.tags, '1');
        assert.equal(item.light, '0');
      }
    }
  }
  await page.evaluate(() => { window.motionState.formation = '4-2-3-1'; });

  // Even oversized or repositioned photos must not paint on the surface beyond their own column.
  for (const full of [false, true]) {
    plan = await page.evaluate(async full => {
      const state = structuredClone(window.motionState);
      const photo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#ef2638"/></svg>');
      for (const player of state.players) Object.assign(player, {
        photo, photoK: photo, cut: !full, cutK: !full, key: true,
        fit: { z: 2, x: 40, y: -20 }, fitK: { z: 2, x: 40, y: -20 },
      });
      await window.exportRenderer.init(state, 'en', null);
      return window.motionPlan(state);
    }, full);
    const group = plan.groups[1];
    for (const time of [group.start + .4, group.settled + .1, group.cut + .2]) {
      await page.evaluate(time => window.exportRenderer.frame(time), time);
      const boundary = await page.evaluate(() => {
        // Uncover the extended surface so sidebar occlusion cannot hide an escaping photo.
        document.querySelector('[class*="s26-panel-track_"]').style.setProperty('opacity', '0', 'important');
        const column = document.querySelector('[data-group="1"] [class*="s26-column-position_"]:last-child');
        const rect = column.getBoundingClientRect();
        const surface = column.querySelector('[class*="s26-column-bg_"]').getBoundingClientRect();
        return { x: Math.ceil(rect.right + 1), y: 80, width: 24, height: 48, bleed: surface.right - rect.right, stageWidth: innerWidth };
      });
      assert.ok(boundary.bleed >= boundary.stageWidth * .095, 'Clipping photos removed the surface extension under the sidebar');
      const clip = { x: boundary.x, y: boundary.y, width: boundary.width, height: boundary.height };
      const withPhotos = await page.screenshot({ clip });
      await page.evaluate(() => {
        document.querySelectorAll('[data-group="1"] [class*="s26-column-position_"]:last-child [class*="s26-photo_"]').forEach(photo => { photo.style.visibility = 'hidden'; });
      });
      assert.ok(withPhotos.equals(await page.screenshot({ clip })), `Photo escaped its column (${full ? 'opaque' : 'cut-out'}, ${time})`);
      await page.evaluate(() => {
        document.querySelectorAll('[data-group="1"] [class*="s26-column-position_"]:last-child [class*="s26-photo_"]').forEach(photo => { photo.style.visibility = ''; });
      });
    }
    evidence.push({ photoClipping: full ? 'opaque' : 'cut-out', phases: 'entry, settled, highlight', surfaceBleed: 'retained' });
  }

  for (const shape of ['rounded', 'sharp', 'angled']) {
    plan = await page.evaluate((shape) => window.motionInit(shape), shape);
    await page.evaluate((time) => window.exportRenderer.frame(time), plan.total);
    const shadow = await page.evaluate(() => {
      const slot = document.querySelector('[data-i="3"]');
      const image = slot.querySelector('[data-fit="p:3:fitS"]');
      const flag = slot.querySelector('[class*="s26-small-tags"] img');
      const shadow = slot.querySelector('[class*="s26-card-shadow"] > div');
      return { slot: getComputedStyle(slot).filter, portrait: getComputedStyle(image).filter, flag: getComputedStyle(flag).filter, clip: getComputedStyle(shadow).clipPath, radius: getComputedStyle(shadow).borderRadius };
    });
    assert.equal(shadow.slot, 'none', 'Composite shadow still includes flags and portrait');
    assert.notEqual(shadow.portrait, 'none');
    if (shape === 'angled') assert.match(shadow.clip, /^polygon/);
    await page.screenshot({ path: `${output}/final-${shape}.png` });
    evidence.push({ shape, shadow });
  }

  plan = await page.evaluate(() => window.motionInit('rounded', true));
  await page.evaluate((time) => window.exportRenderer.frame(time), plan.groups[3].cut);
  const opaque = await page.evaluate(() => {
    const column = document.querySelector('[data-player="8"]');
    return {
      photo: getComputedStyle(column.querySelector('[data-fit="p:8:fitK"]')).filter,
      key: getComputedStyle(column.querySelector('[class*="s26-key-photo_"]')).opacity,
      veil: getComputedStyle(column.querySelector('[class*="s26-key-veil_"]')).opacity,
    };
  });
  assert.equal(opaque.photo, 'none'); assert.equal(opaque.key, '1'); assert.equal(opaque.veil, '1');
  await page.screenshot({ path: `${output}/key-opaque.png` });

  // Reduced motion removes the portrait displacement, light pass and small-card turn.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  plan = await page.evaluate(() => window.motionInit());
  await page.evaluate(time => window.exportRenderer.frame(time), plan.manager.start + .2);
  assert.ok(await page.evaluate(() => Math.abs(document.querySelector('[class*="s26-panel_"]').getBoundingClientRect().left - innerWidth * .29) < .1), 'Reduced motion still slides the opening panel');
  assert.ok(await page.evaluate(() =>
    [...document.querySelectorAll('[class*="s26-outline_"] span')].every(row => getComputedStyle(row).color === 'rgba(0, 0, 0, 0)') &&
    getComputedStyle(document.querySelector('[class*="s26-solid_"]')).opacity === '1'
  ), 'Reduced motion still cycles the filled letter rows');
  for (const time of [plan.groups[1].start + .3, plan.final.start + .5]) {
    await page.evaluate((time) => window.exportRenderer.frame(time), time);
    const reduced = await page.evaluate(() => ({
      light: [...document.querySelectorAll('[class*="s26-entry-light_"]')].every((el) => getComputedStyle(el).opacity === '0'),
      turns: [...document.querySelectorAll('[class*="cflip_"]')].every((el) => getComputedStyle(el).transform === 'none'),
    }));
    assert.ok(reduced.light); assert.ok(reduced.turns);
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/checks.json`, JSON.stringify({ evidence, errors }, null, 2));
  console.log('26/27 motion: rightward opening, unfolding outline trail and temporary centre outline, clipped cut-out/opaque portraits, visible adjacent-card shadow, deterministic reflection, 1–7 columns, all card shapes and reduced motion passed.');
} finally { await browser.close(); }
