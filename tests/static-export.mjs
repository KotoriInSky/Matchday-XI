import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// A file server with no Vite middleware and no export API, like GitHub Pages.
const root = resolve('dist'), prefix = process.env.TEST_BASE || '/matchday-xi/';
let apiRequests = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.includes('/api/export')) apiRequests++;
  if (!path.startsWith(prefix)) { res.writeHead(404).end(); return; }
  const file = resolve(root, decodeURIComponent(path.slice(prefix.length)) || 'index.html');
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain' }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}${prefix}`;
const browser = await chromium.launch({ channel: 'chrome' });
try {
  await mkdir('test-results/static-export', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => localStorage.setItem('matchday-xi-lang', 'zh-Hans'));
  await page.goto(base);
  await page.getByRole('tab', { name: '备份', exact: true }).click();
  let download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载项目', exact: true }).click();
  const project = 'test-results/static-export/project.json'; await (await download).saveAs(project);
  const state = JSON.parse(await readFile(project, 'utf8')); Object.assign(state.anim, { intro: false, manager: false, style: 'off' });
  await writeFile(project, JSON.stringify(state));
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '导入项目', exact: true }).click();
  await (await chooser).setFiles(project);
  await page.getByRole('tab', { name: '阵容', exact: true }).click();
  await page.locator('.player-index-row').first().click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('PNG 长边', { exact: true }).selectOption('1024');
  await modal.getByRole('button', { name: '导出卡片 PNG', exact: true }).click();
  await modal.getByRole('link', { name: '下载 PNG', exact: true }).waitFor({ timeout: 90000 });
  download = page.waitForEvent('download'); await modal.getByRole('link', { name: '下载 PNG', exact: true }).click();
  await (await download).saveAs('test-results/static-export/card.png');
  const png = await readFile('test-results/static-export/card.png'); assert.equal(Math.max(png.readUInt32BE(16), png.readUInt32BE(20)), 1024);
  await page.keyboard.press('Escape'); await page.getByRole('tab', { name: '备份', exact: true }).click();
  await page.getByLabel('分辨率', { exact: true }).selectOption('720');
  assert.equal(await page.getByLabel('导出方式', { exact: true }).inputValue(), 'browser');
  await page.getByRole('button', { name: '导出视频', exact: true }).click();
  await page.getByRole('link', { name: '下载 MP4', exact: true }).waitFor({ timeout: 300000 });
  download = page.waitForEvent('download'); await page.getByRole('link', { name: '下载 MP4', exact: true }).click();
  const video = 'test-results/static-export/video.mp4'; await (await download).saveAs(video);
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name,r_frame_rate', '-of', 'json', video], { encoding: 'utf8' })).streams[0];
  assert.equal(info.height, 720); assert.equal(info.codec_name, 'h264'); assert.equal(info.r_frame_rate, '30/1');
  await page.getByRole('link', { name: '下载 MP4', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/static-export/desktop.png' });
  assert.equal(apiRequests, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/static-export/mobile.png' });
  // No encoder: explicit fallback, no silent downgrade or dead export button.
  const unsupported = await browser.newPage();
  await unsupported.addInitScript(() => { delete window.VideoEncoder; localStorage.setItem('matchday-xi-lang', 'zh-Hans'); });
  await unsupported.goto(base); await unsupported.getByRole('tab', { name: '备份', exact: true }).click();
  await unsupported.getByText(/当前浏览器不支持此规格/).waitFor();
  assert.ok(await unsupported.getByRole('button', { name: '导出视频', exact: true }).isDisabled());
  console.log('Built static site: real PNG and MP4 downloaded through the UI; zero API calls, mobile layout and unsupported-codec guidance passed.');
} finally { await browser.close(); server.close(); await once(server, 'close'); }
