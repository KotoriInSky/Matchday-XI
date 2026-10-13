import { useRef, useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useLineup } from '@/lib/store';
import { tagMatches, tagName } from '@/lib/fifa';
import { Input } from '../ui/form';
import { Button } from '../ui/button';
import { FifaFlagLibrary } from './FifaFlagLibrary';

/** Visible picture choices keep tag assignment one click away. */
export function TagPicker({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  const { t, lang } = useI18n();
  const s = useLineup();
  const details = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'project' | 'fifa'>('project');
  const current = s.tags.find((tag) => tag.id === value);
  const choose = (next: string) => { onChange(next); if (details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } setQuery(''); };
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      <details ref={details} className="tag-picker">
        <summary>{current?.img && <img src={current.img} alt="" />}<span>{current ? tagName(current, lang) || t('lineup.unnamedTag') : t('lineup.noTag')}</span></summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant={source === 'project' ? 'secondary' : 'outline'} aria-pressed={source === 'project'} onClick={() => { setSource('project'); setQuery(''); }}>{t('fifa.projectTags')}</Button>
          <Button size="sm" variant={source === 'fifa' ? 'secondary' : 'outline'} aria-pressed={source === 'fifa'} onClick={() => { setSource('fifa'); setQuery(''); }}>{t('fifa.title')}</Button>
        </div>
        <Input type="search" className="mt-3" aria-label={`${label}: ${t(source === 'fifa' ? 'fifa.search' : 'tags.search')}`} placeholder={t(source === 'fifa' ? 'fifa.search' : 'tags.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        {source === 'fifa' ? <FifaFlagLibrary query={query} onSelect={id => { choose(id); setSource('project'); }} /> : <div className="tag-options mt-2">
        <button type="button" className="tag-option" aria-pressed={!value} onClick={() => choose('')}>
          <Minus className="size-5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{t('lineup.noTag')}</span>
          {!value && <Check className="size-4 shrink-0" aria-hidden="true" />}
        </button>
        {s.tags.filter(tag => tagMatches(tag, query)).map((tag) => (
          <button key={tag.id} type="button" className="tag-option" aria-pressed={value === tag.id} onClick={() => choose(tag.id)}>
            {tag.img && <img src={tag.img} alt="" />}
            <span className="min-w-0 flex-1 break-words">{tagName(tag, lang) || t('lineup.unnamedTag')}</span>
            {value === tag.id && <Check className="size-4 shrink-0" aria-hidden="true" />}
          </button>
        ))}
      </div>}
      </details>
      {!s.tags.length && <p className="mt-2 text-xs text-muted-foreground">{t('tags.manage')}</p>}
    </fieldset>
  );
}
