import { Stage } from './engine/stage';
import { normalize } from './engine/state';
import { registerFont } from './engine/fonts';
import { COMPACT_QUALITY, createBrowserCapture } from './lib/browser-capture';
import { elementCaptureSupported, mountElementCapture } from './lib/element-capture';
import type { Input, WrappedCanvas } from 'mediabunny';

declare global {
  interface Window {
    exportRenderer: {
      init(state: unknown, lang: string, video: string | null): Promise<number>;
      /** Prepare sequential frame(0), frame(1 / fps), ... for browser video export. */
      prepareVideo(fps: number, frames: number): Promise<boolean>;
      frame(time: number, waitForPaint?: boolean): Promise<void>;
      capture(width: number, height: number): Promise<HTMLCanvasElement>;
      captureInto(canvas: HTMLCanvasElement): Promise<void>;
      dispose(): void;
      /** 'element' when HTML-in-Canvas passed validation for this project. */
      readonly captureMode: 'element' | 'svg';
      /** Pixel differences measured while validating HTML-in-Canvas. */
      readonly elementCheck: ElementCheck[] | null;
    };
  }
}

type ElementCheck = { time: number; mean: number; worstBlock: number; over64: number };

// HTML-in-Canvas paints natively, like the preview, so it differs from the SVG
// copy by rasterization (SVG vs native was ~1.8 mean on the real project). A
// missing, shifted or mistimed layer exceeds these by far.
const ELEMENT_MEAN = 2, ELEMENT_BLOCK = 48, ELEMENT_OVER64 = 0.01;

const compare = (a: HTMLCanvasElement, b: HTMLCanvasElement, time: number): ElementCheck => {
  const { width, height } = a;
  const read = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  const pa = read(a), pb = read(b);
  let total = 0, over64 = 0, worstBlock = 0;
  for (let i = 0; i < pa.length; i += 4) {
    let pixel = 0;
    for (let k = 0; k < 4; k++) { const d = Math.abs(pa[i + k] - pb[i + k]); total += d; pixel = Math.max(pixel, d); }
    if (pixel > 64) over64++;
  }
  for (let by = 0; by < height; by += 16) for (let bx = 0; bx < width; bx += 16) {
    let sum = 0, count = 0;
    for (let y = by; y < Math.min(by + 16, height); y++) for (let x = bx; x < Math.min(bx + 16, width); x++) {
      const i = (y * width + x) * 4; for (let k = 0; k < 4; k++) sum += Math.abs(pa[i + k] - pb[i + k]); count += 4;
    }
    worstBlock = Math.max(worstBlock, sum / count);
  }
  return { time, mean: total / pa.length, worstBlock, over64: over64 / (pa.length / 4) };
};

