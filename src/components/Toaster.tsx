import { useSyncExternalStore } from 'react';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { useT, type MessageId } from '@/i18n';
import { cn } from '@/lib/utils';

interface Toast { id: number; msg: MessageId; vars?: Record<string, string | number>; error: boolean }
let toasts: Toast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows a short message at the bottom of the screen. Errors stay a little longer. */
export function toast(msg: MessageId, opts: { error?: boolean; vars?: Record<string, string | number> } = {}) {
  const t: Toast = { id: next++, msg, vars: opts.vars, error: !!opts.error };
  toasts = [...toasts.filter((x) => x.msg !== msg), t].slice(-3);
  emit();
  setTimeout(() => dismiss(t.id), t.error ? 8000 : 4000);
}
function dismiss(id: number) {
  toasts = toasts.filter((x) => x.id !== id);
  emit();
}

export function Toaster() {
  const t = useT();
  const list = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => toasts,
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
      {list.map((x) => (
        <div
          key={x.id}
          role={x.error ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-card p-3 pr-2 text-sm shadow-panel',
            x.error ? 'border-destructive/50' : 'border-border',
          )}
        >
          {x.error ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" /> : <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />}
          <p className="flex-1">{t(x.msg, x.vars)}</p>
          <button type="button" onClick={() => dismiss(x.id)} className="-mt-1 rounded-sm p-1 text-muted-foreground hover:text-foreground" aria-label={t('common.close')}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
