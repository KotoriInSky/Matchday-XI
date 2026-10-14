import { normalizeColorOverrides } from './color-overrides';
import { DISPLAY_FONTS, CUSTOM_FAMILY, LEGACY_CUSTOM_FAMILY, SAMPLE, blankPlayer, newFit } from './constants';
import { parseFormation } from './formation';
import type { Fit, FitPath, LineupState, Tag } from './types';

export const STORAGE_KEY = 'matchday-xi-v1';
/** Where Starting XI Builder kept its setup. Read once so existing lineups carry over. */
export const LEGACY_STORAGE_KEY = 'starting-xi-builder-v1';

export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Copies values from src into base where the key and type match, so unknown or broken fields are dropped. */
function deepMerge<T extends Obj>(base: T, src: unknown): T {
  if (!isObj(src)) return base;
  const b = base as Obj;
  for (const k of Object.keys(b)) {
    if (!(k in src)) continue;
    const bv = b[k], sv = src[k];
    if (Array.isArray(bv)) b[k] = Array.isArray(sv) ? sv : bv;
    else if (isObj(bv)) { if (isObj(sv)) b[k] = deepMerge(bv, sv); }
    else if (bv === null || typeof sv === typeof bv) b[k] = sv;
  }
  return base;
}

const okFit = (f: unknown): Fit =>
  isObj(f) ? { z: clamp(Number(f.z) || 1, 0.3, 3), x: Number(f.x) || 0, y: Number(f.y) || 0 } : newFit();
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** Turns anything (a saved setup, a pasted one, an older version) into a complete, valid lineup. */
export function normalize(input: unknown): LineupState {
  const d = deepMerge(clone(SAMPLE) as unknown as Obj, input) as unknown as LineupState;
  d.colorOverrides = normalizeColorOverrides(isObj(input) ? input.colorOverrides : undefined);
  const ns = isObj(input) && isObj(input.numberStyle) ? input.numberStyle : {};
  d.numberStyle = { font: oneOf(ns.font, ['', CUSTOM_FAMILY.number, ...DISPLAY_FONTS], ''), mode: oneOf(ns.mode, ['solid', 'outline'] as const, 'solid') };
  d.formation = (parseFormation(d.formation) || parseFormation('4-3-3')!).label;
  const ps = (Array.isArray(d.players) ? d.players : []).slice(0, 11).map((p) => deepMerge(blankPlayer() as unknown as Obj, p) as unknown as LineupState['players'][number]);
  while (ps.length < 11) ps.push(blankPlayer());
  const incomingPlayers = isObj(input) && Array.isArray(input.players) ? input.players : [];
  ps.forEach((p, index) => {
    p.nameLine1 = typeof p.nameLine1 === 'string' ? p.nameLine1 : null;
    p.nameLine2 = typeof p.nameLine2 === 'string' ? p.nameLine2 : null;
    p.nameSize1 = clamp(Number(p.nameSize1) || 100, 30, 250);
    p.nameSize2 = clamp(Number(p.nameSize2) || 100, 30, 250);
    const incoming = incomingPlayers[index];
    const smallSize = isObj(incoming) && !('nameSizeSmall' in incoming) ? incoming.nameSize2 : p.nameSizeSmall;
    p.nameSizeSmall = clamp(Number(smallSize) || 100, 30, 250);
  });
  d.players = ps;
  d.tags = (Array.isArray(d.tags) ? d.tags : [])
    .filter((t): t is Tag => isObj(t) && !!t.id)
    .map((t) => ({ id: String(t.id), ...(typeof t.fifaCode === 'string' && /^[A-Z]{3}$/.test(t.fifaCode) ? { fifaCode: t.fifaCode } : {}), label: String(t.label ?? ''), img: typeof t.img === 'string' ? t.img : null, shape: t.shape === 'square' ? 'square' : 'wide', fit: okFit(t.fit) }));
  ps.forEach((p) => {
    p.tagFits = isObj(p.tagFits) ? Object.fromEntries(Object.entries(p.tagFits)
      .filter(([id, fit]) => d.tags.some((tag) => tag.id === id) && isObj(fit))
      .map(([id, fit]) => [id, okFit(fit)])) : null;
  });
  if (!isObj(d.slotPos)) d.slotPos = {};
  d.anim.template = oneOf(d.anim.template, ['classic', 'season2627'] as const, 'classic');
  d.anim.style = oneOf(d.anim.style, ['lines', 'row', 'single', 'off'] as const, 'lines');
  d.look.pitch = oneOf(d.look.pitch, ['light', 'dark'] as const, 'light');
  d.look.gk = oneOf(d.look.gk, ['top', 'bottom'] as const, 'top');
  d.look.pattern = oneOf(d.look.pattern, ['bolts', 'diagonal', 'stripes', 'halves', 'plain'] as const, 'bolts');
  d.look.patColors = oneOf(d.look.patColors, ['two', 'tone'] as const, 'two');
  d.look.shape = oneOf(d.look.shape, ['rounded', 'angled', 'sharp'] as const, 'rounded');
  d.bg.mode = oneOf(d.bg.mode, ['stripes', 'gradient', 'solid', 'image', 'video'] as const, 'stripes');
  d.fonts.cjk = oneOf(d.fonts.cjk, ['auto', 'sc', 'tc', 'jp', 'kr'] as const, 'auto');
  d.look.ratio = clamp(Number(d.look.ratio) || 50, 20, 80);
  d.look.photoScale = clamp(Number(d.look.photoScale) || 100, 60, 140);
  d.look.smallSize = clamp(Number(d.look.smallSize) || 100, 70, 150);
  d.look.tagSize = clamp(Number(d.look.tagSize) || 140, 60, 200);
  d.look.bigSize = clamp(Number(d.look.bigSize) || 100, 70, 140);
  d.bg.dim = clamp(Number(d.bg.dim) || 0, 0, 90);
  d.players.forEach((p) => { p.fit = okFit(p.fit); p.fitS = okFit(p.fitS); p.fitK = okFit(p.fitK); if (!p.captain) p.captain = false; });
  // only one captain
  let seen = false;
  d.players.forEach((p) => { if (p.captain && seen) p.captain = false; if (p.captain) seen = true; });
  d.coach.fit = okFit(d.coach.fit);
  d.team.crestFit = okFit(d.team.crestFit);
  d.bg.fit = okFit(d.bg.fit);
  d.anim.per = clamp(Number(d.anim.per) || 1, 0.4, 3);
  d.anim.introLen = clamp(Number(d.anim.introLen) || 3.2, 2, 6);
  d.anim.mgrLen = clamp(Number(d.anim.mgrLen) || 6, 4, 10);
  // fonts uploaded in Starting XI Builder used other family names
  (['display', 'body'] as const).forEach((role) => {
    if (d.fonts[role] === LEGACY_CUSTOM_FAMILY[role]) d.fonts[role] = CUSTOM_FAMILY[role];
    if (d.fonts[role] === CUSTOM_FAMILY[role] && !d.customFonts[role]) d.fonts[role] = SAMPLE.fonts[role];
  });
  if (d.numberStyle?.font === CUSTOM_FAMILY.number && !d.customFonts.number) d.numberStyle.font = '';
  return d;
}

