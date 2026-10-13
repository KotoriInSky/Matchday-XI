import { useRef, useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { useT } from '@/i18n';
import { useLineup } from '@/lib/store';
import { Input } from '../ui/form';

/** Visible picture choices keep tag assignment one click away. */
export function TagPicker({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  const t = useT();
  const s = useLineup();
  const details = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState('');
  const current = s.tags.find((tag) => tag.id === value);
  const choose = (next: string) => { onChange(next); if (details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } setQuery(''); };
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      <details ref={details} className="tag-picker">
        <summary>{current?.img && <img src={current.img} alt="" />}<span>{current?.label || t('lineup.noTag')}</span></summary>
        <Input type="search" aria-label={`${label}: ${t('tags.search')}`} placeholder={t('tags.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="tag-options">
        <button type="button" className="tag-option" aria-pressed={!value} onClick={() => choose('')}>
          <Minus className="size-5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{t('lineup.noTag')}</span>
          {!value && <Check className="size-4 shrink-0" aria-hidden="true" />}
        </button>
        {s.tags.filter((tag) => tag.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((tag) => (
          <button key={tag.id} type="button" className="tag-option" aria-pressed={value === tag.id} onClick={() => choose(tag.id)}>
            {tag.img && <img src={tag.img} alt="" />}
            <span className="min-w-0 flex-1 break-words">{tag.label || t('lineup.unnamedTag')}</span>
            {value === tag.id && <Check className="size-4 shrink-0" aria-hidden="true" />}
          </button>
        ))}
      </div>
      </details>
      {!s.tags.length && <p className="mt-2 text-xs text-muted-foreground">{t('tags.manage')}</p>}
    </fieldset>
  );
}
