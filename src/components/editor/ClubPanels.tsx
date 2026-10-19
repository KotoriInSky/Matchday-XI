import { useState } from 'react';
import { Languages, Plus, Search } from 'lucide-react';
import type { GraphicText } from '@/engine/types';
import { useI18n } from '@/i18n';
import { uploadCoachPhoto, uploadCrest, uploadTag } from '@/lib/actions';
import { store, useLineup } from '@/lib/store';
import { tagMatches, tagName } from '@/lib/fifa';
import { Button } from '../ui/button';
import { Field, Input, Switch } from '../ui/form';
import { Grid, Note, Section, Subsection } from '../ui/section';
import { Framer, PictureButtons, ResNote } from './Picture';
import { ScenePreviewAction } from './ScenePreviewAction';
import { FifaFlagLibrary } from './FifaFlagLibrary';

function TextField({ label, k, hint, placeholder, maxLength }: { label: string; k: keyof GraphicText; hint?: string; placeholder?: string; maxLength?: number }) {
  const s = useLineup();
  return (
    <Field label={label} hint={hint}>
      {({ id, describedBy }) => (
        <Input id={id} aria-describedby={describedBy} value={s.text[k]} placeholder={placeholder} maxLength={maxLength} onChange={(e) => store.update((st) => (st.text[k] = e.target.value))} />
      )}
    </Field>
  );
}

export function ManagerPanel() {
  const { t } = useI18n();
  const s = useLineup();
  const c = s.coach;
  return (
    <Section title={t('tab.manager')}>
      <ScenePreviewAction kind="manager" />
      <Switch label={t('manager.show')} checked={s.anim.manager} onCheckedChange={(v) => store.update((st) => (st.anim.manager = v))} />
      <Grid>
        <Field label={t('manager.name')}>
          {({ id }) => <Input id={id} value={c.name} onChange={(e) => store.update((st) => (st.coach.name = e.target.value))} />}
        </Field>
        <TextField label={t('manager.title')} k="coachLabel" />
      </Grid>
      <Subsection title={t('manager.photo')}>
        {!c.photo && <Note>{t('photo.tip')}</Note>}
        <PictureButtons has={!!c.photo} onUpload={uploadCoachPhoto} onRemove={() => store.update((st) => (st.coach.photo = null))} />
        {c.photo && (
          <Framer path="coach:fit" kind="manager" src={c.photo} cut={c.cut} label={t('manager.photo')} showLabel={false}>
            <ResNote res={c.res} />
          </Framer>
        )}
      </Subsection>
    </Section>
  );
}

export function ClubPanel() {
  const { t, lang, languages, graphicText } = useI18n();
  const s = useLineup();
  const style = s.anim.style;
  const langName = languages.find((l) => l.code === lang)?.name ?? lang;
  const season = s.anim.template === 'season2627';
  const showHeadline = !season && (s.anim.intro || style === 'row');
  return (
    <div className="flex flex-col gap-4">
      <Section title={t('tab.club')}>
        <ScenePreviewAction kind="club" />
        <Grid>
          <Field label={t('club.teamName')}>
            {({ id }) => <Input id={id} value={s.team.name} onChange={(e) => store.update((st) => (st.team.name = e.target.value))} />}
          </Field>
          <Field label={t('club.shortName')} hint={t('club.shortHint')}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} maxLength={5} value={s.team.short} onChange={(e) => store.update((st) => (st.team.short = e.target.value))} className="uppercase" />
            )}
          </Field>
        </Grid>
        <Subsection title={t('club.badge')}>
          {!s.team.crest && <Note>{t('club.badgeHint')}</Note>}
          <PictureButtons has={!!s.team.crest} uploadLabel={t('club.uploadBadge')} onUpload={uploadCrest} onRemove={() => store.update((st) => (st.team.crest = null))} />
          {s.team.crest && <Framer path="crest:fit" kind="crest" src={s.team.crest} label={t('club.badge')} showLabel={false} max={200} />}
        </Subsection>
      </Section>

      <Section
        title={t('club.wording')}
        actions={
          <Button variant="outline" size="sm" onClick={() => store.update((st) => Object.assign(st.text, graphicText()))}>
            <Languages />
            {t('club.useLanguage', { language: langName })}
          </Button>
        }
      >
        <Grid>
          {!season && <TextField label={t('club.subtitle')} k="subtitle" hint={t('club.subtitleHint')} />}
          {showHeadline && <TextField label={t('club.headline')} k="title" />}
          <TextField label={t('club.subsLabel')} k="subsLabel" />
          <TextField label={t('club.captainLabel')} k="captainLabel" />
        </Grid>
        {style === 'lines' && (
          <fieldset className="flex flex-col gap-3">
            <legend className="editor-subsection-title mb-3">{t('club.sideLabels')}</legend>
            <Grid className="lg:grid-cols-4">
              <TextField label={t('club.gk')} k="grpGK" />
              <TextField label={t('club.def')} k="grpDEF" />
              <TextField label={t('club.mid')} k="grpMID" />
              <TextField label={t('club.fwd')} k="grpFWD" />
            </Grid>
          </fieldset>
        )}
      </Section>
    </div>
  );
}

export function TagsPanel({ onSelect }: { onSelect(id: string): void }) {
  const { t, lang } = useI18n();
  const s = useLineup();
  const [query, setQuery] = useState('');
  const [fifaQuery, setFifaQuery] = useState('');
  const matches = s.tags.filter(tag => tagMatches(tag, query));
  return <div className="flex flex-col gap-6">
    <Section title={t('fifa.title')}>
      <div className="relative">
        <Search className="absolute left-3 top-3.5 size-4 text-muted-foreground" aria-hidden="true" />
        <Input type="search" aria-label={t('fifa.search')} placeholder={t('fifa.search')} className="pl-9" value={fifaQuery} onChange={e => setFifaQuery(e.target.value)} />
      </div>
      <FifaFlagLibrary query={fifaQuery} onSelect={onSelect} />
    </Section>
    <Section title={t('fifa.projectTags')} actions={<Button variant="outline" onClick={async () => {
      const before = new Set(store.state.tags.map((tag) => tag.id));
      await uploadTag();
      const added = store.state.tags.find((tag) => !before.has(tag.id));
      if (added) { setQuery(''); onSelect(added.id); }
    }}><Plus />{t('tags.add')}</Button>}>
      <div className="relative">
        <Search className="absolute left-3 top-3.5 size-4 text-muted-foreground" aria-hidden="true" />
        <Input type="search" aria-label={t('tags.search')} placeholder={t('tags.search')} className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!matches.length && <Note>{t(s.tags.length ? 'tags.noResults' : 'tags.empty')}</Note>}
      <ul className="tag-index">
        {matches.map((tag) => <li key={tag.id}>
          <button type="button" onClick={() => onSelect(tag.id)}>
            {tag.img ? <img src={tag.img} alt="" /> : <span className="size-8" />}
            <span>{tagName(tag, lang) || t('lineup.unnamedTag')}</span>
          </button>
        </li>)}
      </ul>
    </Section>
  </div>;
}
