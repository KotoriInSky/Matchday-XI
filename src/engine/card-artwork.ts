import type { CSSProperties } from 'react';
import type { LineupState } from './types';
import { colorOverrideStyles } from './color-overrides';
import { cjkFor, ensureFont, fontStack } from './fonts';
import { boardLayout, playerCardHTML } from './markup';
import { seasonColumnTone, seasonPlayerHTML } from './season2627';
import { patternURI, textPatternURI } from './pattern';
import styles from './stage.module.css';
import seasonStyles from './season2627.module.css';

export type CardKind = 'small' | 'big' | 'key';

/** The inspector and PNG renderer share markup, fonts, colours and framing. */
export function cardArtwork(s: LineupState, index: number, kind: CardKind, lang: string) {
  const ck = cjkFor(s.fonts.cjk, lang);
  [s.fonts.display, s.fonts.body, ck.font].forEach(ensureFont);
  const css = { ...colorOverrideStyles(s), '--c1': s.colors.c1, '--c2': s.colors.c2, '--c3': s.colors.c3, '--c4': s.colors.c4,
    '--fd': fontStack(s.fonts.display, ck.font), '--fb': fontStack(s.fonts.body, ck.font),
    '--pat': patternURI(s), '--text-pat': textPatternURI(s), '--pats': patternURI(s, ['#dfe3e6', '#99a0a7']),
    '--gz': s.look.photoScale / 100, '--ks': s.look.smallSize / 100, '--tgz': s.look.tagSize / 100 } as CSSProperties;
  const group = boardLayout(s).groups.find(g => g.items.some(item => item.i === index));
  const count = group?.items.length || 1, column = group?.items.findIndex(item => item.i === index) || 0;
  const raw = s.anim.template === 'season2627' && kind !== 'small'
    ? `<div class="s26-preview${kind === 'key' ? ' s26-preview-key' : ''}" style="--s26-tone:${seasonColumnTone(s, column)};--preview-scale:${Math.min(88 / (90 / count), 94 / 56.25)}">${seasonPlayerHTML(s, index, count, true, kind === 'key')}</div>`
    : playerCardHTML(s, index, kind);
  const html = raw.replace(/class="([^"]*)"/g, (_, names: string) => `class="${names.split(/\s+/).map(name => styles[name] || seasonStyles[name] || name).join(' ')}"`);
  return { html, css, lang: ck.tag, className: `${styles.stage} ${styles.inspector} ${s.look.upper ? styles.upper : ''}` };
}
