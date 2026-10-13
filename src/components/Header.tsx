import { Globe, Monitor as MonitorIcon, Moon, Sun } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useTheme, type ThemePref } from '@/lib/theme';
import { store, useLineup } from '@/lib/store';
import { Undo2, Redo2 } from 'lucide-react';
import { Button } from './ui/button';
import { useEffect } from 'react';

const SHORT: Record<string, string> = { en: 'EN', 'zh-Hant': '繁', 'zh-Hans': '简', ja: '日本', ko: '한', es: 'ES' };

export function Header() {
  const { t, lang, setLang, languages } = useI18n();
  const [theme, setTheme] = useTheme();
  useLineup();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('textarea,[contenteditable=true]') || (target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'].includes(target.type))) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const undo = lang.startsWith('zh') ? '撤销' : 'Undo';
  const redo = lang.startsWith('zh') ? '重做' : 'Redo';
  return (
    <header className="app-header sticky top-0 z-30 border-b border-border bg-background">
      <div className="app-header-inner mx-auto flex flex-wrap py-2 w-full items-center gap-2 px-4 sm:gap-3 sm:px-8">
        <h1 className="brand-lockup" aria-label={t('app.name')}>
          <span className="brand-wordmark" aria-hidden="true">Matchday</span>
          <span className="brand-initials" aria-hidden="true">XI</span>
        </h1>
        <div className="app-header-controls ml-auto flex items-center gap-2">
          <Button size="icon" variant="ghost" disabled={!store.canUndo} onClick={store.undo} title={`${undo} · Ctrl/⌘ Z`} aria-label={undo}><Undo2 /></Button>
          <Button size="icon" variant="ghost" disabled={!store.canRedo} onClick={store.redo} title={`${redo} · Ctrl/⌘ Shift Z`} aria-label={redo}><Redo2 /></Button>
          {/* the select covers the visible label, so it stays a native, accessible control */}
          <label className="language-trigger relative flex h-11 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-semibold focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring hover:bg-accent">
            <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span aria-hidden="true" className="sm:hidden">{SHORT[lang] || lang.toUpperCase()}</span>
            <span aria-hidden="true" className="max-sm:hidden">{languages.find((l) => l.code === lang)?.name ?? lang}</span>
            <select
              aria-label={t('app.language')}
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="absolute inset-0 cursor-pointer appearance-none opacity-0"
            >
              {languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </label>
          <label className="relative flex size-11 items-center justify-center rounded-md border border-border bg-card focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring hover:bg-accent">
            {theme === 'dark' ? <Moon className="size-4" /> : theme === 'light' ? <Sun className="size-4" /> : <MonitorIcon className="size-4" />}
            <select aria-label={t('theme.label')} value={theme} onChange={(e) => setTheme(e.target.value as ThemePref)} className="absolute inset-0 cursor-pointer opacity-0">
              <option value="light">{t('theme.light')}</option>
              <option value="dark">{t('theme.dark')}</option>
              <option value="system">{t('theme.system')}</option>
            </select>
          </label>

        </div>
      </div>
    </header>
  );
}
