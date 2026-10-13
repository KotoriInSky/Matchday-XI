/* Form controls in the shadcn/ui style, built on native elements so they stay accessible without extra libraries. */
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, type LabelHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const control =
  'w-full min-w-0 rounded-md border border-input bg-field px-3 text-[15px] text-foreground shadow-xs transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, type = 'text', ...props }, ref) => (
  <input ref={ref} type={type} className={cn(control, 'h-11', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(control, 'min-h-28 resize-y py-2 text-sm leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <div className={cn('relative min-w-0', className)}>
    <select ref={ref} className={cn(control, 'h-11 appearance-none pr-9')} {...props}>
      {children}
    </select>
    <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
  </div>
));
Select.displayName = 'Select';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-[13px] font-semibold text-foreground', className)} {...props} />;
}

/** A labelled control with optional helper text and error, wired up for screen readers. */
export function Field({
  label, hint, error, children, className, aside,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  /** Shown at the end of the label row, e.g. the current value of a slider. */
  aside?: ReactNode;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? id + '-hint' : undefined, errId = error ? id + '-err' : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {aside != null && <span className="text-[13px] font-medium tabular-nums text-muted-foreground">{aside}</span>}
      </div>
      {children({ id, describedBy, invalid: !!error })}
      {error && (
        <p id={errId} role="alert" className="text-[13px] font-medium text-destructive">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Switch({
  checked, onCheckedChange, label, className, id,
}: {
  checked: boolean;
  onCheckedChange(v: boolean): void;
  label: ReactNode;
  className?: string;
  id?: string;
}) {
  const auto = useId();
  const sid = id || auto;
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <label htmlFor={sid} className="cursor-pointer text-sm font-medium">
        {label}
      </label>
      <button
        id={sid}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative inline-flex h-11 w-12 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors',
          'before:absolute before:inset-x-0 before:top-2.5 before:h-6 before:rounded-full',
          checked ? 'before:bg-primary' : 'before:bg-input',
        )}
      >
        <span
          className={cn(
            'pointer-events-none relative block size-5 rounded-full bg-white shadow-sm ring-0 transition-transform',
            checked ? 'translate-x-6' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

/** A range slider with its label and current value. */
export function Slider({
  label, value, min, max, step = 1, onChange, format, hint,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(v: number): void;
  format?: (v: number) => string;
  hint?: ReactNode;
}) {
  const shown = format ? format(value) : String(value);
  return (
    <Field label={label} hint={hint} aside={shown}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={shown}
          aria-describedby={describedBy}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-6 w-full cursor-pointer"
        />
      )}
    </Field>
  );
}

/** Options shown as a row of buttons, for short exclusive choices. */
export function Segmented<T extends string>({
  value, onChange, options, label, className, size = 'default',
}: {
  value: T;
  onChange(v: T): void;
  options: { value: T; label: ReactNode; icon?: ReactNode; title?: string }[];
  label: string;
  className?: string;
  size?: 'default' | 'sm';
}) {
  const gid = useId();
  const move = (dir: number) => {
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + dir + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() => document.getElementById(`${gid}-${next.value}`)?.focus());
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-md border border-border bg-muted p-0.5', className)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            id={`${gid}-${o.value}`}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-[calc(var(--radius)-6px)] font-semibold transition-colors [&_svg]:size-4',
              size === 'sm' ? 'min-h-11 px-2 text-[13px]' : 'min-h-11 px-3 text-sm',
              on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
