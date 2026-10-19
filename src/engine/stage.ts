import { colorOverrideStyles } from './color-overrides';
/*
 * The broadcast frame: renders the lineup into a host element and plays it back on one shared clock
 * (Web Animations), so it can be scrubbed, paused, looped and sped up. Also handles moving cards on the
 * pitch and adjusting pictures right on the frame.
 */
import styles from './stage.module.css';
import seasonStyles from './season2627.module.css';
import { season2627HTML, season2627Timeline } from './season2627';
import { classicOpeningTimeline } from './classic-opening';
import { classicLineDuration, classicRowInterval } from './reveal-timing';
import { CW, STEP } from './constants';
import { cjkFor, ensureFont, fontStack } from './fonts';
import { boardLayout, fitStyle, proj, stageHTML, unproj } from './markup';
import { patternURI, textPatternURI } from './pattern';
import { clamp, fitRef } from './state';
import { slotsFor } from './formation';
import type { Fit, FitPath, LineupState } from './types';

export type SceneId = 'intro' | 'manager' | 'players' | 'gk' | 'def' | 'mid' | 'fwd' | 'subs' | 'final';

export interface PlaybackSnapshot {
  playing: boolean;
  /** Current time and total length, in seconds. */
  t: number;
  total: number;
  rate: number;
  scene: SceneId | '';
  marks: { t: number; scene: SceneId }[];
  adjusting: boolean;
  /** The picture selected while adjusting, as a fit path. */
  selected: FitPath | null;
  fullscreen: boolean;
}

export type StageNotice = 'videoError' | 'fullscreenUnavailable';

export interface StageOptions {
  getState(): LineupState;
  getLang(): string;
  /** The stage changed the lineup itself (card moved, picture adjusted). `final` is false while dragging. */
  onEdit(change: { kind: 'slot' } | { kind: 'fit'; path: FitPath; final: boolean }): void;
  onPlayerClick(index: number): void;
  onNotice(notice: StageNotice): void;
}

type Frames = Keyframe[];
interface Spec { el: Element; frames: Frames; start: number; dur: number }

const EASE = 'cubic-bezier(.2,.8,.2,1)', EASE_OUT = 'cubic-bezier(.6,0,.8,.4)';
const cn = (name: string) => (styles as Record<string, string>)[name] ?? (seasonStyles as Record<string, string>)[name] ?? name;
const mapHtml = (html: string) =>
  html.replace(/class="([^"]*)"/g, (_, c: string) => `class="${c.split(/\s+/).filter(Boolean).map(cn).join(' ')}"`);
/** Maps `.name` parts of a selector to the CSS Module's class names. */
const sel = (s: string) => s.replace(/\.([a-zA-Z_][\w-]*)/g, (_, n: string) => '.' + CSS.escape(cn(n)));

export const stageClass = cn;

export class Stage {
  readonly wrap: HTMLElement;
  readonly stage: HTMLDivElement;
  private fitBox: HTMLDivElement;
  private clockEl: HTMLElement;
  private opts: StageOptions;
  private anims: Animation[] = [];
  private clock: Animation | null = null;
  private total = 1;
  private playing = false;
  private rate = 1;
  private raf = 0;
  private marks: { t: number; scene: SceneId }[] = [];
  private adjusting = false;
  private selFit: FitPath | null = null;
  private videoURL: string | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private refreshTimer = 0;
  private listeners = new Set<() => void>();
  private snap: PlaybackSnapshot;
  private cleanup: (() => void)[] = [];
  private fitBoxTarget: Element | null = null;

  constructor(wrap: HTMLElement, opts: StageOptions) {
    this.wrap = wrap;
    this.opts = opts;
    wrap.classList.add(cn('stage-wrap'));
    wrap.innerHTML = mapHtml(
      `<div class="stage-box"><div class="stage" role="img"></div></div><div class="fit-box" hidden><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div><i hidden></i>`,
    );
    this.stage = wrap.querySelector(sel('.stage'))!;
    this.fitBox = wrap.querySelector(sel('.fit-box'))!;
    this.clockEl = wrap.lastElementChild as HTMLElement;
    this.snap = this.makeSnap();
    this.bindEvents();
    this.refresh();
    this.seek(this.total); // rest on the finished lineup
  }

  /* ---------- Subscription for the interface ---------- */
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = () => this.snap;
  private makeSnap(): PlaybackSnapshot {
    const t = Math.min(this.curT(), this.total);
    let scene: SceneId | '' = this.marks.length ? this.marks[0].scene : '';
    this.marks.forEach((m) => { if (t >= m.t - 0.01) scene = m.scene; });
    if (t >= this.total - 0.05) scene = 'final';
    return {
      playing: this.playing, t, total: this.total, rate: this.rate, scene, marks: this.marks,
      adjusting: this.adjusting, selected: this.selFit, fullscreen: document.fullscreenElement === this.wrap,
    };
  }
  private emit() {
    this.snap = this.makeSnap();
    if (this.adjusting) this.placeFitBox();
    this.listeners.forEach((l) => l());
  }

  private get s() {
    return this.opts.getState();
  }
  private q<T extends Element = HTMLElement>(s: string, root: ParentNode = this.stage) {
    return root.querySelector<T>(sel(s));
  }
  private qa<T extends Element = HTMLElement>(s: string, root: ParentNode = this.stage) {
    return [...root.querySelectorAll<T>(sel(s))];
  }
  private fitEls(path: FitPath) {
    return [...this.stage.querySelectorAll<HTMLElement>('[data-fit]')].filter((el) => el.dataset.fit === path);
  }

