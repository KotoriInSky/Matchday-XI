import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, Clapperboard, HardDrive, Palette, Shield, Tag, UserRound, Users } from 'lucide-react';
import { registerFont } from '@/engine/fonts';
import { useI18n, type MessageId } from '@/i18n';
import { getStage } from '@/lib/stage-instance';
import { store, useLineup } from '@/lib/store';
import { Header } from './components/Header';
import { Monitor } from './components/Monitor';
import { CardPreview } from './components/editor/CardPreview';
import { HowToUse } from './components/HowToUse';
import { Toaster, toast } from './components/Toaster';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { LineupPanel } from './components/editor/LineupPanel';
import { ClubPanel, ManagerPanel, TagsPanel } from './components/editor/ClubPanels';
import { StylePanel } from './components/editor/StylePanel';
import { AnimationPanel, BackupPanel } from './components/editor/MorePanels';

const TABS: { id: string; label: MessageId; icon: typeof Users }[] = [
  { id: 'club', label: 'tab.club', icon: Shield },
  { id: 'lineup', label: 'tab.lineup', icon: Users },
  { id: 'manager', label: 'tab.manager', icon: UserRound },
  { id: 'tags', label: 'tab.tags', icon: Tag },
  { id: 'style', label: 'tab.style', icon: Palette },
  { id: 'animation', label: 'tab.animation', icon: Clapperboard },
  { id: 'backup', label: 'tab.backup', icon: HardDrive },
];
const TAB_KEY = 'matchday-xi-tab';

export default function App() {
  const { t } = useI18n();
  const s = useLineup();
  const [tab, setTabState] = useState(() => {
    try { const saved = sessionStorage.getItem(TAB_KEY); return TABS.some((item) => item.id === saved) ? saved! : 'lineup'; } catch { return 'lineup'; }
  });
  const [card, setCard] = useState<number | null>(null);
  const [previewTag, setPreviewTag] = useState<string | null>(null);
  const inspectPlayer = (i: number) => { getStage()?.pause(); setCard(i); setPreviewTag(null); setFocus((f) => ({ i, n: (f?.n ?? 0) + 1 })); };
  const setTab = (v: string) => {
    setCard(null); setPreviewTag(null);
    setTabState(v);
    requestAnimationFrame(() => document.getElementById('editor')?.scrollTo({ top: 0 }));
    try { sessionStorage.setItem(TAB_KEY, v); } catch { /* ignore */ }
    if (window.matchMedia('(max-width: 899px)').matches) {
      requestAnimationFrame(() => document.getElementById('editor')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
    }
  };
  const [focus, setFocus] = useState<{ i: number; n: number } | null>(null);
  const onPlayerClick = useCallback((i: number) => {
    setTabState('lineup');
    try { sessionStorage.setItem(TAB_KEY, 'lineup'); } catch { /* ignore */ }
    getStage()?.pause(); setCard(i); setPreviewTag(null);
    setFocus((f) => ({ i, n: (f?.n ?? 0) + 1 }));
  }, []);

  // once per visit: carried-over setups, fonts uploaded earlier, and the unsaved background video
  useEffect(() => {
    if (store.migrated) toast('app.migrated');
    if (store.state.bg.mode === 'video') toast('style.videoReload');

  }, []);

  useEffect(() => {
    let active = true;
    const { display, body } = s.customFonts;
    void Promise.all([registerFont('display', display), registerFont('body', body), registerFont('number', s.customFonts.number)]).then(([a, b, c]) => {
      if (!active) return;
      if (!a || !b || !c) toast('style.fontReloadError', { error: true });
      getStage()?.refresh();
    });
    return () => { active = false; };
  }, [s.customFonts.display?.data, s.customFonts.body?.data, s.customFonts.number?.data]);

  return (
    <div className="min-h-dvh">
      <Header />
      <main className="workspace">
        <Tabs value={tab} onValueChange={setTab} className="workspace-grid">
          <aside className="workspace-nav">
            <TabsList label={t('workspace.edit')} className="workspace-tabs" verticalAt={1200}>
              {TABS.map(({ id, label, icon: Icon }) => (
                <TabsTrigger key={id} value={id} className="workspace-tab">
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span>{t(label)}</span>
                  {id === 'lineup' && <span className="nav-count" aria-hidden="true">11</span>}
                  {id === 'tags' && <span className="nav-count" aria-hidden="true">{s.tags.length}</span>}
                </TabsTrigger>
              ))}
            </TabsList>
          </aside>
        <div className="preview-column">
          {card !== null && <CardPreview playerIndex={card} tagId={previewTag} onPlayerChange={setCard} onClose={() => { setCard(null); setPreviewTag(null); }} onSceneAdjust={() => { setCard(null); setPreviewTag(null); getStage()?.setAdjusting(true); }} />}
          <div>
            <Monitor onPlayerClick={onPlayerClick} onInspect={() => inspectPlayer(focus?.i ?? 0)} />
          </div>
          <HowToUse />
        </div>

        <div id="editor" className="editor-column">
          {store.saveStatus === 'failed' && (
            <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive-soft p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p className="flex-1 font-medium">{t('save.failed')}</p>
            </div>
          )}
            <TabsContent value="lineup"><LineupPanel onInspect={inspectPlayer} /></TabsContent>
            <TabsContent value="manager"><ManagerPanel /></TabsContent>
            <TabsContent value="club"><ClubPanel /></TabsContent>
            <TabsContent value="tags"><TagsPanel onSelect={(id) => {
              setPreviewTag(id); getStage()?.pause();
              const index = store.state.players.findIndex((p) => p.tag1 === id || p.tag2 === id);
              setCard(index < 0 ? 0 : index);
            }} /></TabsContent>
            <TabsContent value="style"><StylePanel /></TabsContent>
            <TabsContent value="animation"><AnimationPanel /></TabsContent>
            <TabsContent value="backup" keepMounted><BackupPanel /></TabsContent>

        </div>
        </Tabs>
      </main>
      <Toaster />
    </div>
  );
}
