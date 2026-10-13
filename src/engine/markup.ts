/*
 * HTML for the broadcast frame. Class names here are the plain names from stage.module.css;
 * the stage maps them to the module's generated names before inserting the markup.
 */
import { CH, CW, FH, FW, ROLE_OF, SMALL, STEP } from './constants';
import { slotsFor, type Role } from './formation';
import { broadcastName, cardName, playerNameLines, clamp, parseSubs, shortName, splitName, fitRef, playerTagPath } from './state';
import type { Fit, LineupState, Player } from './types';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const fitStyle = (f?: Fit | null) => (f ? `--fz:${(+f.z).toFixed(3)};--fx:${(+f.x).toFixed(2)}%;--fy:${(+f.y).toFixed(2)}%` : '');
const fullCls = (o: { photo: string | null; cut: boolean }) => (o.photo && o.cut === false ? ' full' : '');
const pad2 = (n: number) => String(n).padStart(2, '0');

/* ---------- Pitch perspective ---------- */
export const depth = (y: number) => 0.8 + 0.2 * (y / 100);
export const proj = (x: number, y: number) => ({ X: 50 + (x - 50) * depth(y), Y: y });
export const unproj = (X: number, Y: number) => {
  const y = clamp(Y, 8, 94);
  return { x: clamp(50 + (X - 50) / depth(y), 4, 96), y };
};
const P = (x: number, y: number) => {
  const p = proj(x, y);
  return p.X.toFixed(2) + ' ' + p.Y.toFixed(2);
};

/** A full pitch in perspective (105 × 68 m), seen from the team's own goal; the far end runs off the bottom. */
export function pitchSVG(s: LineupState) {
  const top = s.look.gk === 'top', Ly = (L: number) => (top ? 8 + L * 1.1 : 92 - L * 1.1);
  const poly = (pts: number[][]) => pts.map(([x, L]) => P(x, Ly(L))).join(' ');
  const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 32) => {
    const o: number[][] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      o.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return o;
  };
  let bands = '';
  for (let b = 0; b < 12; b += 2) bands += `<polygon class="band" points="${poly([[0, (b * 100) / 12], [100, (b * 100) / 12], [100, ((b + 1) * 100) / 12], [0, ((b + 1) * 100) / 12]])}"/>`;
  const RX = 13.5, RY = 8.7, PA = [20.2, 79.8, 15.7], SY = [36.5, 63.5, 5.2], PS = 10.5, t = Math.asin((PA[2] - PS) / RY);
  const end = (own: boolean) => {
    const f = (y: number) => (own ? y : 100 - y);
    return `<polygon class="ln" points="${poly([[PA[0], f(0)], [PA[1], f(0)], [PA[1], f(PA[2])], [PA[0], f(PA[2])]])}"/>
      <polygon class="ln" points="${poly([[SY[0], f(0)], [SY[1], f(0)], [SY[1], f(SY[2])], [SY[0], f(SY[2])]])}"/>
      <polyline class="ln" points="${poly(arc(50, f(PS), RX, RY, own ? t : -t, own ? Math.PI - t : -Math.PI + t))}"/>
      <polygon class="spot" points="${poly(arc(50, f(PS), 0.5, 0.8, 0, Math.PI * 2, 12))}"/>`;
  };
  const lines = s.look.lines
    ? `${end(true)}${end(false)}
    <polyline class="ln" points="${poly([[0, 50], [100, 50]])}"/>
    <polygon class="ln" points="${poly(arc(50, 50, RX, RY, 0, Math.PI * 2, 48))}"/>
    <polygon class="spot" points="${poly(arc(50, 50, 0.5, 0.8, 0, Math.PI * 2, 12))}"/>`
    : '';
  return `<svg class="pitch ${s.look.pitch === 'light' ? 'light' : 'tinted'}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <polygon class="turf" points="${poly([[0, 0], [100, 0], [100, 100], [0, 100]])}"/>${bands}${lines}
    <polygon class="edge" points="${poly([[0, 0], [100, 0], [100, 100], [0, 100]])}"/></svg>`;
}

