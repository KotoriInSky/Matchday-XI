import { cardArtwork, type CardKind } from './engine/card-artwork';
import { normalize } from './engine/state';
import { registerFont } from './engine/fonts';
import type { LineupState } from './engine/types';
import styles from './engine/stage.module.css';
import seasonStyles from './engine/season2627.module.css';
import { createBrowserCapture } from './lib/browser-capture';
import { settleCardCaption } from './engine/card-still';

declare global {
  interface Window {
    cardRenderer: {
      init(input: unknown, lang: string): Promise<void>;
      show(index: number, kind: CardKind): Promise<{ x: number; y: number; width: number; height: number; padding: number; frameWidth: number; frameHeight: number }>;
      place(width: number, x: number, y: number): Promise<void>;
      capture(width: number, height: number): Promise<HTMLCanvasElement>;
    };
  }
}

export function mountCardRenderer() {
  document.documentElement.style.cssText = 'scrollbar-gutter:auto;background:transparent';
  document.body.style.cssText = 'margin:0;background:transparent;overflow:hidden';
  const root = document.getElementById('root')!;
  const canvas = document.createElement('div');
  canvas.style.cssText = 'position:absolute;width:600px;container-type:inline-size';
  root.replaceChildren(canvas);
  // Freeze from the first style calculation, before compositor animations start.
  // Pausing after image/font loading can otherwise preserve a fractional frame.
  const stillStyle = document.createElement('style');
  stillStyle.textContent = `*,*::before,*::after{animation-play-state:paused!important;animation-delay:0s!important;transition:none!important}`;
  document.head.append(stillStyle);
  let state: LineupState, language: string;
  let capture: ReturnType<typeof createBrowserCapture>;
  const settle = async () => {
    for (const animation of canvas.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = 0;
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  };
  window.cardRenderer = {
    async init(input, lang) {
      state = normalize(input); language = lang;
      capture = createBrowserCapture(state);
      const fonts = await Promise.all((['display', 'body', 'number'] as const).map(role => registerFont(role, state.customFonts[role])));
      if (fonts.some(ok => !ok)) throw new Error('Custom font could not be loaded');
    },
    async show(index, kind) {
      canvas.style.width = '600px'; canvas.style.left = '0'; canvas.style.top = '0';
      const art = cardArtwork(state, index, kind, language);
      const stage = document.createElement('div');
      stage.className = art.className; stage.lang = art.lang; stage.dataset.shape = state.look.shape;
      for (const [key, value] of Object.entries(art.css)) stage.style.setProperty(key, String(value));
      stage.innerHTML = art.html; canvas.replaceChildren(stage);
      await Promise.all([...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')].map(link => link.sheet ? Promise.resolve() : new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Font stylesheet timed out')), 20000);
        link.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
        link.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Font stylesheet failed')); }, { once: true });
      })));
      // Flush style before reading FontFaceSet.ready; otherwise newly used faces may
      // start loading after an already-resolved ready promise has been observed.
      stage.getBoundingClientRect();
      await document.fonts.ready;
      await Promise.all([...canvas.querySelectorAll('img')].map(image => image.decode()));
      settleCardCaption(stage, state.text.captainLabel);
      await settle();
      const frame = stage.querySelector<HTMLElement>(kind === 'small' ? `.${styles['sm-por']}`
        : state.anim.template === 'season2627' ? `.${seasonStyles['s26-preview-column']}` : `.${styles.rc}`);
      if (!frame) throw new Error('Missing card frame');
      const frameBox = frame.getBoundingClientRect();
      // Include overflowing portraits, labels and tags. Clip only where the artwork clips.
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const node of stage.querySelectorAll<HTMLElement>('*')) {
        if (node.closest('svg') && node.tagName.toLowerCase() !== 'svg') continue;
        const own = getComputedStyle(node);
        const paints = ['img', 'svg'].includes(node.tagName.toLowerCase()) || [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())
          || !['transparent', 'rgba(0, 0, 0, 0)'].includes(own.backgroundColor) || own.backgroundImage !== 'none' || own.boxShadow !== 'none'
          || ['::before', '::after'].some(pseudo => !['none', 'normal'].includes(getComputedStyle(node, pseudo).content));
        if (!paints) continue;
        let box = node.getBoundingClientRect();
        let l = box.left, t = box.top, r = box.right, b = box.bottom, visible = true;
        for (let parent: Element | null = node; parent && parent !== stage; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) { visible = false; break; }
          if (parent !== node && /hidden|clip|scroll|auto/.test(style.overflow)) {
            box = parent.getBoundingClientRect();
            l = Math.max(l, box.left); t = Math.max(t, box.top); r = Math.min(r, box.right); b = Math.min(b, box.bottom);
          }
        }
        if (!visible || r <= l || b <= t) continue;
        left = Math.min(left, l); top = Math.min(top, t); right = Math.max(right, r); bottom = Math.max(bottom, b);
      }
      if (!Number.isFinite(left)) throw new Error('Empty card');
      // Shadows are paint overflow rather than DOM bounds; reserve 12% of design width.
      return { x: left, y: top, width: right - left, height: bottom - top, padding: 72,
        frameWidth: frameBox.width, frameHeight: frameBox.height };
    },
    async place(width, x, y) {
      canvas.style.width = `${width}px`; canvas.style.left = `${x}px`; canvas.style.top = `${y}px`;
      await settle();
    },
    capture(width, height) { return capture(root, width, height); },
  };
}
