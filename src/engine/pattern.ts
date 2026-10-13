import { clamp } from './state';
import type { LineupState } from './types';

export function hexRgb(h: string): [number, number, number] {
  h = String(h || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mixHex(a: string, b: string, t: number) {
  const A = hexRgb(a), B = hexRgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

const svgPat = (body: string) =>
  'url("data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${body}</svg>`) +
  '")';

/**
 * The kit pattern: one generated artwork shared by cards, panels and the background.
 * `over` replaces the two colours; `bandsOnly` leaves out the base so only the second-colour bands remain.
 */
export function patternURI(state: LineupState, over?: [string, string], bandsOnly = false) {
  const L = state.look, A = over ? over[0] : state.colors.c1;
  const B = over ? over[1] : L.patColors === 'two' ? state.colors.k2 : mixHex(A, '#000000', 0.3);
  const r = clamp(Number(L.ratio) || 50, 20, 80) / 100;
  const A2 = mixHex(A, '#000000', 0.16), A3 = mixHex(A, '#ffffff', 0.12), B2 = mixHex(B, '#000000', 0.2);
  // a vertical band with an optional jog half-way down; rotated afterwards
  const band = (x: number, w: number, j: number, fill: string) =>
    `<polygon points="${x},-90 ${x + w},-90 ${x + w},44 ${x + w + j},56 ${x + w + j},190 ${x + j},190 ${x + j},56 ${x},44" fill="${fill}"/>`;
  let g = '', rot = 0;
  const kind = bandsOnly && !['bolts', 'diagonal', 'stripes'].includes(L.pattern) ? 'bolts' : L.pattern;
  if (kind === 'plain') {
    return svgPat(`<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${A3}"/><stop offset=".55" stop-color="${A}"/><stop offset="1" stop-color="${A2}"/></linearGradient></defs><rect width="100" height="100" fill="url(#p)"/>`);
  }
  if (kind === 'bolts') {
    // wide bands that curve down to the right, both edges stepped like a saw, each colour with a soft gradient
    const P = 40, w = r * P, S = 27, sh = 4.5;
    const xm = (x0: number, y: number) => x0 + 0.95 * y - 0.0028 * y * y;
    const edge = (x0: number, ph: number) => {
      const pts: [number, number][] = [];
      for (let y = -48 + ph; y < 150; y += S) pts.push([xm(x0, y), y], [xm(x0, y + S) + sh, y + S]);
      return pts;
    };
    const f = (v: number) => v.toFixed(2);
    let i = 0;
    for (let x0 = -110; x0 < 160; x0 += P, i++) {
      const ph = (i * 9) % S, Lp = edge(x0, ph), Rp = edge(x0 + w, ph).reverse();
      g += `<polygon points="${[...Lp, ...Rp].map((q) => f(q[0]) + ',' + f(q[1])).join(' ')}" fill="url(#gb)"/>`;
    }
    const grad = (id: string, c: string) =>
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="100" y1="0" x2="0" y2="100"><stop offset="0" stop-color="${mixHex(c, '#ffffff', 0.16)}"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${mixHex(c, '#000000', 0.14)}"/></linearGradient>`;
    return svgPat(`<defs>${grad('ga', A)}${grad('gb', B)}</defs>${bandsOnly ? '' : '<rect width="100" height="100" fill="url(#ga)"/>'}${g}`);
  }
  if (kind === 'halves') {
    rot = -22;
    const x = 50 - (r - 0.5) * 100 - 6;
    g = band(x, 260, 12, B) + band(x, 4, 12, B2) + band(x - 26, 7, 12, A2);
  } else {
    const P = kind === 'stripes' ? 25 : 34, j = 0;
    rot = kind === 'stripes' ? 0 : -35;
    const w = r * P;
    for (let x = -90; x < 190; x += P) {
      if (kind !== 'stripes') g += band(x + w + (P - w) * 0.55, (P - w) * 0.2, j, A2);
      g += band(x, w, j, B);
      if (kind !== 'stripes') g += band(x + w * 0.8, w * 0.2, j, B2);
    }
  }
  if (bandsOnly) g = g.replace(/<polygon[^>]*fill="(#[0-9a-f]+)"\/>/gi, (m0, c: string) => (c.toLowerCase() === B.toLowerCase() ? m0 : ''));
  return svgPat(`${bandsOnly ? '' : `<rect width="100" height="100" fill="${A}"/>`}<g transform="rotate(${rot} 50 50)">${g}</g>`);
}

/** A small swatch for colour presets in the editor. */
export const presetSwatch = (c1: string, k2: string, c2: string) =>
  `radial-gradient(circle at 78% 22%,${c2} 0 18%,transparent 19%),linear-gradient(135deg,${c1} 50%,${k2} 50%)`;


/** WCAG contrast used for default text surfaces, independently of kit artwork. */
export function contrastRatio(a: string, b: string) {
  const luminance = (h: string) => hexRgb(h).map(v => {
    const c = v / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export function readableText(background: string, preferred: string) {
  if (contrastRatio(background, preferred) >= 4.5) return preferred;
  return contrastRatio(background, '#FFFFFF') > contrastRatio(background, '#111111') ? '#FFFFFF' : '#111111';
}
export function textSurfaceColors(s: LineupState): [string, string] {
  const ink = s.colors.c3;
  const target = contrastRatio(ink, '#FFFFFF') > contrastRatio(ink, '#000000') ? '#FFFFFF' : '#000000';
  const base = mixHex(s.colors.c1, target, .16);
  const second = s.look.patColors === 'two' ? s.colors.k2 : mixHex(s.colors.c1, '#000000', .3);
  const soften = (color: string) => {
    let result = color;
    for (let i = 0; i <= 100; i++) {
      result = mixHex(color, target, i / 100);
      if (contrastRatio(result, ink) >= 7) break;
    }
    return result;
  };
  return [soften(base), soften(mixHex(base, second, .14))];
}
export const textPatternURI = (s: LineupState) => patternURI(s, textSurfaceColors(s));
