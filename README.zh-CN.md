# <img src="public/favicon.svg" width="32" height="32" alt="Matchday XI icon"> Matchday XI

🌐 **[在线使用](https://kotoriinsky.github.io/Matchday-XI/)**

[English](README.md) · [提交 Issue](https://github.com/KotoriInSky/Matchday-XI/issues)

## 项目介绍

Matchday XI 是一个在浏览器里制作足球阵容画面和比赛日动画的工具。

选好阵型，填入球员名单，再换上球队的配色、队徽和照片，就可以预览阵容出场动画，也能把球员卡片或视频导出。适合做赛前首发介绍、球队社媒内容，或者给自己排一套想看的阵容。

## 🎬 效果展示

Classic：按位置分组展示球员，最后呈现首发与替补名单。

![Classic 模板的阵容出场动画](docs/demos/classic-demo.gif)

26/27：分栏出场动画，包含主教练、队长和核心球员展示。

![26/27 模板的阵容出场动画](docs/demos/season2627-demo.gif)

两段动图使用示例阵容和项目自带的人物占位图，以 2.5 倍速播放。你可以上传自己的素材，分别调整小卡、大卡和 Highlight 的构图。模板名称用于区分样式，不代表赛事或转播机构的官方授权。

## 主要功能

| 功能 | 可以做什么 |
| --- | --- |
| 阵容编辑 | 选择预设阵型或输入自定义阵型，拖动球员卡片调整站位，填写替补名单。 |
| 球员卡片 | 编辑小卡、大卡和 Highlight，为不同卡片分别上传照片、调整构图和姓名排版。 |
| 出场动画 | 使用 Classic 或 26/27 模板，设置主教练开场、球员出场顺序和片段时长。 |
| 球队样式 | 更换队徽、配色、球衣纹理、卡片外形和背景图片或视频。 |
| 字体与标签 | 选择内置字体或上传字体，给球员添加国旗、自定义图片标签。 |
| 预览与修改 | 播放、暂停、拖动时间轴或跳转片段，支持撤销和重做。 |
| 卡片导出 | 在浏览器中生成透明背景 PNG，支持单张下载和批量 ZIP，卡框长边可选 1024、2048 或 4096 px。同类卡框尺寸一致，出框内容向外扩展透明画布。 |
| 视频导出 | 导出无音轨的 H.264 MP4，可选 720p、1080p、1440p 或 2160p，以及 30／60 fps。 |
| 项目保存 | 自动保存到当前浏览器，下载或导入 JSON 项目文件，方便备份和继续编辑。 |
| 界面 | 支持深浅主题，以及英语、简体中文、繁体中文、日语、韩语和西班牙语。 |

浏览器会检测所选视频规格是否支持 H.264 编码。导出时请保持页面在前台；如果当前浏览器无法编码，可以调整规格、使用新版 Chrome／Edge，或改用本地渲染。文件生成后请及时下载。

## 本地运行

安装 Node.js 22.x（至少 22.12），下载或克隆项目后，在项目目录运行：

```sh
npm ci
npm run dev
```

打开终端显示的网址，默认是 `http://localhost:5173/matchday-xi/`。

浏览器导出无需另外安装 FFmpeg。需要使用本地视频渲染服务时，请安装 Chrome 或 Playwright Chromium，以及支持 H.264 编码的 FFmpeg：

```sh
npx playwright install chromium
```

将 `ffmpeg` 加入 PATH，或在启动项目之前指定 `FFMPEG_PATH`。PowerShell 示例：

```powershell
$env:FFMPEG_PATH = 'C:\Tools\ffmpeg\bin\ffmpeg.exe'
npm run dev
```

然后在「备份 → 视频导出」选择「本地渲染服务」。你仍然可以用 Firefox 打开编辑器，服务会另外启动无界面的 Chromium 来渲染。

构建和预览生产版本：

```sh
npm run build
npm run preview
```

浏览器导出、本地渲染和 GitHub Actions 手动导出的详细用法见[导出说明](docs/export.md)。

## 🐛 Issue

遇到问题，或者有想加的功能，可以在本仓库的 [Issues](https://github.com/KotoriInSky/Matchday-XI/issues) 中提出。报告问题时，请写清楚：

- 浏览器名称和版本，以及使用的设备。
- 你做了哪些操作，在哪一步出现问题。
- 原本希望发生什么，实际发生了什么。
- 如果与导出有关，注明导出方式、模板、尺寸和帧率。

截图或可复现的示例项目会更方便排查。JSON 项目文件可能包含照片、姓名和上传的字体，分享前请移除不方便公开的内容。翻译修正也欢迎提交，贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 使用条款与数据隐私

请使用自己拥有或已获许可的照片、队徽、字体和视频，发布作品前确认素材许可是否覆盖你的用途。你保留所提供内容的相关权利；项目不主张取得上传素材或导出作品的所有权。Matchday XI 是独立项目，不代表球队、联赛或赛事的官方产品。

应用没有账号系统，也没有云端项目同步。项目保存在当前浏览器中；换浏览器、换网站地址或清除网站数据，都可能需要重新导入备份。背景视频文件不会写入 JSON，须单独保留。

不同导出方式的数据流向如下：

- 浏览器导出在你的设备上处理，不上传项目素材。
- 本地渲染会把项目快照发送到你电脑上的渲染服务。
- GitHub Actions 手动导出需要你将项目文件上传到自己的仓库，素材会成为仓库内容；私人素材请使用私有仓库。

内置字体随网站提供，页面无需连接 Google Fonts。网站托管方仍会收到加载页面和字体等资源的正常请求；浏览器导出不上传项目素材。

完整内容见[使用条款](public/TERMS.txt)和[隐私说明](public/PRIVACY.txt)。

## 许可证与致谢

项目源代码和原创 XI 标志采用 [MIT License](LICENSE)，允许使用、修改和商业使用，分发时须保留许可证要求的声明。第三方代码和素材仍遵循各自的许可证。

感谢以下开源项目：

| 项目 | 用途 | 许可证 |
| --- | --- | --- |
| [React / React DOM](https://github.com/facebook/react) | 编辑器界面 | MIT |
| [Vite](https://github.com/vitejs/vite) / [React 插件](https://github.com/vitejs/vite-plugin-react) | 开发与构建 | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | 类型检查 | Apache-2.0 |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) / Vite 插件 | 界面样式 | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | 界面图标 | ISC |
| [class-variance-authority](https://github.com/joe-bell/cva) | 组件样式变体 | Apache-2.0 |
| [clsx](https://github.com/lukeed/clsx) | 组合 CSS 类名 | MIT |
| [tailwind-merge](https://github.com/dcastil/tailwind-merge) | 合并 Tailwind 类名 | MIT |
| [fflate](https://github.com/101arrowz/fflate) | 打包卡片 ZIP | MIT |
| [Mediabunny](https://github.com/Vanilagy/mediabunny) | 浏览器视频编码与 MP4 封装 | MPL-2.0 |
| [Playwright](https://github.com/microsoft/playwright) | 浏览器测试与本地渲染 | Apache-2.0 |
| [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) | Node.js、React 与 React DOM 的类型定义 | MIT |
| [Chromium](https://www.chromium.org/) | 本地与 Actions 渲染 | BSD 类许可证及组件各自许可 |
| [FFmpeg](https://ffmpeg.org/legal.html) | 本地与 Actions 视频编码 | LGPL／GPL，取决于构建配置 |

内置字体取自 Google Fonts 的开源字体，随网站托管，采用 SIL Open Font License 1.1。每款字体的原始版权与许可声明均保留在 `public/fonts/`，来源见[字体说明](docs/font-sources.md)。

更多许可信息见[第三方说明](THIRD_PARTY_NOTICES.md)。Mediabunny 的 [MPL-2.0 许可证](public/MEDIABUNNY-LICENSE.txt)和[源码信息](public/DEPENDENCIES.txt)随网站一并提供。
