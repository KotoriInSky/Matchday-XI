import { readableText } from './pattern';
import { ensureFont, fontStack } from './fonts';
import type { LineupState } from './types';

export const COLOR_OVERRIDE_VARS = {
  captainText: '--captain-text', captainBackground: '--captain-bg',
  numberFill: '--number-fill', name: '--name-color', number: '--number-color', smallBackground: '--small-name-bg',
  smallText: '--small-name-text', turf: '--turf-color', lines: '--pitch-line-color',
} as const;
export type ColorOverrideKey = keyof typeof COLOR_OVERRIDE_VARS;
export type ColorOverrides = Partial<Record<ColorOverrideKey, string>>;

export function normalizeColorOverrides(value: unknown): ColorOverrides {
  const result: ColorOverrides = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of Object.keys(COLOR_OVERRIDE_VARS) as ColorOverrideKey[]) {
    const color = (value as Record<string, unknown>)[key];
    if (typeof color === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) {
      result[key] = color.length === 4 ? '#' + [...color.slice(1)].map((c) => c + c).join('') : color;
    }
  }
  return result;
}

/** Empty properties remove stale overrides in both the stage and React inspector. */
export function colorOverrideStyles(s: LineupState): Record<string, string> {
  const values = normalizeColorOverrides(s.colorOverrides);
  const font = s.numberStyle?.font || s.fonts.display;
  ensureFont(font);
  return { '--fn': fontStack(font, 'sans-serif'), '--number-ink': s.numberStyle?.mode === 'outline' ? 'transparent' : 'var(--number-fill,#FFFFFF)', ...Object.fromEntries(Object.entries(COLOR_OVERRIDE_VARS).map(([key, variable]) => [variable, values[key as ColorOverrideKey] ?? (key === 'smallText' ? readableText(values.smallBackground || s.colors.c2, s.colors.c4) : key === 'captainText' ? readableText(values.captainBackground || '#ffffff', s.colors.c1) : '')])),
    '--turf-opacity': values.turf ? '1' : '', '--pitch-line-opacity': values.lines ? '1' : '' };
}

export function defaultOverrideColor(s: LineupState, key: ColorOverrideKey): string {
  if (key === 'numberFill') return '#FFFFFF';
  if (key === 'number') return '#111111';
  if (key === 'captainText') return readableText(s.colorOverrides?.captainBackground || '#ffffff', s.colors.c1);
  if (key === 'captainBackground') return '#FFFFFF';
  if (key === 'smallBackground') return s.colors.c2;
  if (key === 'smallText') return readableText(s.colorOverrides?.smallBackground || s.colors.c2, s.colors.c4);
  if (key === 'turf') return s.look.pitch === 'light' ? '#f3f4f6' : '#000000';
  if (key === 'lines') return s.look.pitch === 'light' ? '#b9bfc8' : s.colors.c3;
  return s.colors.c3;
}