export interface BoardItem {
  i: number; x: number; y: number; sx: number; sy: number; s: number; ss: number;
  role: Role; row: number; pos: string; bs: number; bx: number; by: number;
}
export interface BoardGroup { role: Role; items: BoardItem[] }

/** Where each small card sits, and where its big card grows to during the line-by-line reveal. */
export function boardLayout(s: LineupState) {
  const slots = slotsFor(s.formation, s.look.gk);
  const items: BoardItem[] = s.players.map((p, i) => {
    const sp = s.slotPos[i] || slots[i], scr = proj(sp.x, sp.y);
    const sc = (0.8 + (0.2 * sp.y) / 100) * slots.scale;
    return {
      i, x: sp.x, y: sp.y, sx: scr.X, sy: scr.Y, s: sc, ss: (SMALL * (s.look.smallSize / 100) * sc) / CW,
      role: slots[i].role, row: slots[i].row, pos: p.pos || slots[i].pos, bs: 1, bx: 0, by: 0,
    };
  });
  // one reveal group per formation row (4-1-4-1 shows the 1 and the 4 separately);
  // consecutive rows with the same role share one side label
  const rows = [...new Set(slots.map((sl) => sl.row))];
  const groups: BoardGroup[] = rows
    .map((r) => {
      const its = items.filter((it) => it.row === r).sort((a, b) => a.sx - b.sx);
      return { role: its[0] ? its[0].role : ('MID' as Role), items: its };
    })
    .filter((g) => g.items.length);
  const labels: { role: Role; groups: number[] }[] = [];
  groups.forEach((g, gi) => {
    const last = labels[labels.length - 1];
    if (last && last.role === g.role) last.groups.push(gi);
    else labels.push({ role: g.role, groups: [gi] });
  });
  groups.forEach((g) => {
    const k = g.items.length, W = Math.min((19 * s.look.bigSize) / 100, (FW - 13) / k - 4, 33), bs = W / CW;
    const halfH = ((CH * bs) / 2 / FH) * 100;
    const avgY = g.items.reduce((a, it) => a + it.sy, 0) / k;
    const by = clamp(avgY, halfH + 1.5, 100 - halfH - 1.5);
    g.items.forEach((it, j) => {
      it.bs = bs * (k > 1 && Math.abs(j - (k - 1) / 2) < .6 ? 1.08 : 1);
      it.by = by;
      it.bx = 46 + (j - (k - 1) / 2) * (((W + 4) / FW) * 100);
    });
  });
  return { slots, items, groups, labels };
}

/* ---------- Pieces ---------- */
export interface MarkupContext {
  s: LineupState;
  /** Object URL of the background video, which is never saved. */
  videoURL: string | null;
}

function tagHTML(s: LineupState, id: string, index: number) {
  // the tag's name is only for finding it in the editor; the graphic shows the picture alone
  const t = id && s.tags.find((x) => x.id === id);
  if (!t || !t.img) return '';
  const path = playerTagPath(index, id);
  return `<div class="tag solo"><span class="tpic${t.shape === 'square' ? ' square' : ''}"><img src="${t.img}" alt="" draggable="false" data-fit="${esc(path)}" style="${fitStyle(fitRef(s, path))}"></span></div>`;
}
function badgeSVG(s: LineupState) {
  const t = esc(shortName(s).slice(0, 5));
  const size = t.length > 3 ? 24 : t.length > 2 ? 30 : 40;
  return `<svg viewBox="0 0 100 116" aria-hidden="true"><path d="M50 4 L93 17 V58 C93 86 74 103 50 112 C26 103 7 86 7 58 V17 Z" style="fill:var(--c1);stroke:var(--c2);stroke-width:5"/><path d="M50 14 L83 24 V58 C83 80 68 94 50 101 C32 94 17 80 17 58 V24 Z" style="fill:none;stroke:var(--c2);stroke-width:1.5;opacity:.6"/><text x="50" y="66" text-anchor="middle" dominant-baseline="middle" style="fill:var(--c2);font-family:var(--fd);font-weight:800;font-size:${size}px">${t}</text></svg>`;
}
export const crestHTML = (s: LineupState) =>
  s.team.crest ? `<img class="crest-img" src="${s.team.crest}" alt="" draggable="false" data-fit="crest:fit" style="${fitStyle(s.team.crestFit)}">` : badgeSVG(s);