  /* ---------- Rendering ---------- */
  private renderStage() {
    const s = this.s, st = this.stage.style;
    st.setProperty('--c1', s.colors.c1);
    st.setProperty('--c2', s.colors.c2);
    st.setProperty('--c3', s.colors.c3);
    st.setProperty('--c4', s.colors.c4);
    for (const [key, value] of Object.entries(colorOverrideStyles(s))) { if (value) st.setProperty(key, value); else st.removeProperty(key); }
    const ck = cjkFor(s.fonts.cjk, this.opts.getLang(), navigator.language);
    ensureFont(ck.font);
    ensureFont(s.fonts.display);
    ensureFont(s.fonts.body);
    st.setProperty('--fd', fontStack(s.fonts.display, ck.font));
    st.setProperty('--fb', fontStack(s.fonts.body, ck.font));
    st.setProperty('--pat', patternURI(s));
    st.setProperty('--text-pat', textPatternURI(s));
    st.setProperty('--pats', patternURI(s, ['#dfe3e6', '#99a0a7']));
    st.setProperty('--sweep', patternURI(s, ['#ffffff', '#ffffff'], true));
    st.setProperty('--gz', (s.look.photoScale / 100).toFixed(2));
    st.setProperty('--ks', (s.look.smallSize / 100).toFixed(2));
    st.setProperty('--tgz', (s.look.tagSize / 100).toFixed(2));
    this.stage.setAttribute('lang', ck.tag);
    this.stage.dataset.shape = s.look.shape;
    this.stage.classList.toggle(cn('upper'), !!s.look.upper);
    this.stage.setAttribute('aria-label', `${s.text.title} · ${s.team.name}`);
    this.stage.innerHTML = mapHtml(s.anim.template === 'season2627' ? season2627HTML(s, this.videoURL) : stageHTML({ s, videoURL: this.videoURL }));
    this.mountBackground();
    this.fitText();
  }

  private mountBackground() {
    const s = this.s, bg = this.q('.bg');
    this.videoEl?.pause();
    if (!bg) return;
    const tint = `color-mix(in srgb, var(--c1) ${Number(s.bg.dim)}%, transparent)`;
    if (s.bg.mode === 'video' && this.videoURL) {
      if (!this.videoEl) {
        const v = document.createElement('video');
        Object.assign(v, { muted: true, loop: true, playsInline: true });
        v.setAttribute('muted', '');
        v.setAttribute('playsinline', '');
        v.addEventListener('error', () => this.opts.onNotice('videoError'));
        v.addEventListener('loadedmetadata', () => this.syncVideo(true));
        this.videoEl = v;
      }
      const v = this.videoEl;
      if (v.src !== this.videoURL) v.src = this.videoURL;
      v.setAttribute('style', fitStyle(s.bg.fit));
      v.setAttribute('data-fit', 'bg:fit');
      bg.appendChild(v);
      const ti = document.createElement('i');
      ti.className = cn('tint');
      ti.style.background = tint;
      bg.appendChild(ti);
      this.syncVideo(true);
    } else if (s.bg.mode === 'image' && s.bg.image) {
      bg.insertAdjacentHTML(
        'beforeend',
        mapHtml(`<img class="bgimg" src="${s.bg.image}" alt="" draggable="false" data-fit="bg:fit" style="${fitStyle(s.bg.fit)}"><i class="tint" style="background:${tint}"></i>`),
      );
    }
  }

