import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { receiveVideo, serveVideo } from '../server/export-media.mjs';
import { exportPlugin } from '../server/export-plugin.mjs';

const directory = await mkdtemp(join(tmpdir(), 'matchday-upload-test-'));
const events = [];
const pending = new Set();
const server = createServer((req, res) => {
  const task = (async () => {
    if (req.method === 'POST') {
      const file = join(directory, req.url.slice(1));
      try {
        await receiveVideo(req, file, { maxBytes: 1024 * 1024 });
        events.push({ path: req.url, complete: true }); res.writeHead(202).end();
      } catch (error) {
        events.push({ path: req.url, error });
        if (!res.destroyed) res.writeHead(error.status || 400).end();
      }
    } else await serveVideo(req, res, join(directory, 'video'), 'video/mp4');
  })();
  pending.add(task); task.finally(() => pending.delete(task));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const data = Buffer.alloc(600 * 1024);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  const result = await fetch(`${origin}/video`, { method: 'POST', body: data });
  assert.equal(result.status, 202); assert.deepEqual(await readFile(join(directory, 'video')), data);
  const whole = await fetch(`${origin}/video`);
  assert.equal(whole.status, 200); assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), data);
  for (const [range, start, end] of [['bytes=100-299', 100, 299], ['bytes=600000-', 600000, data.length - 1], ['bytes=-99', data.length - 99, data.length - 1], ['bytes=0-9999999', 0, data.length - 1]]) {
    const response = await fetch(`${origin}/video`, { headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${data.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), data.subarray(start, end + 1));
  }
  for (const range of ['bytes=9999999-', 'bytes=3-2', 'bytes=-0', 'bytes=0-1,4-5']) {
    const response = await fetch(`${origin}/video`, { headers: { Range: range } });
    assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), `bytes */${data.length}`);
  }
  const head = await fetch(`${origin}/video`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(data.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);

  const oversized = await fetch(`${origin}/oversized`, { method: 'POST', body: Buffer.alloc(1024 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  await assert.rejects(stat(join(directory, 'oversized')), { code: 'ENOENT' });
  // Chunked requests must enforce the same bound without trusting Content-Length.
  const streamed = request(`${origin}/chunked`, { method: 'POST', agent: false });
  const disconnected = new Promise(resolve => { streamed.on('error', resolve); streamed.on('response', response => { response.resume(); response.on('end', resolve); }); });
  streamed.write(Buffer.alloc(700 * 1024)); streamed.end(Buffer.alloc(700 * 1024));
  await disconnected;
  const aborted = request(`${origin}/aborted`, { method: 'POST', agent: false }); aborted.on('error', () => {});
  aborted.flushHeaders(); await new Promise((resolve, reject) => aborted.write(Buffer.alloc(64 * 1024), error => error ? reject(error) : resolve()));
  // Let the server open the writer before interrupting a real in-flight body.
  let opened = false;
  for (let i = 0; i < 300; i++) {
    if (await stat(join(directory, 'aborted')).then(() => true, () => false)) { opened = true; break; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(opened, `The cancelled request must reach its open file writer: ${JSON.stringify(events.map(event => ({ path: event.path, error: event.error?.message, complete: event.complete })))}`);
  aborted.destroy();
  for (let i = 0; i < 100 && !events.some(event => event.path === '/aborted'); i++) await new Promise(resolve => setTimeout(resolve, 10));
  await Promise.all(pending);
  assert.ok(events.some(event => event.path === '/chunked' && event.error));
  assert.ok(events.some(event => event.path === '/aborted' && event.error));
  for (const file of ['chunked', 'aborted']) await assert.rejects(stat(join(directory, file)), { code: 'ENOENT' });
  console.log('Binary upload, byte ranges, size limits and disconnected-writer cleanup passed');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }

// Exercise the real job reservation and cancellation protocol without starting a renderer.
let middleware;
const service = createServer((req, res) => { void middleware(req, res, () => res.writeHead(404).end()); });
exportPlugin('/').configureServer({ httpServer: service, middlewares: { use(handler) { middleware = handler; } } });
service.listen(0, '127.0.0.1'); await once(service, 'listening');
const endpoint = `http://127.0.0.1:${service.address().port}/api/export`;
const payload = { state: { bg: { mode: 'video' } }, lang: 'en', height: 720, fps: 30, videoUpload: true };
const create = () => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
try {
  const created = await create(); assert.equal(created.status, 202);
  const { id } = await created.json();
  assert.equal((await create()).status, 409);
  assert.equal((await fetch(`${endpoint}/${id}/video`)).status, 405);
  assert.equal((await fetch(`${endpoint}/${id}/media`)).status, 405);
  const rejected = await fetch(`${endpoint}/${id}/video`, { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'video/mp4' }, body: 'x' });
  assert.equal(rejected.status, 403);
  assert.equal((await fetch(`${endpoint}/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${endpoint}/${id}`)).status, 404);
  // Deleting while the upload is open must abort its writer before reclaiming the slot.
  const next = await create(); assert.equal(next.status, 202);
  const nextId = (await next.json()).id;
  const upload = request(`${endpoint}/${nextId}/video`, { method: 'POST', agent: false, headers: { 'Content-Type': 'video/mp4' } });
  const ended = new Promise(resolve => { upload.on('error', resolve); upload.on('response', response => { response.resume(); response.on('end', resolve); }); });
  upload.write(Buffer.alloc(64 * 1024));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await fetch(`${endpoint}/${nextId}`, { method: 'DELETE' })).status, 200);
  await ended;
  assert.equal((await fetch(`${endpoint}/${nextId}`)).status, 404);
  const retry = await create(); assert.equal(retry.status, 202);
  await fetch(`${endpoint}/${(await retry.json()).id}`, { method: 'DELETE' });
  console.log('Pending/in-flight job cancellation, upload reservation and same-origin checks passed');
} finally { service.closeAllConnections(); await new Promise(resolve => service.close(resolve)); }
