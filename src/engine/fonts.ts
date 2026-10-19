import { CUSTOM_FAMILY, FONT_SPECS } from './constants';
import type { CjkScript, CustomFont } from './types';

const loaded = new Set(['Newsreader', 'Noto Serif SC', 'Outfit', 'Saira Condensed', 'Barlow']);

/** Loads a bundled font stylesheet on first use; unicode subsets load as needed. */
export function ensureFont(name: string) {
  if (!(name in FONT_SPECS) || loaded.has(name)) return;
  loaded.add(name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = import.meta.env.BASE_URL + 'fonts/' + name.toLowerCase().replace(/ /g, '-') + '/font.css';
  link.addEventListener('error', () => { loaded.delete(name); link.remove(); }, { once: true });
  document.head.appendChild(link);
}

/**
 * Han characters are drawn differently in mainland China (SC), Taiwan and Hong Kong (TC), Japan and Korea,
 * so the fallback font and the lang tag follow the chosen writing system.
 */
export const CJK: Record<Exclude<CjkScript, 'auto'>, { font: string; tag: string }> = {
  sc: { font: 'Noto Sans SC', tag: 'zh-CN' },
  tc: { font: 'Noto Sans TC', tag: 'zh-TW' },
  jp: { font: 'Noto Sans JP', tag: 'ja' },
  kr: { font: 'Noto Sans KR', tag: 'ko' },
};
const LANG_CJK: Record<string, Exclude<CjkScript, 'auto'>> = { 'zh-Hans': 'sc', 'zh-Hant': 'tc', ja: 'jp', ko: 'kr' };

/** One resolver for the live stage, card inspector and both export renderers. */
export function cjkFor(choice: CjkScript, uiLang: string, browserLang = typeof navigator === 'undefined' ? 'en' : navigator.language) {
  const scriptFor = (lang: string) => LANG_CJK[lang] || (/^zh-(TW|HK|MO|Hant)/i.test(lang) ? 'tc' : /^zh/i.test(lang) ? 'sc' : LANG_CJK[lang.split('-')[0]]);
  return CJK[choice !== 'auto' && CJK[choice] ? choice : scriptFor(uiLang) || scriptFor(browserLang) || 'sc'];
}
export const uiCjk = (uiLang: string) => (LANG_CJK[uiLang] ? CJK[LANG_CJK[uiLang]] : null);

export const fontStack = (name: string, cjkFont: string) => `"${name}", "${cjkFont}", "Noto Sans SC", "Noto Sans TC", "Noto Sans JP", "Noto Sans KR", system-ui, sans-serif`;

/** Registers a font file the user uploaded. Returns false when the browser can't read it. */
export async function registerFont(role: 'display' | 'body' | 'number', font: CustomFont | null | ArrayBuffer): Promise<boolean> {
  if (!font) return true;
  try {
    const src = font instanceof ArrayBuffer ? font : `url(${font.data})`;
    const ff = new FontFace(CUSTOM_FAMILY[role], src);
    await ff.load();
    document.fonts.add(ff);
    return true;
  } catch {
    return false;
  }
}
