import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { ExportProgress, formatExportDuration, type ExportTimingValue } from '@/lib/export-progress';

export function useExportProgress(busy: boolean) {
  const estimate = useRef(new ExportProgress());
  const [timing, setTiming] = useState<ExportTimingValue>({ elapsedSeconds: 0, remainingSeconds: null });
  const start = useCallback(() => {
    const now = performance.now(); estimate.current.start(now); setTiming(estimate.current.snapshot(now));
  }, []);
  const update = useCallback((progress: number, phase: string) => {
    const now = performance.now(); estimate.current.update(progress, phase, now); setTiming(estimate.current.snapshot(now));
  }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setTiming(estimate.current.snapshot(performance.now())), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  return { timing, start, update };
}

export function ExportTiming({ timing, phase }: { timing: ExportTimingValue; phase: string }) {
  const { lang } = useI18n(), zh = lang.startsWith('zh');
  const finishing = phase === 'encoding' || phase === 'finishing' || phase === 'complete';
  const remaining = timing.remainingSeconds;
  // Coarse estimates communicate uncertainty without distracting second-by-second jumps.
  const rounded = remaining === null ? 0 : Math.max(1, Math.ceil(remaining / (remaining > 10 ? 5 : 1)) * (remaining > 10 ? 5 : 1));
  return <p data-export-timing aria-live="off" className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
    <span>{zh ? '已用时' : 'Elapsed'} {formatExportDuration(timing.elapsedSeconds, zh)}</span>
    <span data-export-eta>{finishing ? (zh ? '正在收尾…' : 'Finishing…') : remaining === null
      ? (zh ? '估算剩余时间中…' : 'Estimating time remaining…')
      : (zh ? `预计剩余约 ${formatExportDuration(rounded, zh)}` : `About ${formatExportDuration(rounded, zh)} remaining`)}</span>
  </p>;
}