export function personSVG(num: string, gid: string) {
  return `<svg class="person" viewBox="0 0 200 230" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--c1l)"/><stop offset="1" style="stop-color:var(--c1d)"/></linearGradient></defs>
  <circle cx="100" cy="64" r="36" style="fill:url(#${gid});stroke:var(--c2);stroke-width:4"/>
  <path d="M24 232 C24 150 58 116 100 116 C142 116 176 150 176 232 Z" style="fill:url(#${gid});stroke:var(--c2);stroke-width:4;stroke-linejoin:round"/>
  <path d="M84 118 Q100 136 116 118" style="fill:none;stroke:var(--c2);stroke-width:4"/>
  <text x="100" y="186" text-anchor="middle" dominant-baseline="middle" style="fill:var(--c2);font-family:var(--fd);font-weight:800;font-size:46px">${esc(num)}</text></svg>`;
}
export function coachSVG(gid: string) {
  return `<svg viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--c1l)"/><stop offset="1" style="stop-color:var(--c1)"/></linearGradient></defs>
  <circle cx="100" cy="62" r="34" style="fill:url(#${gid});stroke:var(--c2);stroke-width:4"/>
  <path d="M30 192 C30 132 62 108 100 108 C138 108 170 132 170 192 Z" style="fill:url(#${gid});stroke:var(--c2);stroke-width:4;stroke-linejoin:round"/>
  <path d="M88 110 L100 140 L112 110" style="fill:none;stroke:var(--c2);stroke-width:4"/></svg>`;
}

function introHTML(s: LineupState) {
  const t = s.text;
  return `<div class="intro">
    <i class="shard s1"></i><i class="shard s2"></i><i class="shard s3"></i>
    <div class="i-crest">${crestHTML(s)}</div><i class="flare"></i>
    <div class="i-text">
      ${t.subtitle ? `<div class="i-eyebrow">${esc(t.subtitle)}</div>` : ''}
      <h2 class="i-title">${esc(t.title)}</h2>
      <div class="i-team up">${esc(s.team.name)}</div>
    </div></div>`;
}

function mgrHTML({ s, videoURL }: MarkupContext) {
  const c = s.coach, t = s.text, ab = esc(shortName(s));
  const item = `<span>${ab}</span>`;
  const media = (s.bg.mode === 'image' && s.bg.image) || (s.bg.mode === 'video' && videoURL);
  return `<div class="mgr">
    ${media ? '' : '<i class="m-back"></i>'}<i class="m-sweep"></i>
    <div class="m-panel"><div class="stripes-bg"></div></div>
    <div class="m-photo${fullCls(c)}">${c.photo ? `<img src="${c.photo}" alt="" draggable="false" data-fit="coach:fit" style="${fitStyle(c.fit)}">` : coachSVG('mg')}</div>
    ${s.look.crest ? `<div class="m-crest">${crestHTML(s)}</div>` : ''}
    <div class="m-colw"><div class="m-col">${item.repeat(6)}<span class="m-gap">${ab}</span>${item.repeat(7)}</div></div>
    <div class="m-solid"><i>${ab}</i></div>
    ${t.subtitle ? `<div class="m-eye">${esc(t.subtitle)}</div>` : ''}
    <div class="m-teamw"><div class="m-team up">${esc(s.team.name)}</div></div>
    <div class="m-name"><span>${esc(t.coachLabel)}</span><b class="up">${esc(c.name)}</b></div>
  </div>`;
}

const bugHTML = (s: LineupState) =>
  `<div class="bug"><div class="bc">${crestHTML(s)}</div><div><b>${esc(s.text.title)}</b><small class="up">${esc(s.team.name)}</small></div></div>`;

type SeqPlayer = Player & { idx: number };

