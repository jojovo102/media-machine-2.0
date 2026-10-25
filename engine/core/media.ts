// The shared core of the media machine (2026-10-19, moved here 2026-10-22): ffmpeg, whisper, the OS, the iPhone's
// colour, the trial versions. Nothing here knows about a brand. Bun only: no packages beyond the motion engine's own (playwright-core, in vsl/motion/app/node_modules).
// ffmpeg, ffprobe and whisper-cli from Homebrew. Nothing here knows about a brand or a machine.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const CORE = import.meta.dir;
/** The repo (media-machine) and the folder that holds the repos side by side. */
export const MACHINE_ROOT = path.resolve(CORE, '..', '..');
export const BASE_DIR = path.resolve(MACHINE_ROOT, '..');
/** The motion engine's app (ophanim-ai/media-exports/vsl/motion/app): its playwright-core draws text in Chrome. */
export const APP = process.env.MOTION_APP ?? path.join(BASE_DIR, 'ophanim-ai', 'media-exports', 'vsl', 'motion', 'app');
export const WHISPER_MODEL = path.join(process.env.HOME ?? '', '.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin');
/** The OS repo: read for its .env.local and its postgres package, never written to by the machine. */
export const OS_DIR = process.env.OS_DIR ?? path.join(BASE_DIR, 'OPHANIM AI OS');

export const ensure = (...dirs: string[]) => { for (const d of dirs) mkdirSync(d, { recursive: true }); };
export const readJson = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;
export const writeJson = (f: string, v: unknown) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v, null, 1)); };
export const has = (f: string) => existsSync(f);
export const arg = (k: string, d?: string) => { const a = process.argv, i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
export const flag = (k: string) => process.argv.includes(`--${k}`);

/** Runs a command; throws with its stderr when it fails. */
export function run(cmd: string[], o: { quiet?: boolean; cwd?: string } = {}): string {
  const r = Bun.spawnSync(cmd, { cwd: o.cwd, stdout: 'pipe', stderr: 'pipe' });
  const out = r.stdout.toString(), err = r.stderr.toString();
  if (r.exitCode !== 0) throw new Error(`${cmd[0]} failed (${r.exitCode}): ${cmd.slice(1).join(' ').slice(0, 400)}\n${err.slice(-2000)}`);
  if (!o.quiet && err.trim() && cmd[0] !== 'ffmpeg' && cmd[0] !== 'ffprobe') process.stderr.write(err);
  return out + (cmd[0] === 'ffmpeg' ? err : '');
}
export const ffmpeg = (args: string[]) => run(['ffmpeg', '-hide_banner', '-y', '-loglevel', 'error', ...args], { quiet: true });

/** ffmpeg in the background, for running several at once. */
export async function ffAsync(args: string[]) {
  const p = Bun.spawn(['ffmpeg', '-hide_banner', '-y', '-loglevel', 'error', ...args], { stdout: 'ignore', stderr: 'pipe' });
  const err = await new Response(p.stderr).text();
  if ((await p.exited) !== 0) throw new Error(`ffmpeg failed: ${args.join(' ').slice(0, 300)}\n${err.slice(-1500)}`);
}
/** `fn` over `items`, at most `n` at a time. */
export async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (k < items.length) { const i = k++; await fn(items[i]!, i); } }));
}

export interface Probe { file: string; duration: number; video?: { w: number; h: number; fps: number; rotation: number; codec: string }; audio?: { rate: number; channels: number }; created: number }

/** What a media file is: its length, its picture (as displayed, after any rotation) and its sound. */
export function probe(file: string): Probe {
  const j = JSON.parse(run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { quiet: true }));
  const vs = (j.streams as any[]).find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const as = (j.streams as any[]).find((s) => s.codec_type === 'audio');
  const rot = Number(vs?.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? vs?.tags?.rotate ?? 0);
  const [n, d] = String(vs?.avg_frame_rate ?? vs?.r_frame_rate ?? '30/1').split('/').map(Number);
  let w = Number(vs?.width ?? 0), h = Number(vs?.height ?? 0);
  if (Math.abs(rot) % 180 === 90) [w, h] = [h, w];
  const created = Date.parse(j.format?.tags?.creation_time ?? '') || statSync(file).mtimeMs;
  return {
    file,
    duration: Number(j.format?.duration ?? vs?.duration ?? as?.duration ?? 0),
    video: vs ? { w, h, fps: d ? n! / d : n!, rotation: rot, codec: vs.codec_name } : undefined,
    audio: as ? { rate: Number(as.sample_rate), channels: Number(as.channels) } : undefined,
    created,
  };
}

