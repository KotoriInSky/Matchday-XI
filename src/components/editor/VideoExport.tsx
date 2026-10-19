import { useEffect, useRef, useState } from 'react';
import { Download, Video } from 'lucide-react';
import { useI18n } from '@/i18n';
import { exportEndpoint, exportVideo } from '@/lib/video-export';
import { browserVideo, browserVideoSupported, releaseDownload } from '@/lib/browser-export';
import { store } from '@/lib/store';
import { Button } from '../ui/button';
import { Field, Select } from '../ui/form';
import { Grid, Section } from '../ui/section';
import { ExportTiming, useExportProgress } from './ExportTiming';

export function VideoExport() {
  const { lang } = useI18n();
  const zh = lang.startsWith('zh');
  const text = (cn: string, en: string) => zh ? cn : en;
  const [height, setHeight] = useState('1080');
  const [fps, setFps] = useState('30');
  const [method, setMethod] = useState('browser');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const timing = useExportProgress(busy);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('preparing');
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [revision, setRevision] = useState(0);
  const [receipt, setReceipt] = useState<{ revision: number; height: string; fps: string; time: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const download = useRef('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); releaseDownload(download.current); }; }, []);
  useEffect(() => {
    let active = true; setAvailable(null);
    const check = method === 'browser' ? browserVideoSupported(Number(height), Number(fps)) : fetch(exportEndpoint).then(async r => r.ok && (await r.json()).available === true);
    void check.then(value => { if (active) setAvailable(value); }).catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, [height, fps, method]);
  useEffect(() => store.onChange(() => setRevision((value) => value + 1)), []);
  const start = async () => {
    const ctrl = new AbortController(); controller.current = ctrl;
    setBusy(true); setProgress(0); setStatus('preparing'); setError('');
    timing.start();
    const exported = { revision, height, fps, time: Date.now() };
    try {
      const url = await (method === 'browser' ? browserVideo : exportVideo)({ state: structuredClone(store.state), lang, height: Number(height), fps: Number(fps), signal: ctrl.signal, onProgress: (value, phase) => { if (mounted.current) { setProgress(value); setStatus(phase); timing.update(value, phase); } } });
      if (mounted.current) { releaseDownload(download.current); download.current = url; setResult(url); setReceipt({ ...exported, time: Date.now() }); }
      else releaseDownload(url);
    } catch (e) {
      if (mounted.current && !ctrl.signal.aborted) setError(e instanceof Error && e.message === 'busy' ? text('已有导出任务，请稍后重试。', 'An export is already running. Try again shortly.') : e instanceof Error && e.message === 'videoMissing' ? text('请重新选择背景视频后导出。', 'Reload the background video before exporting.') : method === 'browser' ? text('导出失败。请降低分辨率或帧率，或使用本地 / Actions 导出。', 'Export failed. Try a lower resolution or frame rate, or use local / Actions export.') : text('导出失败。请检查本地服务与 Chrome，然后重试。', 'Export failed. Check the local service and Chrome, then retry.'));
    } finally { if (mounted.current) setBusy(false); }
  };
  return <Section title={text('视频导出', 'Video export')}>
    <Grid className="sm:grid-cols-1">
      <Field label={text('导出方式', 'Export method')}>{({ id }) => <Select id={id} value={method} onChange={e => setMethod(e.target.value)} disabled={busy}><option value="browser">{text('浏览器', 'Browser')}</option><option value="local">{text('本地渲染服务', 'Local renderer')}</option></Select>}</Field>
      <Field label={text('分辨率', 'Resolution')}>{({ id }) => <Select id={id} value={height} onChange={(e) => setHeight(e.target.value)} disabled={busy}>{[[720, '720p'], [1080, '1080p'], [1440, '2K / 1440p'], [2160, '4K']].map(([value, label]) => <option key={value} value={value}>{label} · {Number(value) * 16 / 9} × {value}</option>)}</Select>}</Field>
      <Field label={text('帧率', 'Frame rate')}>{({ id }) => <Select id={id} value={fps} onChange={(e) => setFps(e.target.value)} disabled={busy}><option value="30">30 fps</option><option value="60">60 fps</option></Select>}</Field>
    </Grid>
    <p className="text-xs text-muted-foreground">MP4 · H.264 · {text('无音轨', 'No audio track')}</p>
    {available === false && <p className="text-sm">{method === 'browser' ? text('当前浏览器不支持此规格的 H.264 编码。请降低规格、使用新版 Chrome / Edge，或选择本地 / Actions 导出。', 'This browser cannot encode H.264 at these settings. Lower the settings, use current Chrome / Edge, or choose local / Actions export.') : text('请运行本地项目，再选择本地渲染服务。', 'Run and open the local project to use the local renderer.')}</p>}
    {method === 'browser' && <p className="text-xs text-muted-foreground">{text('导出期间请保持此页面在前台；素材不上传。', 'Keep this page in the foreground during export. Assets stay on this device.')}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {busy ? <div className="flex flex-col gap-3" role="status"><span className="text-sm">{status === 'preparing' ? text('准备素材', 'Preparing assets') : status === 'encoding' || status === 'finishing' ? text('生成 MP4', 'Encoding MP4') : text('渲染画面', 'Rendering frames')} · {progress}%</span><progress className="w-full accent-primary" max={100} value={progress} /><ExportTiming timing={timing.timing} phase={status} /><Button variant="outline" onClick={() => controller.current?.abort()}>{text('取消导出', 'Cancel export')}</Button></div> : <Button disabled={!available} onClick={start}><Video />{result ? text('重新导出', 'Export again') : text('导出视频', 'Export video')}</Button>}
    {result && receipt && <div className="text-xs text-muted-foreground" data-export-receipt><p>{text('上次导出', 'Last export')} · {new Date(receipt.time).toLocaleString(lang)} · {Number(receipt.height) * 16 / 9} × {receipt.height} · {receipt.fps} fps</p>{receipt.revision !== revision && <p>{text('项目已修改，下载文件仍为上次导出的版本。', 'The project has changed. The download contains the previous export.')}</p>}</div>}
    {result && <a href={result} download="matchday-lineup.mp4" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4"><Download className="size-4" />{result.startsWith('blob:') ? text('下载 MP4', 'Download MP4') : text('下载 MP4（保留 30 分钟）', 'Download MP4 (available for 30 minutes)')}</a>}
    <details className="how-to"><summary>{text('GitHub Actions 导出', 'GitHub Actions export')}</summary><ol className="list-decimal space-y-2 py-3 pl-5 text-sm"><li>{text('下载项目 JSON，上传到自己的仓库 exports/ 目录。', 'Download project JSON and upload it to exports/ in your own repository.')}</li><li>{text('打开 Actions → Render project → Run workflow，填写文件路径和输出规格。', 'Open Actions → Render project → Run workflow. Set the project path and output settings.')}</li><li>{text('运行完成后，在 Artifacts 下载文件。素材会上传至 GitHub；私人素材请使用私有仓库。', 'Download the finished artifact. Assets are uploaded to GitHub; use a private repository for private media.')}</li></ol></details>
  </Section>;
}
