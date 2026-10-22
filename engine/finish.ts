#!/usr/bin/env bun
// The last pass of a reel (2026-10-22): the brand's music under the finished picture, levelled to where his published
// reels sit, written as outputs/<slug>.final.mp4, the one file publish.ts sends on. The picture is the newest the
// editor produced for the job (its sound effects mix, else its graphics assemble), or the base cut when the brand has
// no preset yet. A job the editor already finished with its own music bed is left as it is.
//   bun finish.ts <brand> <session> [reel numbers]
import path from 'node:path';
import { batch, ensure, ffmpeg, has, job, log, loudness, naturalLevel, probe, readJson, setState } from './lib';
import { musicFor } from './music';

const x = batch(process.argv[2] ?? '', process.argv[3] ?? '');
const only = process.argv.slice(4).filter((a) => /^\d+$/.test(a)).map(Number);
type Reel = { n: number; title: string; pieces: unknown[] };
const reels = readJson<Reel[]>(path.join(x.work, 'reels.json')).filter((r) => r.pieces.length && (!only.length || only.includes(r.n)));

for (const r of reels) {
  const j = job(x, r.title);
  const own = j.p('outputs', `${j.name}-music.mp4`);
  if (has(own)) { console.log(`reel ${r.n}: the editor laid its own music bed (${path.basename(own)}): kept as the final`); Bun.write(j.final, Bun.file(own)); continue; }
  const picture = [j.p('outputs', `${j.name}-final.mp4`), j.p('hf-graphics', 'renders', 'final.mp4'), j.base].find(has);
  if (!picture) { console.warn(`reel ${r.n}: no base cut yet (cut.ts)`); continue; }
  const dir = path.join(x.work, `reel-${r.n}`);
  ensure(dir);
  const dur = probe(picture).duration;
  const m = musicFor(x, r.n);
  const mix = path.join(dir, 'mix.wav');
  if (m) {
    console.log(`reel ${r.n}: music ${path.basename(m.file)} (${m.gainDb > 0 ? '+' : ''}${m.gainDb} dB) under ${path.basename(picture)}`);
    const music = path.join(dir, 'music.wav');
    ffmpeg(['-stream_loop', '-1', '-i', m.file, '-af', `aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${dur},afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, dur - 1.5)}:d=1.5,volume=${m.gainDb}dB`, '-t', String(dur), music]);
    ffmpeg(['-i', picture, '-i', music, '-filter_complex', `[0:a]aformat=sample_rates=48000:channel_layouts=stereo[v];[v][1:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=0[a]`, '-map', '[a]', '-ar', '48000', path.join(dir, 'mix-raw.wav')]);
  } else {
    console.log(`reel ${r.n}: no music (the pool is empty)`);
    ffmpeg(['-i', picture, '-vn', '-ac', '2', '-ar', '48000', path.join(dir, 'mix-raw.wav')]);
  }
  naturalLevel(path.join(dir, 'mix-raw.wav'), mix, -14.5, -1.5); // where his published reels sit
  ffmpeg(['-i', picture, '-i', mix, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', dur.toFixed(3), '-movflags', '+faststart', j.final]);
  const lu = loudness(mix);
  console.log(`reel ${r.n}: ${j.final}\n  ${dur.toFixed(1)} s, ${lu.lufs} LUFS, peak ${lu.peak} dB`);
  log(x, `finish reel ${r.n}: ${path.basename(picture)} + ${m ? path.basename(m.file) : 'no music'}, ${lu.lufs} LUFS`);
}
setState(x, { phase: 'finished' });
