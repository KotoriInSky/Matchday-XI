import { playerNameLines, splitName, playerTagPath } from '@/engine/state';
import { cardArtwork } from '@/engine/card-artwork';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Undo2, Redo2, Plus, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { uploadPlayerPhoto, uploadTag } from '@/lib/actions';
import { PictureButtons } from './Picture';
import { newFit } from '@/engine/constants';
import { TagPicker } from './TagPicker';

import { esc } from '@/engine/markup';


import { clamp, fitRef } from '@/engine/state';
import type { FitPath } from '@/engine/types';
import styles from '@/engine/stage.module.css';

import { useI18n } from '@/i18n';
import { store, useLineup } from '@/lib/store';
import { Button } from '../ui/button';
import { Field, Input, Textarea, Select, Slider, Switch } from '../ui/form';
import { Subsection } from '../ui/section';
import { CardExport } from './CardExport';

export function CardPreview({ playerIndex, tagId, onPlayerChange, onClose, onSceneAdjust }: {
  playerIndex: number; tagId: string | null; onPlayerChange(i: number): void; onClose(): void; onSceneAdjust(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [armed, setArmed] = useState(false);
  const [copyArmed, setCopyArmed] = useState(false);
  const [nameDraft, setNameDraft] = useState<[string, string] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const opener = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { node?.close(); document.body.style.overflow = overflow; if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); };
  }, []);
  const s = useLineup();
  const { t, lang } = useI18n();
  const p = s.players[playerIndex] ?? s.players[0];
  const tag = s.tags.find((item) => item.id === tagId);
  const sample = !!tag && p.tag1 !== tag.id && p.tag2 !== tag.id;
  const shown = tag ? { ...s, players: s.players.map((item, i) => i === playerIndex ? { ...item, ...(sample ? { tag1: tag.id } : {}), tagFits: { ...item.tagFits, [tag.id]: tag.fit } } : item) } : s;
  const [variant, setVariant] = useState<'small' | 'big' | 'key'>('big');
  const [target, setTarget] = useState('photo');
  const zh = lang.startsWith('zh');
  const labels = { small: zh ? '小卡' : 'Pitch card', big: zh ? '大卡' : 'Player card', key: 'Highlight' };
  useEffect(() => { setTarget(tagId ? 'tag:' + tagId : 'photo'); setArmed(false); setCopyArmed(false); setNameDraft(null); }, [playerIndex, tagId]);
  const slot = variant === 'small' ? 'photo2' : variant === 'key' ? 'photoK' : 'photo';
  const fitKey = variant === 'small' ? 'fitS' : variant === 'key' ? 'fitK' : 'fit';
  const source = p[slot] || (slot !== 'photo' ? p.photo : null);
  const inherited = !p[slot] && !!source;
  const active = tag ? 'tag:' + tag.id : target;
  const localTagId = !tag && active.startsWith('tag:') ? active.slice(4) : null;
  const path: FitPath | null = active.startsWith('tag:') ? tag ? `${active}:fit` : playerTagPath(playerIndex, active.slice(4)) : source ? `p:${playerIndex}:${fitKey}` : null;
  const assignedTags = [...new Set([shown.players[playerIndex].tag1, shown.players[playerIndex].tag2].filter(Boolean))]
    .flatMap((id) => { const item = s.tags.find((tg) => tg.id === id); return item?.img ? [item] : []; });
  const fit = path ? fitRef(s, path) : null;
  const drag = useRef<{ x: number; y: number; fx: number; fy: number; width: number; height: number; path: FitPath } | null>(null);
  const change = (key: 'x' | 'y' | 'z', value: number) => {
    if (path) store.update((state) => { const f = fitRef(state, path, true); if (f) f[key] = value; }, { fit: path });
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const hit = (e.target as Element).closest<HTMLElement>('[data-fit]');
    const image = hit || ((e.target as Element).closest('.' + styles.rc) && [...e.currentTarget.querySelectorAll<HTMLElement>('[data-fit]')].find((el) => el.dataset.fit === path));
    if (!image) return;
    const imagePath = image.dataset.fit as FitPath;
    const f = fitRef(s, imagePath);
    if (!f) return;
    if (imagePath !== path) return;
    store.beginHistoryGroup();
    setTarget(active);
    const rect = image.getBoundingClientRect();
    drag.current = { x: e.clientX, y: e.clientY, fx: f.x, fy: f.y, width: Math.max(1, rect.width / f.z), height: Math.max(1, rect.height / f.z), path: imagePath };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const endDrag = () => { if (drag.current) { drag.current = null; store.touched(); store.endHistoryGroup(); } };
  useEffect(() => () => { if (drag.current) store.touched(); store.endHistoryGroup(); }, []);
  const canvas = useRef<HTMLDivElement>(null);
  const art = cardArtwork(shown, playerIndex, tag ? 'big' : variant, lang);
  const html = tag ? art.html.replaceAll(`data-fit="${esc(playerTagPath(playerIndex, tag.id))}"`, `data-fit="${esc(path)}"`) : art.html;
  const adjustmentControls = fit && <div className="flex flex-col gap-4 border-t border-border pt-4">
        {active.startsWith('tag:') && <p className="text-xs text-muted-foreground">{tag ? (zh ? '共享默认位置 · 未单独调整的球员会同步' : 'Shared default · applies to players without overrides') : (zh ? '位置仅用于当前球员' : 'Position applies to this player only')}</p>}
        <Slider label={t('framer.size')} min={30} max={300} value={Math.round(fit.z * 100)} format={(v) => `${v}%`} onChange={(v) => change('z', clamp(v / 100, .3, 3))} />
        <div className="grid grid-cols-2 gap-4">
          <Slider label={t('card.horizontal')} min={Math.min(-100, Math.floor(fit.x))} max={Math.max(100, Math.ceil(fit.x))} value={Math.round(fit.x)} onChange={(v) => change('x', v)} />
          <Slider label={t('card.vertical')} min={Math.min(-100, Math.floor(fit.y))} max={Math.max(100, Math.ceil(fit.y))} value={Math.round(fit.y)} onChange={(v) => change('y', v)} />
        </div>
        <Button variant="ghost" onClick={() => path && store.update((state) => { if (localTagId) { if (state.players[playerIndex].tagFits) delete state.players[playerIndex].tagFits![localTagId]; } else { const f = fitRef(state, path, true); if (f) Object.assign(f, { x: 0, y: 0, z: 1 }); } }, { fit: path })}>{localTagId ? (zh ? '恢复共享位置' : 'Use shared position') : t('adjust.reset')}</Button>
      </div>;
  return createPortal(
    <dialog ref={dialog} className="card-dialog" data-preview-expanded={expanded} aria-label={t(tag ? 'tags.edit' : 'card.edit')} onPointerDownCapture={(e) => { if (e.target instanceof HTMLInputElement && e.target.type === 'range') { store.beginHistoryGroup(); e.target.setPointerCapture(e.pointerId); } }} onPointerUpCapture={(e) => { if (e.target instanceof HTMLInputElement && e.target.type === 'range') store.endHistoryGroup(); }} onPointerCancelCapture={(e) => { if (e.target instanceof HTMLInputElement && e.target.type === 'range') store.endHistoryGroup(); }} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <section className="card-inspector" aria-label={t('card.preview')}>
      <div className="card-dialog-header">
        <h2 className="text-lg font-semibold">{t(tag ? 'tags.edit' : 'card.edit')}</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" disabled={!store.canUndo} onClick={store.undo} aria-label={zh ? '撤销' : 'Undo'} title={zh ? '撤销 · Ctrl/⌘ Z' : 'Undo · Ctrl/⌘ Z'}><Undo2 /></Button>
          <Button variant="ghost" size="icon" disabled={!store.canRedo} onClick={store.redo} aria-label={zh ? '重做' : 'Redo'} title={zh ? '重做 · Ctrl/⌘ Shift Z' : 'Redo · Ctrl/⌘ Shift Z'}><Redo2 /></Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('common.close')}><X /></Button>
        </div>
      </div>
      <div className="card-dialog-layout">
      <div className="card-dialog-preview">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t('card.player')} className="min-w-36 flex-1" value={playerIndex} onChange={(e) => onPlayerChange(Number(e.target.value))}>
          {s.players.map((player, i) => <option key={i} value={i}>{player.num} · {player.name}</option>)}
        </Select>
        <Button variant="ghost" size="icon" disabled={playerIndex === 0} onClick={() => onPlayerChange(playerIndex - 1)} aria-label={zh ? '上一位球员' : 'Previous player'}><ChevronLeft /></Button>
        <Button variant="ghost" size="icon" disabled={playerIndex >= s.players.length - 1} onClick={() => onPlayerChange(playerIndex + 1)} aria-label={zh ? '下一位球员' : 'Next player'}><ChevronRight /></Button>
      </div>
      {!tag && <div className="card-variant-picker grid grid-cols-3 gap-2" role="group" aria-label={zh ? '卡片图片' : 'Card artwork'}>
        {(['small', 'big', 'key'] as const).map((kind) => {
          const imageSlot = kind === 'small' ? 'photo2' : kind === 'key' ? 'photoK' : 'photo';
          const image = p[imageSlot] || (imageSlot !== 'photo' ? p.photo : null);
          return <button key={kind} type="button" aria-label={labels[kind]} aria-pressed={variant === kind} onClick={() => { setVariant(kind); setTarget('photo'); setCopyArmed(false); }} className={`flex min-h-20 flex-col items-center gap-2 rounded border p-2 text-xs ${variant === kind ? 'border-primary bg-accent font-semibold' : 'border-border text-muted-foreground'}`}>
            {image ? <img src={image} alt="" className="h-12 w-full object-contain" /> : <span className="flex h-12 items-center"><Plus className="size-5" aria-hidden="true" /></span>}
            <span>{labels[kind]}{kind === 'key' && !p.key ? (zh ? ' · 未启用' : ' · Off') : ''}</span>
          </button>;
        })}
      </div>}
      {sample && <p className="text-xs text-muted-foreground">{t('card.sample')}</p>}
      <div ref={canvas} className="card-inspector-canvas" onPointerDown={onPointerDown} onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        store.update((state) => { const f = fitRef(state, d.path, true); if (f) { f.x = d.fx + (e.clientX - d.x) / d.width * 100; f.y = d.fy + (e.clientY - d.y) / d.height * 100; } }, { fit: d.path }, false);
      }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
        <div className={art.className} data-shape={s.look.shape} style={art.css} lang={art.lang} role="img" aria-label={`${p.name} — ${t('card.preview')}`} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <Button variant="ghost" size="sm" className="card-preview-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? (zh ? '收起大图' : 'Compact preview') : (zh ? '展开大图' : 'Expand preview')}</Button>
      </div>
      <div className="card-dialog-fields">
        {tag ? <>
          <Field label={t('tags.name')}>{({ id }) => <Input id={id} value={tag.label} onChange={(e) => store.update((state) => { const item = state.tags.find((tg) => tg.id === tag.id); if (item) item.label = e.target.value; }, 'none')} />}</Field>
          <Field label={t('tags.shape')}>{({ id }) => <Select id={id} value={tag.shape} onChange={(e) => store.update((state) => { const item = state.tags.find((tg) => tg.id === tag.id); if (item) item.shape = e.target.value === 'square' ? 'square' : 'wide'; })}><option value="wide">{t('tags.wide')}</option><option value="square">{t('tags.square')}</option></Select>}</Field>
          <Slider label={t('tags.size')} min={60} max={200} step={5} value={s.look.tagSize} format={(v) => `${v}%`} onChange={(v) => store.update((state) => state.look.tagSize = v)} />
          <PictureButtons has={!!tag.img} onUpload={() => uploadTag(tag.id)} />
          {adjustmentControls}
        </> : <>
          <Field label={zh ? '完整姓名' : 'Full name'}>{({ id }) => <Input id={id} value={p.name} onChange={(e) => { setNameDraft(null); store.update((state) => state.players[playerIndex].name = e.target.value); }} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('lineup.number')}>{({ id }) => <Input id={id} maxLength={3} value={p.num} onChange={(e) => store.update((state) => state.players[playerIndex].num = e.target.value)} />}</Field>

          </div>
          <Subsection title={zh ? '卡片显示姓名' : 'Card name'} headingLevel={3}>
          <Button variant="ghost" size="sm" className="self-start" disabled={!p.name.trim()} onClick={() => setNameDraft(splitName(p.name))}>{zh ? '从完整姓名生成' : 'Generate from full name'}</Button>
          {nameDraft && <div className="space-y-3 border border-border rounded-md p-3" role="group" aria-label={zh ? '核对生成姓名' : 'Review generated name'}>
            <p className="text-xs text-muted-foreground">{zh ? '核对两行内容后应用，可直接修改。' : 'Review both lines before applying. Edit as needed.'}</p>
            <div className="grid grid-cols-2 gap-3">{([0, 1] as const).map((line) => <Field key={line} label={zh ? `生成第${line ? '二' : '一'}行` : `Generated line ${line + 1}`}>{({ id }) => <Input id={id} value={nameDraft[line]} onChange={(e) => setNameDraft((draft) => draft ? line ? [draft[0], e.target.value] : [e.target.value, draft[1]] : null)} />}</Field>)}</div>
            <div className="flex gap-2"><Button size="sm" onClick={() => { store.beginHistoryGroup(); store.update((state) => { state.players[playerIndex].nameLine1 = nameDraft[0]; state.players[playerIndex].nameLine2 = nameDraft[1]; }); store.endHistoryGroup(); setNameDraft(null); }}>{zh ? '应用姓名' : 'Apply name'}</Button><Button size="sm" variant="ghost" onClick={() => setNameDraft(null)}>{zh ? '取消' : 'Cancel'}</Button></div>
          </div>}
          <div className="grid grid-cols-2 gap-3">
            {([0, 1] as const).map((line) => <div key={line} className="min-w-0 space-y-3">
              <Field label={zh ? (line ? '第二行' : '第一行') : (line ? 'Second line' : 'First line')}>{({ id }) => <Textarea id={id} rows={2} aria-describedby="card-name-wrap-help" value={playerNameLines(p)[line]} onChange={(e) => store.update((state) => { const player = state.players[playerIndex]; const lines = playerNameLines(player); player.nameLine1 = lines[0]; player.nameLine2 = lines[1]; player[line ? 'nameLine2' : 'nameLine1'] = e.target.value; })} />}</Field>
              <Slider label={zh ? '字号' : 'Text size'} min={60} max={140} step={5} value={line ? p.nameSize2 : p.nameSize1} format={(v) => `${v}%`} onChange={(v) => store.update((state) => { state.players[playerIndex][line ? 'nameSize2' : 'nameSize1'] = v; })} />
            </div>)}
          </div>
          <p id="card-name-wrap-help" className="text-xs text-muted-foreground">{zh ? '按 Enter 换行，例如 ALEXANDER- ↵ ARNOLD。字号保持不变，文字从底部向上延展。' : 'Press Enter to wrap, e.g. ALEXANDER- ↵ ARNOLD. Text grows upward at the same size.'}</p>
          </Subsection>
          <div className="card-field-pair">
          <Switch label={t('lineup.key')} checked={p.key} onCheckedChange={(value) => store.update((state) => state.players[playerIndex].key = value)} />
              <Switch label={t('lineup.captain')} checked={p.captain} onCheckedChange={(value) => store.update((state) => state.players.forEach((player, i) => { player.captain = i === playerIndex ? value : false; }))} />
          </div>
          <Subsection title={labels[variant]} headingLevel={3} className="border-t border-border pt-4">
            {inherited && <p className="text-xs text-muted-foreground">{zh ? '沿用大卡图片，裁切独立保存。' : 'Using the player-card image with independent framing.'}</p>}
            <PictureButtons has={!!p[slot]} onUpload={() => uploadPlayerPhoto(playerIndex, slot)} onRemove={() => store.update((state) => { state.players[playerIndex][slot] = null; state.players[playerIndex][fitKey] = newFit(); })} />
            {source && <Button variant="ghost" size="sm" className="self-start" onClick={() => {
              if (!copyArmed && (['photo', 'photo2', 'photoK'] as const).some((key) => key !== slot && p[key] && p[key] !== source)) { setCopyArmed(true); return; }
              store.update((state) => {
              const player = state.players[playerIndex];
              const cut = slot === 'photoK' && player.photoK ? player.cutK : player.cut;
              player.photo = source; player.photo2 = source; player.photoK = source;
              player.cut = cut; player.cutK = cut; player.cutS = cut;
            }); setCopyArmed(false);
            }}>{copyArmed ? (zh ? '确认替换其他卡片图片' : 'Confirm replacing other images') : (zh ? '应用图片到其他卡片' : 'Use image on all cards')}</Button>}
            {active === 'photo' ? adjustmentControls : <Button variant="outline" onClick={() => setTarget('photo')}>{zh ? '调整图片' : 'Adjust image'}</Button>}
          </Subsection>
          <div className="card-field-pair">
          <TagPicker label={t('lineup.tag1')} value={p.tag1} onChange={(value) => store.update((state) => state.players[playerIndex].tag1 = value)} />
          <TagPicker label={t('lineup.tag2')} value={p.tag2} onChange={(value) => store.update((state) => state.players[playerIndex].tag2 = value)} />
          </div>
          {assignedTags.length > 0 && variant !== 'small' && <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">{assignedTags.map((item) => <Button key={item.id} variant={active === 'tag:' + item.id ? 'secondary' : 'ghost'} size="sm" onClick={() => setTarget('tag:' + item.id)}>{zh ? '调整标签' : 'Adjust tag'} · {item.label}</Button>)}</div>
            {active.startsWith('tag:') && adjustmentControls}
          </div>}
          <CardExport playerIndex={playerIndex} kind={variant} />
          <details className="how-to">
            <summary>{t('card.more')}</summary>
            <div className="flex flex-col gap-4 py-3">
              <Field label={t('lineup.position')}>{({ id }) => <Input id={id} maxLength={5} value={p.pos} onChange={(e) => store.update((state) => state.players[playerIndex].pos = e.target.value.toUpperCase())} />}</Field>
              <div className="flex flex-wrap gap-2">
                {([-1, 1] as const).map((dir) => <Button key={dir} variant="ghost" disabled={playerIndex + dir < 0 || playerIndex + dir >= s.players.length} onClick={() => {
                  const next = playerIndex + dir;
                  store.update((state) => { [state.players[playerIndex], state.players[next]] = [state.players[next], state.players[playerIndex]]; });
                  onPlayerChange(next);
                }}>{dir < 0 ? <ArrowUp /> : <ArrowDown />}{t(dir < 0 ? 'lineup.moveUp' : 'lineup.moveDown')}</Button>)}
              </div>
            </div>
          </details>
        </>}

      {tag ? <Button variant={armed ? 'destructive' : 'ghost'} onClick={() => {
        const used = s.players.some((player) => player.tag1 === tag.id || player.tag2 === tag.id);
        if (used && !armed) { setArmed(true); return; }
        store.update((state) => { state.tags = state.tags.filter((item) => item.id !== tag.id); state.players.forEach((player) => { if (player.tag1 === tag.id) player.tag1 = ''; if (player.tag2 === tag.id) player.tag2 = ''; }); });
        onClose();
      }}>{armed ? t('tags.confirmRemove', { count: s.players.filter((player) => player.tag1 === tag.id || player.tag2 === tag.id).length }) : t('tags.remove')}</Button> : <Button variant="ghost" onClick={onSceneAdjust}>{t('card.scene')}</Button>}
      </div>
      </div>
    </section>
    </dialog>, document.body
  );
}
