import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'matchday-xi-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

let pref: ThemePref = read();
const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply() {
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#ffffff');
}

/** The editor's light or dark theme. Starts from the system setting; a choice is remembered in this browser. */
export function useTheme() {
  const value = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => pref,
  );
  useEffect(() => {
    apply();
    const m = media();
    const onChange = () => apply();
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, []);
  const setTheme = useCallback((next: ThemePref) => {
    pref = next;
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* the choice still applies for this visit */
    }
    apply();
    listeners.forEach((l) => l());
  }, []);
  return [value, setTheme] as const;
}
