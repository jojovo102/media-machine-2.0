#!/usr/bin/env bun
// Step 3: the rough cut of every reel, as a job the editor can dress (2026-10-22). From work/reels.json (match.ts):
// the pieces cut from the takes and joined, at the brand's speed (pitch kept), in the brand's frame, his voice as his
// mic recorded it, only made louder (or cleaned when the brand says "voice": "clean"), no music, no graphics yet.
// Each reel becomes <session>/<slug>/ in the editor's layout (vendor video-editor, CLAUDE.md § Folder Structure):
//   raw/<take>                       the take in normal colour (the editor refuses HDR), linked, never changed
//   transcript/words.json            every word of the take, the editor's shape ({clips: [{clip, path, duration, words}]})
//   transcript/cuts.json             the cut ({segments: [{clip, start, end}]}, on the take's clock)
//   outputs/<slug>.mp4               the base cut (picture + his voice)
//   outputs/<slug>.transcript.json   the words on the cut's clock, spelled as the script spells them (captext.ts)
//   RUN.md                           the job's state, as the editor keeps it
// work/reel-<n>/voice.wav is the levelled voice check.ts listens to.
//   bun cut.ts <brand> <session> [reel numbers]
import path from 'node:path';
import { existsSync, linkSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { batch, cleanVoice, ensure, ffmpeg, has, job, log, loudness, naturalLevel, probe, readJson, setState, writeJson } from './lib';
import { mergeHearings, scriptSpelling } from './captext';
import { levels10ms } from './core/speech';

const x = batch(process.argv[2] ?? '', process.argv[3] ?? '');
const only = process.argv.slice(4).filter((a) => /^\d+$/.test(a)).map(Number);
const B = x.brand, SPEED = B.speed, FPS = 30, W = B.frame.w, H = B.frame.h;
type Reel = { n: number; postId: string | null; title: string; caption: string; pieces: { take: string; file: string; a: number; b: number; sentence: number }[]; words: { w: string; take: string; start: number; end: number }[]; duration: number };
const reels = readJson<Reel[]>(path.join(x.work, 'reels.json')).filter((r) => !only.length || only.includes(r.n));
const media = readJson<{ takes: { n: string; file: string; raw: string; duration: number }[] }>(path.join(x.work, 'media.json'));
const whole = readJson<{ w: string; take: string; start: number; end: number; ghost?: boolean; filler?: boolean }[]>(path.join(x.work, 'words.json'));
const scripts = has(path.join(x.work, 'scripts.json')) ? readJson<{ scripts: { sentences: { text: string }[] }[] }>(path.join(x.work, 'scripts.json')).scripts : [];

// his voice as recorded (Josef, 2026-10-21: the cleaned voice "sounds different from my professional mic")
const CLEAN = B.voice === 'clean';
const voiceOf = (take: string) => path.join(x.work, 'takes', `${take}.${CLEAN ? 'clean' : 'voice'}.wav`);
if (CLEAN) for (const t of media.takes) {
  const clean = path.join(x.work, 'takes', `${t.n}.clean.wav`);
  if (!has(clean)) cleanVoice(path.join(x.work, 'takes', `${t.n}.voice.wav`), clean, t.duration);
}
const takeOf = (n: string) => { const t = media.takes.find((t) => t.n === n); if (!t) throw new Error(`no take ${n}`); return t; };
const clipOf = (n: string) => path.basename(takeOf(n).file);

/** The words on the cut's clock: the better of two hearings per piece, spelled as the script spells them. */
function cutWords(r: Reel, scriptText: string) {
  const timed: { w: string; at: number; end: number }[] = [];
  let off = 0;
  for (const p of r.pieces) {
    const inPiece = <T extends { take: string; start: number; end: number }>(w: T) => w.take === p.take && w.end > p.a + 0.03 && w.start < p.b;
    const heard = mergeHearings(r.words.filter(inPiece), whole.filter((w) => !w.ghost && !w.filler).filter(inPiece).map((w) => ({ w: w.w, take: w.take, start: w.start, end: w.end })), scriptText, p);
    for (const w of heard) timed.push({ w: w.w, at: (off + Math.max(w.start, p.a) - p.a) / SPEED, end: (off + Math.min(w.end, p.b) - p.a) / SPEED });
    off += p.b - p.a;
  }
  const sp = scriptText ? scriptSpelling(timed, scriptText) : { words: timed, changes: [] as string[] };
  // what the transcriber got wrong, put right for the screen: the session's own fixes.txt ("gli A => l'IA")
  const fixes = has(x.p('fixes.txt')) ? readFileSync(x.p('fixes.txt'), 'utf8').split('\n').map((l) => l.split('=>').map((s) => s.trim())).filter((f): f is [string, string] => f.length === 2 && !!f[0]) : [];
  const out = sp.words;
  for (const [from, to] of fixes) {
    const want = from.split(/\s+/);
    for (let i = 0; i + want.length <= out.length; i++) if (want.every((wd, q) => out[i + q]!.w === wd)) { out[i]!.w = to; out[i]!.end = out[i + want.length - 1]!.end; out.splice(i + 1, want.length - 1); }
  }
  return { words: out, changes: sp.changes };
}

// <session>/remove.txt: words he wants out of the reel, one phrase a line ("senza sapere", Josef 2026-10-22: he says it
// and right after "senza la garanzia"). The phrase is found among the reel's words and cut out of its piece at the
// quietest 10 ms around its edges (a piece's end or start moves; a phrase inside a piece splits it in two).
const removals = has(x.p('remove.txt')) ? readFileSync(x.p('remove.txt'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : [];
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9']/g, '');
const levels = new Map<string, Float32Array>();
const quietest = (take: string, from: number, to: number) => {
  if (!levels.has(take)) levels.set(take, levels10ms(path.join(x.work, 'takes', `${take}.16k.wav`)));
  const db = levels.get(take)!; let best = Math.round(from * 100);
  for (let i = Math.round(from * 100); i <= Math.round(to * 100); i++) if (db[i]! < db[best]!) best = i;
  return best / 100;
};
function removePhrases(r: Reel) {
  for (const phrase of removals) {
    const want = phrase.split(/\s+/).map(norm).filter(Boolean);
    const ws = r.words;
    for (let i = 0; i + want.length <= ws.length; i++) {
      if (!want.every((q, k) => norm(ws[i + k]!.w) === q)) continue;
      const first = ws[i]!, last = ws[i + want.length - 1]!;
      const k = r.pieces.findIndex((p) => p.take === first.take && first.start >= p.a - 0.05 && first.start < p.b);
      if (k < 0) continue;
      const p = r.pieces[k]!;
      const cutIn = quietest(p.take, first.start - 0.12, first.start + 0.06), cutOut = quietest(p.take, last.end - 0.06, last.end + 0.12);
      const before = cutIn - p.a, after = p.b - cutOut;
      if (before < 0.3 && after < 0.3) r.pieces.splice(k, 1);
      else if (before < 0.3) p.a = cutOut;
      else if (after < 0.3) p.b = cutIn;
      else r.pieces.splice(k, 1, { ...p, b: cutIn }, { ...p, a: cutOut });
      r.words = ws.filter((_, j) => j < i || j >= i + want.length);
      console.log(`reel ${r.n}: "${phrase}" removed (${cutIn.toFixed(2)}-${cutOut.toFixed(2)} s of take ${p.take})`);
      break;
    }
  }
}

for (const r of reels) {
  if (!r.pieces.length) { console.warn(`reel ${r.n}: nothing to cut (no sentence found)`); continue; }
  removePhrases(r);
  // every piece a whole number of frames, so the cuts of the base land where the sum of the pieces says they do: the
  // editor's layout and flash scan count frames from transcript/cuts.json, and a piece of 4.83 s gave 145 frames
  // (the flash scan found a one-frame sliver at every switch, 2026-10-22)
  for (const p of r.pieces) p.b = +(p.a + Math.round((p.b - p.a) * FPS) / FPS).toFixed(4);
  const j = job(x, r.title);
  const dir = path.join(x.work, `reel-${r.n}`);
  ensure(dir, j.raw, j.transcript, j.outputs);
  const t0 = Date.now();
  // ---- his takes, linked into the job (the editor's tools read raw/ for stills; the bytes are the originals')
  const takes = [...new Set(r.pieces.map((p) => p.take))].map(takeOf);
  for (const t of takes) {
    const dst = path.join(j.raw, path.basename(t.file));
    if (existsSync(dst)) continue;
    try { linkSync(t.file, dst); } catch { copyFileSync(t.file, dst); }
  }
  // ---- picture and voice, piece by piece, in one filter graph: hard cuts at his voice (as he cuts), 8 and 12 ms fades
  const ins: string[] = [];
  let fc = '';
  const src = probe(r.pieces[0]!.file).video!;
  // the picture is cut to the piece's exact frame count inside the graph (trim=end_frame): an input -t let a piece
  // carry one frame too many and the base ran a frame late from there (the flash scan, 2026-10-22)
  r.pieces.forEach((p, i) => {
    const d = p.b - p.a;
    ins.push('-ss', p.a.toFixed(4), '-t', (d + 0.1).toFixed(4), '-i', p.file);
    fc += `[${i}:v]scale=w=${W}:h=${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}:'max(0,min(iw-${W},iw*0.5-${W / 2}))':'max(0,min(ih-${H},ih*0.42-${H / 2}))',setsar=1,fps=${FPS},trim=end_frame=${Math.round(d * FPS)},setpts=(PTS-STARTPTS)/${SPEED}[v${i}];`;
  });
  r.pieces.forEach((p, i) => {
    const d = p.b - p.a;
    ins.push('-ss', p.a.toFixed(4), '-t', d.toFixed(6), '-i', voiceOf(p.take));
    fc += `[${r.pieces.length + i}:a]aformat=sample_rates=48000:channel_layouts=mono,afade=t=in:d=0.008,afade=t=out:st=${(d - 0.012).toFixed(4)}:d=0.012${SPEED !== 1 ? `,atempo=${SPEED}` : ''}[a${i}];`;
  });
  const n = r.pieces.length;
  fc += `${r.pieces.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${n}:v=1:a=1[vc][ac]`;
  const cut = path.join(dir, 'cut.mp4');
  ffmpeg([...ins, '-filter_complex', fc, '-map', '[vc]', '-map', '[ac]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'pcm_s16le', cut]);
  const dur = probe(cut).duration;
  // ---- his voice, one gain and a slow limiter to his published level; the base cut carries it (the editor's own
  // audio chain is not run: Josef 2026-10-21, his voice as his mic recorded it)
  const voice = path.join(dir, 'voice.wav');
  ffmpeg(['-i', cut, '-vn', '-ac', '1', '-ar', '48000', path.join(dir, 'voice-raw.wav')]);
  naturalLevel(path.join(dir, 'voice-raw.wav'), voice, -15, -2);
  ffmpeg(['-i', cut, '-i', voice, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', '-t', dur.toFixed(3), j.base]);
  // ---- the editor's files
  writeJson(path.join(j.transcript, 'words.json'), {
    clips: takes.map((t) => ({
      clip: path.basename(t.file), path: path.join(j.raw, path.basename(t.file)), duration: t.duration,
      words: whole.filter((w) => w.take === t.n && !w.ghost).map((w) => ({ w: w.w, start: w.start, end: w.end, prob: 1 })),
    })),
  });
  writeJson(path.join(j.transcript, 'cuts.json'), { segments: r.pieces.map((p) => ({ clip: clipOf(p.take), start: p.a, end: p.b })) });
  const sc = scripts[r.n - 1];
  const { words, changes } = cutWords(r, sc ? sc.sentences.map((s) => s.text).join(' ') : '');
  writeJson(path.join(j.outputs, `${j.name}.transcript.json`), { language_code: B.lang, words: words.map((w) => ({ text: w.w, start: +w.at.toFixed(3), end: +w.end.toFixed(3), type: 'word' })) });
  if (changes.length) console.log(`reel ${r.n}: words from the script: ${changes.join(', ')}`);
  if (!has(j.p('RUN.md'))) writeFileSync(j.p('RUN.md'), `# RUN: ${r.title}\n\nBrand: ${B.name} (${B.key}) · session ${x.name} · reel ${r.n}\nFormat: 9:16 ${W}x${H}, ${SPEED}x · lane: chat-only · preset: ${B.preset ?? 'none'}\n\n| Step | Status |\n|---|---|\n| 1 intake | done: raw/ linked to the session's take |\n| 2 rough cut | done by the engine (match.ts + cut.ts): transcript/cuts.json, outputs/${j.name}.mp4 |\n| 3 audio | done in the base: his voice as recorded, one gain to -15 LUFS |\n| 4 grade | skipped: no colour change (Josef 2026-10-21) |\n| 5 graphics | ${B.preset ? 'pending' : 'skipped: the brand has no preset yet'} |\n| 6 sfx | ${B.preset ? 'pending' : 'skipped'} |\n| 7 review | in the OS, status review |\n| 8 export | finish.ts then publish.ts |\n`);
  const lu = loudness(voice);
  console.log(`reel ${r.n}: ${j.base}\n  ${dur.toFixed(1)} s, ${n} cuts, ${src.w}x${src.h} -> ${W}x${H}, ${SPEED}x, voice ${lu.lufs} LUFS, peak ${lu.peak} dB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  log(x, `cut reel ${r.n} "${r.title}": ${j.name}/, ${dur.toFixed(1)} s, ${n} cuts, voice ${lu.lufs} LUFS`);
}
setState(x, { phase: 'cut' });
