import { PRESETS } from '@/engine/constants';
import type { LineupState } from '@/engine/types';

type Palette = { id: string; name: [string, string, string]; group: 'club' | 'national' | 'classic'; colors: LineupState['colors'] };
const make = (id: string, name: Palette['name'], group: Palette['group'], c1: string, k2: string, c2: string, c3 = '#FFFFFF', c4 = '#101820'): Palette => ({ id, name, group, colors: { c1, k2, c2, c3, c4 } });
export const PALETTES: Palette[] = [
  // Graphic palettes: tonal companions are design adaptations, not official brand specifications.
  make('devils', ['红魔', '紅魔', 'Red Devils'], 'club', '#DA291C', '#A51E16', '#861810', '#FFFFFF', '#FFFFFF'),
  make('moon', ['蓝月亮', '藍月亮', 'Blue Moon'], 'club', '#6CABDD', '#4894CA', '#3074A6', '#142D4E', '#FFFFFF'),
  make('reds', ['红军', '紅軍', 'The Reds'], 'club', '#C8102E', '#A00B24', '#85091E', '#FFFFFF', '#FFFFFF'),
  make('gunners', ['枪手', '槍手', 'Gunners'], 'club', '#EF0107', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#A60005'),
  make('blues', ['蓝军', '藍軍', 'The Blues'], 'club', '#034694', '#033775', '#022B5C', '#FFFFFF', '#FFFFFF'),
  make('lilywhites', ['白百合', '白百合', 'Lilywhites'], 'club', '#FFFFFF', '#132257', '#132257', '#132257', '#FFFFFF'),
  make('whites', ['银河战舰', '銀河戰艦', 'Galácticos'], 'club', '#FAFAFA', '#D8B96A', '#172A53', '#172A53', '#FFFFFF'),
  make('blaugrana', ['红蓝军团', '紅藍軍團', 'Blaugrana'], 'club', '#154284', '#A50044', '#EDBB00'),
  make('bavarians', ['南部之星', '南部之星', 'Southern Star'], 'club', '#DC052D', '#FFFFFF', '#0066B2', '#FFFFFF', '#FFFFFF'),
  make('rossoneri', ['红黑军团', '紅黑軍團', 'Rossoneri'], 'club', '#AC001A', '#141414', '#FFFFFF'),
  make('nerazzurri', ['蓝黑军团', '藍黑軍團', 'Nerazzurri'], 'club', '#0057B8', '#141414', '#D5B573'),
  make('bianconeri', ['斑马军团', '斑馬軍團', 'Bianconeri'], 'club', '#161616', '#FFFFFF', '#FFFFFF'),
  make('dragon', ['中国龙', '中國龍', 'Chinese Dragons'], 'national', '#D71920', '#B31319', '#F6D54A'),
  make('eagle', ['日耳曼战车', '日耳曼戰車', 'Die Mannschaft'], 'national', '#FAFAFA', '#161616', '#D9AB27', '#161616'),
  make('azzurri', ['蓝衣军团', '藍衣軍團', 'Azzurri'], 'national', '#0066B2', '#FFFFFF', '#CFB46D'),
  make('fury', ['斗牛士', '鬥牛士', 'La Roja'], 'national', '#AA151B', '#172C54', '#F1BF00'),
  make('pampas', ['潘帕斯雄鹰', '潘帕斯雄鷹', 'Albiceleste'], 'national', '#75AADB', '#FFFFFF', '#172C44', '#172C44', '#FFFFFF'),
  make('samba', ['桑巴军团', '桑巴軍團', 'Seleção'], 'national', '#FEDD00', '#009739', '#012169', '#153E28', '#FFFFFF'),
  make('roosters', ['高卢雄鸡', '高盧雄雞', 'Les Bleus'], 'national', '#002654', '#154889', '#FFFFFF'),
  make('orange', ['橙衣军团', '橙衣軍團', 'Oranje'], 'national', '#F36C21', '#111820', '#111820', '#111820', '#FFFFFF'),
  ...PRESETS.map((p) => ({ id: p.id, name: [p.id, p.id, p.id] as Palette['name'], group: 'classic' as const, colors: { c1: p.c[0], k2: p.k2, c2: p.c[1], c3: p.c[2], c4: p.c[3] } })),
];
