import { ensureFont } from '@/engine/fonts';
import { defaultOverrideColor, type ColorOverrideKey } from '@/engine/color-overrides';
import { useEffect, useId } from 'react';
import { Upload, Video } from 'lucide-react';
import { BODY_FONTS, CUSTOM_FAMILY, DISPLAY_FONTS, SPORT_FONTS } from '@/engine/constants';
import { PalettePicker } from './PalettePicker';
import type { LineupState } from '@/engine/types';
import { useI18n, useT, type MessageId } from '@/i18n';
import { removeBackgroundMedia, uploadBackground, uploadFont, uploadVideo } from '@/lib/actions';
import { getStage } from '@/lib/stage-instance';
import { store, useLineup } from '@/lib/store';
import { Button } from '../ui/button';
import { Field, Select, Slider, Switch } from '../ui/form';
import { Grid, Note, Section, Subsection } from '../ui/section';
import { Framer, PictureButtons } from './Picture';

type Colors = LineupState['colors'];

function ColorInput({ k, label }: { k: keyof Colors; label: string }) {
  const s = useLineup();
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border py-2 text-sm font-medium">
      <input
        id={id}
        type="color"
        value={s.colors[k]}
        onChange={(e) => store.update((st) => (st.colors[k] = e.target.value))}
        className="h-8 w-10 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0.5"
      />
      <span className="min-w-0 flex-1">{label}</span>
      <span className="font-mono text-xs text-muted-foreground uppercase">{s.colors[k]}</span>
    </label>
  );
}

function OverrideInput({ field, label }: { field: ColorOverrideKey; label: string }) {
  const s = useLineup();
  const { lang } = useI18n();
  const id = useId();
  const zh = lang.startsWith('zh');
  const tw = lang === 'zh-Hant';
  const value = s.colorOverrides?.[field];
  return <div className="flex min-h-12 items-center gap-3 border-b border-border py-2 text-sm">
    <input id={id} type="color" className="h-8 w-10 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0.5" value={value ?? defaultOverrideColor(s, field)} onChange={(e) => store.update((st) => { st.colorOverrides ??= {}; st.colorOverrides[field] = e.target.value; })} />
    <label htmlFor={id} className="flex-1 cursor-pointer">{label}<span className="block text-xs text-muted-foreground">{value ? value.toUpperCase() : zh ? (tw ? '跟隨整體配色' : '跟随整体配色') : 'Follow palette'}</span></label>
    {value && <Button size="sm" variant="ghost" onClick={() => store.update((st) => { delete st.colorOverrides?.[field]; })}>{zh ? (tw ? '恢復' : '恢复') : 'Reset'}</Button>}
  </div>;
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, MessageId][]; onChange(v: T): void }) {
  const t = useT();
  return (
    <Field label={label}>
      {({ id }) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map(([v, m]) => <option key={v} value={v}>{t(m)}</option>)}
        </Select>
      )}
    </Field>
  );
}

function FontGallery() {
  const t = useT();
  const s = useLineup();
  useEffect(() => { SPORT_FONTS.forEach(ensureFont); }, []);
  return <div className="grid grid-cols-2 gap-2">
    {SPORT_FONTS.map((font) => <div key={font} className="min-w-0 border-b border-border py-3">
      <p className="text-xs text-muted-foreground">{font}</p>
      <p className="overflow-hidden text-ellipsis py-2 text-3xl" style={{ fontFamily: font }}>XI 09</p>
      <p className="overflow-hidden text-ellipsis text-lg" style={{ fontFamily: font }}>MATCHDAY</p>
      <div className="mt-2 flex flex-wrap gap-1">
        <Button size="sm" variant={s.numberStyle?.font === font ? 'secondary' : 'ghost'} aria-pressed={s.numberStyle?.font === font} onClick={() => store.update((st) => { st.numberStyle = { font, mode: st.numberStyle?.mode || 'solid' }; })}>{t('style.applyNumbers')}</Button>
        <Button size="sm" variant={s.fonts.display === font ? 'secondary' : 'ghost'} aria-pressed={s.fonts.display === font} onClick={() => store.update((st) => { st.fonts.display = font; })}>{t('style.applyHeadings')}</Button>
      </div>
    </div>)}
  </div>;
}

