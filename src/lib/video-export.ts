import type { LineupState } from '@/engine/types';
import { getStage } from './stage-instance';

export const exportEndpoint = `${import.meta.env.BASE_URL}api/export`;
export async function exportVideo({ state, lang, height, fps, signal, onProgress }: {
  state: LineupState; lang: string; height: number; fps: number; signal: AbortSignal;
  onProgress(progress: number, status: string): void;
}): Promise<string> {
  let id: string | null = null;
  let complete = false;
  let cancellation: Promise<unknown> | undefined;
  const cancel = () => { if (id) cancellation ||= fetch(`${exportEndpoint}/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const source = state.bg.mode === 'video' ? getStage()?.video : null;
    if (state.bg.mode === 'video' && !source) throw new Error('videoMissing');
    let video = source ? await (await fetch(source, { signal })).blob() : null;
    signal.throwIfAborted();
    // Keep this request alive until its job ID is known so cancellation can always clean up the worker.
    const created = await fetch(exportEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, lang, height, fps, videoUpload: !!video }) });
    if (!created.ok) throw new Error(created.status === 409 ? 'busy' : 'unavailable');
    const result = await created.json(); id = result.id;
    if (signal.aborted) { cancel(); signal.throwIfAborted(); }
    if (video) {
      const uploaded = await fetch(`${exportEndpoint}/${id}/video`, { method: 'POST', headers: { 'Content-Type': video.type || 'application/octet-stream' }, body: video, signal });
      if (!uploaded.ok) throw new Error('failed');
      video = null;
    }
    for (;;) {
      signal.throwIfAborted();
      const response = await fetch(`${exportEndpoint}/${id}`, { signal });
      if (!response.ok) throw new Error('failed');
      const job = await response.json();
      onProgress(job.progress, job.status);
      if (job.status === 'complete') { complete = true; return `${exportEndpoint}/${id}/file`; }
      if (job.status === 'failed') throw new Error('failed');
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!complete) { cancel(); await cancellation; }
  }
}
