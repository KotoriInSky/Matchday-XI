import { boardLayout, coachSVG, crestHTML, esc, fitStyle, personSVG, pitchSVG, smallCardsHTML, substitutesHTML } from './markup';
import { broadcastName, playerNameLines, shortName, fitRef, playerTagPath } from './state';
import { contrastRatio, mixHex, readableText, textSurfaceColors } from './pattern';
import type { BoardGroup } from './markup';
import type { Fit, LineupState, Player } from './types';
import type { SceneId } from './stage';
import { HIGHLIGHT_CUT_FRACTION, seasonGroupHold } from './reveal-timing';

export interface SeasonGroup extends BoardGroup {
  start: number;
  settled: number;
  cut: number;
  leave: number;
  end: number;
}
export interface SeasonPlan {
  lead: number;
  manager: { start: number; end: number; rollStart: number; rollEnd: number; nameStart: number; nameReady: number } | null;
  groups: SeasonGroup[];
  final: { start: number; ready: number };
  total: number;
  marks: { t: number; scene: SceneId }[];
}

const SCENES: Record<BoardGroup['role'], SceneId> = { GK: 'gk', DEF: 'def', MID: 'mid', FWD: 'fwd' };
const columnDelay = (count: number) => Math.min(.1, .48 / Math.max(1, count - 1));

/** One timing plan for markup, preview and frame-by-frame export. No timers or frame-rate assumptions. */
export function planSeason2627(s: LineupState): SeasonPlan {
  const lead = s.anim.intro ? s.anim.introLen : .35;
  const rollStart = lead + .23, rollEnd = rollStart + Math.min(.67, s.anim.mgrLen * .2);
  const manager = s.anim.manager ? { start: lead, end: lead + s.anim.mgrLen, rollStart, rollEnd, nameStart: rollEnd + .4, nameReady: rollEnd + .9 } : null;
  const marks: SeasonPlan['marks'] = [];
  if (s.anim.intro) marks.push({ t: 0, scene: 'intro' });
  if (manager) marks.push({ t: manager.start, scene: 'manager' });
  let start = manager?.end ?? lead;
  const groups = s.anim.style === 'off' ? [] : boardLayout(s).groups.map((group) => {
    const settled = start + .64 + (group.items.length - 1) * columnDelay(group.items.length);
    const hasHighlight = group.items.some((item) => s.players[item.i].key);
    // Reserve a readable Highlight hold without moving the cut into the first half of the scene.
    const hold = seasonGroupHold(s.anim.per, hasHighlight);
    const leave = settled + hold;
    const scene = { ...group, start, settled, cut: settled + hold * HIGHLIGHT_CUT_FRACTION, leave, end: leave + .4 };
    marks.push({ t: start, scene: SCENES[group.role] });
    start = leave + .1;
    return scene;
  });
  const finalStart = groups.length ? groups[groups.length - 1].leave : start;
  const final = { start: finalStart, ready: finalStart + 1.15 };
  if (s.look.subs && s.subs.trim()) marks.push({ t: finalStart, scene: 'subs' });
  marks.push({ t: final.ready, scene: 'final' });
  return { lead, manager, groups, final, total: final.ready + 4.5, marks };
}

function tagHTML(s: LineupState, id: string, index: number) {
  const tag = s.tags.find((t) => t.id === id);
  if (!tag?.img) return '';
  const path = playerTagPath(index, id);
  return `<span class="s26-tag${tag.shape === 'square' ? ' s26-square' : ''}"><img src="${esc(tag.img)}" alt="" draggable="false" data-fit="${esc(path)}" style="${fitStyle(fitRef(s, path))}"></span>`;
}

function playerTags(s: LineupState, p: Player, index: number) {
  const tag1 = tagHTML(s, p.tag1, index), tag2 = tagHTML(s, p.tag2, index);
  const captain = `<span class="s26-captain"><span class="s26-captain-text">${Array(8).fill(esc(s.text.captainLabel || 'Captain')).join('&emsp;')}&emsp;</span></span>`;
  const square = s.tags.find((tag) => tag.id === p.tag1)?.shape === 'square';
  const first = !p.captain ? tag1 : tag1
    ? `<span class="s26-badge${square ? ' s26-square' : ''}"><span class="s26-badge-rotor"><span class="s26-badge-front">${tag1}</span><span class="s26-badge-back">${captain}</span></span></span>`
    : `<span class="s26-badge">${captain}</span>`;
  return first || tag2 ? `<div class="s26-tags">${first}${tag2}</div>` : '';
}

