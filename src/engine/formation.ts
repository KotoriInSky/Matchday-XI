export type Role = 'GK' | 'DEF' | 'MID' | 'FWD';

export interface ParsedFormation {
  label: string;
  rows: string[][];
  roles: Role[];
}

export interface Slot {
  pos: string;
  x: number;
  y: number;
  role: Role;
  row: number;
}

/** Any "D-M-...-A" string whose numbers add up to 10 outfield players, e.g. 4-3-3 or 5-5-0. */
export function parseFormation(str: string): ParsedFormation | null {
  const s = String(str || '').trim().replace(/[–—\s]+/g, '-');
  if (!/^\d+(-\d+)+$/.test(s)) return null;
  const segs = s.split('-').map(Number);
  if (segs.reduce((a, b) => a + b, 0) !== 10 || segs[0] < 1 || segs.some((n) => n > 7)) return null;
  const rows: string[][] = [['GK']];
  const roles: Role[] = ['GK'];
  const L = segs.length;
  const lastIsAttack = L === 2 || segs[L - 1] > 0;
  const mids = segs.map((_, i) => i).filter((i) => i > 0 && (i < L - 1 || !lastIsAttack));
  const wide = (n: number, l: string, c: string, r: string) => (n <= 3 ? Array(n).fill(c) : [l, ...Array(n - 2).fill(c), r]);
  segs.forEach((n, i) => {
    if (n === 0) { rows.push([]); roles.push('MID'); return; }
    if (i === 0) {
      roles.push('DEF');
      rows.push(n >= 5 ? ['LWB', ...Array(n - 2).fill('CB'), 'RWB'] : n === 4 ? ['LB', 'CB', 'CB', 'RB'] : Array(n).fill('CB'));
      return;
    }
    if (i === L - 1 && lastIsAttack) {
      roles.push('FWD');
      rows.push(n === 1 ? ['ST'] : n === 2 ? ['ST', 'ST'] : ['LW', ...Array(n - 2).fill('ST'), 'RW']);
      return;
    }
    roles.push('MID');
    const filled = mids.filter((j) => segs[j] > 0), k = filled.indexOf(i), many = filled.length > 1;
    if (many && k === 0 && n <= 2) rows.push(Array(n).fill('DM'));
    else if (many && k === filled.length - 1 && n <= 3) rows.push(n === 3 ? ['LW', 'AM', 'RW'] : Array(n).fill('AM'));
    else if (k === 0 && segs[0] <= 3 && n >= 4) rows.push(wide(n, 'LWB', 'CM', 'RWB'));
    else rows.push(wide(n, 'LM', 'CM', 'RM'));
  });
  return { label: s, rows, roles };
}

/** Slot positions in pitch space (x 0–100 left to right on screen, y 0 far … 100 near). */
export function slotsFor(formation: string, gk: 'top' | 'bottom'): Slot[] & { scale: number } {
  const parsed = parseFormation(formation) || parseFormation('4-3-3')!;
  const rows = parsed.rows, n = rows.length, top = gk === 'top';
  const out: Slot[] = [];
  rows.forEach((row, r) => {
    const y = top ? 9 + r * (79 / (n - 1)) : 91 - r * (79 / (n - 1));
    const k = row.length, sp = Math.min(19, 84 / Math.max(k, 1));
    row.forEach((pos, j) => {
      let x = 50 + (j - (k - 1) / 2) * sp;
      if (top) x = 100 - x; // seen from the other end, the team's left is on screen right
      out.push({ pos, x, y, role: parsed.roles[r], row: r });
    });
  });
  return Object.assign(out, { scale: n >= 6 ? 0.86 : 1 });
}
