import { useState } from 'react';
import { Check, LoaderCircle, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useLineup } from '@/lib/store';
import { fifaFlagURL, fifaMemberName, searchFifaMembers, selectFifaFlag, type FifaMember } from '@/lib/fifa';
import { Note } from '../ui/section';

export function FifaFlagLibrary({ query, onSelect }: { query: string; onSelect(id: string): void }) {
  const { t, lang } = useI18n();
  const s = useLineup();
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const choose = async (member: FifaMember) => {
    if (pending) return;
    setPending(member.code); setFailed(false);
    try { await selectFifaFlag(member, onSelect); }
    catch { setFailed(true); }
    finally { setPending(null); }
  };
  if (!query.trim()) return null;
  const matches = searchFifaMembers(query);
  return <div className="fifa-library">
    {failed && <p role="alert" className="text-sm text-destructive">{t('fifa.loadError')}</p>}
    {!matches.length && <Note>{t('fifa.noResults')}</Note>}
    <div className="fifa-options" aria-label={t('fifa.title')} aria-busy={!!pending}>
      {matches.map(member => {
        const added = s.tags.some(tag => tag.fifaCode === member.code);
        return <button key={member.code} type="button" className="fifa-option" disabled={!!pending} onClick={() => void choose(member)}>
          <img src={fifaFlagURL(member)} alt="" loading="lazy" width="36" height="27" />
          <span className="min-w-0 flex-1"><span className="block break-words" title={member.name}>{fifaMemberName(member, lang)}</span><span className="block text-xs text-muted-foreground">{member.iocCode === member.code ? `FIFA/IOC ${member.code}` : `FIFA ${member.code}${member.iocCode ? ` · IOC ${member.iocCode}` : ''}`}</span></span>
          {pending === member.code ? <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" /> : added ? <Check className="size-4 shrink-0 text-brand" aria-hidden="true" /> : <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          {added && <span className="sr-only">{t('fifa.inProject')}</span>}
        </button>;
      })}
    </div>
  </div>;
}
