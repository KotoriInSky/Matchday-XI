import { useEffect, useRef, useState } from 'react';
import { Download, ImageDown } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useLineup, store } from '@/lib/store';
import { exportCards } from '@/lib/card-export';
import { releaseDownload } from '@/lib/export-file';
import type { CardKind } from '@/engine/card-artwork';
import { Button } from '../ui/button';
import { Field, Select } from '../ui/form';
import { Section, Subsection } from '../ui/section';
import { ExportTiming, useExportProgress } from './ExportTiming';

const kinds: CardKind[] = ['small', 'big', 'key'];

export function CardExport({ playerIndex, kind = 'big' }: { playerIndex?: number; kind?: CardKind }) {
  const { lang } = useI18n();
  const s = useLineup(), batch = playerIndex === undefined;
  const text = (cn: string, en: string) => lang.startsWith('zh') ? cn : en;
  const labels = { small: text('小卡', 'Pitch card'), big: text('大卡', 'Player card'), key: 'Highlight' };
  const [size, setSize] = useState('2048');
  const [players, setPlayers] = useState(() => s.players.map((_, i) => i));
  const [types, setTypes] = useState<CardKind[]>(['big']);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [error, setError] = useState('');
  const [status, setStatus] = useState('preparing');
  const timing = useExportProgress(busy);
  const [result, setResult] = useState<{ url: string; filename: string; description: string } | null>(null);
  const controller = useRef<AbortController | null>(null), mounted = useRef(false);
  const download = useRef('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); void releaseDownload(download.current); }; }, []);
  const count = batch ? players.length * types.length : 1;
  const start = async () => {
    const ctrl = new AbortController(); controller.current = ctrl;
    const selected = batch ? players : [playerIndex];
    const variants = batch ? types : [kind];
    const description = batch ? `${count} PNG` : `${s.players[playerIndex].name} · ${labels[kind]}`;
    setBusy(true); setError(''); setProgress(0); setStatus('preparing'); timing.start();
    try {
      const file = await exportCards({ state: structuredClone(store.state), lang, size: Number(size), batch,
        cards: selected.flatMap(index => variants.map(kind => ({ index, kind }))), signal: ctrl.signal,
        onProgress: (value, phase) => { if (mounted.current) { setProgress(value); setStatus(phase); timing.update(value, phase); } } });
      if (mounted.current) {
        void releaseDownload(download.current); download.current = file.url;
        setResult({ ...file, description: `${description} · ${file.dimensions ? `${file.dimensions.width} × ${file.dimensions.height} px` : text(`卡框长边 ${size} px`, `Card frame long edge ${size} px`)}` });
      } else void releaseDownload(file.url);
    } catch (error) {
      if (mounted.current && !ctrl.signal.aborted) setError(error instanceof Error && error.message === 'busy'
        ? text('已有导出任务，请完成或取消后重试。', 'Another export is running. Finish or cancel it first.')
        : text('导出失败，请检查素材和字体，或降低尺寸后重试。', 'Export failed. Check images and fonts, or try a smaller size.'));
    } finally { if (mounted.current) setBusy(false); }
  };
  const content = <>
    {batch && <>
      <fieldset disabled={busy} className="space-y-2">
        <legend className="text-sm font-medium">{text('球员', 'Players')}</legend>
        <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setPlayers(s.players.map((_, index) => index))}>{text('全选', 'Select all')}</Button><Button size="sm" variant="ghost" onClick={() => setPlayers([])}>{text('取消全选', 'Clear selection')}</Button></div>
        <div className="grid grid-cols-2 gap-x-3">{s.players.map((player, index) => <label key={index} className="flex min-h-11 min-w-0 items-center gap-2" title={player.name}><input type="checkbox" className="size-4 shrink-0 accent-primary" checked={players.includes(index)} onChange={event => setPlayers(values => event.target.checked ? [...values, index].sort((a, b) => a - b) : values.filter(value => value !== index))} /><span className="truncate text-sm">{player.num} · {player.name}</span></label>)}</div>
      </fieldset>
      <fieldset disabled={busy} className="space-y-2"><legend className="text-sm font-medium">{text('卡片类型', 'Card types')}</legend><div className="flex flex-wrap gap-x-4">{kinds.map(value => <label key={value} className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-4 accent-primary" checked={types.includes(value)} onChange={event => setTypes(values => event.target.checked ? [...values, value] : values.filter(item => item !== value))} />{labels[value]}</label>)}</div></fieldset>
    </>}
    <Field label={text('卡框长边', 'Card frame long edge')}>{({ id }) => <Select id={id} value={size} disabled={busy} onChange={event => setSize(event.target.value)}>{[1024, 2048, 4096].map(value => <option key={value} value={value}>{value} px</option>)}</Select>}</Field>
    <p className="text-xs text-muted-foreground">{batch ? `${count} PNG` : labels[kind]} · {text('透明背景', 'Transparent background')}</p>
    <p className="text-xs text-muted-foreground">{text('同类卡框尺寸一致，出框人物、标签和阴影会扩展透明画布；PNG 实际尺寸可能超过所选长边。', 'Frames of the same type keep a consistent size. Portraits, tags and shadows extend the transparent canvas, so the PNG may exceed the selected frame size.')}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {busy ? <div role="status" className="space-y-3"><p className="text-sm">{status === 'preparing' ? text('准备素材', 'Preparing assets') : status === 'finishing' ? text('打包文件', 'Packaging files') : text('生成卡片', 'Rendering cards')} · {progress}%</p><progress className="w-full accent-primary" max={100} value={progress} /><ExportTiming timing={timing.timing} phase={status} />{!batch && <p className="text-xs text-muted-foreground">{text('关闭窗口将取消本次导出。', 'Closing this window cancels this export.')}</p>}<Button variant="outline" onClick={() => controller.current?.abort()}>{text('取消卡片导出', 'Cancel card export')}</Button></div>
      : <Button disabled={!count} onClick={start}><ImageDown />{batch ? text('导出卡片 ZIP', 'Export cards ZIP') : text('导出卡片 PNG', 'Export card PNG')}</Button>}
    {result && <div className="space-y-1"><p className="text-xs text-muted-foreground">{result.description}</p><a href={result.url} download={result.filename} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4"><Download className="size-4" />{batch ? text('下载 ZIP', 'Download ZIP') : text('下载 PNG', 'Download PNG')}</a><p className="text-xs text-muted-foreground">{text(batch ? '刷新页面前请保存文件。' : '关闭窗口前请保存文件。', batch ? 'Save before refreshing the page.' : 'Save before closing this window.')}</p></div>}
  </>;
  return batch ? <Section title={text('卡片导出', 'Card export')}>{content}</Section> : <Subsection title={text('卡片导出', 'Card export')} headingLevel={3} className="border-t border-border pt-4">{content}</Subsection>;
}
