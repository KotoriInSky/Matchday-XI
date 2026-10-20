import { spawn } from 'node:child_process';

const cpu = { name: 'libx264', args: ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p'] };
const nvidia = { name: 'h264_nvenc', args: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '18', '-b:v', '0', '-pix_fmt', 'yuv420p'] };

// Encoder listings do not prove that the installed driver supports the build's NVENC API.
export async function selectVideoEncoder({ ffmpeg = 'ffmpeg', mode = 'auto', width, height, fps, signal }) {
  signal?.throwIfAborted();
  if (!['auto', 'h264_nvenc', 'libx264'].includes(mode)) throw new Error('FFMPEG_ENCODER must be auto, h264_nvenc or libx264');
  if (mode === 'libx264') return cpu;
  const result = await new Promise((resolve, reject) => {
    let detail = '', settled = false;
    const process = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}`, '-frames:v', '1', '-an', ...nvidia.args, '-f', 'null', '-'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const finish = (value, error) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => { process.kill(); finish(null, signal.reason); };
    const timer = setTimeout(() => { process.kill(); finish({ ok: false, detail: 'NVENC probe timed out' }); }, 15000);
    process.stderr.on('data', chunk => { detail = (detail + chunk).slice(-2500); });
    // A missing executable is not an NVENC problem: libx264 would need the same binary.
    process.once('error', error => error.code === 'ENOENT'
      ? finish(null, Object.assign(new Error(`FFmpeg not found: ${ffmpeg}. Set FFMPEG_PATH to an existing ffmpeg executable.`), { code: 'ENOENT' }))
      : finish({ ok: false, detail: error.message }));
    process.once('close', code => finish({ ok: code === 0, detail }));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  if (result.ok) return nvidia;
  if (mode === 'h264_nvenc') throw new Error(`NVENC is unavailable: ${result.detail}`);
  return { ...cpu, fallbackReason: result.detail };
}
