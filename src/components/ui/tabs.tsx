import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface TabsCtx { value: string; onChange(v: string): void; base: string }
const Ctx = createContext<TabsCtx | null>(null);
const use = () => useContext(Ctx)!;

export function Tabs({ value, onValueChange, children, className }: { value: string; onValueChange(v: string): void; children: ReactNode; className?: string }) {
  const base = useId();
  return (
    <Ctx.Provider value={{ value, onChange: onValueChange, base }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  );
}

/** Arrow keys move between tabs, as in the WAI-ARIA tabs pattern. */
export function TabsList({ children, className, label, verticalAt }: { children: ReactNode; className?: string; label: string; verticalAt?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [vertical, setVertical] = useState(() => verticalAt !== undefined && matchMedia(`(min-width: ${verticalAt}px)`).matches);
  useEffect(() => {
    if (verticalAt === undefined) return;
    const media = matchMedia(`(min-width: ${verticalAt}px)`);
    const sync = () => setVertical(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [verticalAt]);
  const onKeyDown = (e: KeyboardEvent) => {
    const tabs = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || [])];
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === (vertical ? 'ArrowDown' : 'ArrowRight')) j = (i + 1) % tabs.length;
    if (e.key === (vertical ? 'ArrowUp' : 'ArrowLeft')) j = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = tabs.length - 1;
    if (j < 0) return;
    e.preventDefault();
    tabs[j].focus();
    tabs[j].click();
  };
  return (
    <div ref={ref} role="tablist" aria-label={label} aria-orientation={vertical ? 'vertical' : 'horizontal'} onKeyDown={onKeyDown} className={className}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const c = use();
  const on = c.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${c.base}-t-${value}`}
      aria-controls={`${c.base}-p-${value}`}
      aria-selected={on}
      tabIndex={on ? 0 : -1}
      data-state={on ? 'active' : 'inactive'}
      onClick={() => c.onChange(value)}
      className={className}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className, keepMounted = false }: { value: string; children: ReactNode; className?: string; keepMounted?: boolean }) {
  const c = use();
  if (c.value !== value && !keepMounted) return null;
  return (
    <div hidden={c.value !== value} role="tabpanel" id={`${c.base}-p-${value}`} aria-labelledby={`${c.base}-t-${value}`} tabIndex={-1} className={cn('outline-none', className)}>
      {children}
    </div>
  );
}
