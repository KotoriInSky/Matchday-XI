import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { Zip, ZipPassThrough } from 'fflate';

export function validCards(payload) {
  return [1024, 2048, 4096].includes(payload.size) && Array.isArray(payload.cards) && payload.cards.length > 0 && payload.cards.length <= 33
    && Array.isArray(payload.state?.players)
    && payload.cards.every(card => card && Number.isInteger(card.index) && card.index >= 0 && card.index < Math.min(11, payload.state.players.length) && ['small', 'big', 'key'].includes(card.kind))
    && new Set(payload.cards.map(card => `${card.index}:${card.kind}`)).size === payload.cards.length;
}

export async function renderCards(page, job, payload) {
  await page.waitForFunction(() => !!window.cardRenderer);
  await page.evaluate(({ state, lang }) => window.cardRenderer.init(state, lang), payload);
  const batch = payload.batch === true || payload.cards.length > 1;
  job.mime = batch ? 'application/zip' : 'image/png';
  job.file = join(job.dir, batch ? 'cards.zip' : 'card.png');
  const output = await open(job.file, 'w');
  let writes = Promise.resolve(), zipError;
  const write = chunk => {
    writes = writes.then(() => output.writeFile(chunk));
    writes.catch(() => {});
  };
  const zip = batch ? new Zip((error, data) => { if (error) zipError = error; else write(data); }) : null;
  job.outputs = [];
  job.status = 'rendering';
  try {
  for (const [position, card] of payload.cards.entries()) {
    if (job.cancelled) return;
    const bounds = await page.evaluate(({ index, kind }) => window.cardRenderer.show(index, kind), card);
    const factor = payload.size / Math.max(bounds.frameWidth, bounds.frameHeight);
    const width = Math.max(1, Math.round((bounds.width + bounds.padding * 2) * factor));
    const height = Math.max(1, Math.round((bounds.height + bounds.padding * 2) * factor));
    await page.setViewportSize({ width, height });
    await page.evaluate(({ factor, bounds }) => window.cardRenderer.place(600 * factor, (bounds.padding - bounds.x) * factor, (bounds.padding - bounds.y) * factor), { factor, bounds });
    const png = await page.screenshot({ type: 'png', omitBackground: true, animations: 'allow', caret: 'hide' });
    if (job.cancelled) return;
    const player = payload.state.players[card.index];
    const name = String(player.nameLine2 || player.short || player.name || 'player').replace(/[\x00-\x1f<>:"/\\|?*]/g, '-').replace(/\s+/g, '-').slice(0, 70).replace(/[. -]+$/g, '') || 'player';
    const number = String(player.num || '').replace(/[^\w-]/g, '').slice(0, 8);
    const filename = `${String(card.index + 1).padStart(2, '0')}-${number || '0'}-${name}-${card.kind}-${payload.size}.png`;
    job.filename = batch ? 'matchday-cards.zip' : filename;
    if (zip) {
      const entry = new ZipPassThrough(filename); zip.add(entry); entry.push(png, true);
    } else write(png);
    await writes;
    if (zipError) throw zipError;
    job.outputs.push({ filename, width, height });
    job.progress = Math.floor((position + 1) / payload.cards.length * 95);
  }
  if (job.cancelled) return;
  zip?.end(); await writes;
  if (zipError) throw zipError;
  job.status = 'finishing'; job.progress = 99;
  } finally {
    zip?.terminate(); await writes.catch(() => {}); await output.close();
  }
}
