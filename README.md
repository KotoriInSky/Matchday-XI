# <img src="public/favicon.svg" width="32" height="32" alt="Matchday XI icon"> Matchday XI

[Open the editor](https://kotoriinsky.github.io/Matchday-XI/) · [简体中文](README.zh-CN.md) · [Report an issue](https://github.com/KotoriInSky/Matchday-XI/issues)

## About

Matchday XI is a browser tool for making football lineup graphics and matchday animations.

Choose a formation, add your players, then set the club colours, badge and photos. Preview the animation and export player cards or a video for a starting lineup announcement, a club social post, or a team you would like to see play.

## 🎬 Demo

Classic: player reveals by position, followed by the starting lineup and substitutes.

![Classic lineup animation](docs/images/classic-demo.gif)

26/27: split-panel player reveals, with manager, captain and key-player highlights.

![26/27 lineup animation](docs/images/season2627-demo.gif)

Both demos use the sample lineup and original placeholder artwork, played at 2.5× speed. You can supply your own images and frame the pitch, player and highlight cards separately. Template names describe styles and do not imply official affiliation.

## Features

| Feature | What you can do |
| --- | --- |
| Lineup editor | Choose a preset or custom formation, drag players into position, and add substitutes. |
| Player cards | Edit pitch, player and highlight cards with separate photos, image framing and name layouts. |
| Animation | Use Classic or 26/27, with a manager introduction, player reveal order and scene timing. |
| Club styling | Set badges, colours, kit patterns, card shapes, and background images or video. |
| Fonts and tags | Choose bundled fonts or upload your own, and add flags or custom image tags. |
| Preview | Play, pause, scrub the timeline or jump between scenes, with undo and redo. |
| Card export | Generate transparent PNGs in the browser, individually or in a ZIP, with a 1024, 2048 or 4096 px long edge. |
| Video export | Export silent H.264 MP4 at 720p, 1080p, 1440p or 2160p, at 30 or 60 fps. |
| Project files | Autosave in the current browser and download or import JSON backups. |
| Interface | Light and dark themes, with English, Simplified Chinese, Traditional Chinese, Japanese, Korean and Spanish. |

The browser checks H.264 support for your chosen video settings. Keep the page in the foreground while exporting. If encoding is unavailable, try different settings, a recent Chrome or Edge release, or local rendering. Save generated downloads before refreshing.

## Run locally

Use Node.js 22.x, version 22.12 or newer. Clone or download the project, then run these commands in its directory:

```sh
git clone https://github.com/KotoriInSky/Matchday-XI.git
cd Matchday-XI
npm ci
npm run dev
```

Open the address printed by Vite, normally `http://localhost:5173/matchday-xi/`.

Browser export does not require FFmpeg. For the optional local video renderer, install Chrome or Playwright Chromium, and FFmpeg with H.264 encoding support:

```sh
npx playwright install chromium
```

Put `ffmpeg` on PATH, or set `FFMPEG_PATH` before starting the app. PowerShell example:

```powershell
$env:FFMPEG_PATH = 'C:\Tools\ffmpeg\bin\ffmpeg.exe'
npm run dev
```

Select the local rendering service under Backup → Video export. You can edit in Firefox; the service launches headless Chromium separately to render.

Build and preview the production version:

```sh
npm run build
npm run preview
```

See the [export guide](docs/export.md) for browser, local and manual GitHub Actions export, and the [Pages guide](docs/github-pages.md) for deploying your own copy.

## 🐛 Issues

Report bugs or suggest features in this repository's [Issues](https://github.com/KotoriInSky/Matchday-XI/issues). For a bug, include:

- Your browser version and device.
- The steps you took and where the problem appeared.
- What you expected and what happened.
- For export problems, the export method, template, dimensions and frame rate.

Screenshots or a small example project help with reproduction. JSON backups may contain photos, names and uploaded fonts; remove private content before sharing. Translation fixes are welcome too. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Terms and privacy

Use photos, badges, fonts and videos that you own or have permission to use, and check that their licences cover your intended publication. You retain your rights in supplied content; the project does not claim ownership of uploaded assets or exported work. Matchday XI is independent and is not an official club, league or competition product.

The app has no accounts or cloud project sync. Projects are stored in the current browser. A different browser, website address or cleared site data may require importing a backup. Background video files are not included in JSON and must be kept separately.

Export methods handle data as follows:

- Browser export processes the project on your device without uploading its assets.
- Local rendering sends a project snapshot to the renderer on your own computer.
- Manual GitHub Actions export uses project files you upload to your repository. These assets become repository content and history; use a private repository for private media.

Built-in fonts are served with the website, without connecting to Google Fonts. The host still receives normal requests for pages, fonts and other resources. Browser export does not upload project assets.

Read the full [usage terms](public/TERMS.txt) and [privacy notice](public/PRIVACY.txt).

## Licence and acknowledgements

The source code and original XI mark use the [MIT License](LICENSE), permitting use, modification and commercial use subject to its notice requirements. Third-party code and assets retain their own licences.

Thanks to the following open-source projects:

| Project | Use | Licence |
| --- | --- | --- |
| [React / React DOM](https://github.com/facebook/react) | Editor interface | MIT |
| [Vite](https://github.com/vitejs/vite) / [React plugin](https://github.com/vitejs/vite-plugin-react) | Development and build | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | Type checking | Apache-2.0 |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) / Vite plugin | Interface styling | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | Interface icons | ISC |
| [class-variance-authority](https://github.com/joe-bell/cva) | Component variants | Apache-2.0 |
| [clsx](https://github.com/lukeed/clsx) | CSS class composition | MIT |
| [tailwind-merge](https://github.com/dcastil/tailwind-merge) | Tailwind class merging | MIT |
| [fflate](https://github.com/101arrowz/fflate) | Card ZIP archives | MIT |
| [Mediabunny](https://github.com/Vanilagy/mediabunny) | Browser video encoding and MP4 muxing | MPL-2.0 |
| [Playwright](https://github.com/microsoft/playwright) | Browser tests and local rendering | Apache-2.0 |
| [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) | Node.js, React and React DOM types | MIT |
| [Chromium](https://www.chromium.org/) | Local and Actions rendering | BSD-style and component licences |
| [FFmpeg](https://ffmpeg.org/legal.html) | Local and Actions video encoding | LGPL/GPL, depending on the build |

Bundled fonts are sourced from Google Fonts and use SIL Open Font License 1.1. Original copyright and licence files are included under `public/fonts/`; see [font sources](docs/font-sources.md).

See [third-party notices](THIRD_PARTY_NOTICES.md) for more details. Mediabunny's [MPL-2.0 licence](public/MEDIABUNNY-LICENSE.txt) and [source information](public/DEPENDENCIES.txt) are also distributed with the site.