function portrait(photo: string | null, cut: boolean, fit: Fit, path: string, num: string, id: string, key = false) {
  return `<div class="s26-photo-window"><div class="s26-photo${photo && !cut ? ' s26-full-photo' : ''}${key ? ' s26-key-photo' : ''}">${photo
    ? `<img src="${esc(photo)}" alt="" draggable="false" data-fit="${path}" style="${fitStyle(fit)}">`
    : personSVG(num, id)}</div></div>`;
}

export function seasonPlayerHTML(s: LineupState, index: number, count = 1, preview = false, keyPreview = false) {
  const p = s.players[index], [first, last] = playerNameLines(p);
  const key = p.key || keyPreview;
  const nameInk = s.colorOverrides?.name || '#ffffff', keyInk = s.colorOverrides?.name || '#101820';
  // Contrast is symmetric: choose the backing surface while retaining an explicit text colour.
  const surfaceFor = (ink: string, preferred: string) => contrastRatio(ink, preferred) >= 4.5 ? preferred : contrastRatio(ink, '#ffffff') > contrastRatio(ink, '#000000') ? '#ffffff' : '#000000';
  const normalSurface = surfaceFor(nameInk, '#101820'), keySurface = surfaceFor(keyInk, '#dde1e5');
  const foilTone = (toward: string, amount: number) => {
    const tone = mixHex(keySurface, toward, amount);
    return contrastRatio(keyInk, tone) >= 4.5 ? tone : keySurface;
  };
  return `<div class="s26-column${preview ? ' s26-preview-column' : ''}" data-player="${index}" data-key="${key}" style="--card-w:${preview ? 64 : 90 / count}cqw;--card-h:${preview ? 106 : 56.25}cqw;--s26-name-bg:${normalSurface};--s26-key-name-bg:${keySurface};--s26-key-name-light:${foilTone('#ffffff', .24)};--s26-key-name-dark:${foilTone('#263547', .08)}">
    <div class="s26-column-bg"></div>${key ? '<div class="s26-metal"><div class="s26-foil-relief"></div><div class="s26-reflection"></div></div>' : ''}<div class="s26-entry-light" aria-hidden="true"></div>
    <div class="s26-number" data-card-text>${esc(p.num)}</div>
    ${key ? '<div class="s26-key-coat"><div class="s26-reflection"></div></div>' : ''}
    ${portrait(p.photo, p.cut !== false, p.fit, `p:${index}:fit`, p.num, 'season-' + index)}
    ${key ? portrait(p.photoK || p.photo, (p.photoK ? p.cutK : p.cut) !== false, p.fitK, `p:${index}:fitK`, p.num, 'season-key-' + index, true) : ''}
    <div class="s26-veil"></div>${key ? '<div class="s26-key-veil"></div>' : ''}
    <div class="s26-info" style="--name-scale-1:${p.nameSize1 / 100};--name-scale-2:${p.nameSize2 / 100}">
      <div class="s26-name" data-card-text>${first ? `<span>${esc(broadcastName(first))}</span>` : ''}${last ? `<b>${esc(broadcastName(last))}</b>` : ''}</div>
    </div>
    ${playerTags(s, p, index)}
  </div>`;
}