/** Key player: a second, larger portrait that takes over when the card turns silver; cut-outs break out over the top edge. */
function keyPhotoHTML(p: SeqPlayer, gid: string) {
  const own = !!p.photoK, pic = p.photoK || p.photo, cut = own ? p.cutK !== false : p.cut !== false;
  return `<div class="rc-kphoto${pic && !cut ? ' full' : ''}">${pic ? `<img src="${pic}" alt="" draggable="false" data-fit="p:${p.idx}:fitK" style="${fitStyle(p.fitK)}">` : personSVG(p.num, 'k' + gid)}</div>`;
}

function rcInner(s: LineupState, p: SeqPlayer, gid: string) {
  const t = s.text, [first, last] = playerNameLines(p);
  const ticker = p.captain ? `<div class="rc-ticker"><span>${Array(8).fill(esc(t.captainLabel)).join('&emsp;')}&emsp;</span></div>` : '';
  const tag1 = tagHTML(s, p.tag1, p.idx);
  const badge = p.captain && tag1 ? `<div class="roll"><div class="roll-in"><div class="roll-a">${tag1}</div><div class="roll-b">${ticker}</div></div></div>` : ticker || tag1;
  const tags = (p.captain ? badge : tag1) + tagHTML(s, p.tag2, p.idx);
  return `<div class="rc-in${p.photo && p.cut !== false ? ' cutout' : ''}">
    <div class="stripes-bg"></div>
    ${p.key ? '<div class="rc-metal"></div><div class="rc-holo"></div>' : ''}
    <div class="rc-num">${esc(p.num)}</div>
    <div class="rc-photo${fullCls(p)}">${p.photo ? `<img src="${p.photo}" alt="" draggable="false" data-fit="p:${p.idx}:fit" style="${fitStyle(p.fit)}">` : personSVG(p.num, gid)}</div>
    <div class="rc-shade"></div>
    <div class="rc-name" style="--name-scale-1:${p.nameSize1 / 100};--name-scale-2:${p.nameSize2 / 100}">${first ? `<span class="up">${esc(first)}</span>` : ''}${last ? `<b class="up">${esc(last)}</b>` : ''}</div>
    <i class="sheen"></i>${p.key ? '<i class="rc-flash"></i>' : ''}
  </div>${p.key ? keyPhotoHTML(p, gid) : ''}${tags ? `<div class="rc-tags">${tags}</div>` : ''}`;
}

const seqPlayers = (s: LineupState): SeqPlayer[] => {
  const slots = slotsFor(s.formation, s.look.gk);
  return s.players.map((p, i) => ({ ...p, pos: p.pos || slots[i].pos, idx: i }));
};

function rowHTML(s: LineupState) {
  const cards = seqPlayers(s)
    .map((p, k) => `<div class="rc${p.key ? ' key' : ''}${p.captain ? ' cap' : ''}" style="left:${(k * STEP).toFixed(2)}cqw">${rcInner(s, p, 'rg' + k)}</div>`)
    .join('');
  return `<div class="rowscene"><div class="strip">${cards}</div></div>`;
}

function roleWord(s: LineupState, pos: string) {
  const r = ROLE_OF[String(pos).toUpperCase()];
  return r ? s.text[`role${r}` as const] : '';
}

function heroesHTML(s: LineupState) {
  const t = s.text;
  return seqPlayers(s)
    .map((p, k) => {
      const role = roleWord(s, p.pos), [first, last] = playerNameLines(p);
      const tags = tagHTML(s, p.tag1, p.idx) + tagHTML(s, p.tag2, p.idx);
      const ticks = Array.from({ length: 11 }, (_, j) => `<i class="${j <= k ? 'on' : ''}"></i>`).join('');
      return `<div class="hero">
      <div class="h-num">${esc(p.num)}</div>
      <div class="h-photo${p.key ? ' key' : ''}${fullCls(p)}">${p.photo ? `<img src="${p.photo}" alt="" data-fit="p:${p.idx}:fit" style="${fitStyle(p.fit)}">` : personSVG(p.num, 'hg' + k)}</div>
      <div class="h-info" style="--name-scale-1:${p.nameSize1 / 100};--name-scale-2:${p.nameSize2 / 100}">
        <div class="h-chip">${p.num ? `<b>${esc(p.num)}</b>` : ''}<span>${esc(role ? role + ' · ' + p.pos : p.pos)}</span>${p.captain ? `<em>${esc(t.captainLabel)}</em>` : ''}${p.key ? `<em class="k">★ ${esc(t.keyLabel)}</em>` : ''}</div>
        ${tags ? `<div class="h-tags">${tags}</div>` : ''}
        ${first ? `<div class="h-first up">${esc(first)}</div>` : ''}
        ${last ? `<div class="h-last up">${esc(last)}</div>` : ''}
        <i class="h-bar"></i>
      </div>
      <div class="h-count"><b>${pad2(k + 1)}</b><span>/ 11</span><div class="ticks">${ticks}</div></div>
    </div>`;
    })
    .join('');
}