export function mountExportRenderer() {
  document.documentElement.style.cssText = 'scrollbar-gutter:auto;background:#000';
  document.body.style.cssText = 'margin:0;overflow:hidden';
  const root = document.getElementById('root')!;
  let stage: Stage;
  let capture: ReturnType<typeof createBrowserCapture>;
  let frameCapture: ReturnType<typeof createBrowserCapture>;
  let videoElement: HTMLVideoElement | null;
  let videoInput: Input | undefined;
  let preparation: AbortController | undefined;
  type Decoded = { frames: AsyncIterator<WrappedCanvas | null>; first: boolean; timestamp: number; image: string; upcoming?: Promise<{ timestamp: number; image: string } | null> };
  let decoded: Decoded | undefined;
  // toBlob encodes off the main thread; requesting the next source
  // frame right away overlaps its decode and encode with this frame's capture.
  // Browser export embeds opaque video frames as JPEG (WebP with alpha), which
  // bounds renderer memory as in browser-capture; the local renderer keeps PNG.
  const compact = window.top !== window;
  let frameType = 'image/png', frameQuality: number | undefined;
  const frameURL = async (canvas: HTMLCanvasElement | OffscreenCanvas) => {
    const blob = canvas instanceof HTMLCanvasElement
      ? await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, frameType, frameQuality))
      : await canvas.convertToBlob({ type: frameType, quality: frameQuality });
    if (!blob) throw new Error('videoFrame');
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
    });
  };
  const prefetch = (state: Decoded) => {
    const { timestamp, image } = state;
    const upcoming = (async () => {
      const frame = (await state.frames.next()).value;
      if (!frame) return null;
      // The library identifies repeated source frames when output FPS is
      // higher. Retain the current image instead of encoding it again.
      return frame.timestamp === timestamp ? { timestamp, image } : { timestamp: frame.timestamp, image: await frameURL(frame.canvas) };
    })();
    upcoming.catch(() => {}); // Awaited by the next frame(); never unhandled.
    state.upcoming = upcoming;
  };
  let element: ReturnType<typeof mountElementCapture> | undefined;
  let elementAllowed = elementCaptureSupported(), elementCheck: ElementCheck[] | null = null;
  const dispose = () => {
    preparation?.abort(); preparation = undefined;
    videoInput?.dispose(); videoInput = undefined;
    void decoded?.frames.return?.().catch(() => {}); decoded = undefined;
  };
  window.exportRenderer = {
    async init(input, lang, video) {
      dispose();
      stage?.destroy();
      element?.unmount(); element = undefined;
      // Decoded background frames reach only the SVG copy, so video keeps it.
      if (elementAllowed && !video) element = mountElementCapture(root);
      const state = normalize(input);
      capture = createBrowserCapture(state, { lightEncoding: true }, () => decoded?.image);
      // Video frames embed photos near their on-screen size; see browser-capture.
      // Browser export (this page inside the editor's iframe) also embeds them as
      // WebP; the local renderer keeps lossless pixels.
      frameCapture = createBrowserCapture(state, { pruneInvisible: true, imageHeadroom: 3, compactImages: compact, compactStyles: true, lightEncoding: true, reuseUnchanged: true, subsetFonts: true }, () => decoded?.image);
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
      const total = stage.getSnapshot().total;
      if (element) {
        // Compare with the SVG capture at five points before trusting it.
        const width = innerWidth, height = innerHeight;
        const a = document.createElement('canvas'), b = document.createElement('canvas');
        a.width = b.width = width; a.height = b.height = height;
        elementCheck = [];
        try {
          for (const time of [.15, .35, .55, .75, .95].map(f => total * f)) {
            stage.seek(time, true);
            if (!await element.capture(a)) break;
            await frameCapture(root, width, height, b);
            elementCheck.push(compare(a, b, time));
          }
        } finally { a.width = a.height = b.width = b.height = 0; }
        if (elementCheck.length < 5 || elementCheck.some(c => c.mean > ELEMENT_MEAN || c.worstBlock > ELEMENT_BLOCK || c.over64 > ELEMENT_OVER64)) {
          elementAllowed = false; // Rebuild the stage outside the canvas.
          return this.init(input, lang, video);
        }
      }
      return total;
    },
    async prepareVideo(fps, frames) {
      if (decoded) return true; // Already prepared for this timeline.
      const video = videoElement;
      if (!video || !('VideoDecoder' in window) || !(video.duration > 0 && Number.isFinite(video.duration))) return false;
      const duration = video.duration;
      const controller = preparation = new AbortController();
      try {
        const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
        const response = await fetch(video.currentSrc || video.src, { signal: controller.signal });
        if (!response.ok) throw new Error('video');
        const blob = await response.blob(); controller.signal.throwIfAborted();
        const input = videoInput = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track || !await track.canDecode()) throw new Error('unsupported');
        const color = await track.getColorSpace();
        // Native video and WebCodecs can infer different colors for untagged
        // material. Preserve native decoding when that inference is required.
        if (!color.primaries || !color.transfer || !color.matrix || color.fullRange == null || await track.hasHighDynamicRange()) throw new Error('colorSpace');
        // Use Mediabunny's timestamp iterator: it reuses decoded packets for
        // forward sampling and handles backwards timestamps at loop boundaries.
        // A single pooled canvas bounds the surfaces retained by this adapter.
        const sink = new CanvasSink(track, { poolSize: 1, alpha: true });
        const timestamps = function* () { for (let i = 0; i < frames; i++) yield (i / fps) % duration; };
        const iterator = sink.canvasesAtTimestamps(timestamps());
        const first = await iterator.next(); controller.signal.throwIfAborted();
        if (!first.value) throw new Error('videoFrame');
        if (compact) [frameType, frameQuality] = await track.canBeTransparent() ? ['image/webp', COMPACT_QUALITY] : ['image/jpeg', .92];
        const image = (first.value.canvas as HTMLCanvasElement).toDataURL(frameType, frameQuality);
        decoded = { frames: iterator, first: true, timestamp: first.value.timestamp, image };
        // Feed the encoded frame directly to capture, keeping the video's original CSS
        // box. A live <img> would make the browser decode every frame once more.
        video.removeAttribute('src'); video.load();
        return true;
      } catch (error) {
        const aborted = controller.signal.aborted;
        dispose();
        if (aborted) throw error;
        return false; // Native media decoding remains available for other codecs.
      }
    },
    async frame(time, waitForPaint = true) {
      stage.seek(time, !decoded);
      if (decoded) {
        if (decoded.first) decoded.first = false;
        else {
          const next = await decoded.upcoming;
          if (!next) throw new Error('Background video frame unavailable');
          decoded.timestamp = next.timestamp; decoded.image = next.image;
        }
        prefetch(decoded);
      }
      // Stage owns both timeline and CSS animations. Canvas capture reads their
      // computed styles synchronously; native screenshots still wait for paint.
      const video = decoded ? null : videoElement;
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
    async captureInto(canvas) {
      // A hidden document stops painting; the SVG capture continues from there.
      if (element && !element.failed && await element.capture(canvas)) return;
      await frameCapture(root, canvas.width, canvas.height, canvas);
    },
    dispose,
    get captureMode() { return element && !element.failed ? 'element' : 'svg'; },
    get elementCheck() { return elementCheck; },
  };
}
