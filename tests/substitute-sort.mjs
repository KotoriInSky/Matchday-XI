import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173/matchday-xi/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'en'));
  await page.goto(base);
  const cases = [
    ['12 Keeper (GK)\n20 Silva\n5 Smith\n7 Lee', '12 Keeper (GK)\n5 Smith\n7 Lee\n20 Silva'],
    ['20 A\n12 Keeper (gk)\n3 B\n3 C\nnote\n0 Zero', '0 Zero\n12 Keeper (gk)\n3 B\n3 C\nnote\n20 A'],
    ['10 A\n1 Keeper（GK）\n\n2 B', '2 B\n1 Keeper（GK）\n\n10 A'],
    ['', ''], ['1 Keeper (GK)', '1 Keeper (GK)'],
  ];
  for (const [input, expected] of cases) {
    const actual = await page.evaluate(async ({ base, input }) => (await import(base + 'src/engine/state.ts')).sortSubstitutes(input), { base, input });
    assert.equal(actual, expected);
  }
  await page.evaluate(async () => {
    window.sortStore = (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith('/src/lib/store.ts')).name)).store;
    await window.sortStore.ready;
  });
  const original = await page.evaluate(() => window.sortStore.state.subs);
  await page.getByRole('tab', { name: 'Lineup', exact: true }).click();
  await page.getByRole('button', { name: 'Sort by number', exact: true }).click();
  const sorted = await page.evaluate(() => window.sortStore.state.subs);
  assert.notEqual(sorted, original);
  assert.equal(sorted.split('\n')[0], original.split('\n')[0]);
  assert.deepEqual(sorted.split('\n').slice(1).map(line => Number(line.match(/^\d+/)[0])), [5, 7, 10, 11, 15, 17, 18, 20]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.evaluate(() => window.sortStore.state.subs), original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal(await page.evaluate(() => window.sortStore.state.subs), sorted);
  await page.waitForTimeout(750);
  await page.reload();
  assert.equal(await page.evaluate(async () => { const { store } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith('/src/lib/store.ts')).name); await store.ready; return store.state.subs; }), sorted);
  console.log('Substitute number sorting: numeric order, stable ties, keeper/note/blank positions, undo/redo and reload passed.');
} finally { await browser.close(); }
