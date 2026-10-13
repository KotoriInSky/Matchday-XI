export class ImageReadError extends Error {}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new ImageReadError('unreadable')); };
    img.src = url;
  });
}

/** Reads a picture and shrinks it to at most `max` pixels on its longest side. */
export async function readImage(file: Blob, max: number, mime: 'image/webp' | 'image/jpeg'): Promise<string> {
  const img = await loadImage(file);
  const w = img.naturalWidth || max, h = img.naturalHeight || max;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(mime, 0.88);
}

export interface Photo {
  data: string;
  /** True for cut-outs (transparent background). */
  cut: boolean;
  /** Size of the original picture, in pixels. */
  res: [number, number];
}

/**
 * Keeps original portrait pixels for high-resolution export; samples alpha to detect cut-outs.
 */
export async function readPhoto(file: Blob, max: number): Promise<Photo> {
  const img = await loadImage(file);
  const W = img.naturalWidth || max, H = img.naturalHeight || max, k0 = Math.min(1, 2400 / Math.max(W, H));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(W * k0));
  c.height = Math.max(1, Math.round(H * k0));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  let cut = false;
  try {
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let clear = 0, n = 0;
    for (let y = 0; y < c.height; y += 2)
      for (let x = 0; x < c.width; x += 2) {
        n++;
        if (d[(y * c.width + x) * 4 + 3] <= 16) clear++;
      }
    cut = clear > n * 0.04;
  } catch {
    /* pixels can't be read (e.g. some SVGs): keep the whole picture */
  }
  return { data: await readDataURL(file), cut, res: [W, H] };
}

/** Wide pictures (flags) get a 3:2 frame, near-square ones (badges, logos) a square frame. */
export const imageShape = (src: string): Promise<'wide' | 'square'> =>
  new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im.naturalWidth / Math.max(1, im.naturalHeight) > 1.2 ? 'wide' : 'square');
    im.onerror = () => res('wide');
    im.src = src;
  });

export const readDataURL = (file: Blob): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });

/** Opens the file picker and resolves with the chosen file, or null. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((res) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let done = false;
    const finish = (f: File | null) => { if (done) return; done = true; input.remove(); res(f); };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}
