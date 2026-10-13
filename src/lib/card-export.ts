import type { CardKind } from '@/engine/card-artwork';
import type { LineupState } from '@/engine/types';
import { exportEndpoint } from './video-export';
import { browserCards } from './browser-export';

export async function exportCards(options: {
  state: LineupState; lang: string; size: number; cards: { index: number; kind: CardKind }[]; batch: boolean;
  signal: AbortSignal; onProgress(progress: number): void;
}): Promise<{ url: string; filename: string; dimensions?: { width: number; height: number } }> {
  return browserCards(options);
}

export async function exportCardsLocally(options: {
  state: LineupState; lang: string; size: number; cards: { index: number; kind: CardKind }[]; batch: boolean;
  signal: AbortSignal; onProgress(progress: number): void;
}): Promise<{ url: string; filename: string; dimensions?: { width: number; height: number } }> {
  const { signal, onProgress, ...payload } = options;
  let id: string | null = null;
  const cancel = () => { if (id) void fetch(`${exportEndpoint}/${id}`, { method: 'DELETE', keepalive: true }); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const response = await fetch(exportEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'cards', ...payload }) });
    if (!response.ok) throw new Error(response.status === 409 ? 'busy' : 'failed');
    id = (await response.json()).id;
    if (signal.aborted) { cancel(); signal.throwIfAborted(); }
    for (;;) {
      signal.throwIfAborted();
      const response = await fetch(`${exportEndpoint}/${id}`, { signal });
      if (!response.ok) throw new Error('failed');
      const job = await response.json();
      onProgress(job.progress);
      if (job.status === 'complete') return { url: `${exportEndpoint}/${id}/file`, filename: job.filename, dimensions: job.outputs?.length === 1 ? job.outputs[0] : undefined };
      if (job.status === 'failed') throw new Error('failed');
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } finally { signal.removeEventListener('abort', cancel); }
}
