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
  // Filled and outline abbreviations occupy the same moving row until the full name takes over.
  for (const mgrLen of [4, 6, 10]) {
    plan = await page.evaluate(async (length) => {
      window.motionState.anim.mgrLen = length;
      return window.motionInit();
    }, mgrLen);
    const manager = plan.manager;
    for (const time of [manager.rollStart, manager.rollStart + (manager.rollEnd - manager.rollStart) * .4, manager.rollEnd]) {
      await page.evaluate((time) => window.exportRenderer.frame(time), time);
      const phase = await page.evaluate(() => {
        const solid = document.querySelector('[class*="s26-solid_"]'), gap = document.querySelector('[class*="s26-outline-gap_"]');
        const name = document.querySelector('[class*="s26-team_"]');
        return { delta: Math.abs(solid.getBoundingClientRect().y - gap.getBoundingClientRect().y), name: getComputedStyle(name).opacity };
      });
      assert.ok(phase.delta < .1, 'Filled abbreviation is detached from the scrolling stack');
      assert.equal(phase.name, '0', 'Full name appeared during the abbreviation roll');
    }
    await page.evaluate((time) => window.exportRenderer.frame(time), manager.nameReady + .01);
    const namePhase = await page.evaluate(() => ({
      solid: getComputedStyle(document.querySelector('[class*="s26-solid_"]')).opacity,
      name: getComputedStyle(document.querySelector('[class*="s26-team_"]')).opacity,
    }));
    assert.deepEqual(namePhase, { solid: '0', name: '1' });
    evidence.push({ managerLength: mgrLen, title: 'filled abbreviation follows outline row before full name' });
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
  console.log('26/27 motion: synced title roll, visible adjacent-card shadow, deterministic reflection, 1–7 columns, cut-out/opaque portraits, all card shapes and reduced motion passed.');
} finally { await browser.close(); }
