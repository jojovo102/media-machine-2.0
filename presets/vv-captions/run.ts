#!/usr/bin/env bun
// VolpinVeritas' look after the cut (2026-10-22): its approved captions (2026-10-21, "Contro l'AI nei video": "This
// is very good, good job"): three words at a time in EB Garamond, cream, the word being said in the logo's red,
// at 52 % of the height, drawn by Chrome over the base cut. No drawn cards, no grade. Paintings and real pictures
// as b-roll come next, each with Josef's OK. Writes outputs/<slug>-final.mp4, which finish.ts puts the music under.
//   bun presets/vv-captions/run.ts <brand> <session> [reel numbers]
import path from 'node:path';
import { batch, ensure, ffmpeg, has, job, log, probe, readJson } from '../../engine/lib';
import { captionTrack, type CaptionLook } from '../../engine/core/captions';

const x = batch(process.argv[2] ?? '', process.argv[3] ?? '');
const only = process.argv.slice(4).filter((a) => /^\d+$/.test(a)).map(Number);
type B = { captionLook: Omit<CaptionLook, 'fontFace'>; captionFixes?: [string, string][]; captionY?: number; captionSize?: number; assets: string; theme: { fonts?: [string, string, string, string][] } };
const b = x.brand as unknown as B;
const FPS = 30;
const fontFace = (b.theme.fonts ?? []).map(([family, file, weight, style]) => `@font-face { font-family: '${family}'; src: url("file://${path.join(b.assets, 'fonts', file)}") format('woff2'); font-weight: ${weight}; font-style: ${style}; }`).join('\n');
const reels = readJson<{ n: number; title: string; pieces: unknown[] }[]>(path.join(x.work, 'reels.json')).filter((r) => r.pieces.length && (!only.length || only.includes(r.n)));
for (const r of reels) {
  const j = job(x, r.title);
  const tr = j.p('outputs', `${j.name}.transcript.json`);
  if (!has(j.base) || !has(tr)) { console.warn(`reel ${r.n}: no base cut yet (cut.ts)`); continue; }
  const words = readJson<{ words: { text: string; start: number; end: number }[] }>(tr).words.map((w) => ({ w: w.text, at: w.start, end: w.end }));
  for (const [from, to] of b.captionFixes ?? []) {
    const want = from.split(/\s+/);
    for (let i = 0; i + want.length <= words.length; i++) if (want.every((wd, q) => words[i + q]!.w === wd)) { words[i]!.w = to; words[i]!.end = words[i + want.length - 1]!.end; words.splice(i + 1, want.length - 1); }
  }
  const dur = probe(j.base).duration, dir = j.p('captions');
  ensure(dir);
  const list = await captionTrack(words, dur, { w: 1080, h: 1920, y: b.captionY ?? 0.52, size: b.captionSize ?? 80, style: 'brand3', dir, fps: FPS, look: { ...b.captionLook, fontFace } });
  const out = j.p('outputs', `${j.name}-final.mp4`);
  ffmpeg(['-i', j.base, '-f', 'concat', '-safe', '0', '-i', list, '-filter_complex', `[1:v]fps=${FPS},format=rgba[c];[0:v][c]overlay=0:0:eof_action=pass,format=yuv420p[v]`, '-map', '[v]', '-map', '0:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'copy', '-t', dur.toFixed(3), '-movflags', '+faststart', out]);
  console.log(`reel ${r.n}: captions on ${j.name} (${words.length} words) -> ${path.basename(out)}`);
  log(x, `vv-captions reel ${r.n}: ${words.length} words captioned`);
}
