import { realpath, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Workflow inputs are data, never interpolated into a shell command.
const root = await realpath(process.cwd());
async function projectFile(name) {
  if (!name || isAbsolute(name)) throw new Error('Use a repository-relative file path');
  const file = await realpath(resolve(root, name));
  const rel = relative(root, file);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('File must stay inside the repository');
  if ((await stat(file)).size > 150 * 1024 * 1024) throw new Error('Input file exceeds 150 MB');
  return file;
}
const state = JSON.parse(await readFile(await projectFile(process.env.PROJECT_FILE || 'exports/project.json'), 'utf8'));
if (!state.team || !Array.isArray(state.players)) throw new Error('Invalid Matchday XI project');
const kind = process.env.EXPORT_KIND || 'video';
if (!['video', 'cards'].includes(kind)) throw new Error('Unknown output kind');
const lang = process.env.EXPORT_LANG || 'en';
const height = Number(process.env.EXPORT_HEIGHT || 1080), fps = Number(process.env.EXPORT_FPS || 30);
const size = Number(process.env.CARD_SIZE || 2048);
if (![720, 1080, 1440, 2160].includes(height) || ![30, 60].includes(fps) || ![1024, 2048, 4096].includes(size)) throw new Error('Invalid output settings');
const types = [...new Set((process.env.CARD_TYPES || 'big').split(',').map(value => value.trim()))];
const indices = process.env.CARD_PLAYERS && process.env.CARD_PLAYERS !== 'all' ? process.env.CARD_PLAYERS.split(',').map(value => Number(value.trim()) - 1) : state.players.map((_, i) => i);
if (types.some(type => !['small', 'big', 'key'].includes(type)) || indices.some(i => !Number.isInteger(i) || i < 0 || i >= Math.min(11, state.players.length))) throw new Error('Invalid card selection');
let video = null;
if (kind === 'video' && state.bg?.mode === 'video') {
  if (!process.env.BACKGROUND_VIDEO) throw new Error('This project uses a session-only background video. Set BACKGROUND_VIDEO to its repository-relative path.');
  const file = await projectFile(process.env.BACKGROUND_VIDEO);
  const mime = /\.webm$/i.test(file) ? 'video/webm' : /\.mov$/i.test(file) ? 'video/quicktime' : 'video/mp4';
  video = `data:${mime};base64,${(await readFile(file)).toString('base64')}`;
}
const port = Number(process.env.RENDER_PORT || 4179);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid render port');
const origin = `http://127.0.0.1:${port}`, endpoint = `${origin}/api/export`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, env: { ...process.env, BASE_PATH: '/' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
server.stderr.on('data', chunk => process.stderr.write(chunk));
server.stdout.resume();
let launchError; server.on('error', error => { launchError = error; });
let id;
const controller = new AbortController();
const stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  const started = Date.now();
  while (true) {
    controller.signal.throwIfAborted();
    if (launchError || server.exitCode !== null) throw launchError || new Error('Renderer exited');
    if (await fetch(endpoint).then(r => r.ok).catch(() => false)) break;
    if (Date.now() - started > 30000) throw new Error('Renderer startup timed out');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const payload = kind === 'cards' ? { kind, state, lang, size, batch: true, cards: [...new Set(indices)].flatMap(index => types.map(kind => ({ index, kind }))) } : { state, lang, height, fps, video };
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(payload), signal: controller.signal });
  if (!response.ok) throw new Error(`Export rejected: ${response.status}`);
  ({ id } = await response.json());
  let reported = -1;
  for (;;) {
    controller.signal.throwIfAborted();
    if (Date.now() - started > 80 * 60 * 1000) throw new Error('Export exceeded 80 minutes');
    const response = await fetch(`${endpoint}/${id}`, { signal: controller.signal });
    if (!response.ok) throw new Error('Export job unavailable');
    const job = await response.json();
    if (job.status === 'failed') throw new Error(job.error);
    const progress = Math.floor(job.progress / 10) * 10;
    if (progress !== reported) { console.log(`${kind}: ${progress}%`); reported = progress; }
    if (job.status === 'complete') {
      const response = await fetch(`${endpoint}/${id}/file`, { signal: controller.signal });
      if (!response.ok) throw new Error('Could not download output');
      await mkdir('.export-output', { recursive: true });
      const filename = kind === 'cards' ? 'matchday-cards.zip' : 'matchday-lineup.mp4';
      await writeFile(resolve('.export-output', filename), Buffer.from(await response.arrayBuffer()));
      await writeFile('.export-output/render.json', JSON.stringify({ kind, lang, ...(kind === 'cards' ? { size, outputs: job.outputs } : { height, fps }), createdAt: new Date().toISOString() }, null, 2));
      console.log(`Saved .export-output/${filename}`); break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally {
  if (id) await fetch(`${endpoint}/${id}`, { method: 'DELETE', signal: AbortSignal.timeout(15000) }).catch(() => {});
  if (!launchError && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
}
