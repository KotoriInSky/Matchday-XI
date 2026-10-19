export interface ExportTimingValue {
  elapsedSeconds: number;
  remainingSeconds: number | null;
}

/** Estimate from observed work, excluding preparation and final file assembly. */
export class ExportProgress {
  private startedAt = 0;
  private phaseAt = 0;
  private sampleAt = 0;
  private progress = 0;
  private phase = 'preparing';
  private msPerPoint: number | null = null;

  start(at: number) {
    this.startedAt = this.phaseAt = this.sampleAt = at;
    this.progress = 0; this.phase = 'preparing'; this.msPerPoint = null;
  }

  update(progress: number, phase: string, at: number) {
    if (!Number.isFinite(progress)) return;
    progress = Math.max(0, Math.min(100, progress));
    if (phase !== this.phase || progress < this.progress) {
      this.phase = phase; this.phaseAt = this.sampleAt = at;
      this.progress = progress; this.msPerPoint = null;
    } else if (progress > this.progress) {
      const cost = (at - this.sampleAt) / (progress - this.progress);
      if (cost > 0) this.msPerPoint = this.msPerPoint === null ? cost : this.msPerPoint * .7 + cost * .3;
      this.sampleAt = at; this.progress = progress;
    }
  }

  snapshot(at: number): ExportTimingValue {
    const ready = this.phase === 'rendering' && this.msPerPoint !== null && this.progress < 100
      && at - this.phaseAt >= 2000 && at - this.sampleAt < Math.max(10000, this.msPerPoint * 3);
    return {
      elapsedSeconds: Math.max(0, Math.floor((at - this.startedAt) / 1000)),
      remainingSeconds: ready ? this.msPerPoint! * (100 - this.progress) / 1000 : null,
    };
  }
}

export function formatExportDuration(seconds: number, chinese: boolean) {
  const total = Math.max(0, Math.floor(seconds)), hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60, rest = total % 60;
  const join = chinese ? '' : ' ';
  if (hours) return `${hours}${chinese ? '小时' : 'h'}${minutes ? join + minutes + (chinese ? '分' : 'm') : ''}`;
  if (minutes) return `${minutes}${chinese ? '分' : 'm'}${rest ? join + rest + (chinese ? '秒' : 's') : ''}`;
  return `${rest}${chinese ? '秒' : 's'}`;
}
