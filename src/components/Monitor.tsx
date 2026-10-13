import { useEffect, useRef } from 'react';
import { Check, Maximize, Minimize, Minus, Pause, Play, Plus, RotateCcw, Scan } from 'lucide-react';
import { Stage, type SceneId } from '@/engine/stage';
import { cardName } from '@/engine/state';
import type { FitPath, LineupState } from '@/engine/types';
import { useI18n, type MessageId } from '@/i18n';
import { store, useLineup } from '@/lib/store';
import { setStage, usePlayback, getStage } from '@/lib/stage-instance';
import { Button } from './ui/button';
import { Select, Switch } from './ui/form';
import { toast } from './Toaster';

const SCENE_MSG: Record<SceneId, MessageId> = {
  intro: 'scene.intro', manager: 'scene.manager', players: 'scene.players', gk: 'scene.gk', def: 'scene.def',
  mid: 'scene.mid', fwd: 'scene.fwd', subs: 'scene.subs', final: 'scene.final',
};



function useFitLabel() {
  const { t } = useI18n();
  return (s: LineupState, path: FitPath | null) => {
    if (!path) return t('adjust.none');
    const [a, b, c] = path.split(':');
    if (a === 'p') {
      const p = s.players[Number(b)];
      const who = (p && (cardName(p) || p.num)) || t('lineup.player', { n: Number(b) + 1 });
      return `${who} · ${t(c === 'fitS' ? 'adjust.pitchCard' : c === 'fitK' ? 'adjust.keyCard' : 'adjust.bigCard')}`;
    }
    if (a === 'tag' || a === 'pt') {
      const tag = s.tags.find((x) => x.id === (a === 'pt' ? decodeURIComponent(c) : path.slice(4, -4)));
      return `${a === 'pt' ? s.players[Number(b)]?.name + ' · ' : ''}${tag?.label || t('lineup.unnamedTag')}`;
    }
    return t(a === 'coach' ? 'tab.manager' : a === 'crest' ? 'club.badge' : 'style.background');
  };
}