const CJK_RE = /[぀-ヿ㐀-鿿가-힯]/;

function smallNameHTML(p: Player) {
  const surname = playerNameLines(p)[1];
  // Format all-caps broadcast surnames for pitch labels; preserve manually mixed case.
  const text = broadcastName(surname);
  return `<div class="nm"><b style="font-size:${1.05 * p.nameSize2 / 100}cqw">${esc(text)}</b></div>`;
}

export function smallCardsHTML(s: LineupState, tags = false) {
  const t = s.text;
  const L = boardLayout(s);
  return L.items
    .map((it) => {
      const p = s.players[it.i], pic = p.photo2 || p.photo;
      const ph = pic ? `<img class="pp" src="${pic}" alt="" draggable="false" data-fit="p:${it.i}:fitS" style="${fitStyle(p.fitS)}">` : personSVG(p.num, 'sp' + it.i);
      const cap = p.captain ? `<span class="sm-cap${tags ? ' s26-small-captain' : ''}" data-small-captain>${esc((t.captainLabel || 'C').trim().charAt(0).toUpperCase())}</span>` : '';
      const badges = tags ? tagHTML(s, p.tag1, it.i) + tagHTML(s, p.tag2, it.i) : '';
      const cutout = !!pic && (p.photo2 ? p.cutS !== false : p.cut !== false);
      return `<div class="slot${tags ? ' s26-slot' : ''}" data-i="${it.i}" style="left:${it.sx}%;top:${it.sy}%;--s:${it.s.toFixed(3)};z-index:${Math.round(it.y)}"><div class="card"><div class="cvis"><div class="cflip">
      <div class="sm-face${tags ? ' s26-small-face' : ''}">${tags ? '<div class="s26-card-shadow" aria-hidden="true"><div></div></div>' : ''}<div class="sm-por${cutout ? ' cutout' : ''}${tags && cutout ? ' s26-small-cutout' : ''}"><div class="ph">${ph}</div>${smallNameHTML(p)}</div>${badges ? `<div class="s26-small-tags">${badges}</div>` : ''}${cap}</div>
      <div class="sm-num"><b>${esc(p.num)}</b><small class="up">${esc(cardName(p))}</small></div>
    </div></div></div></div>`;
    })
    .join('');
}

export function substitutesHTML(s: LineupState, broadcast = false) {
  if (!s.look.subs) return '';
  const subs = parseSubs(s.subs);
  if (!subs.length) return '';
  return `<div class="subs"><span class="lab">${esc(s.text.subsLabel)}</span><ul>${subs
    .map((x) => {
      const m = x.name.match(/^(.*?)(\s*[（(][^）)]*[）)])?$/)!, [f, l] = splitName(m[1]);
      return `<li><i>${esc(x.num)}</i>${f ? `<span class="fn">${esc(broadcast ? broadcastName(f) : f)}</span>` : ''}<span class="sn">${esc(broadcast ? broadcastName(l) : l)}</span>${m[2] ? `<small class="sub-position">${esc(m[2].trim())}</small>` : ''}</li>`;
    }).join('')}</ul></div>`;
}

