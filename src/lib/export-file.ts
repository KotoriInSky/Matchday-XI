import type { StreamTargetChunk } from 'mediabunny';

const downloads = new Map<string, () => Promise<void>>();
const pending = new Set<() => Promise<void>>();
const lockName = (name: string) => `matchday-xi-export:${name}`;

// Locks live as long as the temporary file or its download URL. Another tab may
// reclaim orphaned files after a crash without deleting an active export.
async function lease(name: string) {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await new Promise<void>((resolve, reject) => {
    void navigator.locks.request(lockName(name), () => { resolve(); return held; }).catch(reject);
  });
  return release;
}

export async function releaseDownload(url: string) {
  if (!url.startsWith('blob:')) return;
  URL.revokeObjectURL(url);
  const dispose = downloads.get(url); downloads.delete(url);
  await dispose?.().catch(() => {});
}

window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  for (const url of downloads.keys()) void releaseDownload(url);
  for (const dispose of pending) void dispose();
});

export async function createExportFile() {
  let directory: FileSystemDirectoryHandle | undefined;
  let handle: FileSystemFileHandle | undefined;
  let file: FileSystemWritableFileStream | undefined;
  let release: (() => void) | undefined;
  const name = `export-${crypto.randomUUID()}`;
  try {
    if (!navigator.storage?.getDirectory || !navigator.locks) throw new Error('Temporary storage unavailable');
    directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('matchday-xi-exports', { create: true });
    const entries = directory as FileSystemDirectoryHandle & AsyncIterable<[string, FileSystemHandle]>;
    for await (const [entry, info] of entries) {
      // Chromium may expose a live writer's .crswap file in this directory.
      if (info.kind !== 'file' || !/^export-[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(entry)) continue;
      await navigator.locks.request(lockName(entry), { ifAvailable: true }, async lock => {
        if (lock) await directory!.removeEntry(entry).catch(() => {});
      });
    }
    release = await lease(name);
    handle = await directory.getFileHandle(name, { create: true });
    file = await handle.createWritable();
  } catch {
    if (handle) await directory?.removeEntry(name).catch(() => {});
    release?.(); release = undefined; handle = undefined; file = undefined;
  }

  let blob = new Blob(), cursor = 0;
  let writes = Promise.resolve();
  let closed = false, transferred = false, removed = false;
  const cleanup = async () => {
    if (removed) return;
    removed = true; pending.delete(cleanup);
    await writes.catch(() => {});
    if (!closed) { closed = true; await file?.abort().catch(() => {}); }
    blob = new Blob();
    try { if (handle) await directory?.removeEntry(name).catch(() => {}); }
    finally { release?.(); }
  };
  pending.add(cleanup);
  const write = (data: Uint8Array<ArrayBuffer>, position = cursor) => {
    if (closed || removed) return Promise.reject(new Error('Export output is closed'));
    if (!Number.isSafeInteger(position) || position < 0) return Promise.reject(new Error('Invalid output position'));
    cursor = position + data.byteLength;
    writes = writes.then(async () => {
      if (file) await file.write({ type: 'write', data, position });
      else {
        const gap = Math.max(0, position - blob.size);
        blob = new Blob([blob.slice(0, position), ...(gap ? [new Uint8Array(gap)] : []), data, blob.slice(position + data.byteLength)]);
      }
    });
    // The caller still receives the rejection; cleanup may run before it awaits.
    void writes.catch(() => {});
    return writes;
  };
  const close = async () => {
    await writes;
    if (removed) throw new Error('Export output was discarded');
    if (closed) return;
    closed = true;
    try { await file?.close(); }
    catch (error) { closed = false; throw error; }
  };
  return {
    storage: file ? 'file' as const : 'memory' as const,
    write,
    stream: new WritableStream<StreamTargetChunk>({ write: chunk => write(chunk.data, chunk.position), close, abort: cleanup }),
    async finish(type: string) {
      if (transferred) throw new Error('Export output was already finalized');
      await close();
      const result = handle ? await handle.getFile() : blob;
      const url = URL.createObjectURL(result.slice(0, result.size, type));
      transferred = true; blob = new Blob(); pending.delete(cleanup); downloads.set(url, cleanup);
      return url;
    },
    async dispose() { if (!transferred) await cleanup(); },
  };
}
