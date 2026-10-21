import type { LineupState } from '@/engine/types';
import { getStage } from './stage-instance';
import { adoptExportBlob, adoptExportFile } from './export-file';

// Browser video export in its own tab. Chromium keeps memory for every
// foreignObject SVG image it decodes until the renderer process exits; a tab
// opened with noopener gets its own process, and closing it after the export
// returns all of that memory. The editor receives the finished MP4 from OPFS.

type ToTab =
  | { type: 'job'; state: LineupState; lang: string; height: number; fps: number; video: Blob | null }
  | { type: 'cancel' }
  | { type: 'release' };
type FromTab =
  | { type: 'ready' }
  | { type: 'progress'; value: number; status: string }
  | { type: 'done'; name: string }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; message: string };

const channelName = (id: string) => `matchday-xi-export-tab:${id}`;
const lifeLock = (id: string) => `matchday-xi-export-tab-life:${id}`;
const READY_TIMEOUT = 10000;

export const exportTabSupported = () => 'BroadcastChannel' in window && !!navigator.locks && isSecureContext;

/**
 * Opens the export tab. Call synchronously from the click that starts the
 * export, before any await, so the browser allows the new tab.
 */
export function openExportTab() {
  const id = crypto.randomUUID();
  const channel = new BroadcastChannel(channelName(id));
  window.open(`${import.meta.env.BASE_URL}?export-video=${id}`, '_blank', 'noopener');
  return { id, channel };
}

/**
 * Runs a browser video export in the tab from `openExportTab`. Rejects with
 * Error('tab') when the tab did not start (e.g. a blocked pop-up), so the
 * caller can export in this page instead.
 */
export async function browserVideoInTab({ tab, state, lang, height, fps, signal, onProgress }: {
  tab: ReturnType<typeof openExportTab>; state: LineupState; lang: string; height: number; fps: number; signal: AbortSignal;
  onProgress(value: number, status: string): void;
}): Promise<string> {
  const { id, channel } = tab;
  const send = (message: ToTab) => channel.postMessage(message);
  let cleanup = () => {};
  try {
    const messages = new Promise<string>((resolve, reject) => {
      // After 'done' the tab closes as soon as it lets go of the file.
      let started = false, finished = false;
      const timer = setTimeout(() => { if (!started) reject(new Error('tab')); }, READY_TIMEOUT);
      const abort = () => { send({ type: 'cancel' }); reject(signal.reason); };
      signal.addEventListener('abort', abort, { once: true });
      const gone = new AbortController();
      cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); gone.abort(); };
      channel.onmessage = async ({ data }: MessageEvent<FromTab>) => {
        if (data.type === 'ready' && !started) {
          started = true; clearTimeout(timer);
          // The tab holds this lock from before 'ready' until it closes, so
          // obtaining it means the tab was closed or crashed.
          void navigator.locks.request(lifeLock(id), { signal: gone.signal }, () => { if (!finished) reject(new Error('failed')); }).catch(() => {});
          if (signal.aborted) { abort(); return; }
          const source = state.bg.mode === 'video' ? getStage()?.video : null;
          // A blob: URL resolves to the same Blob without copying its bytes.
          const video = source ? await (await fetch(source)).blob().catch(() => null) : null;
          if (state.bg.mode === 'video' && !video) { send({ type: 'cancel' }); reject(new Error('videoMissing')); return; }
          send({ type: 'job', state, lang, height, fps, video });
        } else if (data.type === 'progress') onProgress(data.value, data.status);
        else if (data.type === 'error') reject(data.message === 'cancelled' ? new DOMException('Export cancelled', 'AbortError') : new Error(data.message));
        else if (data.type === 'done') {
          finished = true;
          try {
            resolve('name' in data
              ? await adoptExportFile(data.name, 'video/mp4', () => send({ type: 'release' }))
              : (send({ type: 'release' }), adoptExportBlob(data.blob, 'video/mp4')));
          } catch (error) { reject(error); }
        }
      };
    });
    return await messages;
  } finally {
    // Ends a tab still waiting, e.g. after a failed adoption; harmless otherwise.
    send({ type: 'cancel' });
    cleanup(); channel.close();
  }
}

