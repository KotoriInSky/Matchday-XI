import { Stage } from './engine/stage';
import { normalize } from './engine/state';
import { registerFont } from './engine/fonts';
import { createBrowserCapture } from './lib/browser-capture';

declare global {
  interface Window {
    exportRenderer: {
      init(state: unknown, lang: string, video: string | null): Promise<number>;
      frame(time: number, waitForPaint?: boolean): Promise<void>;
      capture(width: number, height: number): Promise<HTMLCanvasElement>;
      captureInto(canvas: HTMLCanvasElement): Promise<void>;
    };
  }
}

export function mountExportRenderer() {
  document.documentElement.style.cssText = 'scrollbar-gutter:auto;background:#000';
  document.body.style.cssText = 'margin:0;overflow:hidden';
  const root = document.getElementById('root')!;
  let stage: Stage;
  let capture: ReturnType<typeof createBrowserCapture>;
  let videoElement: HTMLVideoElement | null;
  window.exportRenderer = {
    async init(input, lang, video) {
      stage?.destroy();
      const state = normalize(input);
      capture = createBrowserCapture(state);
      await Promise.all([registerFont('display', state.customFonts.display), registerFont('body', state.customFonts.body), registerFont('number', state.customFonts.number)]);
      stage = new Stage(root, { getState: () => state, getLang: () => lang, onEdit() {}, onPlayerClick() {}, onNotice() {} });
      if (video) { stage.setVideo(video); stage.refresh(); }
      stage.wrap.style.borderRadius = '0';
      stage.pause();
      // Fonts and decoded assets must be ready before measuring names or taking frames.
      await Promise.all([...document.querySelectorAll('link[rel=stylesheet]')].map((link) =>
        (link as HTMLLinkElement).sheet ? Promise.resolve() : new Promise<void>((resolve) => {
          link.addEventListener('load', () => resolve(), { once: true });
          link.addEventListener('error', () => resolve(), { once: true });
          setTimeout(resolve, 15000);
        })));
      await document.fonts.ready;
      stage.refresh(); stage.pause();
      await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode()));
      const v = videoElement = root.querySelector('video');
      if (v) {
        v.pause();
        if (v.readyState < 2 || v.seeking) await new Promise<void>((resolve, reject) => {
          const events = ['loadeddata', 'canplay', 'seeked'];
          const cleanup = () => { clearTimeout(timer); events.forEach(event => v.removeEventListener(event, ready)); v.removeEventListener('error', failed); };
          const ready = () => { if (v.readyState >= 2 && !v.seeking) { cleanup(); resolve(); } };
          const failed = () => { cleanup(); reject(new Error('Background video could not be decoded')); };
          const timer = setTimeout(() => { cleanup(); reject(new Error('Background video timed out')); }, 30000);
          events.forEach(event => v.addEventListener(event, ready));
          v.addEventListener('error', failed);
          ready();
        });
      }
      return stage.getSnapshot().total;
    },
    async frame(time, waitForPaint = true) {
      stage.seek(time);
      // Stage owns both timeline and CSS animations. Canvas capture reads their
      // computed styles synchronously; native screenshots still wait for paint.
      const video = videoElement;
      video?.pause();
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        const target = time % video.duration;
        if (video.seeking || Math.abs(video.currentTime - target) > .0001) await new Promise<void>((resolve, reject) => {
          const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', ready); video.removeEventListener('error', failed); };
          const ready = () => { cleanup(); resolve(); };
          const failed = () => { cleanup(); reject(new Error('Video seek failed')); };
          const timer = setTimeout(() => { cleanup(); reject(new Error('Video seek timed out')); }, 15000);
          video.addEventListener('seeked', ready, { once: true });
          video.addEventListener('error', failed, { once: true });
          if (Math.abs(video.currentTime - target) > .0001) video.currentTime = target;
        });
      }
      if (waitForPaint) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
    capture(width, height) { return capture(root, width, height); },
    async captureInto(canvas) { await capture(root, canvas.width, canvas.height, canvas); },
  };
}
