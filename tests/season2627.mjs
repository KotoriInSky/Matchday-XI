import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const output = new URL('../test-results/season2627/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const render = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  render.on('pageerror', (e) => errors.push(e.message));
  await render.goto(base + '?render-export');
  await render.waitForFunction(() => !!window.exportRenderer);
  await render.evaluate(async (base) => {
    const [{ normalize, broadcastName }, { SAMPLE, PRESET_FORMATIONS }, { planSeason2627 }, { contrastRatio, textSurfaceColors }, { PALETTES }] = await Promise.all([
      import(base + 'src/engine/state.ts'), import(base + 'src/engine/constants.ts'),
      import(base + 'src/engine/season2627.ts'), import(base + 'src/engine/pattern.ts'),
      import(base + 'src/components/editor/palettes.ts'),
    ]);
    window.testModules = { normalize, SAMPLE, PRESET_FORMATIONS, planSeason2627, contrastRatio, textSurfaceColors, PALETTES };
    if (normalize({ anim: {} }).anim.template !== 'classic') throw new Error('Old projects changed template');
    if (normalize({ anim: { template: 'invalid' } }).anim.template !== 'classic') throw new Error('Invalid template');
    if (!normalize({ players: [{ cutS: false }] }).players.every((p, i) => i || p.cutS === false)) throw new Error('Pitch photo cut lost');
    for (const [input, expected] of [['VAN DE VEN', 'van de Ven'], ['DE JONG', 'de Jong'], ['ALEXANDER-\nARNOLD', 'Alexander-\nArnold'], ['KAKÁ', 'Kaká'], ['McTominay', 'McTominay']]) {
      if (broadcastName(input) !== expected) throw new Error(`Incorrect name: ${input}`);
    }
    window.makeSeason = (overrides = {}) => {
      const state = normalize(SAMPLE);
      Object.assign(state.anim, { template: 'season2627', ...overrides });
      return state;
    };
  }, base);

  // Full scene sequence; include adjacent midfield groups, all rows and crest motion between them.
  const plan = await render.evaluate(async () => {
    const state = window.makeSeason();
    await window.exportRenderer.init(state, 'en', null);
    return window.testModules.planSeason2627(state);
  });
  assert.deepEqual(plan.groups.map((g) => g.role), ['GK', 'DEF', 'MID', 'MID', 'FWD']);
  for (const time of [0, plan.manager.start + 1, plan.manager.end, plan.manager.end + .4, plan.manager.end + .85, plan.final.start, plan.final.start + .5, plan.final.ready, plan.total]) {
    await render.evaluate((t) => window.exportRenderer.frame(t), time);
    const delta = await render.evaluate(() => {
      const crest = document.querySelector('[class*="s26-crest-y"]');
      const panel = document.querySelector('[class*="s26-panel_"]');
      const cr = crest.getBoundingClientRect(), pr = panel.getBoundingClientRect();
      return Math.abs(cr.x + cr.width / 2 - pr.x);
    });
    assert.ok(delta < .1, `Crest not centered at ${time}: ${delta}px`);
    const maskDelta = await render.evaluate(() => {
      const panel = document.querySelector('[class*="s26-panel_"]').getBoundingClientRect();
      const reveal = document.querySelector('[class*="s26-pitch-reveal"]');
      const inset = getComputedStyle(reveal).clipPath.match(/([\d.]+)%\)/)[1];
      return Math.abs(Number(inset) * innerWidth / 100 - panel.left);
    });
    assert.ok(maskDelta < .1, `Pitch mask not attached to panel at ${time}: ${maskDelta}px`);
  }
  for (const [name, time] of [['manager', plan.manager.start + 3], ['defenders', plan.groups[1].settled + .5], ['midfield', plan.groups[3].settled + .5], ['highlight', plan.groups[3].cut + .6], ['final', plan.total]]) {
    await render.evaluate((t) => window.exportRenderer.frame(t), time);
    await render.screenshot({ path: `${output}/${name}.png` });
  }

  // The highlight cut changes all artwork on exactly the same frame and reverses on backward seek.
  const cut = await render.evaluate(async () => {
    const state = window.makeSeason();
    const p = state.players[8];
    p.photo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="500"><rect width="300" height="500" fill="#ff0000"/></svg>');
    p.photoK = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="500"><rect width="300" height="500" fill="#0000ff"/></svg>');
    await window.exportRenderer.init(state, 'en', null);
    const plan = window.testModules.planSeason2627(state);
    window.cutGroup = plan.groups.find((g) => g.items.some((item) => item.i === 8));
    return window.cutGroup.cut;
  });
  const sampleCut = async (time) => {
    await render.evaluate((t) => window.exportRenderer.frame(t), time);
    return render.evaluate(() => {
      const column = document.querySelector('[data-player="8"]');
      const get = (name, property) => getComputedStyle(column.querySelector(`[class*="${name}"]`))[property];
      const name = column.querySelector('[class*="s26-name_"]').getBoundingClientRect();
      return { metal: get('s26-metal_', 'opacity'), regular: get('s26-photo_', 'opacity'), key: get('s26-key-photo_', 'opacity'), text: get('s26-name_', 'color'), x: name.x, y: name.y };
    });
  };
  const before = await sampleCut(cut - 1 / 60);
  const after = await sampleCut(cut);
  assert.equal(before.metal, '0'); assert.equal(before.regular, '1'); assert.equal(before.key, '0');
  assert.equal(after.metal, '1'); assert.equal(after.regular, '0'); assert.equal(after.key, '1');
  assert.equal(before.x, after.x); assert.equal(before.y, after.y);
  assert.notEqual(before.text, after.text);
  assert.deepEqual(await sampleCut(cut - 1 / 60), before);
  assert.deepEqual(await sampleCut(cut + .5), { ...after });

  // Highlight stays readable after its reflection finishes, even at the shortest group setting.
  const highlightTiming = [];
  for (const per of [.4, 1, 3]) {
    const timing = await render.evaluate(async (per) => {
      const state = window.makeSeason({ per, manager: false });
      const plan = window.testModules.planSeason2627(state);
      const group = plan.groups.find((group) => group.items.some((item) => state.players[item.i].key));
      const ordinaryHolds = plan.groups.filter((candidate) => candidate !== group).map((candidate) => candidate.leave - candidate.settled);
      await window.exportRenderer.init(state, 'en', null);
      await window.exportRenderer.frame(group.leave - 1 / 30);
      const column = document.querySelector('[data-player="8"]');
      return {
        per, hold: group.leave - group.cut, before: group.cut - group.settled,
        totalHold: group.leave - group.settled, ordinaryHolds,
        metal: getComputedStyle(column.querySelector('[class*="s26-metal_"]')).opacity,
        group: getComputedStyle(column.closest('[data-group]')).opacity,
      };
    }, per);
    assert.ok(timing.hold >= 3.5 - 1e-8, 'Highlight disappears before a readable hold');
    assert.ok(timing.before > timing.totalHold / 2, 'Highlight cut moved into the first half');
    assert.ok(timing.ordinaryHolds.every((hold) => Math.abs(hold - Math.max(1.6, per * 4)) < 1e-8));
    assert.equal(timing.metal, '1'); assert.equal(timing.group, '1');
    highlightTiming.push(timing);
  }

  const formations = await render.evaluate(() => [...window.testModules.PRESET_FORMATIONS, '1-2-7']);
  const counts = new Set();
  for (const formation of formations) {
    const groups = await render.evaluate(async (formation) => {
      const state = window.makeSeason({ manager: false }); state.formation = formation;
      await window.exportRenderer.init(state, 'en', null);
      return window.testModules.planSeason2627(state).groups;
    }, formation);
    for (const group of groups) {
      counts.add(group.items.length);
      await render.evaluate((t) => window.exportRenderer.frame(t), group.settled + .3);
      const active = await render.evaluate(() => [...document.querySelectorAll('[data-group]')].filter((el) => getComputedStyle(el).visibility === 'visible').map((el) => el.querySelectorAll('[data-player]').length));
      assert.deepEqual(active, [group.items.length], `${formation}: wrong active group`);
    }
  }
  assert.deepEqual([...counts].sort(), [1, 2, 3, 4, 5, 6, 7]);

  const palettes = await render.evaluate(async () => {
    const { PALETTES, contrastRatio } = window.testModules;
    const ids = [];
    for (const palette of PALETTES) {
      const state = window.makeSeason(); Object.assign(state.colors, palette.colors);
      await window.exportRenderer.init(state, 'en', null);
      const plan = window.testModules.planSeason2627(state);
      await window.exportRenderer.frame(plan.groups[3].cut + .1);
      const root = document.querySelector('[class*="s26_"]');
      const css = getComputedStyle(root);
      const ratio = contrastRatio(css.getPropertyValue('--s26-background').trim(), css.getPropertyValue('--s26-background-ink').trim());
      if (ratio < 4.5) throw new Error(`${palette.id}: low contrast ${ratio}`);
      const titleInk = css.getPropertyValue('--s26-panel-ink').trim();
      if (contrastRatio(titleInk, '#f4f5f6') < 4.5) throw new Error(`${palette.id}: unreadable side label`);
      ids.push(palette.id);
    }
    return ids;
  });

  await render.evaluate(async () => {
    const { contrastRatio } = window.testModules;
    for (const color of ['#ffffff', '#101820', '#ec1d25', '#75aadb']) {
      const state = window.makeSeason(); state.colorOverrides.name = color;
      await window.exportRenderer.init(state, 'en', null);
      const column = document.querySelector('[data-player="8"]'), css = getComputedStyle(column);
      for (const variable of ['--s26-name-bg', '--s26-key-name-bg', '--s26-key-name-light', '--s26-key-name-dark']) {
        if (contrastRatio(color, css.getPropertyValue(variable).trim()) < 4.5) throw new Error(`Custom name colour lost contrast: ${color}`);
      }
    }
  });

  for (const manager of [false, true]) for (const intro of [false, true]) for (const style of ['off', 'lines']) {
    const duration = await render.evaluate(async ({ manager, intro, style }) => {
      const state = window.makeSeason({ manager, intro, style });
      const total = await window.exportRenderer.init(state, 'en', null);
      await window.exportRenderer.frame(total);
      return total;
    }, { manager, intro, style });
    assert.ok(duration > 0);
    const cards = await render.evaluate(() => [...document.querySelectorAll('[data-i]')].filter((el) => getComputedStyle(el).visibility === 'visible').length);
    assert.equal(cards, 11);
  }

  // Export sizes all retain the same geometry. No screen capture APIs are involved.
  for (const height of [720, 1080, 1440, 2160]) {
    await render.setViewportSize({ width: height * 16 / 9, height });
    await render.evaluate(async () => {
      const state = window.makeSeason(); await window.exportRenderer.init(state, 'en', null);
      await window.exportRenderer.frame(window.testModules.planSeason2627(state).total);
    });
    assert.equal(await render.evaluate(() => document.getElementById('root').getBoundingClientRect().height), height);
  }

  const ui = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  ui.on('pageerror', (e) => errors.push(e.message));
  await ui.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'zh-Hans'));
  await ui.goto(base);
  await ui.getByRole('tab', { name: '动画', exact: true }).click();
  await ui.getByLabel('模板', { exact: true }).selectOption('season2627');
  await ui.waitForTimeout(250);
  assert.equal(await ui.getByLabel('球员登场方式', { exact: true }).locator('option').count(), 2);
  await ui.screenshot({ path: `${output}/desktop.png` });
  await ui.waitForTimeout(550);
  await ui.reload();
  await ui.getByRole('tab', { name: '动画', exact: true }).click();
  assert.equal(await ui.getByLabel('模板', { exact: true }).inputValue(), 'season2627');
  const sceneSelect = ui.getByLabel('场景', { exact: true });
  const secondMidfield = await sceneSelect.locator('option').evaluateAll((options) => options.find((option) => option.textContent.includes('中场 · 2')).value);
  await sceneSelect.selectOption(secondMidfield);
  const seekTime = await ui.evaluate(async () => {
    const { getStage } = await import(performance.getEntriesByType('resource').find((e) => new URL(e.name).pathname.endsWith('/src/lib/stage-instance.ts')).name);
    return getStage().getSnapshot().t;
  });
  assert.ok(seekTime > plan.groups[3].start);
  await ui.getByRole('tab', { name: '阵容', exact: true }).click();
  await ui.locator('.player-index-row').nth(8).click();
  for (const variant of ['大卡', 'Highlight', '小卡']) await ui.getByRole('button', { name: variant, exact: true }).click();
  await ui.getByRole('button', { name: '大卡', exact: true }).click();
  await ui.screenshot({ path: `${output}/inspector.png` });
  await ui.keyboard.press('Escape');
  await ui.setViewportSize({ width: 390, height: 844 });
  await ui.getByRole('tab', { name: '动画', exact: true }).click();
  assert.ok(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ui.evaluate(() => scrollTo(0, 0));
  await ui.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  await ui.emulateMedia({ reducedMotion: 'reduce' });
  await ui.evaluate(async () => {
    const { getStage } = await import(performance.getEntriesByType('resource').find((e) => new URL(e.name).pathname.endsWith('/src/lib/stage-instance.ts')).name);
    getStage().refresh(); getStage().seek(7);
  });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/checks.json`, JSON.stringify({ formations, palettes, counts: [...counts].sort(), crest: 'centered during all panel transitions', cut: { time: cut, before, after }, highlightTiming, exportSizes: [720, 1080, 1440, 2160], errors }, null, 2));
  console.log('26/27: all formations, 1–7 columns, crest, hard cut, backward seek, scene toggles, export sizes, persistence and responsive editor passed.');
} finally { await browser.close(); }
