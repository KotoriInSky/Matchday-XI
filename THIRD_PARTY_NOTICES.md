# Third-party components and assets

The project's MIT licence covers its own source and original XI mark. Third-party code, fonts, tools and imported content retain their own licences. This is a guide to the main components, not a replacement for the notices included with each dependency.

## Main npm components

Licences below were checked against the installed package metadata on 2026-10-13. `package-lock.json` records the versions used for reproducible installs; transitive dependencies also carry their own notices.

| Component | Licence | Source |
| --- | --- | --- |
| React / React DOM | MIT | [facebook/react](https://github.com/facebook/react) |
| Lucide icons | ISC | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) |
| class-variance-authority | Apache-2.0 | [joe-bell/cva](https://github.com/joe-bell/cva) |
| clsx | MIT | [lukeed/clsx](https://github.com/lukeed/clsx) |
| tailwind-merge | MIT | [dcastil/tailwind-merge](https://github.com/dcastil/tailwind-merge) |
| fflate | MIT | [101arrowz/fflate](https://github.com/101arrowz/fflate) |
| Mediabunny | MPL-2.0 | [Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny) |
| Playwright | Apache-2.0 | [microsoft/playwright](https://github.com/microsoft/playwright) |
| Vite | MIT | [vitejs/vite](https://github.com/vitejs/vite) |
| Tailwind CSS | MIT | [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) |
| TypeScript | Apache-2.0 | [microsoft/TypeScript](https://github.com/microsoft/TypeScript) |

## Fonts

The browser build dynamically includes unmodified Mediabunny. Its MPL-2.0 licence
and source information are also distributed in `public/MEDIABUNNY-LICENSE.txt`
and `public/DEPENDENCIES.txt`.

Built-in fonts are unmodified WOFF2 assets sourced from Google Fonts and served from this website. Each family uses SIL Open Font License 1.1; its original copyright and licence are distributed beside its CSS in `public/fonts/<family>/OFL.txt`. Font software remains under that licence, separately from this project's MIT licence. See [font sources](docs/font-sources.md) and the [asset manifest](public/fonts/manifest.json) for provenance and hashes. The editor and local renderer do not request Google Fonts at runtime.

Uploaded fonts remain subject to the uploader's licence, including embedding or redistribution restrictions. Project JSON can contain the uploaded font file data.

## Local rendering tools

Chrome, Chromium and FFmpeg are installed separately and are not distributed as project source assets. Their licences and notices apply independently. FFmpeg licensing depends on its build configuration and enabled codecs; see [FFmpeg legal information](https://ffmpeg.org/legal.html). The renderer invokes the installed build's `libx264` encoder for H.264 output.

## Images, badges and video

Users must supply assets they have permission to use. The project does not license third-party club badges, player portraits, broadcasts or trademarks. Reference recordings and extracted frames under `test-results/` are development materials excluded by `.gitignore`; do not copy them into public demo assets without permission. Screenshots and demo files contributed to the repository must have a documented source and suitable licence.
