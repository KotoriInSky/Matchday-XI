import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';

export function validCards(payload) {
  return [1024, 2048, 4096].includes(payload.size) && Array.isArray(payload.cards) && payload.cards.length > 0 && payload.cards.length <= 33
    && Array.isArray(payload.state?.players)
    && payload.cards.every(card => card && Number.isInteger(card.index) && card.index >= 0 && card.index < Math.min(11, payload.state.players.length) && ['small', 'big', 'key'].includes(card.kind))
    && new Set(payload.cards.map(card => `${card.index}:${card.kind}`)).size === payload.cards.length;
}

export async function renderCards(page, job, payload) {
  await page.waitForFunction(() => !!window.cardRenderer);
  await page.evaluate(({ state, lang }) => window.cardRenderer.init(state, lang), payload);
  const files = Object.create(null);
  job.outputs = [];
  job.status = 'rendering';
  for (const [position, card] of payload.cards.entries()) {
    if (job.cancelled) return;
    const bounds = await page.evaluate(({ index, kind }) => window.cardRenderer.show(index, kind), card);
    const factor = payload.size / Math.max(bounds.width + bounds.padding * 2, bounds.height + bounds.padding * 2);
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
    files[filename] = png;
    job.outputs.push({ filename, width, height });
    job.progress = Math.floor((position + 1) / payload.cards.length * 95);
  }
  if (job.cancelled) return;
  const batch = payload.batch === true || payload.cards.length > 1;
  job.filename = batch ? 'matchday-cards.zip' : Object.keys(files)[0];
  job.mime = batch ? 'application/zip' : 'image/png';
  job.file = join(job.dir, batch ? 'cards.zip' : 'card.png');
  await writeFile(job.file, batch ? zipSync(files, { level: 0 }) : Object.values(files)[0]);
  job.status = 'finishing'; job.progress = 99;
}