export function season2627HTML(s: LineupState, videoURL: string | null) {
  const plan = planSeason2627(s), ab = esc(shortName(s));
  const hasMedia = (s.bg.mode === 'image' && s.bg.image) || (s.bg.mode === 'video' && videoURL);
  const mode = hasMedia ? s.bg.mode : ['image', 'video'].includes(s.bg.mode) ? 'stripes' : s.bg.mode;
  const [background] = textSurfaceColors(s);
  const foreground = readableText(background, s.colors.c3);
  const ink = readableText('#f4f5f6', s.colors.c1);
  const subs = substitutesHTML(s, true);
  return `<div class="bg" data-mode="${mode}"></div><div class="s26" style="--s26-panel-ink:${ink};--s26-background:${background};--s26-background-ink:${foreground}">
    <div class="s26-wash"></div>
    ${plan.manager ? `<div class="s26-manager">
      <div class="s26-coach-photo${s.coach.photo && !s.coach.cut ? ' s26-full-photo' : ''}">${s.coach.photo ? `<img src="${esc(s.coach.photo)}" alt="" draggable="false" data-fit="coach:fit" style="${fitStyle(s.coach.fit)}">` : coachSVG('season-coach')}</div>
      <div class="s26-coach-name"><span>${esc(s.text.coachLabel)}</span><b>${esc(s.coach.name)}</b></div>
    </div>` : ''}
    ${plan.groups.map((g, gi) => `<div class="s26-group" data-group="${gi}" style="--s26-count:${g.items.length}">${g.items.map((item, j) =>
      `<div class="s26-column-position" style="left:${j * 100 / g.items.length}%;width:${100 / g.items.length}%;z-index:${g.items.length - j};--s26-tone:${mixHex(background, j % 2 ? '#000000' : '#ffffff', .055 + j * .009)}">${seasonPlayerHTML(s, item.i, g.items.length)}</div>`).join('')}</div>`).join('')}
    <div class="s26-panel-track">
      <div class="s26-panel"></div>
      ${plan.manager ? `<div class="s26-title">
        <div class="s26-outline-window"><div class="s26-outline">${Array.from({ length: 8 }, (_, i) => `<span data-title-row="${i}">${ab}</span>`).join('')}</div></div>
        <div class="s26-solid">${ab}</div><div class="s26-team">${esc(s.team.name)}</div>
      </div>` : ''}
      <div class="s26-role-window">${plan.groups.map((g, gi) => `<div class="s26-role${/[぀-ヿ㐀-鿿가-힯]/.test(s.text[`grp${g.role}`]) ? ' s26-cjk' : ''}" data-role="${gi}"><span>${esc(s.text[`grp${g.role}`])}</span></div>`).join('')}</div>
      ${s.look.crest ? `<div class="s26-crest"><div class="s26-crest-y">${crestHTML(s)}</div></div>` : ''}
    </div>
    <div class="s26-final">
      <div class="s26-pitch-reveal"><div class="field s26-field">${pitchSVG(s)}<div class="cards">${smallCardsHTML(s, true)}</div></div></div>
      ${subs ? `<div class="s26-substitutes" style="--s26-sub-size:${Math.min(1.72, 31 / Math.max(1, s.subs.split('\n').filter((line) => line.trim()).length)).toFixed(3)}cqw">${subs}</div>` : ''}
    </div>
  </div>`;
}

export interface SeasonAnimationSpec {
  el: Element;
  frames: Keyframe[];
  start: number;
  dur: number;
  fill?: FillMode;
}

type Query = (selector: string, root?: ParentNode) => HTMLElement | null;
type QueryAll = (selector: string, root?: ParentNode) => HTMLElement[];

