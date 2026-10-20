// HTML-in-Canvas (WICG, https://github.com/WICG/html-in-canvas): the browser
// paints a canvas's `drawable` children and `drawElementImage()` copies the
// last snapshot into the canvas, skipping style serialization and SVG decoding.
// Chromium ships it behind chrome://flags/#canvas-draw-element; the attribute
// names changed during the trial, so both spellings are set.

import { backFacing } from './browser-capture';

type DrawableContext = CanvasRenderingContext2D & {
  drawElementImage(element: Element, dx: number, dy: number, dwidth: number, dheight: number): void;
};
type DrawableCanvas = HTMLCanvasElement & { requestPaint(): void; onpaint: ((event: Event) => void) | null };

export const elementCaptureSupported = () => typeof HTMLCanvasElement !== 'undefined'
  && 'requestPaint' in HTMLCanvasElement.prototype && 'drawElementImage' in CanvasRenderingContext2D.prototype;

/**
 * Moves `root` into a drawable canvas. Mount before animations are created:
 * re-parenting a node cancels its CSS animations. `capture()` resolves false
 * when no paint arrives (hidden documents do not render) or drawing throws;
 * the mount then stays in place and callers keep using another capture.
 */
export function mountElementCapture(root: HTMLElement) {
  const host = document.createElement('canvas') as DrawableCanvas;
  host.setAttribute('layoutsubtree', ''); host.setAttribute('content', 'drawable');
  host.style.cssText = 'display:block;width:100vw;height:100vh';
  root.setAttribute('drawable', '');
  root.replaceWith(host); host.append(root);
  const context = host.getContext('2d') as DrawableContext;
  let failed = false;
  // Faces with backface-visibility:hidden, found once per layout. Snapshots
  // ignore backface culling, so back-facing ones are hidden for the paint.
  let faces: { count: number; nodes: HTMLElement[] } | undefined;
  const cull = () => {
    const count = root.getElementsByTagName('*').length;
    if (faces?.count !== count) faces = { count, nodes: [...root.querySelectorAll<HTMLElement>('*')].filter(node => getComputedStyle(node).backfaceVisibility === 'hidden') };
    const restore: (() => void)[] = [];
    for (const node of faces.nodes) {
      if (!backFacing(node, getComputedStyle(node))) continue;
      const value = node.style.getPropertyValue('opacity'), priority = node.style.getPropertyPriority('opacity');
      node.style.setProperty('opacity', '0', 'important');
      restore.push(() => value ? node.style.setProperty('opacity', value, priority) : node.style.removeProperty('opacity'));
    }
    return () => restore.forEach(undo => undo());
  };
  return {
    get failed() { return failed; },
    async capture(target: HTMLCanvasElement, timeout = 2000) {
      if (failed) return false;
      const { width, height } = target;
      if (host.width !== width) host.width = width;
      if (host.height !== height) host.height = height;
      // The snapshot is recorded during the next rendering update, so a seek
      // made just before this call is included.
      const uncull = cull();
      const painted = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => { host.onpaint = null; resolve(false); }, timeout);
        host.onpaint = () => {
          clearTimeout(timer); host.onpaint = null;
          try {
            context.clearRect(0, 0, width, height);
            context.drawElementImage(root, 0, 0, width, height);
            resolve(true);
          } catch { resolve(false); }
        };
        host.requestPaint();
      }).finally(uncull);
      if (!painted) { failed = true; return false; }
      const output = target.getContext('2d')!;
      output.clearRect(0, 0, width, height); output.drawImage(host, 0, 0);
      return true;
    },
    unmount() {
      host.onpaint = null; host.replaceWith(root); root.removeAttribute('drawable');
      host.width = host.height = 0;
    },
  };
}
