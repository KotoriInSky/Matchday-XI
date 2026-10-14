import { useRef, useState } from 'react';
import { ArrowDown01, ChevronDown, Star } from 'lucide-react';
import { PRESET_FORMATIONS } from '@/engine/constants';
import { parseFormation, slotsFor } from '@/engine/formation';
import type { Player } from '@/engine/types';
import { sortSubstitutes } from '@/engine/state';
import { useT } from '@/i18n';
import { store, useLineup } from '@/lib/store';
import { Button } from '../ui/button';
import { Field, Input, Textarea } from '../ui/form';
import { Section } from '../ui/section';
import { toast } from '../Toaster';

export function LineupPanel({ onInspect }: { onInspect(i: number): void }) {
  const t = useT();
  const s = useLineup();
  const slots = slotsFor(s.formation, s.look.gk);


  return (
    <div className="flex flex-col gap-4">
      <Section title={t('lineup.formation')}>
        <FormationField />
      </Section>

      <Section title={t('lineup.startingXI')}>
        <ol className="flex flex-col gap-2">
          {s.players.map((p, i) => (
            <PlayerRow
              key={i}
              i={i}
              p={p}
              slotPos={slots[i]?.pos ?? ''}
              onToggle={() => onInspect(i)}
            />
          ))}
        </ol>
      </Section>

      <Section title={t('lineup.substitutes')}>
        <Field label={t('lineup.substitutes')} hint={t('lineup.subsHint')} className="[&>div:first-child]:sr-only">
          {({ id, describedBy }) => (
            <Textarea id={id} aria-describedby={describedBy} rows={8} value={s.subs} onChange={(e) => store.update((st) => (st.subs = e.target.value))} />
          )}
        </Field>
        <Button variant="outline" className="self-start" disabled={sortSubstitutes(s.subs) === s.subs} onClick={() => {
          store.beginHistoryGroup();
          store.update((st) => { st.subs = sortSubstitutes(st.subs); });
          store.endHistoryGroup();
        }}><ArrowDown01 />{t('lineup.sortSubs')}</Button>
        <p className="text-xs text-muted-foreground">{t('lineup.sortSubsHint')}</p>
      </Section>
    </div>
  );
}

function FormationField() {
  const t = useT();
  const s = useLineup();
  const [text, setText] = useState(s.formation);
  const [error, setError] = useState(false);
  const last = useRef(s.formation);
  // follow changes made elsewhere (loading a setup, starting over)
  if (last.current !== s.formation) {
    last.current = s.formation;
    if (parseFormation(text)?.label !== s.formation) { setText(s.formation); setError(false); }
  }
  const moved = Object.keys(s.slotPos).length > 0;
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Field label={t('lineup.formation')} error={error ? t('lineup.formationError') : undefined} className="min-w-0 flex-1 basis-52 [&>div:first-child]:sr-only">
        {({ id, describedBy, invalid }) => (
          <>
            <Input
              id={id}
              list="formation-list"
              autoComplete="off"
              spellCheck={false}
              inputMode="numeric"
              value={text}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              className="font-heading text-lg font-bold tracking-wide"
              onChange={(e) => {
                setText(e.target.value);
                const f = parseFormation(e.target.value);
                setError(!f);
                if (f && f.label !== store.state.formation) store.update((st) => { st.formation = f.label; st.slotPos = {}; });
              }}
              onBlur={() => { if (!parseFormation(text)) { setText(store.state.formation); setError(false); } }}
            />
            <datalist id="formation-list">
              {PRESET_FORMATIONS.map((f) => <option key={f} value={f} />)}
            </datalist>
          </>
        )}
      </Field>
      <Button
        variant="outline"
        disabled={!moved}
        onClick={() => {
          store.update((st) => (st.slotPos = {}));
          toast('lineup.positionsReset', { vars: { formation: store.state.formation } });
        }}
      >
        {t('lineup.resetPositions')}
      </Button>
    </div>
  );
}

function PlayerRow({ i, p, slotPos, onToggle }: { i: number; p: Player; slotPos: string; onToggle(): void }) {
  const t = useT();
  return (
    <li className="border-b border-border">
      <button type="button" className="player-index-row" onClick={onToggle} aria-label={t('lineup.details', { name: p.name || t('lineup.player', { n: i + 1 }) })}>
        <span className="text-xs text-muted-foreground">{p.pos || slotPos}</span>
        <span className="text-sm tabular-nums">{p.num}</span>
        <span className="min-w-0 truncate text-left font-medium">{p.name}</span>
        <span className="flex items-center gap-2">
          {p.captain && <span aria-label={t('lineup.captain')} className="text-xs">C</span>}
          {p.key && <Star className="size-3" aria-label={t('lineup.key')} />}
          <ChevronDown className="size-4 -rotate-90" aria-hidden="true" />
        </span>
      </button>
    </li>
  );
}