export function season2627Timeline(s: LineupState, q: Query, qa: QueryAll, reduced: boolean) {
  const plan = planSeason2627(s), specs: SeasonAnimationSpec[] = [];
  const ease = 'cubic-bezier(.2,.8,.2,1)';
  const add = (el: Element | null | undefined, frames: Keyframe[], start: number, dur: number, fill?: FillMode) => {
    if (el) specs.push({ el, frames, start, dur, fill });
  };
  const enter = (el: Element | null, start: number, dur = .5, x = 0) => add(el, [
    { opacity: 0, transform: `translateX(${reduced ? 0 : x}cqw)`, easing: ease },
    { opacity: 1, transform: 'translateX(0)' },
  ], start, dur);
  const show = (el: Element | null, start: number, end: number) => add(el, [
    { visibility: 'visible' }, { visibility: 'visible' },
  ], start, end - start, 'none');
  const life = (el: Element | null, start: number, settled: number, leave: number, end: number, x = 0) => {
    const duration = end - start;
    add(el, [
      { opacity: 0, transform: `translateX(${reduced ? 0 : x}cqw)`, offset: 0, easing: ease },
      { opacity: 1, transform: 'translateX(0)', offset: (settled - start) / duration },
      { opacity: 1, transform: 'translateX(0)', offset: (leave - start) / duration },
      { opacity: 0, transform: 'translateX(0)', offset: 1 },
    ], start, duration);
  };
  // A held state followed by a discontinuity exactly at `at`, including when seeking backwards.
  const cut = (el: Element | null, before: Keyframe, after: Keyframe, at: number) =>
    add(el, [{ ...before, easing: 'steps(1,end)' }, after], 0, at);
  const settlePortrait = (el: Element | null, at: number, dur: number) => add(el, [
    { transform: reduced ? 'none' : 'translateY(1.4cqw) scale(1.015)', easing: ease },
    { transform: 'translateY(0) scale(1)' },
  ], at, dur);
  const revealName = (el: Element | null, at: number, dur: number) => add(el, [
    { opacity: 0, clipPath: reduced ? 'inset(0)' : 'inset(0 0 100% 0)', transform: `translateY(${reduced ? 0 : .8}cqw)`, easing: ease },
    { opacity: 1, clipPath: 'inset(0)', transform: 'translateY(0)' },
  ], at, dur);

  enter(q('.bg'), 0, .6);
  const opening = plan.manager?.start ?? plan.groups[0]?.start ?? plan.final.start;
  enter(q('.s26-wash'), opening, .7);
  const rail = q('.s26-panel-track');
  const initialEdge = plan.manager ? 29 : plan.groups.length ? 90 : 36;
  const firstGroup = plan.groups[0]?.start ?? plan.final.start;
  const openingEdge = plan.manager && !reduced ? 0 : initialEdge;
  const edgePoints = [{ t: 0, value: openingEdge }];
  const crestPoints = [{ t: 0, value: plan.manager || !plan.groups.length ? 28.125 : 7 }];
  if (plan.manager) {
    // Reveal the scene from left to right while the shared panel boundary moves into place.
    edgePoints.push({ t: opening, value: openingEdge }, { t: opening + .55, value: initialEdge });
    add(q('.s26'), [
      { clipPath: reduced ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)', easing: ease },
      { clipPath: 'inset(0 0% 0 0)' },
    ], opening, reduced ? .01 : .55);
  }
  if (plan.manager && plan.groups.length) {
    edgePoints.push({ t: firstGroup - .1, value: 29 }, { t: firstGroup + .45, value: 90 });
    // Orientation: the crest rises after the rail narrows, then descends before it expands.
    crestPoints.push({ t: firstGroup + .25, value: 28.125 }, { t: firstGroup + .8, value: 7 });
  }
  edgePoints.push({ t: plan.final.start + (plan.groups.length ? .35 : 0), value: plan.groups.length ? 90 : initialEdge },
    { t: plan.final.ready, value: 36 }, { t: plan.total, value: 36 });
  if (plan.groups.length) crestPoints.push({ t: plan.final.start - .15, value: 7 }, { t: plan.final.start + .35, value: 28.125 });
  crestPoints.push({ t: plan.total, value: 28.125 });
  const keyframes = (points: typeof edgePoints, axis: 'edge' | 'y') => points.map((point) => ({
    transform: axis === 'edge' ? `translateX(${point.value}cqw)` : `translateY(${point.value - 4.25}cqw)`,
    offset: point.t / plan.total, easing: reduced ? 'steps(1,end)' : ease,
  }));
  add(rail, keyframes(edgePoints, 'edge'), 0, plan.total);
  add(q('.s26-crest-y'), keyframes(crestPoints, 'y'), 0, plan.total);
  add(q('.s26-pitch-reveal'), edgePoints.map((point) => ({ clipPath: `inset(0 0 0 ${point.value}%)`, offset: point.t / plan.total, easing: reduced ? 'steps(1,end)' : ease })), 0, plan.total);
  add(rail, [{ opacity: 0 }, { opacity: 1 }], opening, plan.manager && !reduced ? .12 : .55);

  if (plan.manager) {
    const { start, end, rollStart, rollEnd, nameStart, nameReady } = plan.manager;
    show(q('.s26-manager'), start, end + .5);
    life(q('.s26-manager'), start, start + .65, end, end + .45, -2);
    settlePortrait(q('.s26-coach-photo'), start + .06, .59);
    revealName(q('.s26-coach-name'), start + .2, .45);
    show(q('.s26-title'), start, end + .4);
    life(q('.s26-title'), start, start + .6, end - .15, end + .3);
    // The filled row leaves an outline behind; future rows stay blank on the first pass.
    // The centre also becomes an outline until the second pass fills it for the final hold.
    const letterBeats = [
      { row: 0, offset: 0 }, { row: 1, offset: .1 }, { row: 2, offset: .15 },
      { row: 3, offset: .25 }, { row: 4, offset: .35 }, { row: 5, offset: .45 },
      { row: 6, offset: .55 }, { row: 0, offset: .65 }, { row: 1, offset: .75 },
      { row: 2, offset: .85 }, { row: 3, offset: 1 },
    ];
    qa('.s26-outline span').forEach((letters, index) => add(letters,
      letterBeats.map(({ row, offset }, beat) => ({
        opacity: index === 3 ? (!reduced && beat > 3 && beat < 10 ? 1 : 0) : (index < 7 && (reduced || beat >= index) ? 1 : 0),
        color: !reduced && row === index && index !== 3 ? 'var(--s26-panel-ink)' : 'transparent',
        offset, easing: 'steps(1,end)',
      })), rollStart, reduced ? .01 : rollEnd - rollStart, reduced ? 'both' : 'forwards'));
    const solidDuration = nameStart + .36 - rollStart;
    add(q('.s26-solid'), [
      ...letterBeats.map(({ row, offset }) => ({
        opacity: reduced || row === 3 ? 1 : 0, transform: 'translate(0,0)',
        offset: offset * (rollEnd - rollStart) / solidDuration, easing: 'steps(1,end)',
      })),
      { opacity: 1, transform: 'translate(0,0)', offset: (nameStart - rollStart) / solidDuration, easing: 'cubic-bezier(.6,0,.4,1)' },
      { opacity: 1, transform: `translate(${reduced ? 0 : 70}cqw,0)`, offset: 1 - .000001, easing: 'steps(1,end)' },
      { opacity: 0, transform: `translate(${reduced ? 0 : 70}cqw,0)`, offset: 1 },
    ], rollStart, solidDuration);
    add(q('.s26-team'), [
      { opacity: 0, transform: reduced ? 'translate(0,-50%)' : 'translate(calc(-100% - 13cqw),-50%)', offset: 0, easing: 'steps(1,end)' },
      { opacity: 1, transform: reduced ? 'translate(0,-50%)' : 'translate(calc(-100% - 13cqw),-50%)', offset: .000001, easing: 'cubic-bezier(.16,1,.3,1)' },
      { opacity: 1, clipPath: 'inset(0)', transform: 'translate(0,-50%)' },
    ], nameStart + (reduced ? .36 : .18), reduced ? .01 : nameReady - nameStart - .18);
    add(q('.s26-outline'), [{ opacity: 1 }, { opacity: .24 }], nameStart + .25, reduced ? .01 : nameReady - nameStart - .25);
  }

  const groupEls = qa('.s26-group'), roleEls = qa('.s26-role');
  plan.groups.forEach((group, gi) => {
    const root = groupEls[gi];
    show(root, group.start, group.end);
    life(root, group.start, group.start + .08, group.leave, group.end);
    const columns = qa('.s26-column-position', root);
    columns.forEach((column, j) => {
      const at = group.start + (columns.length - 1 - j) * columnDelay(columns.length);
      enter(column, at, .64, 90 / columns.length);
      // The portrait settles before the name and badges. Their crop transforms remain on the image.
      // Both portrait containers share the same entrance, so a later Highlight cut stays stationary.
      qa('.s26-photo', column).forEach((photo) => settlePortrait(photo, at + .06, .58));
      revealName(q('.s26-name', column), at + .16, .46);
      add(q('.s26-tags', column), [
        { opacity: 0, transform: `translateY(${reduced ? 0 : .45}cqw)`, easing: ease },
        { opacity: 1, transform: 'translateY(0)' },
      ], at + .32, .3);
      add(q('.s26-number', column), [
        { transform: `translateX(${reduced ? 0 : -.7}cqw)`, easing: ease }, { transform: 'translateX(0)' },
      ], at + .1, .4);
      // One low-intensity light pass belongs to the entrance, never the Highlight trigger.
      if (!reduced) add(q('.s26-entry-light', column), [
        { opacity: 0, transform: 'translateX(-150%) skewX(-16deg)', offset: 0 },
        { opacity: .16, offset: .3 },
        { opacity: 0, transform: 'translateX(400%) skewX(-16deg)', offset: 1 },
      ], at + .1, .54);
      const player = s.players[group.items[j].i];
      if (player.key) {
        cut(q('.s26-metal', column), { opacity: 0 }, { opacity: 1 }, group.cut);
        cut(q('.s26-key-coat', column), { opacity: 0 }, { opacity: 1 }, group.cut);
        cut(q('.s26-key-veil', column), { opacity: 0 }, { opacity: 1 }, group.cut);
        cut(q('.s26-veil', column), { opacity: 1 }, { opacity: 0 }, group.cut);
        cut(q('.s26-name', column), { color: s.colorOverrides?.name || '#ffffff' }, { color: s.colorOverrides?.name || '#101820' }, group.cut);
        cut(q('.s26-number', column), { opacity: .22 }, { opacity: .42 }, group.cut);
        cut(q('.s26-photo', column), { opacity: 1 }, { opacity: 0 }, group.cut);
        cut(q('.s26-key-photo', column), { opacity: 0 }, { opacity: 1 }, group.cut);
        // Only the reflection moves after the same-frame material/image cut. No card sway or flash.
        if (!reduced) qa('.s26-reflection', column).forEach((reflection) => add(reflection, [
          { backgroundPosition: '120% 0', easing: 'cubic-bezier(.4,0,.2,1)' },
          { backgroundPosition: '-120% 0' },
        ], group.cut + .14, Math.min(1.25, group.leave - group.cut - .18)));
      }
      const rotor = q('.s26-badge-rotor', column);
      if (rotor) add(rotor, [
        { transform: 'translateZ(calc(-.5 * var(--s26-tag-h))) rotateX(0deg)', easing: ease },
        { transform: 'translateZ(calc(-.5 * var(--s26-tag-h))) rotateX(90deg)' },
      ], group.cut + .12, reduced ? .01 : .65);
      add(q('.s26-captain-text', column), [{ transform: 'translateX(0)' }, { transform: `translateX(${reduced ? '0' : '-50%'})` }], group.start, group.end - group.start);
    });
    // Consecutive midfield rows share one uninterrupted position label.
    if (gi && plan.groups[gi - 1].role === group.role) return;
    let last = gi;
    while (last + 1 < plan.groups.length && plan.groups[last + 1].role === group.role) last++;
    const at = group.start + (gi === 0 && plan.manager ? .2 : 0);
    const { leave, end } = plan.groups[last], duration = end - at;
    show(roleEls[gi], at, end);
    // Orientation: fixed-size labels enter from the top and leave through the bottom of the rail.
    add(roleEls[gi], [
      { opacity: reduced ? 0 : 1, transform: `translateY(${reduced ? 0 : -56.25}cqw)`, offset: 0, easing: ease },
      { opacity: 1, transform: 'translateY(0)', offset: .6 / duration },
      { opacity: 1, transform: 'translateY(0)', offset: (leave - at) / duration, easing: 'cubic-bezier(.4,0,1,1)' },
      { opacity: reduced ? 0 : 1, transform: `translateY(${reduced ? 0 : 56.25}cqw)`, offset: 1 },
    ], at, duration);
  });

  show(q('.s26-final'), plan.final.start, plan.total + .01);
  enter(q('.s26-final'), plan.final.start + .25, .7);
  enter(q('.s26-substitutes'), plan.final.start + .65, .6, -2);
  const cards = qa('.card');
  boardLayout(s).groups.forEach((group, gi) => group.items.forEach((item) => {
    const slot = qa('.slot').find((el) => Number(el.dataset.i) === item.i);
    const card = slot ? q('.card', slot) : cards[item.i];
    const at = plan.final.start + .3 + gi * .075;
    add(card, [
      { opacity: 0, transform: reduced ? 'none' : 'translateY(.55cqw) scale(.96)', easing: ease },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], at, .5);
    if (slot && !reduced) add(q('.cflip', slot), [
      { transform: 'rotateY(-65deg)', easing: ease }, { transform: 'rotateY(0)' },
    ], at, .48);
  }));
  return { ...plan, specs };
}