export interface LoadResult {
  state: LineupState;
  /** True when the setup came from Starting XI Builder. */
  migrated: boolean;
}

export function loadState(): LoadResult {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { state: normalize(JSON.parse(raw)), migrated: false };
    const old = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (old) return { state: normalize(JSON.parse(old)), migrated: true };
  } catch {
    /* fall through to the sample */
  }
  return { state: normalize({}), migrated: false };
}

/** Returns false when the browser refuses to store the setup (usually because it is too large). */
export function saveState(state: LineupState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** The {z,x,y} framing a path points to: p:<slot>:fit|fitS|fitK, coach:fit, crest:fit, tag:<id>:fit, bg:fit. */
export const playerTagPath = (index: number, id: string): FitPath => `pt:${index}:${encodeURIComponent(id)}`;

export function fitRef(state: LineupState, path: FitPath, writable = false): Fit | null {
  const [a, b, c] = String(path).split(':');
  if (a === 'pt') {
    const player = state.players[Number(b)];
    let id: string;
    try { id = decodeURIComponent(c); } catch { return null; }
    const tag = state.tags.find((item) => item.id === id);
    if (!player || !tag) return null;
    const own = Object.prototype.hasOwnProperty.call(player.tagFits ?? {}, id) ? player.tagFits![id] : undefined;
    if (own) return own;
    if (!writable) return tag.fit;
    player.tagFits = { ...player.tagFits, [id]: { ...tag.fit } };
    return player.tagFits[id];
  }
  if (a === 'p') {
    const p = state.players[Number(b)];
    if (!p || (c !== 'fit' && c !== 'fitS' && c !== 'fitK')) return null;
    return p[c];
  }
  if (a === 'coach') return state.coach.fit;
  if (a === 'crest') return state.team.crestFit;
  if (a === 'tag') return state.tags.find((t) => t.id === String(path).slice(4, -4))?.fit ?? null;
  if (a === 'bg') return state.bg.fit;
  return null;
}

export const splitName = (n: string): [string, string] => {
  n = String(n || '').trim();
  // An explicit separator wins; otherwise keep common surname particles together.
  const separator = n.indexOf('|');
  if (separator >= 0) return [n.slice(0, separator).trim(), n.slice(separator + 1).trim()];
  const words = n.split(/\s+/);
  let start = words.length - 1;
  const particles = new Set(['van', 'von', 'de', 'der', 'den', 'di', 'da', 'dos', 'das', 'del', 'della', 'la', 'le', 'du', 'ten', 'ter']);
  while (start > 0 && particles.has(words[start - 1].toLocaleLowerCase())) start--;
  return [words.slice(0, start).join(' '), words.slice(start).join(' ')];
};
export const playerNameLines = (p: { short: string; name: string; nameLine1?: string | null; nameLine2?: string | null }): [string, string] => {
  const legacy: [string, string] = p.short.trim() ? ['', p.short.trim()] : ['', p.name.trim()];
  return [p.nameLine1 ?? legacy[0], p.nameLine2 ?? legacy[1]];
};
export const cardName = (p: { short: string; name: string; nameLine1?: string | null; nameLine2?: string | null }) => playerNameLines(p).filter(Boolean).join(' ');

/** Convert legacy uppercase labels to broadcast case; explicit mixed case stays untouched. */
export function broadcastName(value: string): string {
  if (value !== value.toLocaleUpperCase()) return value;
  const particles = new Set(['van', 'von', 'de', 'der', 'den', 'di', 'da', 'dos', 'das', 'del', 'della', 'la', 'le', 'du', 'ten', 'ter']);
  return value.toLocaleLowerCase().replace(/\p{L}+/gu, (word) => particles.has(word) ? word : word[0].toLocaleUpperCase() + word.slice(1));
}

export const initials = (name: string) => String(name || '').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 3).join('').toUpperCase();
export const shortName = (s: LineupState) => s.team.short || initials(s.team.name);

export function parseSubs(txt: string) {
  return String(txt || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\d{1,3})[\s.\-:]+(.+)$/);
    return m ? { num: m[1], name: m[2] } : { num: '', name: l };
  });
}

/** Sort numbered outfield substitutes while preserving keepers, notes and blank rows. */
export function sortSubstitutes(txt: string): string {
  const lines = String(txt || '').split('\n');
  const movable = lines.flatMap((line, index) => {
    const match = line.trim().match(/^(\d{1,3})[\s.\-:]+(.+)$/);
    const keeper = /[（(]\s*(?:GK|Goalkeeper|门将|門將)\s*[）)]\s*$/i.test(line.trim());
    return match && !keeper ? [{ index, number: Number(match[1]), line }] : [];
  });
  const sorted = [...movable].sort((a, b) => a.number - b.number || a.index - b.index);
  movable.forEach((item, index) => { lines[item.index] = sorted[index].line; });
  return lines.join('\n');
}
