import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** One rawvideo frame at a time, using Node's stream backpressure rather than buffering a frame. */
export function createRawFrameStream(output, { width, height, key, signal }) {
  const frameBytes = width * height * 4;
  if (!Number.isSafeInteger(frameBytes) || frameBytes <= 0) throw new Error('Invalid frame dimensions');
  let nextFrame = 0, busy = false, broken = false;
  const fail = (status, message) => Object.assign(new Error(message), { status });
  return {
    async receive(request) {
      signal?.throwIfAborted();
      if (request.headers['x-frame-key'] !== key) throw fail(403, 'Frame key rejected');
      if (busy || broken || request.headers['x-frame-index'] !== String(nextFrame)) throw fail(409, 'Unexpected frame');
      if (request.headers['content-type'] !== 'application/octet-stream') throw fail(415, 'RGBA required');
      const declared = request.headers['content-length'];
      if (declared != null && Number(declared) !== frameBytes) throw fail(400, 'Invalid frame length');
      busy = true;
      let bytes = 0;
      // A per-request adapter prevents pipeline from closing the shared encoder
      // or leaving listeners on it after every frame. No full-frame Node buffer.
      const destination = new Writable({
        write(chunk, _, callback) {
          bytes += chunk.length;
          if (bytes > frameBytes) callback(fail(413, 'Frame exceeds dimensions'));
          else output.write(chunk, callback);
        },
        final(callback) { callback(bytes === frameBytes ? null : fail(400, 'Incomplete frame')); },
      });
      try {
        await pipeline(request, destination, { signal });
        nextFrame++;
      } catch (error) { broken = true; throw error; }
      finally { busy = false; }
    },
  };
}