export function StylePanel() {
  const { t, lang } = useI18n();
  const zh = lang.startsWith('zh');
  const tw = lang === 'zh-Hant';
  const s = useLineup();
  const L = s.look;
  const look = <K extends keyof LineupState['look']>(k: K, v: LineupState['look'][K]) => store.update((st) => { st.look[k] = v; if (k === 'gk') st.slotPos = {}; });
  const media = s.bg.mode === 'image' || s.bg.mode === 'video';
  const video = getStage()?.video ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Section title={t('style.colours')}>
        <PalettePicker />
        <details>
          <summary className="cursor-pointer py-3 text-sm font-medium">{zh ? (tw ? '自訂顏色' : '自定义颜色') : 'Custom colours'}</summary>
          <div className="flex flex-col">
            <ColorInput k="c1" label={t('style.c1')} />
            <ColorInput k="k2" label={t('style.k2')} />
            <ColorInput k="c2" label={t('style.c2')} />
            <ColorInput k="c3" label={t('style.c3')} />
            <ColorInput k="c4" label={t('style.c4')} />
          </div>
          <div className="space-y-5 pt-5">
            <fieldset><legend className="editor-subsection-title pb-2">{zh ? '大卡 / Highlight' : 'Player card / Highlight'}</legend>
              <OverrideInput field="name" label={zh ? '姓名文字' : 'Player name'} />

            </fieldset>
            <fieldset><legend className="editor-subsection-title pb-2">{zh ? '小卡' : 'Pitch card'}</legend>
              <OverrideInput field="smallBackground" label={zh ? (tw ? '姓名條底色' : '姓名条底色') : 'Name strip background'} />
              <OverrideInput field="smallText" label={zh ? (tw ? '姓名條文字' : '姓名条文字') : 'Name strip text'} />
            </fieldset>
            <fieldset><legend className="editor-subsection-title pb-2">{zh ? (tw ? '隊長袖標' : '队长袖标') : 'Captain armband'}</legend>
              <OverrideInput field="captainText" label={zh ? (tw ? '文字與邊線' : '文字与边线') : 'Text and stripes'} />
              <OverrideInput field="captainBackground" label={zh ? '底色' : 'Background'} />
            </fieldset>
            <fieldset><legend className="editor-subsection-title pb-2">{zh ? (tw ? '球場' : '球场') : 'Pitch'}</legend>
              <OverrideInput field="turf" label={zh ? '草皮' : 'Turf'} />
              <OverrideInput field="lines" label={zh ? (tw ? '線條' : '线条') : 'Pitch lines'} />
            </fieldset>
          </div>
        </details>
      </Section>

      <Section title={t('style.pattern')}>
        <Grid className="sm:grid-cols-1">
          <Choice label={t('style.patternKind')} value={L.pattern} onChange={(v) => look('pattern', v)}
            options={[['bolts', 'style.bolts'], ['diagonal', 'style.diagonal'], ['stripes', 'style.stripes'], ['halves', 'style.halves'], ['plain', 'style.plain']]} />
          {L.pattern !== 'plain' && (
            <Choice label={t('style.patColors')} value={L.patColors} onChange={(v) => look('patColors', v)} options={[['two', 'style.patTwo'], ['tone', 'style.patTone']]} />
          )}
          {L.pattern !== 'plain' && <Slider label={t('style.ratio')} min={20} max={80} step={5} value={L.ratio} format={(v) => `${v}%`} onChange={(v) => look('ratio', v)} />}
        </Grid>
      </Section>

      <Section title={zh ? (tw ? '號碼' : '号码') : 'Numbers'}>
        <Field label={zh ? (tw ? '號碼字體' : '号码字体') : 'Number font'}>{({ id }) =>
          <Select id={id} value={s.numberStyle?.font || ''} onChange={(e) => store.update((st) => { st.numberStyle = { mode: st.numberStyle?.mode || 'solid', font: e.target.value }; })}>
            <option value="">{zh ? '跟随标题字体' : 'Follow heading font'}</option>
            {s.customFonts.number && <option value={CUSTOM_FAMILY.number}>{s.customFonts.number.name}</option>}
            {DISPLAY_FONTS.map((font) => <option key={font} value={font}>{font}</option>)}
          </Select>
        }</Field>
        <Button variant="ghost" size="sm" className="self-start" onClick={() => uploadFont('number')}><Upload />{zh ? '上传号码字体' : 'Upload number font'}</Button>
        <Field label={zh ? '显示方式' : 'Appearance'}>{({ id }) =>
          <Select id={id} value={s.numberStyle?.mode || 'solid'} onChange={(e) => store.update((st) => { st.numberStyle = { font: st.numberStyle?.font || '', mode: e.target.value === 'outline' ? 'outline' : 'solid' }; })}>
            <option value="solid">{zh ? '实心 + 描边' : 'Solid with outline'}</option>
            <option value="outline">{zh ? '仅描边' : 'Outline only'}</option>
          </Select>
        }</Field>
        <OverrideInput field="numberFill" label={zh ? '填充色' : 'Fill colour'} />
        <OverrideInput field="number" label={zh ? '描边色' : 'Outline colour'} />
      </Section>
      <Section title={t('style.fonts')}>
        <details onToggle={(e) => { if (e.currentTarget.open) SPORT_FONTS.forEach(ensureFont); }}>
          <summary className="cursor-pointer py-3 text-sm font-medium">{zh ? '运动字体预览 · 6 款' : 'Sports font preview · 6 fonts'}</summary>
          <FontGallery />
        </details>
        <Grid>
          {(['display', 'body'] as const).map((role) => (
            <div key={role} className="flex flex-col gap-2">
              <Field label={t(role === 'display' ? 'style.displayFont' : 'style.bodyFont')}>
                {({ id }) => (
                  <Select id={id} value={s.fonts[role]} onChange={(e) => store.update((st) => (st.fonts[role] = e.target.value))}>
                    {s.customFonts[role] && <option value={CUSTOM_FAMILY[role]}>{t('style.yourFont', { name: s.customFonts[role]!.name })}</option>}
                    {(role === 'display' ? DISPLAY_FONTS : BODY_FONTS).map((f) => <option key={f} value={f}>{f}</option>)}
                  </Select>
                )}
              </Field>
            </div>
          ))}
        </Grid>
        <details>
          <summary className="cursor-pointer py-3 text-sm font-medium">{zh ? (tw ? '進階字體設定' : '高级字体设置') : 'Advanced typography'}</summary>
          <div className="flex flex-wrap gap-2 pt-2">
            {(['display', 'body'] as const).map((role) => <Button key={role} variant="ghost" size="sm" onClick={() => uploadFont(role)}><Upload />{t(role === 'display' ? 'style.uploadDisplayFont' : 'style.uploadBodyFont')}</Button>)}
          </div>
        </details>
      </Section>

      <Section title={t('style.background')}>
        <Grid>
          <Choice label={t('style.bgKind')} value={s.bg.mode} onChange={(v) => store.update((st) => (st.bg.mode = v))}
            options={[['stripes', 'style.bgStripes'], ['gradient', 'style.bgGradient'], ['solid', 'style.bgSolid'], ['image', 'style.bgImage'], ['video', 'style.bgVideo']]} />
          {media && <Slider label={t('style.tint')} min={0} max={90} value={s.bg.dim} format={(v) => `${v}%`} onChange={(v) => store.update((st) => (st.bg.dim = v))} />}
        </Grid>
        {s.bg.mode === 'image' && (
          <Subsection title={t('style.bgImage')}>
            {!s.bg.image && <Note tone="warning">{t('style.pictureNeeded')}</Note>}
            <PictureButtons has={!!s.bg.image} uploadLabel={t('style.uploadPicture')} onUpload={uploadBackground} onRemove={removeBackgroundMedia} />
            {s.bg.image && <Framer path="bg:fit" kind="bg" src={s.bg.image} label={t('style.bgImage')} showLabel={false} min={100} max={300} />}
          </Subsection>
        )}
        {s.bg.mode === 'video' && (
          <Subsection title={t('style.bgVideo')}>
            <Note tone={video ? 'muted' : 'warning'}>{t(video ? 'style.videoNote' : 'style.videoNeeded')}</Note>
            <div className="flex flex-wrap gap-2">
              <Button variant={video ? 'outline' : 'secondary'} size="sm" onClick={uploadVideo}>
                <Video />
                {t('style.uploadVideo')}
              </Button>
              {video && (
                <Button variant="ghost" size="sm" onClick={removeBackgroundMedia} className="text-muted-foreground hover:text-destructive">
                  {t('style.removeMedia')}
                </Button>
              )}
            </div>
            {video && <Framer path="bg:fit" kind="bg" src={video} video label={t('style.bgVideo')} showLabel={false} min={100} max={300} />}
          </Subsection>
        )}
      </Section>

      <Section title={t('style.pitchCards')}>
        <Grid className="lg:grid-cols-2">
          <Choice label={t('style.pitch')} value={L.pitch} onChange={(v) => look('pitch', v)} options={[['light', 'style.pitchLight'], ['dark', 'style.pitchTeam']]} />
          <Choice label={t('style.gk')} value={L.gk} onChange={(v) => look('gk', v)} options={[['top', 'style.gkTop'], ['bottom', 'style.gkBottom']]} />
          <Choice label={t('style.shape')} value={L.shape} onChange={(v) => look('shape', v)} options={[['rounded', 'style.rounded'], ['angled', 'style.angled'], ['sharp', 'style.sharp']]} />
          <Slider label={t('style.smallSize')} min={70} max={150} step={5} value={L.smallSize} format={(v) => `${v}%`} onChange={(v) => look('smallSize', v)} />
          {s.anim.template === 'classic' && s.anim.style === 'lines' && <Slider label={t('style.bigSize')} min={70} max={140} step={5} value={L.bigSize} format={(v) => `${v}%`} onChange={(v) => look('bigSize', v)} />}
          <Slider label={t('style.photoScale')} min={60} max={140} step={5} value={L.photoScale} format={(v) => `${v}%`} onChange={(v) => look('photoScale', v)} />
        </Grid>
      </Section>

      <Section title={t('style.show')}>
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <Switch label={t('style.showBadge')} checked={L.crest} onCheckedChange={(v) => look('crest', v)} />
          <Switch label={t('style.showSubs')} checked={L.subs} onCheckedChange={(v) => look('subs', v)} />
          <Switch label={t('style.showLines')} checked={L.lines} onCheckedChange={(v) => look('lines', v)} />
          <Switch label={t('style.upper')} checked={L.upper} onCheckedChange={(v) => look('upper', v)} />
        </div>
      </Section>
    </div>
  );
}
