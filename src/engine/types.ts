import type { ColorOverrides } from './color-overrides';
/** Position and zoom of a picture inside its frame. x/y are % of the picture's own size. */
export interface Fit {
  z: number;
  x: number;
  y: number;
}

export interface Player {
  num: string;
  name: string;
  /** One name shown on cards (surname or nickname). Empty means the surname. */
  short: string;
  nameLine1: string | null;
  nameLine2: string | null;
  nameSize1: number;
  nameSize2: number;
  /** Independent surname size on the small pitch card. */
  nameSizeSmall: number;
  /** Optional position label override, e.g. "CAM". */
  pos: string;
  photo: string | null;
  /** Optional separate photo for the small pitch card. */
  photo2: string | null;
  /** Optional separate photo for the key-player card. */
  photoK: string | null;
  /** False when the photo has no transparent background. */
  cut: boolean;
  cutK: boolean;
  cutS?: boolean;
  fit: Fit;
  fitS: Fit;
  fitK: Fit;
  /** Pixel size of the original photo, for low-resolution warnings. */
  res: [number, number] | null;
  captain: boolean;
  key: boolean;
  tag1: string;
  tag2: string;
  /** Per-player framing, keyed by tag id. Missing values inherit the shared tag. */
  tagFits?: Record<string, Fit> | null;
}

export interface Tag {
  id: string;
  /** Built-in FIFA association, retained in portable project files. */
  fifaCode?: string;
  /** Only shown in the editor. */
  label: string;
  img: string | null;
  shape: 'wide' | 'square';
  fit: Fit;
}

export type PatternKind = 'bolts' | 'diagonal' | 'stripes' | 'halves' | 'plain';
export type RevealStyle = 'lines' | 'row' | 'off';
export type AnimationTemplate = 'classic' | 'season2627';
export type CjkScript = 'auto' | 'sc' | 'tc' | 'jp' | 'kr';

export interface GraphicText {
  title: string;
  subtitle: string;
  subsLabel: string;
  coachLabel: string;
  captainLabel: string;
  keyLabel: string;
  grpGK: string;
  grpDEF: string;
  grpMID: string;
  grpFWD: string;
  roleGK: string;
  roleDEF: string;
  roleMID: string;
  roleFWD: string;
}

export interface CustomFont {
  name: string;
  data: string;
}

export interface LineupState {
  team: { name: string; short: string; crest: string | null; crestFit: Fit };
  coach: { name: string; photo: string | null; cut: boolean; fit: Fit; res: [number, number] | null };
  text: GraphicText;
  formation: string;
  slotPos: Record<string, { x: number; y: number }>;
  tags: Tag[];
  players: Player[];
  subs: string;
  numberStyle?: { font: string; mode: 'solid' | 'outline' };
  colorOverrides?: ColorOverrides;
  colors: { c1: string; k2: string; c2: string; c3: string; c4: string };
  fonts: { display: string; body: string; cjk: CjkScript };
  customFonts: { display: CustomFont | null; body: CustomFont | null; number: CustomFont | null };
  bg: { mode: 'stripes' | 'gradient' | 'solid' | 'image' | 'video'; image: string | null; dim: number; fit: Fit };
  look: {
    tagSize: number;
    smallSize: number;
    bigSize: number;
    photoScale: number;
    pattern: PatternKind;
    patColors: 'two' | 'tone';
    ratio: number;
    shape: 'rounded' | 'angled' | 'sharp';
    upper: boolean;
    crest: boolean;
    subs: boolean;
    lines: boolean;
    pitch: 'light' | 'dark';
    gk: 'top' | 'bottom';
  };
  anim: {
    template: AnimationTemplate;
    intro: boolean;
    manager: boolean;
    openingLights: boolean;
    style: RevealStyle;
    per: number;
    introLen: number;
    mgrLen: number;
    loop: boolean;
  };
}

/** Path to one picture's framing, e.g. "p:3:fit", "coach:fit", "crest:fit", "tag:<id>:fit", "bg:fit". */
export type FitPath = string;