  /** Shrinks headings and names until each fits (long names, wide fonts). */
  fitText = () => {
    const sb = this.q('.fin .subs') ?? this.q('.s26-substitutes .subs'), fn = this.q('.fin') ?? this.q('.s26-substitutes');
    if (sb && fn) {
      sb.style.zoom = '';
      let f = 1;
      const over = () => fn.scrollHeight > fn.clientHeight + 1 || this.qa('li', sb).some((li) => li.scrollWidth > li.clientWidth + 1);
      while (over() && f > 0.5) {
        f -= 0.05;
        sb.style.zoom = String(f);
      }
    }
    this.qa('.i-title, .i-team, .m-team, .s26-team, .s26-solid').forEach((el) => {
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize);
      let f = base;
      while (el.scrollWidth > el.clientWidth + 1 && f > base * 0.4) {
        f *= 0.94;
        el.style.fontSize = f + 'px';
      }
    });
    this.qa('.sec').forEach((el) => {
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize);
      let f = base;
      while (el.scrollHeight > el.clientHeight + 1 && f > base * 0.4) {
        f *= 0.94;
        el.style.fontSize = f + 'px';
      }
    });
  };

  /* ---------- Timeline ---------- */
  private buildTimeline() {
    this.anims.forEach((a) => a.cancel());
    this.anims = [];
    if (this.s.anim.template === 'season2627') {
      const plan = season2627Timeline(this.s, (selector, root) => this.q(selector, root), (selector, root) => this.qa(selector, root), matchMedia('(prefers-reduced-motion: reduce)').matches);
      this.total = plan.total;
      this.installTimeline(plan.specs, plan.marks);
      return;
    }
    const specs: Spec[] = [];
    const s = this.s;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const q = (x: string) => this.q(x), qa = (x: string) => this.qa(x);
    const in$ = (x: string, root: Element | null) => (root ? this.q(x, root) : null);
    const add = (el: Element | null | undefined, frames: Frames, start: number, dur: number) => { if (el) specs.push({ el, frames, start, dur }); };
    const enter = (el: Element | null | undefined, start: number, from: Keyframe, to: Keyframe, dur = 0.55, ease = EASE) =>
      add(el, [{ ...from, easing: ease }, { ...to }], start, dur);
    // one animation per element covering its whole on-screen life, so earlier and later states never fight
    const life = (el: Element | null | undefined, tIn: number, tOut: number, from: Keyframe, to: Keyframe, out: Keyframe, dIn = 0.5, dOut = 0.35, hold?: Keyframe) => {
      if (!el) return;
      tOut = Math.max(tOut, tIn + dIn + 0.02);
      const span = tOut + dOut - tIn;
      add(el, [{ ...from, offset: 0, easing: EASE }, { ...to, offset: dIn / span }, { ...(hold || to), offset: (tOut - tIn) / span, easing: EASE_OUT }, { ...out, offset: 1 }], tIn, span);
    };
    // Orientation: coloured bands bridge the optional card scenes on the shared clock.
    const wipe = (el: Element | null | undefined, at: number) => {
      if (!reduced) add(el, [{ transform: 'translateX(-150%) skewX(-16deg)', easing: 'cubic-bezier(.7,0,.3,1)' }, { transform: 'translateX(170%) skewX(-16deg)' }], at, 0.58);
    };

    // captain and key-player cards
    const upgrade = (card: Element | null, at: number, popEl?: Element | null, until?: number) => {
      if (!card) return;
      // key player: a quick pop with a turn on the Y axis that makes the card silver, then a gentle sway with a glint in step
      if (in$('.rc-metal', card)) {
        const peak = at + 0.16;
        if (popEl) {
          const kf: Keyframe[] = [
            { transform: 'scale(1) rotateY(0deg)', offset: 0, easing: 'cubic-bezier(.2,0,.4,1)' },
            { transform: 'scale(1.16) rotateY(-24deg)', offset: 0.22, easing: 'cubic-bezier(.5,0,.3,1)' },
            { transform: 'scale(1.02) rotateY(9deg)', offset: 0.48, easing: 'cubic-bezier(.4,0,.3,1)' },
            { transform: 'scale(1) rotateY(0deg)', offset: 0.7 },
          ];
          const t0 = at + 0.7, end = until ? Math.max(t0 + 1, until - 0.35) : t0, dur = end + 0.3 - at;
          kf.forEach((k) => (k.offset = ((k.offset as number) * 0.7) / dur));
          const glint: Keyframe[] = [{ backgroundPosition: '130% 0', offset: 0 }, { backgroundPosition: '130% 0', offset: 0.7 / dur }];
          // slow sway: ±12° with a 2.4 s period
          const steps = Math.floor((end - t0) / 0.6);
          for (let n = 1; n <= steps; n++) {
            const tt = t0 + n * 0.6, ph = Math.sin((n * Math.PI) / 2), o = (tt - at) / dur;
            kf.push({ transform: `scale(1) rotateY(${(-12 * ph).toFixed(1)}deg)`, offset: o, easing: 'ease-in-out' });
            glint.push({ backgroundPosition: `${(110 * ph).toFixed(0)}% 0`, offset: o, easing: 'ease-in-out' });
          }
          kf.push({ transform: 'scale(1) rotateY(0deg)', offset: 1 });
          glint.push({ backgroundPosition: '0% 0', offset: 1 });
          add(popEl, kf, at, dur);
          add(in$('.rc-holo', card), glint, at, dur);
        }
        add(in$('.rc-flash', card), [{ opacity: 0 }, { opacity: 0.55, offset: 0.4, easing: 'ease-out' }, { opacity: 0 }], at + 0.06, 0.3);
        enter(in$('.rc-metal', card), peak, { opacity: 0 }, { opacity: 1 }, 0.02, 'linear');
        enter(in$('.rc-photo', card), peak, { opacity: 1 }, { opacity: 0 }, 0.02, 'linear');
        enter(in$('.rc-kphoto', card), peak, { opacity: 0, transform: 'scale(1.12)' }, { opacity: 1, transform: 'scale(1)' }, 0.35, 'cubic-bezier(.5,0,.3,1.3)');
        enter(in$('.rc-holo', card), peak + 0.3, { opacity: 0 }, { opacity: 1 }, 0.5, 'ease-out');
      }
      // captain: the first tag rolls over to a scrolling armband (or the armband slides out when there is no tag)
      const roll = in$('.roll-in', card), tick = in$('.rc-ticker', card);
      if (roll) add(roll, [{ transform: 'translateZ(calc(-1.05cqw * var(--tgz,1))) rotateX(0deg)', easing: 'cubic-bezier(.55,0,.3,1.25)' }, { transform: 'translateZ(calc(-1.05cqw * var(--tgz,1))) rotateX(90deg)' }], at + 0.3, 0.75);
      else if (tick) enter(tick, at + 0.3, { opacity: 0, transform: 'scaleX(0)' }, { opacity: 1, transform: 'scaleX(1)' }, 0.5);
    };
    // damped spring: moves fast, overshoots a little and settles; returns [time, value] samples
    const spring = (from: number, to: number, t0: number, dur: number, k = 5.5, cyc = 1.2, n = 26) => {
      const o: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        o.push([t0 + u * dur, to + (from - to) * Math.exp(-k * u) * Math.cos(2 * Math.PI * cyc * u)]);
      }
      o[n][1] = to;
      return o;
    };
    // keyframes from [time, value, opacity?] points
    const track = (pts: number[][], fmt: (v: number) => string, t0: number, t1: number): Keyframe[] =>
      pts.map(([tt, v, op]) => ({ transform: fmt(v), ...(op === undefined ? {} : { opacity: op }), offset: clamp((tt - t0) / (t1 - t0), 0, 1) }));

    const style = s.anim.style, per = s.anim.per;
    let t = 0;
    const marks: { t: number; scene: SceneId }[] = [];
    if (s.anim.intro) marks.push({ t: 0, scene: 'intro' });
    const liveOpening = s.anim.manager && !s.anim.intro && ((s.bg.mode === 'image' && s.bg.image) || (s.bg.mode === 'video' && this.videoURL));
    enter(q('.bg'), 0, { opacity: liveOpening ? 1 : 0, transform: liveOpening ? 'scale(1)' : 'scale(1.08)' }, { opacity: 1, transform: 'scale(1)' }, 1, 'ease-out');

    if (s.anim.intro) {
      const L = s.anim.introLen, end = L - 0.35;
      qa('.shard').forEach((el, k) =>
        life(el, 0.05 + k * 0.09, end + k * 0.05, { opacity: 1, transform: 'translate(34cqw,-22cqw)' }, { opacity: 1, transform: 'translate(0,0)' },
          { opacity: 0, transform: 'translate(-50cqw,32cqw)' }, 0.75, 0.45, { opacity: 1, transform: 'translate(-1.5cqw,1cqw)' }));
      life(q('.i-crest'), 0.4, end, { opacity: 0, transform: 'scale(.55) rotate(-8deg)', filter: 'blur(12px)' },
        { opacity: 1, transform: 'scale(1) rotate(0deg)', filter: 'blur(0px)' }, { opacity: 0, transform: 'scale(1.2) rotate(0deg)', filter: 'blur(8px)' }, 0.75, 0.35,
        { opacity: 1, transform: 'scale(1.04) rotate(0deg)', filter: 'blur(0px)' });
      add(q('.flare'), [{ opacity: 0, transform: 'translateX(-24cqw) skewX(-20deg)' }, { opacity: 1, offset: 0.45 }, { opacity: 0, transform: 'translateX(30cqw) skewX(-20deg)' }], 1.0, 0.9);
      life(q('.i-eyebrow'), 0.75, end, { opacity: 0, transform: 'translateY(1.5cqw)' }, { opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-1cqw)' }, 0.5, 0.3);
      life(q('.i-title'), 0.9, end + 0.05, { clipPath: 'inset(0 100% 0 0)', transform: 'translateX(-3cqw)' }, { clipPath: 'inset(0 0% 0 0%)', transform: 'translateX(0)' },
        { clipPath: 'inset(0 0% 0 100%)', transform: 'translateX(3cqw)' }, 0.7, 0.35, { clipPath: 'inset(0 0% 0 0%)', transform: 'translateX(.8cqw)' });
      life(q('.i-team'), 1.2, end + 0.1, { opacity: 0, transform: 'translateX(-2cqw)' }, { opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(2cqw)' }, 0.55, 0.3);
      t = L;
    }

    let fromMgr: number | false = false;
    let hazeAt: number | null = null;
    if (s.anim.manager) {
      const opening = classicOpeningTimeline(s, q, qa, reduced, t);
      specs.push(...opening.specs);
      marks.push({ t: opening.plan.start, scene: 'manager' });
      hazeAt = opening.plan.open;
      t = opening.plan.leave + .3;
      fromMgr = opening.plan.handoff;
    }

    if (style === 'row') {
      fromMgr = false;
      const cards = qa('.rc').filter((c) => !c.classList.contains(cn('bigc'))), n = cards.length;
      const S = t + 0.1, startX = 100, endX = 50 - ((n - 1) * STEP + CW / 2), rp = classicRowInterval(per);
      marks.push({ t: S, scene: 'players' });
      const run = ((startX - endX) / STEP) * rp, tail = 0.6;
      add(q('.strip'), [{ transform: `translateX(${startX}cqw)`, opacity: 1, offset: 0, easing: 'linear' },
        { transform: `translateX(${endX}cqw)`, opacity: 1, offset: run / (run + tail), easing: 'ease-in' },
        { transform: `translateX(${endX - 22}cqw)`, opacity: 0, offset: 1 }], S, run + tail);
      life(q('.bug'), S + 0.2, S + run - 0.2, { opacity: 0, transform: 'translateY(-2cqw)' }, { opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-2cqw)' }, 0.45, 0.3);
      cards.forEach((card, i) => {
        const tE = S + i * rp;
        enter(in$('.rc-in', card), tE - 0.05, { opacity: 0.25, transform: 'translateY(2.5cqw) rotate(2deg) scale(.95)' }, { opacity: 1, transform: 'translateY(0) rotate(0deg) scale(1)' }, 0.7);
        upgrade(card, tE + 1.3 * rp);
      });
      wipe(q('.wipe'), S + run - 0.1);
      t = S + run + 0.2;
    }

    /* Pitch board: small number cards, then each line grows into big cards, then the full lineup with substitutes. */
    const F = t + (t ? 0.05 : 0.2);
    enter(q('.haze'), hazeAt ?? F, { opacity: 0 }, { opacity: 1 }, 0.8, 'ease-out');
    enter(q('.pitch'), F, { opacity: 0, transform: 'scale(1.04)' }, { opacity: 1, transform: 'scale(1)' }, 0.8, 'ease-out');
    if (fromMgr !== false) enter(q('.bpanel'), fromMgr + 0.05, { opacity: 0 }, { opacity: 1 }, 0.2, 'linear');
    else enter(q('.bpanel'), F + 0.05, { transform: 'translateX(105%)' }, { transform: 'translateX(0)' }, 0.7);
    // number cards pop up one line at a time; every card in a line moves together
    const L = boardLayout(s);
    const slotEl = (i: number) => this.stage.querySelector(`${sel('.slot')}[data-i="${i}"]`);
    const bigEl = (i: number) => this.stage.querySelector(`${sel('.bigc')}[data-i="${i}"]`);
    L.groups.forEach((g, gi) =>
      g.items.forEach((it) => enter(in$('.card', slotEl(it.i)), F + 0.35 + gi * 0.2, { opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1)' }, 0.45, 'cubic-bezier(.2,.9,.3,1.35)')),
    );
    let fin = F + 0.35 + L.groups.length * 0.2 + 0.8;
    const pc = q('.pcrest');
    if (pc && fromMgr !== false) enter(pc, fromMgr + 0.05, { opacity: 0 }, { opacity: 1 }, 0.05, 'linear'); // the knob has arrived as the sidebar badge
    else if (pc) enter(pc, F + 0.5, { opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }, 0.6, 'cubic-bezier(.2,.9,.3,1.3)');
    if (style === 'lines') {
      const secws = qa('.secw'), flashes = qa('.pflash');
      let tg = fin + 0.4;
      const span: [number, number][] = [];
      L.groups.forEach((g, gi) => {
        const special = g.items.some((it) => s.players[it.i].captain || s.players[it.i].key);
        const hold = classicLineDuration(per, g.items.length, special);
        span[gi] = [tg, tg + hold];
        g.items.forEach((it) => {
          const big = bigEl(it.i), slot = slotEl(it.i);
          const tin = tg + 0.15, tout = tg + hold; // the whole line grows, flips and returns together
          const small: Keyframe = { left: it.sx + '%', top: it.sy + '%', transform: `translate(-50%,-50%) scale(${it.ss})`, opacity: 0 };
          const large: Keyframe = { left: it.bx + '%', top: it.by + '%', transform: `translate(-50%,-50%) scale(${it.bs})`, opacity: 1 };
          life(big, tin, tout, small, large, small, 0.85, 0.6);
          // the card is one printed piece: number, photo, name and tags turn over with it
          const fs = tout + 0.55 - tin, o = (x: number) => (x - tin) / fs, edgeIn = o(tin + 0.45), edgeOut = o(tout + 0.27);
          add(in$('.flip', big), [
            { transform: 'rotateY(-180deg)', offset: 0, easing: 'cubic-bezier(.4,0,1,1)' },
            { transform: 'rotateY(-90deg)', offset: edgeIn, easing: 'cubic-bezier(0,0,.2,1)' },
            { transform: 'rotateY(0deg)', offset: o(tin + 1) },
            { transform: 'rotateY(0deg)', offset: o(tout), easing: 'cubic-bezier(.4,0,1,1)' },
            { transform: 'rotateY(90deg)', offset: edgeOut, easing: 'cubic-bezier(0,0,.2,1)' },
            { transform: 'rotateY(180deg)', offset: 1 }], tin, fs);
          // tags sit just outside the card edge, so they switch off exactly when the card is edge-on
          const showFace: Keyframe[] = [{ opacity: 0, offset: 0 }, { opacity: 0, offset: edgeIn }, { opacity: 1, offset: edgeIn + 0.0005 }, { opacity: 1, offset: edgeOut }, { opacity: 0, offset: edgeOut + 0.0005 }, { opacity: 0, offset: 1 }];
          const showBack = showFace.map((k2) => ({ ...k2, opacity: 1 - (k2.opacity as number) }));
          add(in$('.rc-tags', big), showFace, tin, fs);
          add(in$('.fface', big), showFace, tin, fs);
          add(in$('.fback', big), showBack, tin, fs);
          upgrade(big, tin + 1.9, in$('.fface', big), tout);
          // the small card hides while its big card is up, then turns over to show the portrait side
          const back = tout + 0.55, d = back + 0.55 - tin, r = (back - tin) / d;
          add(in$('.cvis', slot), [{ opacity: 1, offset: 0 }, { opacity: 0, offset: 0.15 / d }, { opacity: 0, offset: r }, { opacity: 1, offset: r + 0.0005 }, { opacity: 1, offset: 1 }], tin, d);
          add(in$('.cflip', slot), [{ transform: 'rotateY(180deg)', offset: 0 }, { transform: 'rotateY(180deg)', offset: r - 0.0005 }, { transform: 'rotateY(-90deg)', offset: r, easing: EASE }, { transform: 'rotateY(0deg)', offset: 1 }], tin, d);
          add(in$('.sm-face', slot), [{ opacity: 0, offset: 0 }, { opacity: 0, offset: r }, { opacity: 1, offset: r + 0.0005 }, { opacity: 1, offset: 1 }], tin, d);
          add(in$('.sm-num', slot), [{ opacity: 1, offset: 0 }, { opacity: 1, offset: r }, { opacity: 0, offset: r + 0.0005 }, { opacity: 0, offset: 1 }], tin, d);
        });
        tg += hold + 0.9;
      });
      // the side label changes only when the role changes; rows of the same role keep it on screen
      const SCENE: Record<string, SceneId> = { GK: 'gk', DEF: 'def', MID: 'mid', FWD: 'fwd' };
      L.labels.forEach((lb, li) => {
        const a = span[lb.groups[0]][0], b = span[lb.groups[lb.groups.length - 1]][1];
        marks.push({ t: a, scene: SCENE[lb.role] || 'players' });
        // Orientation: a short cyan-to-violet wash travels down the rail as its new label arrives.
        if (!reduced) add(flashes[li], [{ transform: 'translateY(0)', easing: 'cubic-bezier(.4,0,.3,1)' }, { transform: 'translateY(210%)' }], a - 0.06, 0.52);
        life(secws[li], a, b, { transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }, { transform: 'translateY(100%)' }, 0.45, 0.5);
      });
      fin = tg;
    }
    if (s.look.subs && q('.fin .subs')) marks.push({ t: fin, scene: 'subs' });
    // the sidebar widens to hold the substitutes, and the lineup slides left (no scaling) to make room
    add(q('.bpanel'), spring(15, 33, fin, 1.1, 6, 1.1).map(([tt, v]) => ({ width: v.toFixed(2) + 'cqw', offset: clamp((tt - fin) / 1.1, 0, 1) })), fin, 1.1);
    add(q('.field'), track(spring(0, -10, fin, 1.1, 6, 1.1), (v) => `translateX(${v.toFixed(2)}cqw)`, fin, fin + 1.1), fin, 1.1);
    const finEls = qa('.fin > *');
    finEls.forEach((el, k) => enter(el, fin + 0.6 + k * 0.14, { opacity: 0, transform: 'translateX(3cqw)' }, { opacity: 1, transform: 'translateX(0)' }, 0.6));
    this.total = fin + 0.6 + finEls.length * 0.14 + 3;

    this.installTimeline(specs, marks);
  }

  private installTimeline(specs: (Spec & { fill?: FillMode })[], marks: { t: number; scene: SceneId }[]) {
    const T = this.total * 1000;
    // Keep short effects on the full clock, so play() cannot rewind a finished opening effect.
    this.anims = specs.map(({ el, frames, start, dur, fill = 'both' }) =>
      el.animate(frames, { delay: start * 1000, duration: dur * 1000, endDelay: Math.max(0, T - (start + dur) * 1000), fill }),
    );
    this.clock = this.clockEl.animate([{ opacity: 0 }, { opacity: 0 }], { duration: T, fill: 'forwards' });
    // CSS effects (including pseudo-elements) must share the playback clock too.
    this.anims = [...new Set([...this.anims, ...this.stage.getAnimations({ subtree: true }), this.clock])];
    this.anims.forEach((a) => { a.pause(); a.playbackRate = this.rate; });
    this.clock.onfinish = () => this.onEnd();
    this.marks = marks.sort((x, y) => x.t - y.t);
    if (this.selFit) this.fitEls(this.selFit).forEach((el) => el.classList.add(cn('fit-sel')));
  }

  /* ---------- Playback ---------- */
  /** Video uses the animation time, including pause, seeking, speed and replay. */
  private syncVideo(seek = false) {
    const v = this.videoEl;
    if (!v) return;
    if (this.s.bg.mode !== 'video' || !this.videoURL || !this.stage.contains(v)) { v.pause(); return; }
    v.playbackRate = this.rate;
    if (Number.isFinite(v.duration) && v.duration > 0) {
      const target = this.curT() % v.duration;
      const distance = Math.abs(v.currentTime - target);
      const drift = Math.min(distance, v.duration - distance);
      if ((seek && distance > .0001) || (!v.seeking && drift > .15)) v.currentTime = target;
    }
    if (this.playing) { if (v.paused) void v.play().catch(() => {}); }
    else v.pause();
  }
  private curT() {
    return this.clock ? Number(this.clock.currentTime || 0) / 1000 : this.total;
  }
  seek = (t: number) => {
    t = clamp(t, 0, this.total);
    this.anims.forEach((a) => { a.currentTime = t * 1000; });
    this.syncVideo(true);
    this.emit();
  };
  play = () => {
    if (this.adjusting) this.setAdjusting(false);
    if (this.curT() >= this.total - 0.05) this.seek(0);
    this.anims.forEach((a) => { a.playbackRate = this.rate; a.play(); });
    this.playing = true;
    this.syncVideo(true);
    this.tick();
  };
  pause = () => {
    this.anims.forEach((a) => a.pause());
    this.playing = false;
    this.syncVideo(true);
    cancelAnimationFrame(this.raf);
    this.emit();
  };
  toggle = () => (this.playing ? this.pause() : this.play());
  restart = () => {
    this.seek(0);
    this.play();
  };
  setRate = (r: number) => {
    this.rate = r;
    this.anims.forEach((a) => (a.playbackRate = r));
    this.syncVideo(true);
    this.emit();
  };
  private onEnd() {
    if (!this.playing) return;
    if (this.s.anim.loop) {
      this.seek(0);
      this.anims.forEach((a) => a.play());
      return;
    }
    this.anims.forEach((a) => a.pause());
    this.playing = false;
    this.seek(this.total);
  }
  private tick = () => {
    this.syncVideo();
    this.emit();
    if (this.playing) this.raf = requestAnimationFrame(this.tick);
  };

  /** Rebuilds the frame from the current lineup, keeping the playback position. */
  refresh = () => {
    clearTimeout(this.refreshTimer);
    const t = this.curT(), was = this.playing, atEnd = t >= this.total - 0.05;
    if (was) this.pause();
    this.renderStage();
    this.buildTimeline();
    // resting on the final frame stays there, even when the animation gets longer or shorter
    this.seek(atEnd && !was ? this.total : Math.min(t, this.total));
    if (was) this.play();
  };
  /** Refreshes shortly, so typing doesn't rebuild the frame on every key. */
  soonRefresh = () => {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(this.refresh, 120);
  };

  /** Background video: kept only for this visit, never saved. */
  setVideo(url: string | null) {
    this.videoEl?.pause();
    if (this.videoURL && this.videoURL !== url) URL.revokeObjectURL(this.videoURL);
    this.videoURL = url;
    if (!url && this.videoEl) {
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
    }
  }
  get hasVideo() {
    return !!this.videoURL;
  }
  get video() {
    return this.videoURL;
  }

  /** Updates one picture's framing on the frame without rebuilding it. */
  paintFit(path: FitPath) {
    // Shared defaults may be inherited by several player-local paths.
    if (path.startsWith('tag:')) { this.soonRefresh(); return; }
    const f = fitRef(this.s, path);
    if (!f) return;
    this.fitEls(path).forEach((m) => {
      m.style.setProperty('--fx', f.x + '%');
      m.style.setProperty('--fy', f.y + '%');
      m.style.setProperty('--fz', (+f.z).toFixed(3));
    });
    if (this.selFit === path) this.placeFitBox();
  }

  /* ---------- Fullscreen ---------- */
  toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    const req = this.wrap.requestFullscreen?.();
    if (!req) return this.opts.onNotice('fullscreenUnavailable');
    req.catch(() => this.opts.onNotice('fullscreenUnavailable'));
  };

  /* ---------- Adjusting pictures on the frame ---------- */
  setAdjusting = (on: boolean) => {
    this.adjusting = on;
    if (on && this.playing) this.pause();
    this.stage.classList.toggle(cn('adjusting'), on);
    if (!on) {
      this.selectFit(null);
      this.qa('.fit-hover').forEach((el) => el.classList.remove(cn('fit-hover')));
    } else this.selectFit(this.selFit);
  };
  selectFit = (path: FitPath | null) => {
    this.selFit = path;
    this.qa('.fit-sel').forEach((el) => el.classList.remove(cn('fit-sel')));
    if (path) this.fitEls(path).forEach((el) => el.classList.add(cn('fit-sel')));
    this.emit();
    this.placeFitBox();
  };
  private effOpacity(el: Element) {
    let o = 1;
    for (let n: Element | null = el; n && n !== this.wrap; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      o *= +cs.opacity;
    }
    return o;
  }
  private fitAt(x: number, y: number) {
    return (document.elementsFromPoint(x, y).find((el) => (el as HTMLElement).dataset?.fit && this.stage.contains(el) && this.effOpacity(el) > 0.35) as HTMLElement | undefined) || null;
  }
  private placeFitBox() {
    const box = this.fitBox;
    if (!this.adjusting || !this.selFit) { box.hidden = true; return; }
    const els = this.fitEls(this.selFit).filter((el) => this.effOpacity(el) > 0.35);
    if (!els.length) { box.hidden = true; return; }
    // show only the part of the picture that is visible (cards and frames crop it), kept inside the frame
    const w = this.wrap.getBoundingClientRect(), r0 = els[0].getBoundingClientRect();
    let L = r0.left, T = r0.top, R = r0.right, B = r0.bottom;
    for (let n = els[0].parentElement; n && n !== this.wrap; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflow !== 'visible' || cs.clipPath !== 'none') {
        const c = n.getBoundingClientRect();
        L = Math.max(L, c.left); T = Math.max(T, c.top); R = Math.min(R, c.right); B = Math.min(B, c.bottom);
      }
    }
    const pad = 9;
    L = Math.max(L, w.left + pad); T = Math.max(T, w.top + pad); R = Math.min(R, w.right - pad); B = Math.min(B, w.bottom - pad);
    if (R - L < 12 || B - T < 12) { box.hidden = true; return; }
    Object.assign(box.style, { left: L - w.left + 'px', top: T - w.top + 'px', width: R - L + 'px', height: B - T + 'px' });
    box.hidden = false;
    // on small pictures the handles sit outside the corners, so dragging the middle still moves the picture
    box.classList.toggle(cn('compact'), R - L < 72 || B - T < 72);
    this.fitBoxTarget = els[0];
  }
  /** Changes the selected picture's framing. */
  editFit(path: FitPath, change: (f: Fit) => void, final = true) {
    const f = fitRef(this.s, path, true);
    if (!f) return;
    change(f);
    f.z = clamp(+f.z.toFixed(3), 0.3, 3);
    f.x = +f.x.toFixed(2);
    f.y = +f.y.toFixed(2);
    this.paintFit(path);
    this.opts.onEdit({ kind: 'fit', path, final });
  }
  zoomSelected = (factor: number) => this.selFit && this.editFit(this.selFit, (f) => (f.z *= factor));
  setSelectedZoom = (z: number) => this.selFit && this.editFit(this.selFit, (f) => (f.z = z));
  resetSelected = () => this.selFit && this.editFit(this.selFit, (f) => Object.assign(f, { z: 1, x: 0, y: 0 }));
  selectedZoom() {
    return this.selFit ? fitRef(this.s, this.selFit)?.z ?? 1 : 1;
  }

  /** Drag a picture; screen pixels become % of the picture's own size, whatever it is scaled by. */
  dragFit(e: PointerEvent, img: Element, path: FitPath, captureEl: Element) {
    const f = fitRef(this.s, path);
    if (!f) return;
    const r = img.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    const sx = e.clientX, sy = e.clientY, x0 = f.x, y0 = f.y, z = f.z;
    captureEl.setPointerCapture(e.pointerId);
    const move = (ev: Event) => {
      const p = ev as PointerEvent;
      this.editFit(path, (ff) => { ff.x = x0 + ((p.clientX - sx) / w) * 100 * z; ff.y = y0 + ((p.clientY - sy) / h) * 100 * z; }, false);
    };
    const up = () => {
      captureEl.removeEventListener('pointermove', move);
      captureEl.removeEventListener('pointerup', up);
      captureEl.removeEventListener('pointercancel', up);
      this.opts.onEdit({ kind: 'fit', path, final: true });
    };
    captureEl.addEventListener('pointermove', move);
    captureEl.addEventListener('pointerup', up);
    captureEl.addEventListener('pointercancel', up);
  }

  /* ---------- Events ---------- */
  private on(el: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions | boolean) {
    el.addEventListener(type, fn as EventListener, opts);
    this.cleanup.push(() => el.removeEventListener(type, fn as EventListener, opts));
  }

  private bindEvents() {
    const stage = this.stage;
    // adjusting: pick and drag pictures
    this.on(stage, 'pointerdown', (e: PointerEvent) => {
      if (!this.adjusting) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const el = this.fitAt(e.clientX, e.clientY);
      if (!el) { this.selectFit(null); return; }
      this.selectFit(el.dataset.fit!);
      this.dragFit(e, el, el.dataset.fit!, stage);
    }, true);
    this.on(stage, 'pointermove', (e: PointerEvent) => {
      if (!this.adjusting || e.buttons) return;
      const el = this.fitAt(e.clientX, e.clientY);
      this.qa('.fit-hover').forEach((n) => { if (!el || n.dataset.fit !== el.dataset.fit) n.classList.remove(cn('fit-hover')); });
      if (el) this.fitEls(el.dataset.fit!).forEach((n) => n.classList.add(cn('fit-hover')));
    });
    this.on(stage, 'dblclick', (e: MouseEvent) => {
      if (!this.adjusting) return;
      const el = this.fitAt(e.clientX, e.clientY);
      if (el) { this.selectFit(el.dataset.fit!); this.resetSelected(); }
    });
    // corner handles resize from the centre
    this.on(this.fitBox, 'pointerdown', (e: PointerEvent) => {
      const h = (e.target as Element).closest('[data-h]');
      if (!h || !this.selFit) return;
      e.preventDefault();
      e.stopPropagation();
      const f = fitRef(this.s, this.selFit), el = this.fitBoxTarget;
      if (!f || !el) return;
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d0 = Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy)), z0 = f.z, path = this.selFit;
      h.setPointerCapture(e.pointerId);
      const move = (ev: Event) => {
        const p = ev as PointerEvent;
        this.editFit(path, (ff) => (ff.z = (z0 * Math.hypot(p.clientX - cx, p.clientY - cy)) / d0), false);
      };
      const up = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
        this.opts.onEdit({ kind: 'fit', path, final: true });
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
    this.on(document, 'keydown', (e: KeyboardEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('input, textarea, select, [contenteditable]')) return;
      // space plays or pauses in fullscreen
      if (e.code === 'Space' && document.fullscreenElement === this.wrap) {
        e.preventDefault();
        this.toggle();
        return;
      }
      if (!this.adjusting) return;
      const k = e.key;
      if (k === 'Escape') { this.setAdjusting(false); this.emit(); e.preventDefault(); return; }
      if (!this.selFit) return;
      const st = e.shiftKey ? 2 : 0.5, path = this.selFit;
      const nudge = (dx: number, dy: number) => this.editFit(path, (f) => { f.x += dx; f.y += dy; });
      if (k === 'ArrowLeft') nudge(-st, 0);
      else if (k === 'ArrowRight') nudge(st, 0);
      else if (k === 'ArrowUp') nudge(0, -st);
      else if (k === 'ArrowDown') nudge(0, st);
      else if (k === '+' || k === '=') this.zoomSelected(1.05);
      else if (k === '-' || k === '_') this.zoomSelected(1 / 1.05);
      else return;
      e.preventDefault();
    });
    this.on(window, 'resize', () => this.placeFitBox());
    this.on(matchMedia('(prefers-reduced-motion: reduce)'), 'change', () => {
      if (this.s.anim.template === 'season2627') this.refresh();
    });
    this.on(document, 'fullscreenchange', () => { this.fitText(); this.emit(); });
    const ro = new ResizeObserver(() => { this.fitText(); this.placeFitBox(); });
    ro.observe(stage);
    this.cleanup.push(() => ro.disconnect());
    const onFonts = () => this.fitText();
    document.fonts?.addEventListener?.('loadingdone', onFonts);
    this.cleanup.push(() => document.fonts?.removeEventListener?.('loadingdone', onFonts));

    // cards on the pitch: drag to move, tap to edit that player
    this.on(stage, 'pointerdown', (e: PointerEvent) => {
      const slot = (e.target as Element).closest<HTMLElement>(sel('.slot'));
      if (this.adjusting) return;
      if (!slot) {
        const column = (e.target as Element).closest<HTMLElement>('[data-player]');
        if (column && this.effOpacity(column) > .35) this.opts.onPlayerClick(Number(column.dataset.player));
        return;
      }
      if (this.effOpacity(slot) < .35) return;
      e.preventDefault();
      const field = this.q('.field')!, i = Number(slot.dataset.i), rect = field.getBoundingClientRect();
      const s = this.s, scale = slotsFor(s.formation, s.look.gk).scale;
      const sx = e.clientX, sy = e.clientY;
      let moved = false;
      slot.setPointerCapture(e.pointerId);
      const move = (ev: Event) => {
        const p = ev as PointerEvent;
        if (!moved && Math.hypot(p.clientX - sx, p.clientY - sy) < 5) return;
        moved = true;
        slot.classList.add(cn('dragging'));
        const u = unproj(((p.clientX - rect.left) / rect.width) * 100, ((p.clientY - rect.top) / rect.height) * 100);
        const scr = proj(u.x, u.y);
        slot.style.left = scr.X + '%';
        slot.style.top = scr.Y + '%';
        slot.style.setProperty('--s', ((0.8 + (0.2 * u.y) / 100) * scale).toFixed(3));
        s.slotPos[i] = { x: +u.x.toFixed(1), y: +u.y.toFixed(1) };
      };
      const up = () => {
        slot.removeEventListener('pointermove', move);
        slot.removeEventListener('pointerup', up);
        slot.removeEventListener('pointercancel', up);
        slot.classList.remove(cn('dragging'));
        if (moved) this.opts.onEdit({ kind: 'slot' });
        else this.opts.onPlayerClick(i);
      };
      slot.addEventListener('pointermove', move);
      slot.addEventListener('pointerup', up);
      slot.addEventListener('pointercancel', up);
    });
  }

  destroy() {
    this.pause();
    clearTimeout(this.refreshTimer);
    this.anims.forEach((a) => a.cancel());
    this.cleanup.forEach((f) => f());
    if (this.videoEl) { this.videoEl.removeAttribute('src'); this.videoEl.load(); this.videoEl = null; }
    this.wrap.innerHTML = '';
  }
}