function boardHTML(s: LineupState) {
  const t = s.text, lines = s.anim.style === 'lines';
  const L = boardLayout(s), cards = smallCardsHTML(s);
  const bigs = lines
    ? L.items
        .map((it) => {
          const p: SeqPlayer = { ...s.players[it.i], pos: it.pos, idx: it.i };
          return `<div class="rc bigc${p.key ? ' key' : ''}${p.captain ? ' cap' : ''}" data-i="${it.i}" style="left:${it.sx}%;top:${it.sy}%;transform:translate(-50%,-50%) scale(${it.ss.toFixed(4)})"><div class="flip"><div class="fface">${rcInner(s, p, 'bg' + it.i)}</div><div class="fback"><div class="bk">${crestHTML(s)}</div></div></div></div>`;
        })
        .join('')
    : '';
  const secs = lines
    ? L.labels
        .map((lb) => {
          const w = t[`grp${lb.role}` as const] || '';
          const cjk = CJK_RE.test(w);
          // CJK labels stack one character per line, reading top to bottom
          return `<div class="secw"><div class="sec${cjk ? ' cjk' : ''}">${cjk ? [...w].filter((c) => c.trim()).map((c) => `<span>${esc(c)}</span>`).join('') : esc(w)}</div></div>`;
        })
        .join('')
    : '';
  const flashes = lines ? '<i class="pflash"></i>'.repeat(L.labels.length) : '';
  const fin = substitutesHTML(s);
  return `<div class="board${lines ? '' : ' noreveal'}">
    <div class="field">${pitchSVG(s)}<div class="cards">${cards}</div>${bigs}</div>
    <div class="bpanel"><div class="bpanel-bg"><div class="stripes-bg"></div>${secs}${flashes}</div>${s.look.crest ? `<div class="pcrest">${crestHTML(s)}</div>` : ''}<div class="fin">${fin}</div></div>
  </div>`;
}

/** The whole frame except the background media, which the stage mounts itself. */
export function stageHTML(ctx: MarkupContext) {
  const { s, videoURL } = ctx, style = s.anim.style;
  const hasMedia = (s.bg.mode === 'image' && s.bg.image) || (s.bg.mode === 'video' && videoURL);
  const mode = hasMedia ? s.bg.mode : ['image', 'video'].includes(s.bg.mode) ? 'stripes' : s.bg.mode;
  const wipes = '<i class="wipe"></i>'.repeat(style === 'single' ? 12 : style === 'row' ? 1 : 0);
  const players = style === 'row' ? rowHTML(s) + bugHTML(s) : style === 'single' ? heroesHTML(s) + bugHTML(s) : '';
  return `<div class="bg" data-mode="${mode}"></div><div class="fx"><i class="beam"></i><i class="beam b2"></i></div>${hasMedia ? '<i class="haze"></i>' : ''}
    ${boardHTML(s)}${s.anim.intro ? introHTML(s) : ''}${s.anim.manager ? mgrHTML(ctx) : ''}${players}${wipes}<i class="vignette"></i>`;
}

/** Reuses the broadcast card for the editor's full-card framing preview. */
export function playerCardHTML(s: LineupState, index: number, variant: 'small' | 'big' | 'key' = 'big') {
  const p = s.players[index];
  if (variant === 'small') {
    const pic = p.photo2 || p.photo;
    const ph = pic ? `<img class="pp" src="${pic}" alt="" draggable="false" data-fit="p:${index}:fitS" style="${fitStyle(p.fitS)}">` : personSVG(p.num, 'inspector-small-' + index);
    const cap = p.captain ? `<span class="sm-cap">${esc((s.text.captainLabel || 'C').trim().charAt(0).toUpperCase())}</span>` : '';
    return `<div class="small-preview"><div class="sm-por${(p.photo2 ? p.cutS !== false : p.cut !== false) && pic ? ' cutout' : ''}"><div class="ph">${ph}</div>${smallNameHTML(p)}</div>${cap}</div>`;
  }
  return `<div class="rc${variant === 'key' ? ' key-preview' : ''}">${rcInner(s, { ...p, key: variant === 'key', idx: index }, 'inspector-' + index)}</div>`;
}
