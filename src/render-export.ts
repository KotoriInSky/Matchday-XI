import { Stage } from './engine/stage';
import { normalize } from './engine/state';
import { registerFont } from './engine/fonts';
import { createBrowserCapture } from './lib/browser-capture';

declare global {
  interface Window {
    exportRenderer: {
      init(state: unknown, lang: string, video: string | null): Promise<number>;
      frame(time: number): Promise<void>;
      capture(width: number, height: number): Promise<HTMLCanvasElement>;
    };
  }
}

export function mountExportRenderer() {
  document.documentElement.style.cssText = 'scrollbar-gutter:auto;background:#000';
  document.body.style.cssText = 'margin:0;overflow:hidden';
  const root = document.getElementById('root')!;
  let stage: Stage;
  let capture: ReturnType<typeof createBrowserCapture>;
  window.exportRenderer = {
    async init(input, lang, video) {
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
      const v = root.querySelector('video');
      if (v) {
        v.pause();
        if (v.readyState < 2) await new Promise<void>((resolve, reject) => {
          v.addEventListener('loadeddata', () => resolve(), { once: true });
          v.addEventListener('error', () => reject(new Error('Background video could not be decoded')), { once: true });
          setTimeout(() => reject(new Error('Background video timed out')), 30000);
        });
      }
      return stage.getSnapshot().total;
    },
    async frame(time) {
      stage.seek(time);
      for (const animation of document.getAnimations()) {
        animation.pause(); animation.currentTime = time * 1000;
      }
      const video = root.querySelector('video');
      video?.pause();
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        const target = time % video.duration;
        if (Math.abs(video.currentTime - target) > .0001) await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Video seek timed out')), 15000);
          video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
          video.currentTime = target;
        });
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
    capture(width, height) { return capture(root, width, height); },
  };
}
