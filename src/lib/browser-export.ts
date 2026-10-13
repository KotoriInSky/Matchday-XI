import type { LineupState } from '@/engine/types';
import type { CardKind } from '@/engine/card-artwork';
import { getStage } from './stage-instance';
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
  const remove = () => frame.remove(); signal.addEventListener('abort', remove, { once: true });
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

export function releaseDownload(url: string) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); }
export async function browserVideoSupported(height: number, fps: number) {
  if (!('VideoEncoder' in window) || !isSecureContext) return false;
  const { canEncodeVideo } = await import('mediabunny');
  return canEncodeVideo('avc', { width: height * 16 / 9, height, frameRate: fps }).catch(() => false);
}

export async function browserCards(options: { state: LineupState; lang: string; size: number; cards: { index: number; kind: CardKind }[]; batch: boolean; signal: AbortSignal; onProgress(value: number): void }) {
  if (occupied) throw new Error('busy'); occupied = true;
  let view: Awaited<ReturnType<typeof renderer>> | undefined;
  try {
    const { size, cards, state, signal } = options;
    if (![1024, 2048, 4096].includes(size) || !cards.length || cards.length > 33) throw new Error('settings');
    view = await renderer('cards', signal);
    const api = view.win.cardRenderer; await abortable(api.init(state, options.lang), signal);
    const files: Record<string, Uint8Array> = {}; let dimensions = { width: 0, height: 0 };
    for (const [i, card] of cards.entries()) {
      signal.throwIfAborted();
      const bounds = await abortable(api.show(card.index, card.kind), signal);
      const factor = size / Math.max(bounds.width + bounds.padding * 2, bounds.height + bounds.padding * 2);
      const width = Math.round((bounds.width + bounds.padding * 2) * factor), height = Math.round((bounds.height + bounds.padding * 2) * factor);
      view.frame.style.width = `${width}px`; view.frame.style.height = `${height}px`;
      await abortable(api.place(600 * factor, (bounds.padding - bounds.x) * factor, (bounds.padding - bounds.y) * factor), signal);
      const canvas = await abortable(api.capture(width, height), signal); signal.throwIfAborted();
      const blob = await abortable(new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('png')), 'image/png')), signal);
      canvas.width = canvas.height = 0;
      const player = state.players[card.index];
      const name = (player.nameLine2 || player.short || player.name || 'player').replace(/[\x00-\x1f<>:"/\\|?*]/g, '-').replace(/\s+/g, '-').slice(0, 70);
      const filename = `${String(card.index + 1).padStart(2, '0')}-${player.num.replace(/[^\w-]/g, '') || '0'}-${name}-${card.kind}-${size}.png`;
      files[filename] = new Uint8Array(await blob.arrayBuffer()); dimensions = { width, height };
      options.onProgress(Math.round((i + 1) / cards.length * 95));
    }
    signal.throwIfAborted();
    const batch = options.batch || cards.length > 1;
    const bytes = batch ? (await import('fflate')).zipSync(files, { level: 0 }) : Object.values(files)[0];
    signal.throwIfAborted(); options.onProgress(100);
    return { url: URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: batch ? 'application/zip' : 'image/png' })), filename: batch ? 'matchday-cards.zip' : Object.keys(files)[0], dimensions: cards.length === 1 ? dimensions : undefined };
  } finally { view?.close(); occupied = false; }
}

export async function browserVideo(options: { state: LineupState; lang: string; height: number; fps: number; signal: AbortSignal; onProgress(value: number, status: string): void }) {
  if (occupied) throw new Error('busy'); occupied = true;
  let view: Awaited<ReturnType<typeof renderer>> | undefined;
  let output: import('mediabunny').Output | undefined;
  try {
    const { state, height, fps, signal } = options, width = height * 16 / 9;
    signal.throwIfAborted();
    if (!await browserVideoSupported(height, fps)) throw new Error('unsupported');
    const video = state.bg.mode === 'video' ? getStage()?.video : null;
    if (state.bg.mode === 'video' && !video) throw new Error('videoMissing');
    view = await renderer('export', signal, width, height);
    const api = view.win.exportRenderer;
    const duration = await abortable(api.init(state, options.lang, video || null), signal);
    if (!(duration > 0 && duration < 600)) throw new Error('duration');
    const { Output, Mp4OutputFormat, BufferTarget, CanvasSource } = await import('mediabunny');
    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat(), target });
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false })!;
    const source = new CanvasSource(canvas, { codec: 'avc', bitrate: Math.round(width * height * fps * .16) });
    output.addVideoTrack(source, { frameRate: fps }); await abortable(output.start(), signal);
    const frames = Math.ceil(duration * fps);
    for (let i = 0; i < frames; i++) {
      signal.throwIfAborted(); await abortable(api.frame(i / fps), signal);
      const rendered = await abortable(api.capture(width, height), signal); signal.throwIfAborted();
      context.drawImage(rendered, 0, 0); rendered.width = rendered.height = 0;
      await abortable(source.add(i / fps, 1 / fps, { keyFrame: i % (fps * 2) === 0 }), signal);
      options.onProgress(Math.floor((i + 1) / frames * 99), 'rendering');
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    signal.throwIfAborted(); options.onProgress(99, 'encoding');
    await abortable(output.finalize(), signal); signal.throwIfAborted();
    return URL.createObjectURL(new Blob([target.buffer!], { type: 'video/mp4' }));
  } finally {
    try { if (output && !['finalized', 'canceled'].includes(output.state)) await output.cancel(); }
    finally { view?.close(); occupied = false; }
  }
}
