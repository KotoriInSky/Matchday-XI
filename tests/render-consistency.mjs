import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pixelDifference } from './pixel-difference.mjs';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const output = 'test-results/render-consistency';
await mkdir(output, { recursive: true });
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=128x72:rate=30:duration=2', '-pix_fmt', 'yuv420p', `${output}/background.mp4`]);
const video = 'data:video/mp4;base64,' + (await readFile(`${output}/background.mp4`)).toString('base64');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: 'ja-JP' });
  await page.goto(base);
  await page.evaluate(async base => {
    const [{ Stage, stageClass }, { SAMPLE }, { normalize }, { cardArtwork }, { settleCardCaption }, { planSeason2627 }, { cjkFor }] = await Promise.all([
      import(base + 'src/engine/stage.ts'), import(base + 'src/engine/constants.ts'), import(base + 'src/engine/state.ts'),
      import(base + 'src/engine/card-artwork.ts'), import(base + 'src/engine/card-still.ts'), import(base + 'src/engine/season2627.ts'), import(base + 'src/engine/fonts.ts'),
    ]);
    if (normalize({ anim: { style: 'single' } }).anim.style !== 'lines') throw Error('Legacy single mode must migrate');
    if (normalize({ anim: { template: 'season2627', style: 'row' } }).anim.style !== 'lines') throw Error('Column mode must normalize on import');
    if (normalize({ anim: { template: 'season2627', style: 'off' } }).anim.style !== 'off') throw Error('Off must remain off');
    if (cjkFor('tc', 'en').tag !== 'zh-TW' || cjkFor('auto', 'en').tag !== 'ja' || cjkFor('auto', 'zh-Hans').tag !== 'zh-CN') throw Error('CJK resolver must respect explicit choices and browser regions');
    document.documentElement.style.cssText = 'scrollbar-gutter:auto;background:#000';
    document.body.style.cssText = 'margin:0;overflow:hidden';
    const host = document.createElement('div'); host.style.width = '1280px';
    const previewHost = document.createElement('div'); previewHost.style.cssText = 'position:absolute;left:1400px;top:0;width:600px;container-type:inline-size';
    document.body.replaceChildren(host, previewHost);
    const state = normalize(SAMPLE);
    Object.assign(state.anim, { template: 'season2627', style: 'lines', intro: false, manager: false }); state.look.upper = true;
    for (const p of state.players) Object.assign(p, { tag1: 'cn', tag2: '', captain: false, nameLine1: 'MiXeD', nameLine2: 'Case' });
    state.players[0].captain = true;
    const q = (root, name) => root.querySelector('.' + CSS.escape(stageClass(name)));
    window.check = {
      state, planSeason2627, host, previewHost, q,
      render() {
        this.stage?.destroy();
        this.stage = new Stage(host, { getState: () => state, getLang: () => 'en', onEdit() {}, onPlayerClick() {}, onNotice() {} });
        this.stage.wrap.style.borderRadius = '0';
        this.stage.pause();
      },
      preview(index, kind) {
        const art = cardArtwork(state, index, kind, 'en'), el = document.createElement('div');
        el.className = art.className; el.lang = art.lang; el.dataset.shape = state.look.shape;
        for (const [key, value] of Object.entries(art.css)) el.style.setProperty(key, String(value));
        el.innerHTML = art.html; previewHost.replaceChildren(el); settleCardCaption(el, state.text.captainLabel); return el;
      },
      measure(root) {
        const rect = root.getBoundingClientRect();
        const relative = name => {
          const el = q(root, name), box = el.getBoundingClientRect(), css = getComputedStyle(el);
          return { x: (box.x - rect.x) / rect.width, y: (box.y - rect.y) / rect.height, w: box.width / rect.width, h: box.height / rect.height,
            background: css.backgroundColor, overflow: css.overflow, font: css.fontFamily, textTransform: css.textTransform };
        };
        return { ratio: rect.width / rect.height, photo: relative('s26-photo'), window: relative('s26-photo-window'), info: relative('s26-info'),
          tags: relative('s26-tags'), name: relative('s26-name'), surface: relative('s26-column-bg').background };
      },
    };
    window.check.render(); await document.fonts.ready; window.check.stage.refresh();
  }, base);
  const close = (a, b, context) => {
    for (const key of Object.keys(a)) {
      if (typeof a[key] === 'object') close(a[key], b[key], `${context}/${key}`);
      else if (typeof a[key] === 'number') assert.ok(Math.abs(a[key] - b[key]) < .006, `${context}/${key}: ${a[key]} vs ${b[key]}`);
      else assert.equal(a[key], b[key], `${context}/${key}`);
    }
  };
  // Typography belongs to the broadcast canvas, regardless of how many players share a scene.
  const typography = await page.evaluate(async () => {
    const a = window.check, values = [];
    a.state.players.forEach(p => { p.nameSize1 = 100; p.nameSize2 = 100; });
    for (const width of [1280, 1920]) for (const formation of ['4-2-3-1', '5-4-1', '6-3-1', '7-2-1']) {
      a.host.style.width = `${width}px`; a.state.formation = formation; a.render(); await document.fonts.ready; a.stage.refresh();
      for (const column of a.stage.stage.querySelectorAll('[data-player]')) {
        const font = name => parseFloat(getComputedStyle(a.q(column, name)).fontSize) / width;
        const name = a.q(column, 's26-name');
        const number = getComputedStyle(a.q(column, 's26-number'));
        values.push({ formation, player: column.dataset.player, number: font('s26-number'), first: parseFloat(getComputedStyle(name.firstElementChild).fontSize) / width, last: parseFloat(getComputedStyle(name.lastElementChild).fontSize) / width,
          left: parseFloat(number.left) / width, top: parseFloat(number.top) / width, baseline: (name.lastElementChild.getBoundingClientRect().bottom - column.getBoundingClientRect().bottom) / width });
      }
    }
    a.host.style.width = '1280px';
    return values;
  });
  for (const text of typography) for (const key of ['number', 'first', 'last', 'left', 'top', 'baseline']) {
    assert.ok(Math.abs(text[key] - typography[0][key]) < .0001, `${text.formation}/${text.player}: ${key} must use one global size (${text[key]} vs ${typography[0][key]})`);
  }
  // A captain's two tags and armband must be independent, simultaneously visible pieces.
  for (const template of ['classic', 'season2627']) {
    const badges = await page.evaluate(template => {
      const a = window.check; a.state.anim.template = template;
      a.state.players[0].tag2 = a.state.tags.find(tag => tag.id !== 'cn' && tag.img).id;
      const root = a.preview(0, 'big'), tags = a.q(root, template === 'classic' ? 'rc-tags' : 's26-tags');
      return { flags: tags.querySelectorAll('img').length, children: tags.children.length, rotating: tags.querySelectorAll('[class*="roll-in_"], [class*="s26-badge-rotor_"]').length };
    }, template);
    assert.equal(badges.flags, 2); assert.equal(badges.children, 3, `${template}: two flags and the armband need separate slots`);
    assert.equal(badges.rotating, 0, 'Captain must never replace a tag');
  }
  await page.evaluate(() => { const a = window.check; a.state.anim.template = 'season2627'; a.state.players[0].tag2 = ''; });
  // Both tags, only the second tag, missing tags and the independent captain must compose without overlap.
  for (const template of ['classic', 'season2627']) {
    const cases = await page.evaluate(async template => {
      const a = window.check, p = a.state.players[0], second = a.state.tags.find(tag => tag.id !== 'cn' && tag.img).id;
      a.state.anim.template = template;
      const results = [];
      for (const smallSize of [70, 100, 150]) for (const tagSize of [100, 175, 300]) {
        a.state.look.smallSize = smallSize; a.state.look.tagSize = tagSize;
        for (const tags of [['', ''], ['cn', ''], ['', second], ['cn', second], ['missing', second]]) for (const captain of [false, true]) {
          [p.tag1, p.tag2] = tags; p.captain = captain;
          for (const kind of ['small', 'big']) {
            const root = a.preview(0, kind), container = a.q(root, kind === 'small' ? 'small-preview' : template === 'classic' ? 'rc-tags' : 's26-tags');
            const badges = kind === 'small'
              ? [...root.querySelectorAll('[class*="_tpic_"], [data-small-captain]')]
              : container ? [...container.children] : [];
            const boxes = badges.map(el => el.getBoundingClientRect());
            let overlap = false;
            for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
              const x = Math.min(boxes[i].right, boxes[j].right) - Math.max(boxes[i].left, boxes[j].left);
              const y = Math.min(boxes[i].bottom, boxes[j].bottom) - Math.max(boxes[i].top, boxes[j].top);
              if (x > .5 && y > .5) overlap = true;
            }
            const expected = tags.filter(id => a.state.tags.some(tag => tag.id === id && tag.img)).length + Number(captain);
            results.push({ smallSize, tagSize, tags, captain, kind, count: badges.length, expected, overlap });
          }
        }
      }
      return results;
    }, template);
    for (const item of cases) {
      assert.equal(item.count, item.expected, `${template}: missing/extra badge ${JSON.stringify(item)}`);
      assert.equal(item.overlap, false, `${template}: badges overlap ${JSON.stringify(item)}`);
    }
  }
  await page.evaluate(() => {
    const a = window.check; a.state.anim.template = 'season2627'; a.state.players[0].tag1 = 'cn'; a.state.players[0].tag2 = ''; a.state.players[0].captain = true;
    a.state.look.smallSize = 100; a.state.look.tagSize = 175;
  });
  const wrapped = await page.evaluate(async () => {
    const a = window.check, p = a.state.players[1], results = [];
    a.state.players[0].captain = false; p.captain = true; p.tag1 = 'cn'; p.tag2 = a.state.tags.find(tag => tag.id !== 'cn' && tag.img).id;
    for (const tagSize of [100, 175, 300]) {
      a.state.look.tagSize = tagSize; a.render(); await document.fonts.ready; a.stage.refresh();
      const group = a.planSeason2627(a.state).groups.find(g => g.items.some(it => it.i === 1)); a.stage.seek(group.settled + .5);
      const column = a.stage.stage.querySelector('[data-player="1"]'), tags = a.q(column, 's26-tags'), frame = column.getBoundingClientRect();
      const boxes = [...tags.children].map(el => el.getBoundingClientRect());
      const preview = a.preview(1, 'big');
      results.push({ tagSize, inside: boxes.every(box => box.left >= frame.left - .1 && box.right <= frame.right + .1 && box.bottom <= frame.bottom + .1),
        rows: new Set(boxes.map(box => Math.round(box.top))).size, live: a.measure(column), edit: a.measure(a.q(preview, 's26-preview-column')) });
    }
    p.captain = false; p.tag1 = 'cn'; p.tag2 = ''; a.state.players[0].captain = true; a.state.look.tagSize = 175;
    a.render();
    return results;
  });
  for (const item of wrapped) { assert.ok(item.inside, `Narrow-column badges must stay inside: ${item.tagSize}`); close(item.live, item.edit, `wrapped/${item.tagSize}`); }
  assert.ok(wrapped.at(-1).rows > 1, 'Large badges must wrap instead of overflowing narrow columns');
  // Every player, including the goalkeeper, uses the actual group aspect, crop and bottom badge row.
  for (const formation of ['4-2-3-1', '7-2-1']) {
    const comparisons = await page.evaluate(async formation => {
      const a = window.check; a.state.formation = formation; a.render(); await document.fonts.ready; a.stage.refresh();
      const plan = a.planSeason2627(a.state), result = [];
      for (const group of plan.groups) for (const item of group.items) {
        a.stage.seek(group.settled + .5);
        const column = a.stage.stage.querySelector(`[data-player="${item.i}"]`), preview = a.preview(item.i, 'big');
        const first = a.q(column, 's26-name').firstElementChild;
        if (getComputedStyle(first).textTransform !== 'uppercase') throw Error('Uppercase switch ignored');
        if (a.stage.stage.lang !== preview.lang) throw Error('Stage/inspector CJK fallback differs');
        const live = a.measure(column), edit = a.measure(a.q(preview, 's26-preview-column'));
        if (Math.abs(live.tags.y + live.tags.h - .97) > .002) throw Error('Badges must stay 3% above the bottom');
        if (live.name.y + live.name.h > live.tags.y) throw Error('Name overlaps the bottom badges');
        result.push({ index: item.i, live, edit });
      }
      return result;
    }, formation);
    comparisons.forEach(item => close(item.live, item.edit, `${formation}/${item.index}`));
  }
  const small = await page.evaluate(() => {
    const a = window.check; a.stage.seek(a.stage.getSnapshot().total);
    const live = a.stage.stage.querySelector('[data-i="0"]'), preview = a.preview(0, 'small');
    const measure = root => {
      const frame = a.q(root, 'sm-por').getBoundingClientRect(), badge = root.querySelector('[data-small-captain]').getBoundingClientRect();
      return { width: badge.width / frame.width, height: badge.height / frame.width, shadow: getComputedStyle(a.q(root, 's26-small-captain')).boxShadow.split('rgb').length };
    };
    return [measure(live), measure(preview)];
  });
  close(small[0], small[1], 'small-captain');
  // Independent armbands match tag height and retain a rectangular face beside square flags.
  for (const template of ['classic', 'season2627']) for (const square of [false, true]) {
    const badges = await page.evaluate(({ template, square }) => {
      const a = window.check; a.state.anim.template = template;
      a.state.text.captainLabel = 'Captain · Capitán · 隊長';
      a.state.tags.find(tag => tag.id === 'cn').shape = square ? 'square' : 'rect';
      return ['small', 'big'].map(kind => {
        const root = a.preview(0, kind), band = a.q(root, 'armband');
        const flag = a.q(root, template === 'season2627' && kind !== 'small' ? 's26-tag' : 'tpic');
        const css = getComputedStyle(band);
        return { kind, width: band.offsetWidth, height: band.offsetHeight, flagWidth: flag.offsetWidth, flagHeight: flag.offsetHeight,
          color: css.color, bands: css.backgroundImage, radius: css.borderRadius, fit: band.firstElementChild ? band.firstElementChild.scrollWidth <= band.firstElementChild.clientWidth + 1 : true };
      });
    }, { template, square });
    for (const badge of badges) {
      assert.equal(badge.height, badge.flagHeight, `${template}/${badge.kind}: flag and armband height`);
      if (badge.kind === 'big') assert.ok(Math.abs(badge.width / badge.height - 1.5) < .06, `${template}: independent armband aspect`);
      assert.ok(badge.bands.includes(badge.color) && badge.bands.includes('14%') && badge.bands.includes('86%'), 'Both bands must use the caption colour');
      assert.equal(badge.radius, '0px'); assert.ok(badge.fit, 'Still caption must fit without clipping');
    }
  }

  // The card renderer and the editor use the same still caption and artwork, for both templates.
  const cards = await browser.newPage({ viewport: { width: 600, height: 636 }, locale: 'ja-JP' });
  await cards.goto(base + '?render-cards'); await cards.waitForFunction(() => window.cardRenderer);
  await page.setViewportSize({ width: 600, height: 636 });
  for (const template of ['classic', 'season2627']) for (const kind of ['small', 'big', 'key']) {
    const state = await page.evaluate(async ({ template, kind }) => {
      const a = window.check; a.state.anim.template = template;
      a.state.text.captainLabel = 'Captain'; a.previewHost.style.left = '0'; a.host.style.display = 'none';
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
      a.preview(0, kind); await document.fonts.ready;
      return a.state;
    }, { template, kind });
    await cards.evaluate(async ({ state, kind }) => { await window.cardRenderer.init(state, 'en'); await window.cardRenderer.show(0, kind); }, { state, kind });
    const difference = await pixelDifference(page, await page.screenshot({ omitBackground: true, path: `${output}/${template}-${kind}-preview.png` }), await cards.screenshot({ omitBackground: true, path: `${output}/${template}-${kind}-export.png` }));
    assert.ok(difference.maxDelta <= 2, `${template}/${kind}: inspector/PNG diverged: ${JSON.stringify(difference)}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(async video => {
    const a = window.check; a.host.style.display = ''; a.previewHost.style.left = '1400px'; document.documentElement.style.background = '#000';
    Object.assign(a.state.anim, { template: 'classic', style: 'off', loop: false }); a.state.bg.mode = 'video';
    a.render(); a.stage.setVideo(video); a.stage.refresh(); a.stage.seek(1.1);
  }, video);
  await page.waitForFunction(() => { const v = window.check.stage.stage.querySelector('video'); return v.readyState >= 2 && !v.seeking; });
  const readVideo = () => page.evaluate(() => { const a = window.check, v = a.stage.stage.querySelector('video'); return { t: v.currentTime, paused: v.paused, rate: v.playbackRate, stage: a.stage.getSnapshot().t }; });
  const paused = await readVideo(); await page.waitForTimeout(220);
  assert.deepEqual(await readVideo(), paused, 'Paused background must remain still');
  assert.ok(paused.paused && Math.abs(paused.t - 1.1) < .002);
  const reference = await page.screenshot({ path: `${output}/video-preview.png` });
  const exporter = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: 'ja-JP' });
  await exporter.goto(base + '?render-export'); await exporter.waitForFunction(() => window.exportRenderer);
  await exporter.evaluate(async ({ state, video }) => { await window.exportRenderer.init(state, 'en', video); await window.exportRenderer.frame(1.1); }, { state: await page.evaluate(() => window.check.state), video });
  const videoDifference = await pixelDifference(page, reference, await exporter.screenshot({ path: `${output}/video-export.png` }));
  assert.ok(videoDifference.maxDelta <= 2, `Paused video preview/export must match: ${JSON.stringify(videoDifference)}`);
  await page.evaluate(() => { window.check.stage.setRate(.5); window.check.stage.play(); });
  await page.waitForTimeout(350);
  const playing = await readVideo(); assert.equal(playing.rate, .5); assert.equal(playing.paused, false);
  assert.ok(playing.t > 1.2 && Math.abs(playing.t - playing.stage) < .15, `Video must follow stage time: ${JSON.stringify(playing)}`);
  await page.evaluate(() => { window.check.stage.pause(); window.check.stage.seek(5.25); window.check.stage.refresh(); });
  await page.waitForFunction(() => !window.check.stage.stage.querySelector('video').seeking);
  const seeked = await readVideo(); assert.ok(seeked.paused && Math.abs(seeked.t - 1.25) < .002, 'Seek/refresh must preserve the modulo video phase');
  await page.evaluate(() => { const a = window.check; a.stage.seek(a.stage.getSnapshot().total); a.stage.play(); });
  await page.waitForTimeout(120);
  const replay = await readVideo(); assert.ok(replay.t < .3 && replay.stage < .3, 'Replay must restart the video');
  await page.evaluate(() => { const a = window.check; a.state.anim.loop = true; a.stage.seek(a.stage.getSnapshot().total - .05); });
  await page.waitForTimeout(250);
  const looped = await readVideo(); assert.ok(looped.stage < .3 && looped.t < .3 && !looped.paused, 'Loop must restart the stage and video together');
  await page.evaluate(() => { const a = window.check; a.state.anim.loop = false; a.stage.seek(a.stage.getSnapshot().total - .05); });
  await page.waitForTimeout(250);
  assert.ok((await readVideo()).paused, 'Video must stop at the final frame');
  await page.evaluate(() => window.check.stage.destroy());

  const ui = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await ui.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'en'));
  await ui.goto(base); await ui.getByRole('tab', { name: 'Animation', exact: true }).click();
  const template = ui.getByLabel('Template', { exact: true });
  const reveal = ui.getByLabel('Player reveal', { exact: true });
  assert.ok(!(await reveal.locator('option').allTextContents()).some(text => text.includes('One card')));
  await reveal.selectOption('row'); await template.selectOption('season2627');
  assert.equal(await reveal.inputValue(), 'lines');
  assert.ok((await template.locator('option').allTextContents()).includes('Broadcast Columns'));
  assert.ok((await ui.getByRole('slider', { name: 'Group hold', exact: true }).getAttribute('aria-valuetext')).includes('7.8'), 'Timing readout must include the actual Highlight hold');
  await ui.getByRole('tab', { name: 'Club', exact: true }).click();
  assert.ok(await ui.getByText('Side labels', { exact: true }).isVisible());
  await ui.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await ui.setViewportSize({ width: 390, height: 844 });
  await ui.getByRole('tab', { name: 'Animation', exact: true }).click();
  assert.ok(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ui.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  console.log('Render consistency: mode migration, template switching, all column/card geometry and bottom labels, CJK/uppercase, inspector/PNG pixels, video pause/seek/rate/replay and export passed.');
} finally { await browser.close(); }
