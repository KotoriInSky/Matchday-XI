import { useSyncExternalStore } from 'react';
import { loadState, normalize, saveState } from '@/engine/state';
import type { FitPath, LineupState } from '@/engine/types';
import { readProject, writeProject } from './project-db';

/** What the frame needs to do after a change. */
export type ChangeHint = 'refresh' | 'none' | { fit: FitPath };
export type SaveStatus = 'saved' | 'failed';

// Copy mutable records while sharing immutable image strings between history entries.
function snapshot<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(snapshot) as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)])) as T;
}

/**
 * The lineup being edited. It is one mutable object shared with the broadcast frame;
 * every change bumps a version number so React re-renders, and is saved to this browser shortly after.
 */
class LineupStore {
  state: LineupState;
  readonly migrated: boolean;
  saveStatus: SaveStatus = 'saved';
  private version = 0;
  private listeners = new Set<() => void>();
  private changeListeners = new Set<(hint: ChangeHint) => void>();
  private saveTimer = 0;
  private past: LineupState[] = [];
  private future: LineupState[] = [];
  private checkpoint!: LineupState;
  private historyTimer = 0;
  private historyGroup = false;
  private groupRecorded = false;
  readonly ready: Promise<void>;
  private saveSequence = Promise.resolve();

  constructor() {
    const { state, migrated } = loadState();
    this.state = state;
    this.checkpoint = snapshot(state);
    this.migrated = migrated;
    this.ready = readProject().then((saved) => {
      let useFallback = false;
      try { useFallback = localStorage.getItem('matchday-xi-storage-fallback') === '1'; } catch { /* unavailable */ }
      if (saved && !useFallback && this.version === 0) {
        this.state = normalize(saved);
        this.checkpoint = snapshot(this.state);
      }
    }).catch(() => { /* localStorage remains the migration/fallback source */ });
    // don't lose the last change when the page is closed right after it
    const flush = () => { if (this.saveTimer) { clearTimeout(this.saveTimer); this.save(); } };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getVersion = () => this.version;

  /** Listen for changes that the frame has to show. */
  onChange(cb: (hint: ChangeHint) => void) {
    this.changeListeners.add(cb);
    return () => { this.changeListeners.delete(cb); };
  }

  /** Changes the lineup. `save: false` is for in-between states while dragging. */
  update(mutate: (s: LineupState) => void, hint: ChangeHint = 'refresh', save = true) {
    mutate(this.state);
    this.recordHistory();
    this.bump(hint);
    if (save) this.scheduleSave();
  }
  /** Call after the frame changed the lineup itself. */
  touched(save = true) {
    this.recordHistory();
    this.bump('none');
    if (save) this.scheduleSave();
  }
  replace(next: unknown) {
    this.state = normalize(next);
    this.recordHistory();
    this.bump('refresh');
    this.scheduleSave();
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  beginHistoryGroup = () => {
    if (this.historyGroup) return;
    clearTimeout(this.historyTimer); this.historyTimer = 0;
    this.checkpoint = snapshot(this.state);
    this.historyGroup = true; this.groupRecorded = false;
  };
  endHistoryGroup = () => {
    if (!this.historyGroup) return;
    this.historyGroup = false; this.groupRecorded = false;
    this.checkpoint = snapshot(this.state);
  };
  private recordHistory() {
    if (this.historyGroup) {
      if (!this.groupRecorded) {
        this.past.push(this.checkpoint);
        if (this.past.length > 30) this.past.shift();
        this.groupRecorded = true;
      }
      this.future = [];
      return;
    }
    if (!this.historyTimer) {
      this.past.push(this.checkpoint);
      if (this.past.length > 30) this.past.shift();
    }
    this.future = [];
    clearTimeout(this.historyTimer);
    this.historyTimer = window.setTimeout(() => {
      this.checkpoint = snapshot(this.state);
      this.historyTimer = 0;
    }, 450);
  }
  undo = () => this.travel(this.past, this.future);
  redo = () => this.travel(this.future, this.past);
  private travel(from: LineupState[], to: LineupState[]) {
    this.endHistoryGroup();
    const next = from.pop();
    if (!next) return;
    clearTimeout(this.historyTimer); this.historyTimer = 0;
    to.push(snapshot(this.state));
    this.state = snapshot(next);
    this.checkpoint = snapshot(next);
    this.bump('refresh');
    this.scheduleSave();
  }

  private bump(hint: ChangeHint) {
    this.version++;
    this.changeListeners.forEach((l) => l(hint));
    this.listeners.forEach((l) => l());
  }
  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 400);
  }
  save() {
    this.saveTimer = 0;
    const savedState = snapshot(this.state);
    this.saveSequence = this.saveSequence.then(async () => {
      let ok = true;
      try {
        await writeProject(savedState);
        try { localStorage.removeItem('matchday-xi-storage-fallback'); } catch { /* unavailable */ }
      } catch {
        ok = saveState(savedState);
        if (ok) try { localStorage.setItem('matchday-xi-storage-fallback', '1'); } catch { ok = false; }
      }
      const status: SaveStatus = ok ? 'saved' : 'failed';
      if (status !== this.saveStatus) {
        this.saveStatus = status;
        this.version++;
        this.listeners.forEach((l) => l());
      }
    });
  }
}

export const store = new LineupStore();

/** Re-renders the component whenever the lineup changes, and returns it. */
export function useLineup() {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store.state;
}
