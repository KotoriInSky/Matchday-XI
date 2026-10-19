import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export async function receiveVideo(request, file, { signal, maxBytes = MAX_VIDEO_BYTES } = {}) {
  const tooLarge = () => Object.assign(new Error('Video exceeds upload limit'), { status: 413 });
  const declared = Number(request.headers['content-length']);
  if (declared > maxBytes) throw tooLarge();
  let size = 0;
  const limit = new Transform({
    transform(chunk, _, callback) {
      size += chunk.length;
      callback(size > maxBytes ? tooLarge() : null, chunk);
    },
  });
  try {
    // pipeline keeps bounded buffers and closes the writer on abort or failure.
    await pipeline(request, limit, createWriteStream(file, { flags: 'wx' }), { signal });
    if (!size) throw Object.assign(new Error('Video is empty'), { status: 400 });
  } catch (error) { await rm(file, { force: true }); throw error; }
}

/** Only receives the service-owned job file, never a request-supplied path. */
export async function serveVideo(request, response, file, mime, { signal } = {}) {
  const { size } = await stat(file);
  const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  let start = 0, end = size - 1, status = 200;
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start >= size || end < start || (!match[1] && Number(match[2]) === 0)) {
      response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }); response.end(); return;
    }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  response.writeHead(status, { ...headers, 'Content-Length': end - start + 1 });
  if (request.method === 'HEAD') { response.end(); return; }
  try { await pipeline(createReadStream(file, { start, end }), response, { signal }); }
  catch (error) { if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE' && !response.destroyed) response.destroy(error); }
}
