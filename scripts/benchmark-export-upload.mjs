import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { createReadStream, openAsBlob } from 'node:fs';
import { mkdtemp, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { receiveVideo } from '../server/export-media.mjs';

// Isolates the upload server's memory. This does not measure browser/GPU/encoder memory.
if (process.argv[2] === '--worker') {
  const mode = process.argv[3], directory = await mkdtemp(join(tmpdir(), 'matchday-upload-bench-'));
  const server = createServer(async (req, res) => {
    global.gc();
    const before = process.memoryUsage(), peak = { ...before };
    const sample = () => { for (const [key, value] of Object.entries(process.memoryUsage())) peak[key] = Math.max(peak[key], value); };
    req.on('data', sample); const timer = setInterval(sample, 10);
    const started = performance.now(), file = join(directory, 'video');
    try {
      if (mode === 'json') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        sample();
        const buffer = Buffer.concat(chunks); sample();
        const text = buffer.toString(); sample();
        const payload = JSON.parse(text); sample();
        const video = Buffer.from(payload.video.slice(payload.video.indexOf(',') + 1), 'base64'); sample();
        await writeFile(file, video); sample();
      } else { await receiveVideo(req, file); sample(); }
      const milliseconds = performance.now() - started;
      clearInterval(timer);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      res.end(JSON.stringify({ mode, milliseconds, before, peak, delta: Object.fromEntries(Object.keys(peak).map(key => [key, peak[key] - before[key]])), sha256: hash.digest('hex') }));
    } catch (error) { console.error(error); res.writeHead(500).end(); }
    finally {
      clearInterval(timer); await rm(directory, { recursive: true, force: true });
      server.close(); server.closeIdleConnections(); process.disconnect();
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); process.send({ port: server.address().port });
} else {
  const mib = Number(process.env.UPLOAD_BENCH_MIB || 64);
  if (!Number.isInteger(mib) || mib < 1 || mib > 140) throw Error('UPLOAD_BENCH_MIB must be 1–140');
  const directory = await mkdtemp(join(tmpdir(), 'matchday-upload-input-')), source = join(directory, 'source');
  try {
    const file = await open(source, 'wx'), chunk = Buffer.alloc(1024 * 1024, 0x5a);
    try { for (let i = 0; i < mib; i++) await file.writeFile(chunk); } finally { await file.close(); }
    const results = [];
    for (const mode of ['json', 'binary']) {
      const worker = fork(fileURLToPath(import.meta.url), ['--worker', mode], { execArgv: ['--expose-gc'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      const exited = once(worker, 'exit');
      try {
        const [{ port }] = await once(worker, 'message');
        const body = mode === 'json' ? JSON.stringify({ video: 'data:video/mp4;base64,' + (await readFile(source)).toString('base64') }) : await openAsBlob(source, { type: 'video/mp4' });
        const response = await fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'Content-Type': mode === 'json' ? 'application/json' : 'video/mp4' }, body });
        if (!response.ok) throw Error(`Benchmark upload failed: ${response.status}`);
        results.push(await response.json()); await exited;
      } finally { if (worker.exitCode === null) worker.kill(); }
    }
    if (results[0].sha256 !== results[1].sha256) throw Error('Upload bytes changed');
    const report = { scope: 'Upload server only; excludes browser, rendering, GPU and encoding', node: process.version, platform: process.platform, inputMiB: mib, results };
    await mkdir('test-results', { recursive: true }); await writeFile('test-results/export-upload-benchmark.json', JSON.stringify(report, null, 2));
    console.table(results.map(({ mode, milliseconds, delta }) => ({ mode, seconds: (milliseconds / 1000).toFixed(3), peakRssIncreaseMiB: (delta.rss / 1024 ** 2).toFixed(1), peakHeapIncreaseMiB: (delta.heapUsed / 1024 ** 2).toFixed(1), peakBufferIncreaseMiB: (delta.arrayBuffers / 1024 ** 2).toFixed(1) })));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
