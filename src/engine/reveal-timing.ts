/** Shared with the settings readout so the displayed durations match playback. */
export const classicRowInterval = (per: number) => Math.max(1.4, per * 1.8);
export const classicLineDuration = (per: number, count: number, special: boolean) => Math.max(3.2, 1.5 + per * count) + (special ? 1.2 : 0);
export const HIGHLIGHT_CUT_FRACTION = .55;
export const seasonGroupHold = (per: number, highlight: boolean) => Math.max(1.6, per * 4, highlight ? 3.5 / (1 - HIGHLIGHT_CUT_FRACTION) : 0);