export function Monitor({ onPlayerClick, onInspect }: { onPlayerClick(i: number): void; onInspect(): void }) {
  const { t, lang } = useI18n();
  const s = useLineup();
  const pb = usePlayback();
  const host = useRef<HTMLDivElement>(null);
  const clickRef = useRef(onPlayerClick);
  clickRef.current = onPlayerClick;
  const langRef = useRef(lang);
  langRef.current = lang;
  const fitLabel = useFitLabel();

  useEffect(() => {
    const stage = new Stage(host.current!, {
      getState: () => store.state,
      getLang: () => langRef.current,
      onEdit: (ch) => {
        if (ch.kind === 'slot') { store.touched(); stage.soonRefresh(); }
        else store.touched(ch.final);
      },
      onPlayerClick: (i) => clickRef.current(i),
      onNotice: (n) => toast(n === 'videoError' ? 'preview.videoError' : 'preview.fullscreenUnavailable', { error: true }),
    });
    setStage(stage);
    const offChange = store.onChange((hint) => {
      if (hint === 'refresh') stage.soonRefresh();
      else if (hint !== 'none') stage.paintFit(hint.fit);
    });
    return () => { offChange(); setStage(null); stage.destroy(); };
  }, []);

  // "match the interface language" for Chinese, Japanese and Korean text
  useEffect(() => {
    getStage()?.refresh();
  }, [lang]);

  const stage = getStage();
  const atEnd = pb.total > 0 && pb.t >= pb.total - 0.05;
  const playLabel = pb.playing ? t('preview.pause') : atEnd ? t('preview.replay') : t('preview.play');
  const selZoom = Math.round((stage?.selectedZoom() ?? 1) * 100);

  return (
    <section aria-label={t('preview.label')} className="flex flex-col gap-3">
      {pb.adjusting && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-primary/50 bg-brand-soft px-3 py-2">
          <p className="min-w-0 flex-1 basis-60 text-[13px]">{t('adjust.help')}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <b className="mr-1 max-w-56 truncate text-[13px] text-brand">{fitLabel(s, pb.selected)}</b>
            <Button size="icon-sm" variant="outline" disabled={!pb.selected} onClick={() => stage?.zoomSelected(1 / 1.08)} aria-label={t('adjust.smaller')}>
              <Minus />
            </Button>
            <input
              type="range" min={30} max={300} value={selZoom} disabled={!pb.selected} aria-label={t('adjust.size')}
              onChange={(e) => stage?.setSelectedZoom(Number(e.target.value) / 100)} className="w-28 sm:w-36"
            />
            <Button size="icon-sm" variant="outline" disabled={!pb.selected} onClick={() => stage?.zoomSelected(1.08)} aria-label={t('adjust.larger')}>
              <Plus />
            </Button>
            <Button size="sm" variant="outline" disabled={!pb.selected} onClick={() => stage?.resetSelected()}>
              {t('adjust.reset')}
            </Button>
            <Button size="sm" onClick={() => stage?.setAdjusting(false)}>
              <Check />
              {t('adjust.done')}
            </Button>
          </div>
        </div>
      )}

      <div ref={host} />

      <div className="flex flex-col gap-2.5 px-0.5">
        <div className="flex items-center gap-2">
          <Button onClick={() => stage?.toggle()} className="w-28" aria-label={playLabel}>
            {pb.playing ? <Pause /> : atEnd ? <RotateCcw /> : <Play />}
            {playLabel}
          </Button>
          {!atEnd && (
            <Button variant="ghost" size="icon" onClick={() => stage?.restart()} aria-label={t('preview.restart')} title={t('preview.restart')}>
              <RotateCcw />
            </Button>
          )}
          <Timeline />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Select className="w-24" aria-label={t('preview.speed')} value={String(pb.rate)} onChange={(e) => stage?.setRate(Number(e.target.value))}>
            {['0.5', '0.75', '1', '1.5'].map((v) => <option key={v} value={v}>{v}×</option>)}
          </Select>
          <Switch label={t('preview.loop')} checked={s.anim.loop} onCheckedChange={(v) => store.update((st) => (st.anim.loop = v), 'none')} className="gap-2" />
          <div className="ml-auto flex items-center gap-2">
            <Button variant={pb.adjusting ? 'default' : 'outline'} size="sm" aria-pressed={pb.adjusting} onClick={() => pb.adjusting ? stage?.setAdjusting(false) : onInspect()}>
              <Scan />
              {t('preview.adjust')}
            </Button>
            <Button variant="ghost" size="icon" aria-label={t('preview.fullscreen')} onClick={() => stage?.toggleFullscreen()} title={t('preview.fullscreenHint')}>
              {pb.fullscreen ? <Minimize /> : <Maximize />}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The scrubber with a marker for each scene. */
function Timeline() {
  const { t } = useI18n();
  const pb = usePlayback();
  const stage = getStage();
  const wasPlaying = useRef(false);
  const total = Math.max(pb.total, 0.01);
  let activeMark = -1;
  pb.marks.forEach((mark, i) => { if (pb.t >= mark.t) activeMark = i; });
  const hasFinalMark = pb.marks.some((mark) => mark.scene === 'final');
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
      <div className="relative min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={total}
          step={0.01}
          value={Math.min(pb.t, total)}
          aria-label={t('preview.position')}
          aria-valuetext={`${pb.t.toFixed(1)} / ${pb.total.toFixed(1)} s`}
          onPointerDown={() => { wasPlaying.current = pb.playing; if (pb.playing) stage?.pause(); }}
          onChange={(e) => { if (pb.playing) stage?.pause(); stage?.seek(Number(e.target.value)); }}
          onPointerUp={() => { if (wasPlaying.current) { wasPlaying.current = false; stage?.play(); } }}
          className="block h-6 w-full cursor-pointer"
        />
      </div>
      <Select className="w-32 max-sm:w-full" aria-label={t('anim.scenes')} value={pb.scene === 'final' && !hasFinalMark ? 'end' : String(Math.max(0, activeMark))} onChange={(e) => { const index = Number(e.target.value); const mark = pb.marks[index]; const next = pb.marks[index + 1]?.t ?? pb.total; stage?.pause(); stage?.seek(mark ? Math.min(next - .01, mark.t + (next - mark.t) * .7) : pb.total); }}>
        {pb.marks.map((m, i) => <option key={i} value={i}>{t(SCENE_MSG[m.scene])}{pb.marks.filter((mark) => mark.scene === m.scene).length > 1 ? ` · ${pb.marks.slice(0, i + 1).filter((mark) => mark.scene === m.scene).length}` : ''}</option>)}
        {!hasFinalMark && <option value="end">{t('scene.final')}</option>}
      </Select>
      <span className="hidden text-[13px] whitespace-nowrap text-muted-foreground tabular-nums sm:inline">
        {pb.t.toFixed(1)} / {pb.total.toFixed(1)} s
      </span>
    </div>
  );
}
