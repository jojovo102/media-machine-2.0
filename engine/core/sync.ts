// Lining up a separate microphone recording with a camera take (2026-10-19, shared core): sound envelopes at 100 Hz
// cross-correlated by FFT for the rough offset, then direct correlation at 1 kHz around it. Tested on a synthetic
// take: a mic started 2.345 s early was found to the millisecond.
import path from 'node:path';
import { ffmpeg, samples, type Probe } from './media';

const ENV = 100;
function envelope(x: Float32Array, rate: number) {
  const hop = Math.round(rate / ENV), n = Math.floor(x.length / hop), e = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < hop; j++) { const y = x[i * hop + j]!; s += y * y; } e[i] = Math.sqrt(s / hop); }
  let m = 0; for (const y of e) m += y; m /= n || 1;
  for (let i = 0; i < n; i++) e[i] = e[i]! - m;
  return e;
}
function fft(re: Float64Array, im: Float64Array, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2, xr = re[b]! * cr - im[b]! * ci, xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr; im[b] = im[a]! - xi; re[a] = re[a]! + xr; im[a] = im[a]! + xi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] = re[i]! / n; im[i] = im[i]! / n; }
}
/** Where `cam` starts inside `mic` (seconds), and how sure: the correlation peak over the mean. */
function lag(cam: Float32Array, mic: Float32Array): { at: number; score: number } {
  let n = 1; while (n < cam.length + mic.length) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  mic.forEach((x, i) => (ar[i] = x)); cam.forEach((x, i) => (br[i] = x));
  fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) { const r = ar[i]! * br[i]! + ai[i]! * bi[i]!, m = ai[i]! * br[i]! - ar[i]! * bi[i]!; ar[i] = r; ai[i] = m; }
  fft(ar, ai, true);
  let best = -Infinity, k = 0;
  for (let i = 0; i < n; i++) if (ar[i]! > best) { best = ar[i]!; k = i; }
  const lagFrames = k > n / 2 ? k - n : k;
  let mean = 0; for (let i = 0; i < n; i++) mean += Math.abs(ar[i]!); mean /= n;
  return { at: lagFrames / ENV, score: best / (mean || 1) };
}
function refine(camFile: string, micFile: string, coarse: number, camDur: number): number {
  const R = 1000, mid = camDur >= 45 ? 20 : camDur / 3, len = camDur >= 45 ? 20 : camDur / 3;
  const a = samples(camFile, R, mid, len), b = samples(micFile, R, Math.max(0, mid + coarse - 0.1), len + 0.2);
  const base = Math.round((mid + coarse - Math.max(0, mid + coarse - 0.1)) * R);
  let best = -Infinity, off = 0;
  for (let d = -60; d <= 60; d++) {
    let s = 0;
    for (let i = 0; i < a.length; i += 2) { const j = i + base + d; if (j >= 0 && j < b.length) s += a[i]! * b[j]!; }
    if (s > best) { best = s; off = d; }
  }
  return coarse + off / R;
}

export type Sound = { file: string; offset: number; from: 'mic' | 'camera'; score?: number };
const envCache = new Map<string, Float32Array>();
/** Where a take's sound comes from: the separate mic recording that lines up with it, else the camera's own. */
export function soundFor(cam: Probe, mics: Probe[]): Sound {
  if (mics.length && cam.audio) {
    const ce = envelope(samples(cam.file, 8000), 8000);
    const found = mics.map((m) => {
      if (!envCache.has(m.file)) envCache.set(m.file, envelope(samples(m.file, 8000), 8000));
      return { m, ...lag(ce, envCache.get(m.file)!) };
    }).sort((x, y) => y.score - x.score)[0]!;
    // a lag that would put the take outside the mic recording means this mic did not record it
    if (found.score > 8 && found.at > -1 && found.at + cam.duration < found.m.duration + 1) {
      return { file: found.m.file, offset: refine(cam.file, found.m.file, found.at, cam.duration), from: 'mic', score: Math.round(found.score) };
    }
    console.warn(`${path.basename(cam.file)}: no separate mic recording lines up (best score ${found.score.toFixed(1)}); using the camera's sound`);
  }
  if (!cam.audio) throw new Error(`${path.basename(cam.file)} has no sound and no mic recording lines up`);
  return { file: cam.file, offset: 0, from: 'camera' };
}

/** The take's sound on its own clock: `<base>.voice.wav` (48 kHz mono) and `<base>.16k.wav` for the transcription. */
export function takeSound(cam: Probe, s: Sound, base: string) {
  const pre = ['-ss', String(Math.max(0, s.offset)), '-i', s.file, '-t', String(cam.duration)];
  const pad = s.offset < 0 ? `adelay=${Math.round(-s.offset * 1000)}:all=1,` : '';
  ffmpeg([...pre, '-vn', '-af', `${pad}aformat=channel_layouts=mono,apad=whole_dur=${cam.duration},atrim=0:${cam.duration}`, '-ar', '48000', '-c:a', 'pcm_s16le', `${base}.voice.wav`]);
  ffmpeg(['-i', `${base}.voice.wav`, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', `${base}.16k.wav`]);
}
