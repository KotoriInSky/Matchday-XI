import { useRef, useState } from 'react';
import { ClipboardPaste, Copy, Download, Upload, RotateCcw } from 'lucide-react';
import type { AnimationTemplate, RevealStyle } from '@/engine/types';
import { useI18n } from '@/i18n';
import { registerFont } from '@/engine/fonts';
import { store, useLineup } from '@/lib/store';
import { copyText } from '@/lib/utils';
import { pickFile } from '@/lib/images';
import { Button } from '../ui/button';
import { Field, Select, Slider, Switch, Textarea } from '../ui/form';
import { Grid, Note, Section } from '../ui/section';
import { toast } from '../Toaster';
import { VideoExport } from './VideoExport';
import { CardExport } from './CardExport';

export function AnimationPanel() {
  const { t } = useI18n();
  const s = useLineup();
  const season = s.anim.template === 'season2627';
  const sec = (v: number) => t('anim.seconds', { n: v.toFixed(1) });
  return (
    <div className="flex flex-col gap-4">
      <Section title={t('anim.scenes')}>
        <Field label={t('anim.template')} className="max-w-sm">
          {({ id }) => <Select id={id} value={s.anim.template} onChange={(e) => store.update((st) => (st.anim.template = e.target.value as AnimationTemplate))}>
            <option value="classic">{t('anim.classic')}</option>
            <option value="season2627">26/27</option>
          </Select>}
        </Field>
        <Field label={t('anim.reveal')} className="max-w-sm">
          {({ id }) => (
            <Select id={id} value={season && s.anim.style !== 'off' ? 'lines' : s.anim.style} onChange={(e) => store.update((st) => (st.anim.style = e.target.value as RevealStyle))}>
              <option value="lines">{t(season ? 'anim.columns' : 'anim.lines')}</option>
              {!season && <option value="row">{t('anim.row')}</option>}
              {!season && <option value="single">{t('anim.single')}</option>}
              <option value="off">{t('anim.off')}</option>
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <Switch label={t('anim.manager')} checked={s.anim.manager} onCheckedChange={(v) => store.update((st) => (st.anim.manager = v))} />
          <Switch label={t(season ? 'anim.lead' : 'anim.intro')} checked={s.anim.intro} onCheckedChange={(v) => store.update((st) => (st.anim.intro = v))} />
        </div>
        {!season && s.anim.manager && <Switch label={t('anim.openingLights')} checked={s.anim.openingLights} onCheckedChange={(v) => store.update((st) => (st.anim.openingLights = v))} />}
      </Section>
      <Section title={t('anim.timing')}>
        <Grid className="lg:grid-cols-2">
          {s.anim.style !== 'off' && <Slider label={t(season ? 'anim.groupHold' : 'anim.per')} min={0.4} max={3} step={0.1} value={s.anim.per} format={(v) => sec(season ? v * 4 : v)} onChange={(v) => store.update((st) => (st.anim.per = v))} />}
          {s.anim.manager && <Slider label={t('anim.mgrLen')} min={4} max={10} step={0.5} value={s.anim.mgrLen} format={sec} onChange={(v) => store.update((st) => (st.anim.mgrLen = v))} />}
          {s.anim.intro && <Slider label={t(season ? 'anim.leadLen' : 'anim.introLen')} min={2} max={6} step={0.5} value={s.anim.introLen} format={sec} onChange={(v) => store.update((st) => (st.anim.introLen = v))} />}
        </Grid>
      </Section>
    </div>
  );
}

export function BackupPanel() {
  const { t, lang } = useI18n();
  const text = (cn: string, en: string) => lang.startsWith('zh') ? cn : en;
  const [paste, setPaste] = useState('');
  const [invalid, setInvalid] = useState<'file' | 'paste' | null>(null);
  const [invalidFile, setInvalidFile] = useState('');
  const [confirm, setConfirm] = useState(false);
  const pasteRef = useRef<HTMLTextAreaElement>(null);

  const copySetup = async () => {
    const txt = JSON.stringify(store.state);
    if (await copyText(txt)) toast('backup.copied');
    else {
      setPaste(txt);
      requestAnimationFrame(() => { pasteRef.current?.focus(); pasteRef.current?.select(); });
      toast('backup.copyBlocked');
    }
  };
  const load = async (raw = paste, source: 'file' | 'paste' = 'paste') => {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.players) || !parsed.team || typeof parsed.team !== 'object' || Array.isArray(parsed.team)) throw new Error('Invalid project');
      store.replace(parsed);
      setInvalid(null);
      setPaste('');
      const ok = (await registerFont('display', store.state.customFonts.display)) && (await registerFont('body', store.state.customFonts.body)) && (await registerFont('number', store.state.customFonts.number));
      if (!ok) toast('style.fontReloadError', { error: true });
      toast('backup.loaded');
    } catch {
      setInvalid(source);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <VideoExport />
      <CardExport />
      <Section title={text('项目文件', 'Project file')}>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(store.state)], { type: 'application/json' }));
            const link = document.createElement('a'); link.href = url; link.download = 'matchday-lineup.json'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}><Download />{text('下载项目', 'Download project')}</Button>
          <Button variant="outline" onClick={async () => { const file = await pickFile('.json,application/json'); if (file) { setInvalidFile(file.name); try { await load(await file.text(), 'file'); } catch { setInvalid('file'); } } }}><Upload />{text('导入项目', 'Import project')}</Button>
        </div>
        {invalid === 'file' && <p role="alert" className="text-sm text-destructive">{text(`无法读取「${invalidFile}」。请选择有效的 Matchday XI 项目 JSON 文件。`, `Could not read “${invalidFile}”. Choose a valid Matchday XI project JSON file.`)}</p>}
        <Note>{t('backup.videoNote')}</Note>
        <details className="how-to"><summary>{text('复制与粘贴 JSON', 'Copy and paste JSON')}</summary>
        <div className="flex flex-col gap-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={copySetup}>
            <Copy />
            {t('backup.copy')}
          </Button>
        </div>
        <Field label={t('backup.paste')} error={invalid === 'paste' ? t('backup.invalid') : undefined}>
          {({ id, describedBy, invalid: bad }) => (
            <Textarea ref={pasteRef} id={id} aria-describedby={describedBy} aria-invalid={bad || undefined} spellCheck={false} rows={4} value={paste}
              onChange={(e) => { setPaste(e.target.value); if (invalid === 'paste') setInvalid(null); }} className="font-mono text-xs" />
          )}
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={!paste.trim()} onClick={() => load()}>
            <ClipboardPaste />
            {t('backup.load')}
          </Button>
        </div></div></details>
        <div className="flex flex-wrap items-center gap-2">
          {confirm ? (
            <div role="group" aria-label={t('backup.resetConfirm')} className="flex flex-wrap items-center gap-2 rounded-md bg-destructive-soft px-3 py-1.5">
              <span className="text-[13px] font-medium text-destructive">{t('backup.resetConfirm')}</span>
              <Button size="sm" variant="destructive" onClick={() => { store.replace({}); setConfirm(false); toast('backup.resetDone'); }}>
                {t('backup.resetYes')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)} autoFocus>
                {t('backup.resetNo')}
              </Button>
            </div>
          ) : (
            <Button variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirm(true)}>
              <RotateCcw />
              {t('backup.reset')}
            </Button>
          )}
        </div>
      </Section>


    </div>
  );
}
