import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pixelDifference } from './pixel-difference.mjs';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const output = 'test-results/playback-pause';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(base);
  const state = await page.evaluate(async base => {
    const [{ Stage }, { SAMPLE }, { normalize }] = await Promise.all([
      import(base + 'src/engine/stage.ts'), import(base + 'src/engine/constants.ts'), import(base + 'src/engine/state.ts'),
    ]);
    const state = normalize(SAMPLE);
    window.pauseState = state;
    Object.assign(state.anim, { template: 'classic', style: 'row', intro: false, manager: false });
    state.bg.mode = 'gradient'; state.players[0].key = true; state.players[0].captain = true;
    const host = document.createElement('div');
    document.documentElement.style.cssText = 'scrollbar-gutter:auto;background:#000';
    document.body.replaceChildren(host); document.body.style.cssText = 'margin:0;overflow:hidden';
    host.style.cssText = 'width:1280px;border-radius:0';
    window.pauseStage = new Stage(host, { getState: () => state, getLang: () => 'en', onEdit() {}, onPlayerClick() {}, onNotice() {} });
    await document.fonts.ready;
    window.pauseStage.pause(); window.pauseStage.seek(2.4);
    return state;
  }, base);
  const animationState = () => page.evaluate(() => window.pauseStage.stage.getAnimations({ subtree: true }).map(animation => ({
    name: animation.animationName || 'timeline', state: animation.playState, time: animation.currentTime, rate: animation.playbackRate,
  })));
  const before = await animationState();
  const pausedImage = await page.screenshot({ path: `${output}/paused-before.png` });
  await page.waitForTimeout(250);
  const after = await animationState();
  await page.screenshot({ path: `${output}/paused-after.png` });
  await writeFile(`${output}/animation-states.json`, JSON.stringify({ before, after }, null, 2));
  assert.ok(before.some(animation => animation.name.includes('beam')), 'The test must exercise the striped background lights');
  assert.ok(before.some(animation => animation.name.includes('tick')), 'The test must exercise the scrolling captain badge');
  assert.ok(before.every(animation => animation.state === 'paused'), `Every visual animation must pause: ${JSON.stringify(before.filter(animation => animation.state !== 'paused'))}`);
  assert.deepEqual(after, before, 'Paused effects must keep the same phase');
  const imageA = await page.screenshot(); await page.waitForTimeout(200); const imageB = await page.screenshot();
  assert.ok((await pixelDifference(page, imageA, imageB)).maxDelta <= 2, 'The whole paused frame must remain visually still');
  await page.evaluate(() => { window.pauseStage.setRate(.5); window.pauseStage.play(); });
  await page.waitForTimeout(150);
  const playing = await animationState();
  assert.ok(playing.every(animation => animation.state === 'running'), 'Resume must restart the lights and the main timeline together');
  assert.ok(playing.every(animation => animation.rate === .5), 'All effects must follow the playback speed');
  await page.evaluate(async () => {
    window.pauseStage.pause();
    await Promise.all(window.pauseStage.stage.getAnimations({ subtree: true }).map(animation => animation.ready));
  });
  const frozen = await animationState();
  await page.waitForTimeout(150);
  assert.ok(frozen.every(animation => animation.state === 'paused'), 'Pausing during playback must freeze every effect');
  assert.deepEqual(await animationState(), frozen, 'Pausing during playback must preserve every effect phase');
  await page.evaluate(() => window.pauseStage.seek(4.2));
  const seeked = await animationState();
  assert.ok(seeked.every(animation => animation.state === 'paused' && animation.time === 4200), 'Seeking must choose the same phase for every effect');
  await page.evaluate(() => window.pauseStage.refresh());
  const refreshed = await animationState();
  assert.ok(refreshed.every(animation => animation.state === 'paused' && animation.time === 4200), 'Editing while paused must preserve the frozen effects');
  const exported = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await exported.goto(base + '?render-export');
  await exported.waitForFunction(() => !!window.exportRenderer);
  await exported.evaluate(async state => { await window.exportRenderer.init(state, 'en', null); await window.exportRenderer.frame(2.4); }, state);
  const exportedImage = await exported.screenshot({ path: `${output}/exported.png` });
  const difference = await pixelDifference(page, pausedImage, exportedImage);
  assert.ok(difference.maxDelta <= 2, `Paused preview and export must show the same effect phase: ${JSON.stringify(difference)}`);
  const lineupTime = await page.evaluate(async base => {
    const { planClassicOpening } = await import(base + 'src/engine/classic-opening.ts');
    Object.assign(window.pauseState.anim, { manager: true, openingLights: true, style: 'lines' });
    window.pauseStage.refresh(); window.pauseStage.setRate(1);
    const time = planClassicOpening(window.pauseState).end + 2;
    window.pauseStage.seek(time);
    return time;
  }, base);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(() => window.pauseStage.play());
    await page.waitForTimeout(320);
    await page.evaluate(async () => {
      window.pauseStage.pause();
      await Promise.all(window.pauseStage.stage.getAnimations({ subtree: true }).map(animation => animation.ready));
    });
    const overlay = await page.locator('[class*="_m-sweep_"]').evaluate(element => ({
      opacity: Number(getComputedStyle(element).opacity),
      times: element.getAnimations().map(animation => animation.currentTime),
    }));
    await page.screenshot({ path: `${output}/lineup-pause-${attempt}.png` });
    assert.equal(overlay.opacity, 0, `Opening stripes must stay hidden after resuming the lineup: ${JSON.stringify(overlay)}`);
    assert.ok(overlay.times.every(time => time >= lineupTime * 1000), 'Finished opening effects must keep the shared playback time');
  }
  await page.evaluate(() => window.pauseStage.destroy());
  console.log('Playback pause: opening stripes stay hidden through repeated resume/pause; CSS effects share the playback clock; paused preview matches export.');
} finally { await browser.close(); }
