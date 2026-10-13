import { useSyncExternalStore } from 'react';
import type { PlaybackSnapshot, Stage } from '@/engine/stage';

/** The one broadcast frame on the page, created by the preview. */
let current: Stage | null = null;
let off: (() => void) | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setStage(s: Stage | null) {
  off?.();
  current = s;
  off = s ? (() => { const u = s.subscribe(notify); return () => { u(); }; })() : undefined;
  notify();
}
export const getStage = () => current;

const idle: PlaybackSnapshot = { playing: false, t: 0, total: 0, rate: 1, scene: '', marks: [], adjusting: false, selected: null, fullscreen: false };
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
const snapshot = () => current?.getSnapshot() ?? idle;

/** Playback state of the frame (time, scene, adjusting), for the controls around it. */
export const usePlayback = (): PlaybackSnapshot => useSyncExternalStore(subscribe, snapshot);
