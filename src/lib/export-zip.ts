export async function createZipArchive(write: (data: Uint8Array<ArrayBuffer>) => Promise<void>) {
  const { Zip, ZipPassThrough } = await import('fflate');
  let writes = Promise.resolve();
  let failure: Error | null = null;
  const zip = new Zip((error, data) => {
    if (error) { failure = error; return; }
    writes = writes.then(() => write(data));
    void writes.catch(() => {});
  });
  const drain = async () => { await writes; if (failure) throw failure; };
  return {
    async add(filename: string, blob: Blob, signal: AbortSignal) {
      signal.throwIfAborted();
      const entry = new ZipPassThrough(filename); zip.add(entry);
      const reader = blob.stream().getReader();
      try {
        for (;;) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          entry.push(value); await drain();
        }
        entry.push(new Uint8Array(), true); await drain();
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    },
    async finish() { zip.end(); await drain(); },
    dispose() { zip.terminate(); },
  };
}
