# Contributing

For bug reports, include the browser, interface language, steps to reproduce and expected behaviour. Use fictional names and assets you can share; project JSON may contain photos and uploaded font data.

## Development

Use Node.js 22.12+ in the 22.x series and install the locked dependencies:

```sh
npm ci
npm run dev
```

Before opening a pull request, run `npm run typecheck` and `npm run build`. For UI changes, inspect desktop and mobile widths, both themes and the affected languages. Existing Playwright checks can be run against the dev server with `npm run test:ui`; local export checks need Chrome/Chromium and, for MP4, FFmpeg. See `package.json` for the other focused checks.

Pull requests to `main` run type-check and build checks; merges or pushes to `main` deploy Pages. Keep the static editor usable when the local export service is unavailable.

## Translations

Maintain translations through issues and pull requests in the GitHub repository.

- For a correction, identify the interface language, current wording and proposed wording in an issue or pull request.
- Edit locale messages under `src/i18n`; `en.ts` defines the shared message IDs and provides fallback text.
- For a new locale, add its message file and register it in `src/i18n/index.tsx`. Include graphic labels when applicable.
- Some newer editor components contain local language variants. Check the changed screen as well as the shared message files.
- Run `npm run typecheck` and `npm run build`, then inspect the affected screen at desktop and mobile widths. Preserve interpolation variables such as `{name}`.

Existing locally imported languages remain supported for compatibility, but new languages are distributed through project releases.

## Documentation and rights

Keep `README.md` and `README.zh-CN.md` aligned when changing features or deployment requirements. The bilingual public usage terms and privacy notice are in `public/TERMS.txt` and `public/PRIVACY.txt`; Vite copies them into the deployed site. Update both languages and their dates when the described behaviour changes.

Contribute only code and assets you have the right to submit under the applicable licence. Original code contributions are supplied under the project's MIT licence. Preserve third-party notices and document the source and licence of added assets. Reference recordings, extracted broadcast frames, private project files and generated test results must not be added as public demos.
