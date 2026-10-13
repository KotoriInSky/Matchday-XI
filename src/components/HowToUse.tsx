import { useI18n } from '@/i18n';

export function HowToUse() {
  const { t, lang } = useI18n();
  const zh = lang.startsWith('zh');
  const tw = lang === 'zh-Hant';
  const copy = (en: string, sc: string, tc: string) => zh ? tw ? tc : sc : en;
  return <div className="border-t border-border text-sm">
    <details className="border-b border-border py-3">
      <summary className="cursor-pointer py-1 font-medium">{copy('Using the editor', '使用指南', '使用指南')}</summary>
      <ol className="list-decimal space-y-3 py-4 pl-5 text-muted-foreground">
        <li>{t('help.lineup')}</li><li>{t('help.picture')}</li><li>{t('help.tags')}</li><li>{t('help.playback')}</li><li>{t('help.data')}</li>
      </ol>
    </details>
    <details className="border-b border-border py-3">
      <summary className="cursor-pointer py-1 font-medium">{copy('Assets & rights', '素材与版权', '素材與版權')}</summary>
      <div className="space-y-3 py-4 text-muted-foreground">
        <p>{copy('Use photos, badges, fonts and video that you have permission to use. Check the relevant licences before publishing your work.', '使用你有权使用的照片、队徽、字体和视频。发布作品前，请核对相关素材的许可范围。', '使用你有權使用的照片、隊徽、字體和影片。發布作品前，請核對相關素材的授權範圍。')}</p>
        <p>{copy('Palette names describe visual styles. They do not imply endorsement or affiliation with a team or competition.', '配色名称用于识别视觉风格，不代表球队或赛事的授权、合作或认可。', '配色名稱用於識別視覺風格，不代表球隊或賽事的授權、合作或認可。')}</p>
      </div>
    </details>
    <details className="py-3">
      <summary className="cursor-pointer py-1 font-medium">{copy('About Matchday XI', '关于 Matchday XI', '關於 Matchday XI')}</summary>
      <div className="space-y-3 py-4 text-muted-foreground">
        <p>{copy('Matchday XI — football lineup graphics and animation.', 'Matchday XI · 足球阵容画面与动画制作。', 'Matchday XI · 足球陣容畫面與動畫製作。')}</p>
        <p>{t('app.privacy')}</p>
        <p><a className="underline underline-offset-4 text-foreground" href={`${import.meta.env.BASE_URL}LICENSE.txt`} target="_blank" rel="noreferrer">MIT License</a>{copy(' · Project source code. Third-party assets retain their own licences.', ' · 项目源代码采用 MIT 协议，第三方素材遵循各自许可。', ' · 專案原始碼採用 MIT 授權，第三方素材遵循各自授權。')}</p>
        <nav aria-label={copy('Legal information', '条款与隐私', '條款與隱私')} className="flex flex-wrap gap-x-4 gap-y-2">
          <a className="underline underline-offset-4 text-foreground" href={`${import.meta.env.BASE_URL}TERMS.txt`} target="_blank" rel="noreferrer">{copy('Usage terms', '使用条款', '使用條款')}</a>
          <a className="underline underline-offset-4 text-foreground" href={`${import.meta.env.BASE_URL}PRIVACY.txt`} target="_blank" rel="noreferrer">{copy('Privacy notice', '隐私说明', '隱私說明')}</a>
        </nav>
        <dl className="space-y-2">
          <div><dt className="font-medium text-foreground">{copy('Built with', '技术栈', '技術棧')}</dt><dd>React · TypeScript · Vite · Tailwind CSS</dd></div>
          <div><dt className="font-medium text-foreground">{copy('Video rendering', '视频渲染', '影片渲染')}</dt><dd>Chromium · Playwright · FFmpeg</dd></div>
        </dl>
        <p>{copy('Translations are maintained through the GitHub project.', '翻译由 GitHub 项目统一维护。', '翻譯由 GitHub 專案統一維護。')}</p>
      </div>
    </details>
  </div>;
}
