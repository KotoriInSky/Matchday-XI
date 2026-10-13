import { useMemo, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import { LOW_RES } from '@/engine/constants';
import { fitStyle } from '@/engine/markup';
import { patternURI } from '@/engine/pattern';
import { clamp, fitRef } from '@/engine/state';
import type { Fit, FitPath } from '@/engine/types';
import { useT } from '@/i18n';
import { store, useLineup } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import fr from './framer.module.css';

/** The kit pattern as a CSS background, so previews match the graphic. */
export function usePatternVar(): CSSProperties {
  const s = useLineup();
  const key = [s.colors.c1, s.colors.k2, s.look.pattern, s.look.patColors, s.look.ratio].join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ '--pat': patternURI(s) }) as CSSProperties, [key]);
}

const styleOf = (f: Fit) => Object.fromEntries(fitStyle(f).split(';').map((d) => d.split(':'))) as CSSProperties;

export type FramerKind = 'big' | 'key' | 'small' | 'manager' | 'crest' | 'bg' | 'tag' | 'tagSquare';

function editFit(path: FitPath, change: (f: Fit) => void, final: boolean) {
  store.update(
    (s) => {
      const f = fitRef(s, path);
      if (!f) return;
      change(f);
      f.z = clamp(+f.z.toFixed(3), 0.3, 3);
      f.x = +f.x.toFixed(2);
      f.y = +f.y.toFixed(2);
    },
    { fit: path },
    final,
  );
}

/**
 * A draggable preview of one picture, with a size slider.
 * Drag to move, double-click to reset; arrow keys nudge and + / − resize when it has focus.
 */
export function Framer({
  path, kind, src, cut = true, label, showLabel = true, min = 40, max = 220, video = false, children,
}: {
  path: FitPath;
  kind: FramerKind;
  src: string;
  cut?: boolean;
  label: string;
  showLabel?: boolean;
  min?: number;
  max?: number;
  video?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  const s = useLineup();
  const pat = usePatternVar();
  const f = fitRef(s, path);
  const imgRef = useRef<HTMLElement | null>(null);
  if (!f) return null;
  const st = styleOf(f);
  const media = video ? (
    <video ref={(el) => { imgRef.current = el; }} src={src} muted autoPlay loop playsInline style={st} />
  ) : (
    <img ref={(el) => { imgRef.current = el; }} src={src} alt="" draggable={false} style={st} />
  );
  const wrapped = kind === 'big' || kind === 'key' || kind === 'manager' ? <div className={cn(fr.photo, !cut && fr.full)}>{media}</div> : media;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget, img = imgRef.current;
    if (!img) return;
    e.preventDefault();
    box.focus({ preventScroll: true });
    const r = img.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    const sx = e.clientX, sy = e.clientY, x0 = f.x, y0 = f.y, z = f.z;
    box.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) =>
      editFit(path, (ff) => { ff.x = x0 + ((ev.clientX - sx) / w) * 100 * z; ff.y = y0 + ((ev.clientY - sy) / h) * 100 * z; }, false);
    const up = () => {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      box.removeEventListener('pointercancel', up);
      store.touched();
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 2 : 0.5, k = e.key;
    const nudge = (dx: number, dy: number) => editFit(path, (ff) => { ff.x += dx; ff.y += dy; }, true);
    if (k === 'ArrowLeft') nudge(-step, 0);
    else if (k === 'ArrowRight') nudge(step, 0);
    else if (k === 'ArrowUp') nudge(0, -step);
    else if (k === 'ArrowDown') nudge(0, step);
    else if (k === '+' || k === '=') editFit(path, (ff) => (ff.z *= 1.05), true);
    else if (k === '-' || k === '_') editFit(path, (ff) => (ff.z /= 1.05), true);
    else if (k === '0') editFit(path, (ff) => Object.assign(ff, { z: 1, x: 0, y: 0 }), true);
    else return;
    e.preventDefault();
  };

  const kindCls = { big: fr.big, key: cn(fr.big, fr.key), small: fr.small, manager: fr.manager, crest: fr.crest, bg: fr.bg, tag: fr.tag, tagSquare: cn(fr.tag, fr.square) }[kind];
  return (
    <div className="flex w-fit max-w-full flex-col gap-1.5">
      {showLabel && <span className="text-xs font-semibold text-muted-foreground">{label}</span>}
      <div
        role="img"
        aria-label={`${label}. ${t('framer.help')}`}
        title={t('framer.help')}
        tabIndex={0}
        className={cn(fr.prev, kindCls)}
        style={pat}
        onPointerDown={onPointerDown}
        onDoubleClick={() => editFit(path, (ff) => Object.assign(ff, { z: 1, x: 0, y: 0 }), true)}
        onKeyDown={onKeyDown}
      >
        {wrapped}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={Math.round(f.z * 100)}
        aria-label={`${label}: ${t('framer.size')}`}
        onChange={(e) => editFit(path, (ff) => (ff.z = Number(e.target.value) / 100), false)}
        onPointerUp={() => store.touched()}
        onKeyUp={() => store.touched()}
        className="w-full min-w-24"
      />
      {children}
    </div>
  );
}

export function ResNote({ res }: { res: [number, number] | null }) {
  const t = useT();
  if (!res) return null;
  const low = res[1] < LOW_RES;
  return (
    <p className={cn('max-w-40 text-xs', low ? 'font-medium text-destructive' : 'text-muted-foreground')}>
      {t('photo.size', { w: res[0], h: res[1] })}
      {low && <><br />{t('photo.lowRes')}</>}
    </p>
  );
}

/** Upload, replace and remove buttons for one picture, with an optional thumbnail. */
export function PictureButtons({
  has, onUpload, onRemove, uploadLabel, thumb, removeLabel,
}: {
  has: boolean;
  onUpload(): void;
  onRemove?(): void;
  uploadLabel?: string;
  removeLabel?: string;
  thumb?: string | null;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {thumb && <img src={thumb} alt="" className="size-10 rounded-md border border-border bg-muted object-contain" />}
      <Button variant={has ? 'outline' : 'secondary'} size="sm" onClick={onUpload}>
        {has ? <RefreshCw /> : <ImagePlus />}
        {has ? t('photo.replace') : uploadLabel || t('photo.add')}
      </Button>
      {has && onRemove && (
        <Button variant="ghost" size="sm" onClick={onRemove} className="text-muted-foreground hover:text-destructive">
          <Trash2 />
          {removeLabel || t('photo.remove')}
        </Button>
      )}
    </div>
  );
}

export function resetFits(paths: FitPath[]) {
  store.update((s) => paths.forEach((p) => { const f = fitRef(s, p); if (f) Object.assign(f, { z: 1, x: 0, y: 0 }); }), 'refresh');
}
