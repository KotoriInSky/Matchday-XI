import { useState } from 'react';
import { Eye, Undo2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useLineup } from '@/lib/store';
import { getStage, usePlayback } from '@/lib/stage-instance';
import { planSeason2627 } from '@/engine/season2627';
import { Button } from '../ui/button';

/** Explicit scene navigation: editing fields never changes the user's playhead. */
export function ScenePreviewAction({ kind }: { kind: 'club' | 'manager' }) {
  const { lang } = useI18n();
  const zh = lang.startsWith('zh');
  const s = useLineup(), pb = usePlayback();
  const [returnTo, setReturnTo] = useState<{ t: number; playing: boolean } | null>(null);
  const season = s.anim.template === 'season2627';
  const scene = kind === 'manager' || (kind === 'club' && s.anim.manager) ? 'manager' : 'intro';
  const mark = pb.marks.find((item) => item.scene === scene);
  // The 26/27 intro is only a background lead-in; the club title lives with the manager.
  const available = !!mark && !(season && scene === 'intro');
  const showPreview = () => {
    const stage = getStage();
    if (!stage || !mark) return;
    if (!returnTo) setReturnTo({ t: pb.t, playing: pb.playing });
    const plan = season ? planSeason2627(s) : null;
    const next = pb.marks.find((item) => item.t > mark.t)?.t ?? pb.total;
    const time = plan?.manager ? plan.manager.nameReady + .2 : mark.t + (scene === 'manager' ? 5.55 : Math.min(1.85, (next - mark.t) * .8));
    stage.pause(); stage.seek(Math.min(next - .05, time));
    if (matchMedia('(max-width: 899px)').matches) document.querySelector('.preview-column')?.scrollIntoView({ block: 'start' });
  };
  return <div className="flex flex-wrap items-center gap-2">
    <Button size="sm" variant="outline" disabled={!available} onClick={showPreview} title={!available ? (zh ? '请先启用对应的出场场景' : 'Enable the corresponding intro scene first') : undefined}><Eye />{zh ? '预览此场景' : 'Preview scene'}</Button>
    {returnTo && <Button size="sm" variant="ghost" onClick={() => {
      const stage = getStage(); stage?.pause(); stage?.seek(Math.min(returnTo.t, pb.total));
      if (returnTo.playing) stage?.play(); setReturnTo(null);
    }}><Undo2 />{zh ? '返回原位置' : 'Return to previous position'}</Button>}
    {!available && <span className="text-xs text-muted-foreground">{zh ? '对应出场场景未启用' : 'Intro scene is disabled'}</span>}
  </div>;
}
