import { useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useI18n, type MessageId } from '@/i18n';
import { store, useLineup } from '@/lib/store';
import { PALETTES } from './palettes';
import { Switch } from '../ui/form';

type Palette = typeof PALETTES[number];
function Swatch({ colors }: { colors: Palette['colors'] }) {
  return <span aria-hidden="true" className="flex h-7 w-12 shrink-0 overflow-hidden rounded-sm ring-1 ring-black/15">{[colors.c1, colors.k2, colors.c2].map((color, i) => <span key={i} className="flex-1" style={{ background: color }} />)}</span>;
}
export function PalettePicker() {
  const { t, lang } = useI18n();
  const { colors, colorOverrides } = useLineup();
  const details = useRef<HTMLDetailsElement>(null);
  const [keepDetails, setKeepDetails] = useState(true);
  const zh = lang.startsWith('zh');
  const tw = lang === 'zh-Hant';
  const name = (p: Palette) => p.group === 'classic' ? t(`preset.${p.id}` as MessageId) : p.name[zh ? tw ? 1 : 0 : 2];
  const selected = Object.keys(colorOverrides ?? {}).length ? undefined : PALETTES.find((p) => Object.entries(p.colors).every(([k, v]) => colors[k as keyof typeof colors].toLowerCase() === v.toLowerCase()));
  return <details ref={details}>
    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 border-b border-border py-2 text-sm font-medium">
      <Swatch colors={colors} /><span className="flex-1">{selected ? name(selected) : zh ? (tw ? '自訂配色' : '自定义配色') : 'Custom palette'}</span><span className="text-xs text-muted-foreground">{zh ? '更换'.replace('换', tw ? '換' : '换') : 'Change'}</span><ChevronDown size={16} />
    </summary>
    <div className="max-h-80 space-y-5 overflow-y-auto py-4">
      {!!Object.keys(colorOverrides ?? {}).length && <Switch label={zh ? '保留细节颜色' : 'Keep custom detail colours'} checked={keepDetails} onCheckedChange={setKeepDetails} />}
      {(['club', 'national', 'classic'] as const).map((group) => <div key={group}>
        <p className="mb-2 text-xs font-medium text-muted-foreground">{group === 'club' ? zh ? (tw ? '俱樂部' : '俱乐部') : 'Clubs' : group === 'national' ? zh ? (tw ? '國家隊' : '国家队') : 'National teams' : zh ? (tw ? '經典' : '经典') : 'Classics'}</p>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{PALETTES.filter((p) => p.group === group).map((p) => <button key={p.id} type="button" aria-pressed={p.id === selected?.id} className="flex min-h-12 items-center gap-2 rounded-sm px-1 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary" onClick={() => { store.beginHistoryGroup(); store.update((s) => { Object.assign(s.colors, p.colors); if (!keepDetails) s.colorOverrides = {}; }); store.endHistoryGroup(); if (details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } }}><Swatch colors={p.colors} /><span className="flex-1">{name(p)}</span>{p.id === selected?.id && <Check size={15} />}</button>)}</div>
      </div>)}
    </div>
  </details>;
}
