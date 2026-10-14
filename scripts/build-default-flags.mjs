import { readFile, writeFile } from 'node:fs/promises';

// Keep the portable demo flags identical to the licensed FIFA library assets.
const codes = ['ENG', 'ITA', 'NED', 'KOR', 'JPN', 'HUN', 'BRA', 'CHN'];
const flags = {};
for (const code of codes) flags[code] = await readFile(new URL(`../public/flags/fifa/${code}.svg`, import.meta.url), 'utf8');
await writeFile(new URL('../src/data/default-fifa-flags.json', import.meta.url), JSON.stringify(flags, null, 2) + '\n');