export const VIDEO_EXT = /\.(mov|mp4|m4v|mkv|webm|avi|mts)$/i;
export const AUDIO_EXT = /\.(wav|m4a|mp3|aac|aif|aiff|flac|caf)$/i;
export const IMAGE_EXT = /\.(jpe?g|png|heic|webp)$/i;
/** Media files in a folder (not recursive). */
export function mediaIn(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => ext.test(f) && !f.startsWith('.')).map((f) => path.join(dir, f));
}
/** Whether anything in `dir` (recursively) changed in the last `minutes`: a copy still running. */
export function stillCopying(dir: string, minutes = 10): boolean {
  if (!existsSync(dir)) return false;
  const limit = Date.now() - minutes * 60_000;
  const walk = (d: string): boolean => readdirSync(d, { withFileTypes: true }).some((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : statSync(p).mtimeMs > limit;
  });
  return walk(dir);
}

/** Mono samples of a file's sound at `rate` Hz, as floats (for syncing and silence). */
export function samples(file: string, rate: number, from = 0, dur = 0): Float32Array {
  const args = ['ffmpeg', '-hide_banner', '-loglevel', 'error'];
  if (from) args.push('-ss', String(from));
  args.push('-i', file);
  if (dur) args.push('-t', String(dur));
  args.push('-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-');
  const r = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`could not read the sound of ${file}: ${r.stderr.toString().slice(-500)}`);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
}

