import type { LineupState } from './types';

const EASE = 'cubic-bezier(.2,.8,.2,1)';

/** The opening, letter beats and drawer share one clock in preview and export. */
export function planClassicOpening(s: LineupState, after = 0) {
  const start = after + (after ? .05 : .15);
  const cover = start + (s.anim.openingLights ? .44 : 0), colourReady = start + (s.anim.openingLights ? .52 : 0);
  const open = start + (s.anim.openingLights ? .62 : .18), landed = open + .62;
  const rollStart = open - .12, rollEnd = rollStart + Math.min(1.04, s.anim.mgrLen * .2);
  const nameStart = rollEnd + .65, nameReady = nameStart + .55;
  const leave = start + s.anim.mgrLen - .7, handoff = leave + .8;
  return { start, cover, colourReady, open, landed, rollStart, rollEnd, nameStart, nameReady, leave, handoff, end: handoff + .25 };
}

type Query = (selector: string) => HTMLElement | null;
type QueryAll = (selector: string) => HTMLElement[];

export function classicOpeningTimeline(s: LineupState, q: Query, qa: QueryAll, reduced: boolean, after: number) {
  const plan = planClassicOpening(s, after), specs: { el: Element; frames: Keyframe[]; start: number; dur: number; fill?: FillMode }[] = [];
  const { start, cover, colourReady, open, landed, rollStart, rollEnd, nameStart, nameReady, leave, handoff, end } = plan;
  const add = (el: Element | null, frames: Keyframe[], at: number, dur: number, fill?: FillMode) => {
    if (el) specs.push({ el, frames, start: at, dur, fill });
  };
  const life = (el: Element | null, at: number, ready: number, out: number, gone: number, x = 0) => add(el, [
    { opacity: 0, transform: `translateX(${reduced ? 0 : x}cqw)`, offset: 0, easing: EASE },
    { opacity: 1, transform: 'translateX(0)', offset: (ready - at) / (gone - at) },
    { opacity: 1, transform: 'translateX(0)', offset: (out - at) / (gone - at) },
    { opacity: 0, transform: 'translateX(0)', offset: 1 },
  ], at, gone - at);

  // Orientation: fixed bands flash on; light and then club colour pass from left to right inside them.
  if (s.anim.openingLights && !reduced) {
    add(q('.m-sweep'), [
      { opacity: .94, offset: 0 },
      { opacity: .94, offset: (colourReady - start) / (open - start), easing: 'ease-out' },
      { opacity: 0, offset: 1 },
    ], start, open - start, 'none');
    add(q('.m-sweep'), [
      { backgroundPosition: '100% 50%', easing: 'ease-in-out' }, { backgroundPosition: '0% 50%' },
    ], start, colourReady - start);
    add(q('.m-sweep-team'), [
      { maskPosition: '100% 50%', easing: 'ease-in-out' }, { maskPosition: '0% 50%' },
    ], start + .18, colourReady - start - .18);
  }
  // Use identical horizontal tracks so the badge stays attached to the panel boundary.
  const drawer = [
    { t: cover, x: reduced ? 0 : -33, opacity: 0 },
    { t: open, x: reduced ? 0 : -33, opacity: 1 },
    { t: landed, x: 0, opacity: 1 },
    { t: leave, x: 0, opacity: 1 },
    { t: handoff, x: 52, opacity: 1 },
    { t: handoff + .05, x: 52, opacity: 1 },
    { t: end, x: 52, opacity: 0 },
  ].map(({ t, x, opacity }, index) => ({ transform: `translateX(${x}cqw)`, opacity, offset: (t - cover) / (end - cover), easing: reduced ? 'steps(1,end)' : index === 0 ? 'linear' : EASE }));
  add(q('.m-panel'), drawer, cover, end - cover);
  add(q('.m-crest'), drawer, cover, end - cover);
  add(q('.m-titles'), [
    { transform: 'translateX(0)', easing: reduced ? 'steps(1,end)' : EASE }, { transform: 'translateX(52cqw)' },
  ], leave, handoff - leave);
  add(q('.m-crest-y'), [
    { transform: `translateY(${reduced ? 0 : 40}cqw)`, easing: EASE }, { transform: 'translateY(0)' },
  ], open, landed - open);
  life(q('.m-photo'), open, landed, leave, leave + .4, -1.2);
  life(q('.m-name'), landed + .08, landed + .4, leave, leave + .25);
  life(q('.m-eye'), nameReady, nameReady + .2, leave, leave + .25);
  life(q('.m-colw'), rollStart - .01, rollStart, leave, leave + .25);

  // Emphasis: each filled row leaves an outline, then a second pass stops at the centre.
  const beats = [
    { row: 0, offset: 0 }, { row: 1, offset: .1 }, { row: 2, offset: .2 },
    { row: 3, offset: .3 }, { row: 4, offset: .4 }, { row: 5, offset: .5 },
    { row: 6, offset: .6 }, { row: 0, offset: .7 }, { row: 1, offset: .8 },
    { row: 2, offset: .9 }, { row: 3, offset: 1 },
  ];
  qa('.m-col span').forEach((row, index) => add(row, beats.map((beat, n) => ({
    opacity: index === 3 ? (!reduced && n > 3 && n < 10 ? 1 : 0) : (reduced || n >= index ? 1 : 0),
    color: !reduced && beat.row === index && index !== 3 ? 'var(--c3)' : 'transparent',
    offset: beat.offset, easing: 'steps(1,end)',
  })), rollStart, reduced ? .01 : rollEnd - rollStart, reduced ? 'both' : 'forwards'));
  const solidEnd = nameStart + .36, solidDuration = solidEnd - rollStart;
  add(q('.m-solid'), [
    ...beats.map(({ row, offset }) => ({ opacity: reduced || row === 3 ? 1 : 0, transform: 'translateX(0)',
      offset: offset * (rollEnd - rollStart) / solidDuration, easing: 'steps(1,end)' })),
    { opacity: 1, transform: 'translateX(0)', offset: (nameStart - rollStart) / solidDuration, easing: 'cubic-bezier(.6,0,.4,1)' },
    { opacity: 1, transform: `translateX(${reduced ? 0 : 70}cqw)`, offset: 1 - .000001, easing: 'steps(1,end)' },
    { opacity: 0, transform: `translateX(${reduced ? 0 : 70}cqw)`, offset: 1 },
  ], rollStart, solidDuration);
  // The incoming name follows the outgoing abbreviation without overlap or a fading double image.
  const nameAt = nameStart + (reduced ? .36 : .18);
  life(q('.m-teamw'), nameAt, nameAt + .01, leave, leave + .25);
  add(q('.m-team'), [
    { transform: reduced ? 'translateX(0)' : 'translateX(-105%)', easing: 'cubic-bezier(.16,1,.3,1)' },
    { transform: 'translateX(0)' },
  ], nameAt, nameReady - nameStart - .18);
  add(q('.m-col'), [{ opacity: 1 }, { opacity: .22 }], nameStart + .25, nameReady - nameStart - .25);
  return { plan, specs };
}
