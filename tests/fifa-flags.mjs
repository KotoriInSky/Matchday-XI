import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const members = JSON.parse(await readFile('src/data/fifa-members.json', 'utf8'));
const manifest = JSON.parse(await readFile('public/flags/manifest.json', 'utf8'));
assert.equal(members.length, 211);
assert.equal(new Set(members.map(m => m.code)).size, 211);
assert.equal(manifest.assets.length, 211);
assert.equal((await readdir('public/flags/fifa')).length, 211);
assert.ok(!members.some(m => ['GBR', 'UK', 'IOC', 'AIN'].includes(m.code)), 'Scope remains FIFA membership');
for (const code of ['ENG', 'SCO', 'WAL', 'NIR', 'TPE', 'HKG', 'MAC', 'KOS', 'CUW']) assert.ok(members.some(m => m.code === code));
for (const asset of manifest.assets) {
  const svg = await readFile('public/flags/' + asset.file, 'utf8');
  assert.equal(createHash('sha256').update(svg).digest('hex'), asset.sha256, asset.code);
  assert.doesNotMatch(svg, /<script|<foreignObject|(?:href|src)=["']https?:/i, 'Flags must render without external resources');
  assert.match(svg, asset.license === 'MIT' ? /Copyright \(c\) 2013 Panayiotis Lipiridis[\s\S]*Permission is hereby granted/ : /Pixeltoo[\s\S]*public domain/);
}

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
await mkdir('test-results/fifa-flags', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], remoteRequests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== new URL(base).origin) remoteRequests.push(r.url()); });
await page.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'zh-Hans'));
const attach = () => page.evaluate(async () => {
  window.fifaStore = (await import(performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith('/src/lib/store.ts')).name)).store;
  window.fifaLibrary = await import(performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith('/src/lib/fifa.ts')).name);
  await window.fifaStore.ready;
});
const tab = name => page.getByRole('tab', { name, exact: true }).click();
const dialog = page.getByRole('dialog');
try {
  await page.goto(base); await attach(); await tab('标签');
  assert.equal(await page.locator('.fifa-library').count(), 0, 'The empty search must not expand the catalog');
  const cases = await page.evaluate(() => Object.fromEntries([
    '拉脱维亚', '拉脫維亞', 'Latvia', 'LVA', 'LAT', 'INA', 'IDN',
    'Republic of Korea', 'United States of America', "People’s Republic of China", 'Côte d’Ivoire',
    'GBR', 'TPE', 'LIB', 'LBN', 'SIN', 'SGP', 'MGO', '不存在的协会',
    'china', 'CHINA', ' china ', 'CHN', 'Chinese Taipei',
  ].map(q => [q, window.fifaLibrary.searchFifaMembers(q).map(m => m.code)])));
  for (const q of ['拉脱维亚', '拉脫維亞', 'Latvia', 'LVA', 'LAT']) assert.deepEqual(cases[q], ['LVA']);
  for (const q of ['INA', 'IDN']) assert.deepEqual(cases[q], ['IDN']);
  assert.deepEqual(cases['Republic of Korea'], ['KOR']);
  assert.deepEqual(cases['United States of America'], ['USA']);
  assert.deepEqual(cases['People’s Republic of China'], ['CHN']);
  for (const q of ['china', 'CHINA', ' china ']) assert.deepEqual(cases[q].sort(), ['CHN', 'HKG', 'MAC', 'TPE']);
  assert.deepEqual(cases.CHN, ['CHN']);
  assert.deepEqual(cases['Chinese Taipei'], ['TPE']);
  assert.deepEqual(cases['Côte d’Ivoire'], ['CIV']);
  assert.deepEqual(cases.GBR.sort(), ['ENG', 'NIR', 'SCO', 'WAL']);
  for (const q of ['LIB', 'LBN']) assert.deepEqual(cases[q], ['LBN']);
  for (const q of ['SIN', 'SGP']) assert.deepEqual(cases[q], ['SGP']);
  assert.deepEqual(cases['不存在的协会'], []);

  // Decode every bundled SVG: malformed/empty assets cannot hide behind the count.
  assert.equal(await page.evaluate(async () => {
    const results = await Promise.all(window.fifaLibrary.FIFA_MEMBERS.map(async m => {
      const image = new Image(); image.src = window.fifaLibrary.fifaFlagURL(m); await image.decode();
      return image.naturalWidth > 0 && image.naturalHeight > 0;
    }));
    return results.filter(Boolean).length;
  }), 211);
  const search = page.getByRole('searchbox', { name: '搜索中文名、英语全名、FIFA / IOC 代码', exact: true });
  await search.fill('LAT');
  await page.locator('.fifa-option').filter({ hasText: 'IOC LAT' }).waitFor();
  assert.equal(await page.locator('.fifa-option').count(), 1);
  await page.screenshot({ path: 'test-results/fifa-flags/desktop-search.png' });
  // A failed same-host load must keep the project unchanged and allow retry.
  const unavailable = '**/flags/fifa/LVA.svg';
  const failFetch = route => route.request().resourceType() === 'fetch' ? route.abort() : route.continue();
  await page.route(unavailable, failFetch);
  const countBeforeFailure = await page.evaluate(() => window.fifaStore.state.tags.length);
  await page.locator('.fifa-option').click();
  await page.getByRole('alert').filter({ hasText: '旗帜加载失败' }).waitFor();
  assert.equal(await page.evaluate(() => window.fifaStore.state.tags.length), countBeforeFailure);
  await page.unroute(unavailable, failFetch);
  await page.locator('.fifa-option').click(); await dialog.waitFor(); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.fifaStore.state.tags.filter(t => t.fifaCode === 'LVA').length), 1);
  // Keyboard selection adds to project; selecting again preserves the existing asset/crop.
  await search.fill('TPE');
  const tpe = page.locator('.fifa-option').filter({ hasText: 'FIFA/IOC TPE' });
  await tpe.focus(); await page.keyboard.press('Enter');
  await dialog.waitFor(); await page.keyboard.press('Escape');
  const original = await page.evaluate(() => {
    const tag = window.fifaStore.state.tags.find(t => t.fifaCode === 'TPE');
    window.fifaStore.update(s => s.tags.find(t => t.id === tag.id).fit.x = 7);
    return { id: tag.id, count: window.fifaStore.state.tags.length };
  });
  await tpe.click(); await dialog.waitFor(); await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => {
    const tag = window.fifaStore.state.tags.find(t => t.fifaCode === 'TPE');
    return { id: tag.id, count: window.fifaStore.state.tags.length, crop: tag.fit.x };
  }), { ...original, crop: 7 });
  await search.fill('不存在的协会');
  await page.getByText('未找到匹配的 FIFA 会员协会', { exact: true }).waitFor();
  await search.fill('');
  assert.equal(await page.locator('.fifa-library').count(), 0, 'Clearing the search collapses results');
  await page.screenshot({ path: 'test-results/fifa-flags/desktop-library.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await search.fill('中国');
  assert.ok(await page.locator('.fifa-option').count() > 0);
  await page.getByRole('heading', { name: 'FIFA 会员协会', exact: true }).evaluate(el => el.scrollIntoView({ block: 'start' }));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow on mobile');
  await page.screenshot({ path: 'test-results/fifa-flags/mobile-search.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Add+assign is one undo operation, and existing custom tags are left untouched.
  await tab('阵容'); await page.locator('.player-index-row').first().click();
  const picker = dialog.locator('.tag-picker').first();
  await picker.locator('summary').click();
  await picker.getByRole('button', { name: 'FIFA 会员协会', exact: true }).click();
  assert.equal(await picker.locator('.fifa-library').count(), 0, 'Player pickers also wait for search text');
  await picker.getByRole('searchbox').fill('INA');
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => ({ assignment: window.fifaStore.state.players[0].tag1, tags: structuredClone(window.fifaStore.state.tags) }));
  await picker.locator('.fifa-option').click();
  await page.waitForFunction(() => window.fifaStore.state.players[0].tag1 === 'fifa-IDN');
  await dialog.getByRole('button', { name: '撤销', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => ({ assignment: window.fifaStore.state.players[0].tag1, tags: window.fifaStore.state.tags })), before);
  await dialog.getByRole('button', { name: '重做', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fifaStore.state.players[0].tag1), 'fifa-IDN');
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    await window.fifaLibrary.selectFifaFlag(window.fifaLibrary.FIFA_MEMBERS.find(m => m.code === 'TPE'), id => window.fifaStore.update(s => s.players[0].tag1 = id));
    await window.fifaLibrary.selectFifaFlag(window.fifaLibrary.FIFA_MEMBERS.find(m => m.code === 'PER'), id => window.fifaStore.update(s => s.players[0].tag2 = id));
  });
  await page.waitForTimeout(750); await page.reload(); await attach();
  const portable = await page.evaluate(async () => {
    const saved = JSON.stringify(window.fifaStore.state);
    const { normalize } = await import('/matchday-xi/src/engine/state.ts');
    window.fifaStore.replace(normalize(JSON.parse(saved)));
    const tag = window.fifaStore.state.tags.find(t => t.fifaCode === 'TPE');
    const content = await (await fetch(tag.img)).text();
    const image = new Image(); image.src = tag.img; await image.decode();
    return { data: tag.img.startsWith('data:image/svg+xml;base64,'), notice: content.includes('Pixeltoo'), fit: tag.fit.x, assigned: window.fifaStore.state.players[0].tag1, dimensions: [image.naturalWidth,image.naturalHeight] };
  });
  assert.deepEqual(portable, { data: true, notice: true, fit: 7, assigned: original.id, dimensions: [900,600] });

  // Browser card export needs no flag fetch once the portable project is loaded.
  let flagRequests = 0;
  await page.route('**/flags/fifa/**', route => { flagRequests++; return route.abort(); });
  const images = await page.evaluate(async () => {
    const { exportCards } = await import('/matchday-xi/src/lib/card-export.ts');
    const state = structuredClone(window.fifaStore.state);
    const output = [];
    for (const template of ['classic','season2627']) {
      state.anim.template = template;
      for (const withFlags of [true,false]) {
        const snapshot = structuredClone(state);
        if (!withFlags) { snapshot.players[0].tag1 = ''; snapshot.players[0].tag2 = ''; }
        const result = await exportCards({ state: snapshot, lang: 'zh-Hans', size: 1024, cards: [{index:0,kind:'big'}], batch:false, signal:new AbortController().signal, onProgress() {} });
        const bytes = [...new Uint8Array(await (await fetch(result.url)).arrayBuffer())];
        URL.revokeObjectURL(result.url); output.push({template,withFlags,bytes});
      }
    }
    return output;
  });
  for (const template of ['classic','season2627']) {
    const pair = images.filter(i => i.template === template).map(i => Buffer.from(i.bytes));
    assert.equal(pair[0].subarray(1,4).toString(), 'PNG');
    assert.notDeepEqual(pair[0], pair[1], 'Export must visibly include selected flags');
    await writeFile(`test-results/fifa-flags/${template}-card.png`, pair[0]);
  }
  assert.equal(flagRequests, 0, 'Embedded flags must survive loss of the library asset endpoint');
  assert.deepEqual(remoteRequests, []);
  assert.deepEqual(errors, []);
  console.log('FIFA flags: 211 assets + notices, Chinese/English/FIFA/IOC search, keyboard + mobile UI, reuse, atomic undo, backup + reload and both browser card templates passed.');
} finally { await browser.close(); }
