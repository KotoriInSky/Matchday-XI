import type { Fit, GraphicText, LineupState, Player, Tag } from './types';
import defaultFifaFlags from '@/data/default-fifa-flags.json';
import fifaMembers from '@/data/fifa-members.json';

/** Bundled font families and weights used by the font vendoring script. */
export const FONT_SPECS: Record<string, string> = {
  Graduate: '', 'Black Ops One': '', Bungee: '', 'Russo One': '', Staatliches: '', Orbitron: 'wght@500;700;900',
  'Noto Sans SC': 'wght@500;700;900', 'Noto Serif SC': 'wght@500;700;900', 'Noto Sans JP': 'wght@500;700;900', 'Noto Sans KR': 'wght@500;700;900',
  'Noto Sans TC': 'wght@500;700;900', 'Noto Serif TC': 'wght@500;700;900',
  Outfit: 'wght@300;400;500;600;700;800', Poppins: 'wght@400;500;600;700;800', Montserrat: 'wght@400;500;600;700;800',
  'Saira Condensed': 'wght@500;700;800', Anton: '', 'Bebas Neue': '', Oswald: 'wght@500;700',
  Teko: 'wght@500;600;700', 'Big Shoulders Display': 'wght@500;800', 'Chakra Petch': 'wght@500;700',
  Rajdhani: 'wght@500;700', 'Fjalla One': '', 'Archivo Black': '', Kanit: 'wght@500;700;800',
  'Barlow Semi Condensed': 'wght@400;500;600;700', Barlow: 'wght@400;500;600;700',
  'Roboto Condensed': 'wght@400;600;700', 'IBM Plex Sans Condensed': 'wght@400;600;700', Manrope: 'wght@400;600;700',
};
export const SPORT_FONTS = ['Graduate', 'Black Ops One', 'Bungee', 'Russo One', 'Staatliches', 'Orbitron'];
export const DISPLAY_FONTS = [...SPORT_FONTS, 'Outfit', 'Poppins', 'Montserrat', 'Saira Condensed', 'Anton', 'Bebas Neue', 'Oswald', 'Teko', 'Big Shoulders Display', 'Kanit', 'Chakra Petch', 'Rajdhani', 'Fjalla One', 'Archivo Black', 'Noto Sans SC', 'Noto Serif SC', 'Noto Sans TC', 'Noto Serif TC', 'Noto Sans JP', 'Noto Sans KR'];
export const BODY_FONTS = ['Outfit', 'Poppins', 'Montserrat', 'Barlow Semi Condensed', 'Barlow', 'Roboto Condensed', 'IBM Plex Sans Condensed', 'Manrope', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans JP', 'Noto Sans KR'];
/** Font families used for fonts the user uploads. */
export const CUSTOM_FAMILY = { display: 'MatchDay User Display', body: 'MatchDay User Body', number: 'MatchDay User Number' } as const;
/** Families used by Starting XI Builder, mapped to the new ones when old setups are loaded. */
export const LEGACY_CUSTOM_FAMILY = { display: 'XI User Display', body: 'XI User Body' } as const;

export const PRESET_FORMATIONS = ['4-3-3', '4-4-2', '4-2-3-1', '4-1-4-1', '4-4-1-1', '4-3-1-2', '4-1-2-1-2', '4-2-2-2', '4-5-1', '4-6-0', '3-5-2', '3-4-3', '3-4-2-1', '3-4-1-2', '3-3-4', '3-2-2-3', '5-3-2', '5-4-1', '5-5-0', '2-3-5'];

export const ROLE_OF: Record<string, 'GK' | 'DEF' | 'MID' | 'FWD'> = {
  GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF', SW: 'DEF', DM: 'MID', CDM: 'MID', CM: 'MID', LM: 'MID', RM: 'MID',
  AM: 'MID', CAM: 'MID', LW: 'FWD', RW: 'FWD', SS: 'FWD', CF: 'FWD', ST: 'FWD',
};

/** Big card size and card-row spacing, in % of the frame width. */
export const CW = 29, CH = 44.5, STEP = 35;
/** Pitch box size and small card width, same units. */
export const FW = 79.5, FH = 54.65, SMALL = 6.9;
/** Photos shorter than this (in pixels) may look soft on big cards. */
export const LOW_RES = 700;

/** Colour presets. c: main kit colour, accent, text on main, text on accent. k2: kit colour 2. */
export const PRESETS = [
  { id: 'pine', c: ['#0f3d3e', '#f4b942', '#f3f6f2', '#102a2b'], k2: '#2a7a6f' },
  { id: 'garnet', c: ['#1a3f95', '#f2c230', '#ffffff', '#0d1f4a'], k2: '#a3123a' },
  { id: 'claret', c: ['#6b1d3a', '#9fd3f2', '#ffffff', '#1d2a3a'], k2: '#3f86c4' },
  { id: 'crimson', c: ['#c8102e', '#ffffff', '#ffffff', '#7a1424'], k2: '#8e0b20' },
  { id: 'royal', c: ['#1838b8', '#ffffff', '#ffffff', '#0d1a55'], k2: '#0f2585' },
  { id: 'mono', c: ['#161616', '#ffffff', '#ffffff', '#161616'], k2: '#f2f2f2' },
  { id: 'gold', c: ['#141414', '#d6b25e', '#f5f1e6', '#1a1408'], k2: '#3a3220' },
  { id: 'tangerine', c: ['#e8641f', '#16181d', '#ffffff', '#ffe9da'], k2: '#16181d' },
] as const;

export const newFit = (): Fit => ({ z: 1, x: 0, y: 0 });

const SAMPLE_TAGS: Tag[] = Object.entries({ eng: 'ENG', it: 'ITA', nl: 'NED', kr: 'KOR', jp: 'JPN', hu: 'HUN', br: 'BRA', cn: 'CHN' }).map(([id, code]) => ({
  id, fifaCode: code, label: fifaMembers.find(member => member.code === code)!.name,
  img: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(defaultFifaFlags[code as keyof typeof defaultFifaFlags]),
  shape: 'wide', fit: newFit(),
}));

export const blankPlayer = (): Player => ({
  num: '', name: '', short: '', nameLine1: null, nameLine2: null, nameSize1: 100, nameSize2: 100, nameSizeSmall: 100, pos: '', photo: null, photo2: null, photoK: null, cut: true, cutK: true, cutS: true,
  fit: newFit(), fitS: newFit(), fitK: newFit(), res: null, captain: false, key: false, tag1: '', tag2: '', tagFits: null,
});

/** Wording printed on the graphic, per language. */
export const GRAPHIC_TEXT: Record<string, Omit<GraphicText, 'subtitle'>> = {
  en: { title: 'Starting XI', subsLabel: 'Substitutes', captainLabel: 'Captain', keyLabel: 'Key player', coachLabel: 'Manager', grpGK: 'Goalkeeper', grpDEF: 'Defence', grpMID: 'Midfielders', grpFWD: 'Forwards', roleGK: 'Goalkeeper', roleDEF: 'Defender', roleMID: 'Midfielder', roleFWD: 'Forward' },
  'zh-Hant': { title: '先發陣容', subsLabel: '替補', captainLabel: '隊長', keyLabel: '關鍵球員', coachLabel: '總教練', grpGK: '門將', grpDEF: '後衛', grpMID: '中場', grpFWD: '前鋒', roleGK: '門將', roleDEF: '後衛', roleMID: '中場', roleFWD: '前鋒' },
  'zh-Hans': { title: '首发阵容', subsLabel: '替补', captainLabel: '队长', keyLabel: '核心球员', coachLabel: '主教练', grpGK: '门将', grpDEF: '后卫', grpMID: '中场', grpFWD: '前锋', roleGK: '门将', roleDEF: '后卫', roleMID: '中场', roleFWD: '前锋' },
  ja: { title: 'スターティングメンバー', subsLabel: '控え', captainLabel: 'キャプテン', keyLabel: 'キープレーヤー', coachLabel: '監督', grpGK: 'ゴールキーパー', grpDEF: 'ディフェンダー', grpMID: 'ミッドフィルダー', grpFWD: 'フォワード', roleGK: 'ゴールキーパー', roleDEF: 'ディフェンダー', roleMID: 'ミッドフィルダー', roleFWD: 'フォワード' },
  ko: { title: '선발 라인업', subsLabel: '교체 명단', captainLabel: '주장', keyLabel: '핵심 선수', coachLabel: '감독', grpGK: '골키퍼', grpDEF: '수비수', grpMID: '미드필더', grpFWD: '공격수', roleGK: '골키퍼', roleDEF: '수비수', roleMID: '미드필더', roleFWD: '공격수' },
  es: { title: 'Once inicial', subsLabel: 'Suplentes', captainLabel: 'Capitán', keyLabel: 'Jugador clave', coachLabel: 'Entrenador', grpGK: 'Portero', grpDEF: 'Defensas', grpMID: 'Centrocampistas', grpFWD: 'Delanteros', roleGK: 'Portero', roleDEF: 'Defensa', roleMID: 'Centrocampista', roleFWD: 'Delantero' },
};

// Illustrative mixed-era XI; shirt numbers are examples, not a current club roster.
const samplePlayers: [string, string, string, Partial<Player>?][] = [
  ['1', 'Gianluigi Donnarumma', 'it', { nameLine1: 'Gianluigi', nameLine2: 'DONNARUMMA', nameSize2: 85, pos: 'GK' }],
  ['37', 'Micky van de Ven', 'nl', { nameLine1: 'Micky', nameLine2: 'VAN DE VEN', pos: 'LB' }],
  ['4', 'Virgil van Dijk', 'nl', { nameLine1: 'Virgil', nameLine2: 'VAN DIJK', captain: true, pos: 'CB' }],
  ['4', 'Kim Min-jae', 'kr', { nameLine1: 'Min-jae', nameLine2: 'KIM', pos: 'CB' }],
  ['66', 'Trent Alexander-Arnold', 'eng', { nameLine1: 'Trent', nameLine2: 'ALEXANDER-\nARNOLD', pos: 'RB' }],
  ['21', 'Frenkie de Jong', 'nl', { nameLine1: 'Frenkie', nameLine2: 'DE JONG', pos: 'CM' }],
  ['3', 'Wataru Endo', 'jp', { nameLine1: 'Wataru', nameLine2: 'ENDO', pos: 'DM' }],
  ['8', 'Dominik Szoboszlai', 'hu', { nameLine1: 'Dominik', nameLine2: 'SZOBOSZLAI', nameSize2: 90, pos: 'AM' }],
  ['22', 'Ricardo Izecson dos Santos Leite', 'br', { nameLine1: '', nameLine2: 'KAKÁ', key: true, pos: 'AM' }],
  ['19', 'Lee Kang-in', 'kr', { nameLine1: 'Kang-in', nameLine2: 'LEE', pos: 'AM' }],
  ['7', 'Wu Lei', 'cn', { nameLine1: 'Lei', nameLine2: 'WU', pos: 'ST' }],
];

export const SAMPLE: LineupState = {
  team: { name: 'Harbour City FC', short: 'HCF', crest: null, crestFit: newFit() },
  coach: { name: 'Marta Okonkwo', photo: null, cut: true, fit: newFit(), res: null },
  text: { subtitle: 'Name typography · Demo XI', ...GRAPHIC_TEXT.en },
  formation: '4-2-3-1',
  slotPos: {},
  tags: SAMPLE_TAGS,
  players: samplePlayers.map(([num, name, tag1, extra]) => ({ ...blankPlayer(), num, name, tag1, ...(extra || {}) })),
  subs: '12 Marc-André | TER STEGEN (GK)\n5 Matthijs | DE LIGT\n15 Theo | HERNÁNDEZ\n7 Heung-min | SON\n10 | RAPHINHA\n11 Ángel | DI MARÍA\n17 Kevin | DE BRUYNE\n20 Bernardo | SILVA\n18 | CASEMIRO',
  colors: { c1: '#0f3d3e', k2: '#2a7a6f', c2: '#f4b942', c3: '#f3f6f2', c4: '#102a2b' },
  fonts: { display: 'Outfit', body: 'Outfit', cjk: 'auto' },
  customFonts: { display: null, body: null, number: null },
  bg: { mode: 'stripes', image: null, dim: 45, fit: newFit() },
  look: { tagSize: 175, smallSize: 100, bigSize: 100, photoScale: 100, pattern: 'bolts', patColors: 'two', ratio: 50, shape: 'rounded', upper: false, crest: true, subs: true, lines: true, pitch: 'light', gk: 'top' },
  anim: { template: 'classic', intro: false, manager: true, openingLights: false, style: 'lines', per: 1, introLen: 3.2, mgrLen: 6, loop: false },
};