/** Seconds as 1:02:03.4 for people, or 00:01:02 for YouTube chapters. */
export const clock = (s: number, tenths = true) => {
  const sign = s < 0 ? '-' : '';
  s = Math.abs(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const sec = tenths ? x.toFixed(1).padStart(4, '0') : String(Math.floor(x)).padStart(2, '0');
  return sign + (h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`);
};
export const chapterClock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
};

/** Integrated loudness (LUFS) and true peak (dBTP) of a file, measured with ebur128. */
export function loudness(file: string): { lufs: number; peak: number } {
  const r = Bun.spawnSync(['ffmpeg', '-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { stderr: 'pipe' });
  const tail = r.stderr.toString().split('Summary:').pop() ?? '';
  return { lufs: Number(tail.match(/I:\s+(-?[\d.]+) LUFS/)?.[1] ?? NaN), peak: Number(tail.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1] ?? NaN) };
}

/** Two-pass loudnorm to `I` LUFS with true peak `tp`, into a 48 kHz WAV. */
export function normalise(input: string, output: string, I: number, tp: number, lra = 11) {
  const r = Bun.spawnSync(['ffmpeg', '-hide_banner', '-i', input, '-af', `loudnorm=I=${I}:TP=${tp}:LRA=${lra}:print_format=json`, '-f', 'null', '-'], { stderr: 'pipe' });
  const e = r.stderr.toString();
  const m = JSON.parse(e.slice(e.lastIndexOf('{'), e.lastIndexOf('}') + 1));
  ffmpeg(['-i', input, '-af', `loudnorm=I=${I}:TP=${tp}:LRA=${lra}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`, '-ar', '48000', output]);
}

/**
 * How many seconds `x` lags `ref` (a filter chain's latency: the denoiser delays the voice by about 25 ms, measured
 * 2026-10-19), by direct correlation of a few windows at 2 kHz over 0..120 ms. Median of the windows.
 */
export function lagOf(ref: string, x: string, dur: number): number {
  const R = 2000, len = 3, found: number[] = [];
  for (const f of [0.2, 0.45, 0.7]) {
    const at = Math.max(0, dur * f - len / 2);
    const a = samples(ref, R, at, len), b = samples(x, R, at, len + 0.15);
    let best = -Infinity, off = 0, energy = 0;
    for (const y of a) energy += y * y;
    if (energy < 1e-4) continue; // a silent window says nothing
    for (let d = 0; d <= 0.12 * R; d++) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * (b[i + d] ?? 0); if (s > best) { best = s; off = d; } }
    found.push(off / R);
  }
  found.sort((p, q) => p - q);
  return found[Math.floor(found.length / 2)] ?? 0;
}

/** `input` cleaned for speech (high-pass, light denoise, gentle compression) with the chain's own delay taken out. */
export function cleanVoice(input: string, output: string, dur: number) {
  const tmp = output.replace(/\.wav$/, '.lag.wav');
  ffmpeg(['-i', input, '-af', 'highpass=f=75,afftdn=nr=8:nf=-35,acompressor=threshold=0.125:ratio=2.5:attack=12:release=180:makeup=1.5', '-ar', '48000', tmp]);
  const lag = lagOf(input, tmp, dur);
  ffmpeg(['-i', tmp, '-af', `atrim=start=${lag.toFixed(4)},asetpts=PTS-STARTPTS,apad=whole_dur=${dur},atrim=0:${dur}`, '-ar', '48000', output]);
  return lag;
}

/**
 * His voice as his mic recorded it, only louder (2026-10-21). Josef's CapCut projects never process the voice: no
 * noise reduction, no loudness tool, only the clip's volume raised (about +10 dB on his Lepanto reel), and his
 * published reels land at -14 LUFS with a loudness range of about 4 LU. cleanVoice and a dynamic loudnorm on a voice
 * with 26 dB between its average and its peaks squeezed it to 2.4 LU and he heard "a different mic". So: one fixed
 * gain to `I` LUFS and a fast look-ahead limiter at `peakDb` that touches only the loudest peaks; checked after, and
 * corrected once if the limiter cost more than a tenth of a LU. Returns the LUFS and the loudness range it lands on.
 */
export function naturalLevel(input: string, output: string, I: number, peakDb: number): { lufs: number; lra: number } {
  const measure = (f: string) => {
    const r = Bun.spawnSync(['ffmpeg', '-hide_banner', '-nostats', '-i', f, '-af', 'ebur128', '-f', 'null', '-'], { stderr: 'pipe' });
    const t = r.stderr.toString().split('Summary:').pop() ?? '';
    return { lufs: Number(t.match(/I:\s+(-?[\d.]+) LUFS/)?.[1] ?? NaN), lra: Number(t.match(/LRA:\s+(-?[\d.]+) LU/)?.[1] ?? NaN) };
  };
  const limit = Math.pow(10, peakDb / 20).toFixed(4);
  let gain = I - measure(input).lufs;
  for (let k = 0; k < 2; k++) {
    // a slow limiter: of the settings tried on his voice (2026-10-21) it changed the tone least at every loudness
    ffmpeg(['-i', input, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=${limit}:attack=10:release=200:level=0`, '-ar', '48000', output]);
    const got = measure(output);
    if (Math.abs(got.lufs - I) <= 0.1 || k === 1) return got;
    gain += I - got.lufs;
  }
  return measure(output);
}

/** The OS keys this machine uses: its own `.env` (only the keys it needs, from Josef: Luca's Mac, 2026-10-25), else
 * the OS repo's .env.local beside it (Josef's Mac). Keys stay in memory; nothing is printed or written. */
export const MACHINE_ENV = path.join(MACHINE_ROOT, '.env');
export function osEnv(): Record<string, string> {
  const file = existsSync(MACHINE_ENV) ? MACHINE_ENV : path.join(OS_DIR, '.env.local');
  if (!existsSync(file)) throw new Error(`no OS keys on this Mac: put the machine's .env (from Josef) at ${MACHINE_ENV}`);
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
}
/** The OS database, through Bun's own Postgres client (2026-10-25: no OS repo needed; before, the OS's postgres
 * package). JSON goes in as text cast to jsonb, a text array through sql.array(xs, 'text'), a list through sql(xs). */
export async function osDb() {
  const env = osEnv();
  const { SQL } = await import('bun');
  return new SQL(env.DIRECT_URL ?? env.DATABASE_URL, { max: 1, prepare: false } as never);
}
