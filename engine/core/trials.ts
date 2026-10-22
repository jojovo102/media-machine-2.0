// Trial reel versions of a finished reel (2026-10-21), the ten presets of the Video Editor + Trial Reels pack Josef
// bought (trial-reels/tools/make_trials.py, ported): each version differs in speed and fill together (faster or
// slower always with a bigger fill, so nothing looks stretched), a start trimmed by up to a quarter of a second, a slight
// colour shift, its encode quality, and fresh file metadata (new creation time and comment, the original's stripped).
// The voice keeps its pitch and the reel's own sound (not levelled again: that squeezed his voice, 2026-10-21). Josef, 2026-10-21: "it's good what's
// already there, with speed variation etc".
import { ffmpeg, probe } from './media';

export interface TrialPreset { speed: number; zoom: number; trim: number; brightness: number; contrast: number; saturation: number; crf: number }

// preset 1 of the pack is the original itself (1.00x, 100%): not a version, so the list starts at its preset 2
export const TRIAL_PRESETS: TrialPreset[] = [
  { speed: 1.10, zoom: 1.05, trim: 0.10, brightness: 0.01, contrast: 1.00, saturation: 1.00, crf: 22 },
  { speed: 0.90, zoom: 1.10, trim: 0.00, brightness: 0.00, contrast: 1.00, saturation: 1.04, crf: 21 },
  { speed: 1.05, zoom: 1.03, trim: 0.20, brightness: 0.00, contrast: 1.03, saturation: 1.00, crf: 23 },
  { speed: 0.95, zoom: 1.08, trim: 0.10, brightness: -0.01, contrast: 1.00, saturation: 0.97, crf: 22 },
  { speed: 1.08, zoom: 1.12, trim: 0.15, brightness: 0.00, contrast: 0.98, saturation: 1.05, crf: 23 },
  { speed: 0.92, zoom: 1.06, trim: 0.05, brightness: 0.01, contrast: 1.02, saturation: 1.00, crf: 21 },
  { speed: 1.12, zoom: 1.09, trim: 0.25, brightness: -0.01, contrast: 1.00, saturation: 1.03, crf: 22 },
  { speed: 0.97, zoom: 1.04, trim: 0.15, brightness: 0.00, contrast: 1.01, saturation: 0.98, crf: 23 },
  { speed: 1.03, zoom: 1.11, trim: 0.05, brightness: 0.01, contrast: 0.99, saturation: 1.02, crf: 21 },
];

const randomTime = () => new Date(Date.now() - (5 + Math.floor(Math.random() * 595)) * 60_000 - Math.floor(Math.random() * 60_000)).toISOString().replace(/\.\d{3}Z$/, '.000000Z');
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Version `n` (1 = the first preset) of `src` into `out`, at the source's frame size; returns its length in seconds. */
export function trialVersion(src: string, out: string, n: number): number {
  const p = TRIAL_PRESETS[(n - 1) % TRIAL_PRESETS.length]!;
  const info = probe(src), W = info.video!.w, H = info.video!.h;
  const zw = Math.round((W * p.zoom) / 2) * 2, zh = Math.round((H * p.zoom) / 2) * 2;
  const vf = `scale=${zw}:${zh}:flags=lanczos,crop=${W}:${H},eq=brightness=${p.brightness}:contrast=${p.contrast}:saturation=${p.saturation},setpts=PTS/${p.speed},fps=30,format=yuv420p`;
  ffmpeg(['-ss', p.trim.toFixed(2), '-i', src, '-map', '0:v:0', '-map', '0:a:0', '-vf', vf,
    // the reel's sound as it is (his voice as recorded, already at its level): only the tempo, pitch kept
    '-af', `atempo=${p.speed},alimiter=limit=0.84:attack=10:release=200:level=0`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(p.crf), '-maxrate', '8M', '-bufsize', '16M', '-profile:v', 'high',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', ['160k', '192k', '176k'][n % 3]!, '-ar', '48000', '-movflags', '+faststart',
    '-map_metadata', '-1', '-metadata', `creation_time=${randomTime()}`, '-metadata', `comment=${token()}`, out]);
  return probe(out).duration;
}
