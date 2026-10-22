#!/usr/bin/env bun
// Checks that can fail, on a finished reel (2026-10-21), before Josef sees it. This step re-transcribes the reel's
// voice with the core, the way prepare.ts transcribes a take, and keeps its level every 10 ms; check.py then lines the
// words up against the script and measures every cut point. Exit code 1 when a check fails.
// run.ts runs it after render: a reel that fails gets no CapCut project and does not go to the OS.
//   bun check.ts <brand> <batch> [reel n]
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { batch, ensure, ffmpeg, log, probe, readJson, writeJson } from './lib';
import { levels10ms, transcribeTake } from './core/speech';

const x = batch(process.argv[2] ?? '', process.argv[3] ?? '');
const only = process.argv[4];
const reels = readJson<{ n: number; pieces: unknown[] }[]>(path.join(x.work, 'reels.json')).filter((r) => r.pieces.length && (!only || String(r.n) === only));
const chk = path.join(x.work, 'check');
ensure(chk);
const names = readJson<{ names: string[] }>(path.join(x.work, 'scripts.json')).names.join(', ');
let failed = 0;
for (const { n } of reels) {
  const voice = path.join(x.work, `reel-${n}`, 'voice.wav');
  const base = path.join(chk, `reel-${n}`);
  ffmpeg(['-i', voice, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', `${base}.16k.wav`]);
  const words = transcribeTake(base, 'R', probe(voice).duration, { lang: x.brand.lang as 'it' | 'en', names, again: true });
  writeJson(`${base}.check.json`, { words: words.filter((w) => !w.ghost).map((w) => ({ w: w.w, start: w.start, end: w.end, filler: !!w.filler })) });
  writeFileSync(`${base}.levels.json`, JSON.stringify(Array.from(levels10ms(`${base}.16k.wav`), (v) => Math.round(v * 10) / 10)));
  const r = Bun.spawnSync(['python3', '-I', path.join(import.meta.dir, 'check.py'), x.dir, String(n), String(x.brand.speed)], { stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) failed++;
}
if (failed) { log(x, `check: ${failed} of ${reels.length} reel(s) failed, not sent on`); process.exit(1); }
log(x, `check: ${reels.length} reel(s) passed`);
