import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { GRAPHIC_TEXT } from '@/engine/constants';
import { ensureFont, uiCjk } from '@/engine/fonts';
import type { GraphicText } from '@/engine/types';
import { en, type MessageId, type Messages } from './en';
import { zhHant } from './zh-Hant';
import { zhHans } from './zh-Hans';
import { ja } from './ja';
import { ko } from './ko';
import { es } from './es';

export type { MessageId };

const BUILT_IN: Record<string, { name: string; messages: Messages }> = {
  en: { name: 'English', messages: en },
  'zh-Hant': { name: '繁體中文', messages: zhHant },
  'zh-Hans': { name: '简体中文', messages: zhHans },
  ja: { name: '日本語', messages: ja },
  ko: { name: '한국어', messages: ko },
  es: { name: 'Español', messages: es },
};
const HTML_LANG: Record<string, string> = { 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW' };

const LANG_KEY = 'matchday-xi-lang';
const LEGACY_LANG_KEY = 'starting-xi-lang';
const CUSTOM_KEY = 'matchday-xi-locales';

export interface CustomLocale {
  name: string;
  strings: Messages;
  graphic?: Partial<GraphicText>;
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* still works for this visit */
  }
}

export function guessLang() {
  const n = (navigator.language || 'en').toLowerCase();
  if (n.startsWith('zh')) return /tw|hk|mo|hant/.test(n) ? 'zh-Hant' : 'zh-Hans';
  const b = n.split('-')[0];
  return BUILT_IN[b] ? b : 'en';
}

function initialLang(custom: Record<string, CustomLocale>) {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LANG_KEY) || localStorage.getItem(LEGACY_LANG_KEY);
  } catch {
    /* ignore */
  }
  return saved && (BUILT_IN[saved] || custom[saved]) ? saved : guessLang();
}

type Vars = Record<string, string | number>;
interface I18n {
  lang: string;
  setLang(code: string): void;
  languages: { code: string; name: string }[];
  t(id: MessageId, vars?: Vars): string;
  /** Wording for the graphic in the current language. */
  graphicText(): Omit<GraphicText, 'subtitle'>;
  /** Adds or updates a language from a pasted translation file. Returns its name, or null when the file is invalid. */
  addLanguage(json: string): string | null;
  /** A translation file for the current language, ready to fill in. */
  template(): string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [custom, setCustom] = useState<Record<string, CustomLocale>>(() => readJSON(CUSTOM_KEY, {}));
  const [lang, setLangState] = useState(() => initialLang(custom));

  const setLang = useCallback((code: string) => {
    setLangState(code);
    write(LANG_KEY, code);
  }, []);

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang] || lang;
    const c = uiCjk(lang);
    if (c) ensureFont(c.font);
    document.documentElement.style.setProperty('--font-cjk', `"${(c || uiCjk('zh-Hans')!).font}"`);
  }, [lang]);

  const value = useMemo<I18n>(() => {
    const messages: Messages = custom[lang]?.strings || BUILT_IN[lang]?.messages || {};
    const t = (id: MessageId, vars?: Vars) => {
      let out: string = messages[id] || en[id] || id;
      if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
      return out;
    };
    const graphicText = () => ({ ...GRAPHIC_TEXT.en, ...(GRAPHIC_TEXT[lang] || {}), ...(custom[lang]?.graphic || {}) });
    return {
      lang,
      setLang,
      t,
      graphicText,
      languages: [
        ...Object.entries(BUILT_IN).map(([code, l]) => ({ code, name: l.name })),
        ...Object.entries(custom).filter(([code]) => !BUILT_IN[code]).map(([code, l]) => ({ code, name: l.name })),
      ],
      template() {
        const strings: Record<string, string> = {};
        (Object.keys(en) as MessageId[]).forEach((k) => (strings[k] = lang === 'en' ? '' : messages[k] || ''));
        return JSON.stringify(
          { code: lang === 'en' ? 'xx' : lang, name: lang === 'en' ? 'Language name' : custom[lang]?.name || BUILT_IN[lang]?.name || lang, strings, graphic: graphicText() },
          null,
          2,
        );
      },
      addLanguage(json: string) {
        try {
          const j = JSON.parse(json);
          if (!j || typeof j.code !== 'string' || !j.code.trim() || !j.strings || typeof j.strings !== 'object') return null;
          const code = j.code.trim();
          const strings: Messages = { ...(BUILT_IN[code]?.messages || {}) };
          Object.entries(j.strings as Record<string, unknown>).forEach(([k, v]) => {
            if (k in en && typeof v === 'string' && v.trim()) strings[k as MessageId] = v;
          });
          const entry: CustomLocale = { name: String(j.name || code), strings, graphic: j.graphic && typeof j.graphic === 'object' ? j.graphic : undefined };
          const next = { ...custom, [code]: entry };
          setCustom(next);
          write(CUSTOM_KEY, JSON.stringify(next));
          setLang(code);
          return entry.name;
        } catch {
          return null;
        }
      },
    };
  }, [lang, custom, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n needs I18nProvider');
  return v;
}
export const useT = () => useI18n().t;