/** The export tab: runs one job sent by the editor, then closes itself. */
export async function mountExportTab(id: string) {
  const root = document.getElementById('root')!;
  document.documentElement.style.cssText = 'background:#0b0d12;color:#e8eaf0;font:16px system-ui,sans-serif';
  root.innerHTML = '<main style="max-width:28rem;margin:20vh auto;padding:0 16px;display:flex;flex-direction:column;gap:12px">'
    + '<h1 style="font-size:1.25rem;margin:0" data-title></h1><p style="margin:0;opacity:.75" data-note></p>'
    + '<progress max="100" value="0" style="width:100%"></progress><span data-status></span>'
    + '<button type="button" style="min-height:44px;font:inherit">Cancel</button></main>';
  const title = root.querySelector<HTMLElement>('[data-title]')!, note = root.querySelector<HTMLElement>('[data-note]')!;
  const bar = root.querySelector('progress')!, status = root.querySelector<HTMLElement>('[data-status]')!, button = root.querySelector('button')!;
  let zh = /^zh/.test(navigator.language);
  const text = (chinese: string, english: string) => zh ? chinese : english;
  const label = () => {
    title.textContent = text('正在导出视频', 'Exporting video');
    note.textContent = text('导出完成后此标签页会自动关闭；请勿关闭。', 'This tab closes by itself when the export is done. Keep it open.');
    button.textContent = text('取消导出', 'Cancel export');
  };
  label();
  const channel = new BroadcastChannel(channelName(id));
  const send = (message: FromTab) => channel.postMessage(message);
  // Held until the tab closes, so the editor notices a closed or crashed tab.
  await new Promise<void>(granted => { void navigator.locks.request(lifeLock(id), () => { granted(); return new Promise<never>(() => {}); }); });
  const controller = new AbortController();
  button.addEventListener('click', () => controller.abort());
  let letGo = () => {};
  // A tab that never receives a job (e.g. a pop-up allowed too late) closes too.
  let idle: ReturnType<typeof setTimeout> | undefined;
  // The running job settles after its cleanup (e.g. removing a cancelled file).
  let job: Promise<unknown> = Promise.resolve();
  const finished = new Promise<void>(resolve => {
    channel.onmessage = async ({ data }: MessageEvent<ToTab>) => {
      if (data.type === 'cancel') { controller.abort(); await job.catch(() => {}); resolve(); }
      else if (data.type === 'release') { letGo(); resolve(); }
      else if (data.type === 'job') {
        clearTimeout(idle);
        zh = data.lang.startsWith('zh'); label();
        const video = data.video ? URL.createObjectURL(data.video) : null;
        try {
          const { browserVideo } = await import('./browser-export');
          const running = job = browserVideo({
            state: data.state, lang: data.lang, height: data.height, fps: data.fps, video, signal: controller.signal, handOff: true,
            onHandOff(release: () => void) { letGo = release; },
            onProgress(value: number, phase: string) {
              bar.value = value; status.textContent = `${value}%`; document.title = `${value}% · ${text('导出视频', 'Export video')}`;
              send({ type: 'progress', value, status: phase });
            },
          });
          send({ type: 'done', ...await running });
        } catch (error) {
          // 'cancelled' also covers the tab's own cancel button.
          send({ type: 'error', message: controller.signal.aborted ? 'cancelled' : error instanceof Error ? error.message : 'failed' });
          resolve();
        } finally { if (video) URL.revokeObjectURL(video); }
      }
    };
  });
  idle = setTimeout(() => { controller.abort(); window.close(); }, 60000);
  send({ type: 'ready' });
  await finished; clearTimeout(idle);
  channel.close();
  window.close();
  // Not script-closable in some browsers: say so instead.
  note.textContent = text('导出已结束，可以关闭此标签页。', 'The export has ended. You can close this tab.');
  button.remove();
}
