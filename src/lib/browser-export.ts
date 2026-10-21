import type { LineupState } from '@/engine/types';
import type { CardKind } from '@/engine/card-artwork';
import { getStage } from './stage-instance';
import { createExportFile, releaseDownload } from './export-file';
import { createZipArchive } from './export-zip';
import type {} from '@/render-cards';
import type {} from '@/render-export';

let occupied = false;
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}
async function renderer(kind: 'cards' | 'export', signal: AbortSignal, width = 1000, height = 1000) {
  signal.throwIfAborted();
  const frame = document.createElement('iframe');
  frame.title = 'Export renderer'; frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none`;
  const remove = () => { if (kind === 'export') frame.contentWindow?.exportRenderer?.dispose(); frame.remove(); }; signal.addEventListener('abort', remove, { once: true });
  frame.src = `${import.meta.env.BASE_URL}?render-${kind}`; document.body.append(frame);
  try {
    const deadline = Date.now() + 30000;
    while (!(kind === 'cards' ? frame.contentWindow?.cardRenderer : frame.contentWindow?.exportRenderer)) {
      signal.throwIfAborted(); if (Date.now() > deadline) throw new Error('renderer');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return { frame, win: frame.contentWindow!, close() { signal.removeEventListener('abort', remove); remove(); } };
  } catch (error) { signal.removeEventListener('abort', remove); remove(); throw error; }
}

export { releaseDownload } from './export-file';
export async function browserVideoSupported(height: number, fps: number) {
  if (!('VideoEncoder' in window) || !isSecureContext) return false;
  const { canEncodeVideo } = await import('mediabunny');
  return canEncodeVideo('avc', { width: height * 16 / 9, height, frameRate: fps }).catch(() => false);
}

export async function browserCards(options: { state: LineupState; lang: string; size: number; cards: { index: number; kind: CardKind }[]; batch: boolean; signal: AbortSignal; onProgress(value: number, status: string): void }) {
  if (occupied) throw new Error('busy'); occupied = true;
  let view: Awaited<ReturnType<typeof renderer>> | undefined;
  let file: Awaited<ReturnType<typeof createExportFile>> | undefined;
  let archive: Awaited<ReturnType<typeof createZipArchive>> | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    const { size, cards, state, signal } = options;
    if (![1024, 2048, 4096].includes(size) || !cards.length || cards.length > 33) throw new Error('settings');
    options.onProgress(0, 'preparing');
    view = await renderer('cards', signal);
    const api = view.win.cardRenderer; await abortable(api.init(state, options.lang), signal);
    const batch = options.batch || cards.length > 1;
    file = await createExportFile(); signal.throwIfAborted();
    if (batch) archive = await createZipArchive(file.write);
    options.onProgress(0, 'rendering');
    let dimensions = { width: 0, height: 0 }, filename = '';
    for (const [i, card] of cards.entries()) {
      signal.throwIfAborted();
      const bounds = await abortable(api.show(card.index, card.kind), signal);
      // Scale the frame consistently; portraits extend the transparent canvas.
      const factor = size / Math.max(bounds.frameWidth, bounds.frameHeight);
      const width = Math.round((bounds.width + bounds.padding * 2) * factor), height = Math.round((bounds.height + bounds.padding * 2) * factor);
      view.frame.style.width = `${width}px`; view.frame.style.height = `${height}px`;
      await abortable(api.place(600 * factor, (bounds.padding - bounds.x) * factor, (bounds.padding - bounds.y) * factor), signal);
      canvas = await abortable(api.capture(width, height), signal); signal.throwIfAborted();
      const captured = canvas;
      const blob = await abortable(new Promise<Blob>((resolve, reject) => captured.toBlob(b => b ? resolve(b) : reject(new Error('png')), 'image/png')), signal);
      canvas.width = canvas.height = 0;
      const player = state.players[card.index];
      const name = (player.nameLine2 || player.short || player.name || 'player').replace(/[\x00-\x1f<>:"/\\|?*]/g, '-').replace(/\s+/g, '-').slice(0, 70);
      filename = `${String(card.index + 1).padStart(2, '0')}-${player.num.replace(/[^\w-]/g, '') || '0'}-${name}-${card.kind}-${size}.png`;
      if (archive) await archive.add(filename, blob, signal);
      else await file.write(new Uint8Array(await blob.arrayBuffer()));
      dimensions = { width, height };
      options.onProgress(Math.round((i + 1) / cards.length * 95), 'rendering');
    }
    signal.throwIfAborted();
    options.onProgress(95, 'finishing');
    await archive?.finish(); signal.throwIfAborted();
    const url = await file.finish(batch ? 'application/zip' : 'image/png');
    if (signal.aborted) { await releaseDownload(url); signal.throwIfAborted(); }
    options.onProgress(100, 'complete');
    return { url, filename: batch ? 'matchday-cards.zip' : filename, dimensions: cards.length === 1 ? dimensions : undefined };
  } finally {
    archive?.dispose(); await file?.dispose();
    if (canvas) canvas.width = canvas.height = 0;
    view?.close(); occupied = false;
  }
}

// Timers are throttled in background tabs (to once a minute after five minutes);
// a message-channel task is not, so an export tab keeps rendering when hidden.
const yieldTask = () => new Promise<void>(resolve => {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => { port1.close(); resolve(); };
  port2.postMessage(null);
});

type VideoOptions = { state: LineupState; lang: string; height: number; fps: number; signal: AbortSignal; onProgress(value: number, status: string): void;
  /** Background video URL; defaults to the editor stage's. */
  video?: string | null };
type HandOff = {
  /** Return the finished file for another page instead of a download URL. */
  handOff: true;
  /** Receives the function that releases the file's lock to the adopting page. */
  onHandOff(letGo: () => void): void;
};
export function browserVideo(options: VideoOptions): Promise<string>;
export function browserVideo(options: VideoOptions & HandOff): Promise<{ name: string } | { blob: Blob }>;
export async function browserVideo(options: VideoOptions & Partial<HandOff>): Promise<string | { name: string } | { blob: Blob }> {
  if (occupied) throw new Error('busy'); occupied = true;
  let view: Awaited<ReturnType<typeof renderer>> | undefined;
  let output: import('mediabunny').Output | undefined;
  let file: Awaited<ReturnType<typeof createExportFile>> | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    const { state, height, fps, signal } = options, width = height * 16 / 9;
    signal.throwIfAborted();
    options.onProgress(0, 'preparing');
    if (!await browserVideoSupported(height, fps)) throw new Error('unsupported');
    const video = state.bg.mode === 'video' ? options.video !== undefined ? options.video : getStage()?.video : null;
    if (state.bg.mode === 'video' && !video) throw new Error('videoMissing');
    view = await renderer('export', signal, width, height);
    const api = view.win.exportRenderer;
    const duration = await abortable(api.init(state, options.lang, video || null), signal);
    if (!(duration > 0 && duration < 600)) throw new Error('duration');
    const frames = Math.ceil(duration * fps);
    // Decoded frames are encoded off the main thread and prefetched, so both
    // templates use the decoder; unsupported media keeps native capture.
    await abortable(api.prepareVideo(fps, frames), signal);
    const { Output, Mp4OutputFormat, StreamTarget, CanvasSource } = await import('mediabunny');
    file = await createExportFile(); signal.throwIfAborted();
    const target = new StreamTarget(file.stream, { chunked: true, chunkSize: 1024 * 1024 });
    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'reserve' }), target });
    canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    // SVG blending must use a transparent rendering surface, as PNG capture does.
    const source = new CanvasSource(canvas, { codec: 'avc', alpha: 'discard', bitrate: Math.round(width * height * fps * .16) });
    output.addVideoTrack(source, { frameRate: fps, maximumPacketCount: frames }); await abortable(output.start(), signal);
    let yieldedAt = performance.now(), reported = 0;
    options.onProgress(0, 'rendering');
    for (let i = 0; i < frames; i++) {
      signal.throwIfAborted(); await abortable(api.frame(i / fps, false), signal);
      await abortable(api.captureInto(canvas), signal); signal.throwIfAborted();
      await abortable(source.add(i / fps, 1 / fps, { keyFrame: i % (fps * 2) === 0 }), signal);
      const progress = Math.floor((i + 1) / frames * 99);
      if (progress !== reported) { reported = progress; options.onProgress(progress, 'rendering'); }
      if (performance.now() - yieldedAt >= 50) { await yieldTask(); yieldedAt = performance.now(); }
    }
    signal.throwIfAborted(); options.onProgress(99, 'encoding');
    await abortable(output.finalize(), signal); signal.throwIfAborted();
    if (options.handOff) {
      const handed = await file.handOff();
      options.onHandOff?.(() => file?.letGo());
      options.onProgress(100, 'complete');
      return handed;
    }
    const url = await file.finish('video/mp4');
    if (signal.aborted) { await releaseDownload(url); signal.throwIfAborted(); }
    options.onProgress(100, 'complete');
    return url;
  } finally {
    try { if (output && !['finalized', 'canceled'].includes(output.state)) await output.cancel(); }
    finally {
      await file?.dispose();
      if (canvas) canvas.width = canvas.height = 0;
      view?.close(); occupied = false;
    }
  }
}
