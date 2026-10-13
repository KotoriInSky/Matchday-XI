import catalog from '@/data/fifa-members.json';
import { newFit } from '@/engine/constants';
import type { Tag } from '@/engine/types';
import { readDataURL } from './images';
import { store } from './store';

export const FIFA_MEMBERS = catalog;
export type FifaMember = (typeof FIFA_MEMBERS)[number];
const byCode = new Map(FIFA_MEMBERS.map(member => [member.code, member]));
const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[’‘]/g, "'").toLocaleLowerCase().trim();

export function fifaMemberName(member: FifaMember, lang: string): string {
  return member.names[lang as keyof typeof member.names] || member.name;
}

/** Association codes and names are searchable across all built-in languages. */
export function fifaMemberMatches(member: FifaMember, query: string): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const words = fold([`FIFA ${member.code}`, member.iocCode ? `IOC ${member.iocCode}` : '', member.name, ...Object.values(member.names), ...member.aliases].join(' '));
  return terms.every(term => words.includes(term));
}

export function searchFifaMembers(query: string): FifaMember[] {
  const code = query.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) {
    const exact = FIFA_MEMBERS.filter(member => member.code === code || member.iocCode === code || member.aliases.includes(code));
    if (exact.length) return exact;
  }
  const exactName = fold(query);
  if (exactName) {
    const exact = FIFA_MEMBERS.filter(member => [member.name, ...Object.values(member.names), ...member.aliases].some(name => fold(name) === exactName));
    if (exact.length) return exact;
  }
  return FIFA_MEMBERS.filter(member => fifaMemberMatches(member, query));
}

export function fifaFlagURL(member: FifaMember): string {
  return `${import.meta.env.BASE_URL}flags/fifa/${member.flag}`;
}

export function tagName(tag: Tag, lang: string): string {
  const member = tag.fifaCode && byCode.get(tag.fifaCode);
  // A name edited by the user takes precedence over a translated library label.
  return member && tag.label === member.name ? fifaMemberName(member, lang) : tag.label;
}

export function tagMatches(tag: Tag, query: string): boolean {
  const member = tag.fifaCode && byCode.get(tag.fifaCode);
  return fold(tag.label).includes(fold(query)) || !!member && fifaMemberMatches(member, query);
}

const loaded = new Map<string, Promise<string>>();
async function flagData(member: FifaMember): Promise<string> {
  let pending = loaded.get(member.code);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(fifaFlagURL(member));
      if (!response.ok) throw new Error('Flag unavailable');
      const svg = await response.text();
      if (!svg.includes('<svg')) throw new Error('Invalid flag');
      // Embed the SVG, including its attribution, so backups and exports are portable.
      return readDataURL(new Blob([svg], { type: 'image/svg+xml' }));
    })();
    loaded.set(member.code, pending);
    pending.catch(() => loaded.delete(member.code));
  }
  return pending;
}

/** Adds on demand; adding and assigning a flag is one undo step. */
export async function selectFifaFlag(member: FifaMember, onSelect: (id: string) => void): Promise<void> {
  const existing = store.state.tags.find(tag => tag.fifaCode === member.code);
  const img = existing ? null : await flagData(member);
  store.beginHistoryGroup();
  try {
    // Check again after loading: multiple pickers can request the same flag.
    let tag = store.state.tags.find(item => item.fifaCode === member.code);
    if (!tag) {
      let id = `fifa-${member.code}`;
      let suffix = 1;
      while (store.state.tags.some(item => item.id === id)) id = `fifa-${member.code}-${suffix++}`;
      tag = { id, fifaCode: member.code, label: member.name, img, shape: 'wide', fit: newFit() };
      const added = tag;
      store.update(s => s.tags.push(added));
    }
    onSelect(tag.id);
  } finally {
    store.endHistoryGroup();
  }
}
