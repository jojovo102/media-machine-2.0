#!/usr/bin/env bun
// Step 1: a batch's takes and every word in them (2026-10-19).
//   <batch>/raw/*.mov|mp4   his takes (phone, vertical; one long take per reel, or several, or one for all)
//   <batch>/raw/*.wav|m4a   a separate mic recording, if the mic did not go into the phone (lined up by the core)
// Run scripts.ts first: the scripts' names prime the transcription. Writes work/media.json, work/takes/<n>.voice.wav (48 kHz, the take's own clock), work/words.json (fillers marked), work/bits.json.
//   bun prepare.ts <brand> <batch> [--again]
import path from 'node:path';
import { AUDIO_EXT, VIDEO_EXT, batch, ensure, flag, has, log, mediaIn, probe, readJson, setState, writeJson } from './lib';
import { soundFor, takeSound } from './core/sync';
import { picture } from './core/colour';
import { nameFixer, transcribeTake, type Bit, type Word } from './core/speech';

const x = batch(process.argv[2] ?? '', process.argv[3] ?? '');
const takesDir = path.join(x.work, 'takes');
ensure(x.work, takesDir);

const cams = mediaIn(x.raw, VIDEO_EXT).map(probe).filter((p) => p.video && p.duration > 1).sort((a, b) => a.created - b.created || a.file.localeCompare(b.file));
if (!cams.length) throw new Error(`no takes in ${x.raw}`);
const mics = [...mediaIn(x.raw, AUDIO_EXT), ...mediaIn(path.join(x.raw, 'audio'), AUDIO_EXT)].map(probe).filter((p) => p.audio && p.duration > 1);
const fix = nameFixer(x.brand.nameFixes.map(([re, to]) => [new RegExp(re, 'i'), to] as [RegExp, string]));

const takes = cams.map((cam, i) => {
  const n = String(i + 1).padStart(2, '0');
  const sound = soundFor(cam, mics);
  takeSound(cam, sound, path.join(takesDir, n));
  console.log(`take ${n}: ${path.basename(cam.file)} ${cam.video!.w}x${cam.video!.h} ${cam.video!.fps.toFixed(2)} fps ${cam.duration.toFixed(1)} s, sound from the ${sound.from}`);
  // the picture in normal colour (an iPhone HDR take is converted once); the sound above came from the raw take
  const file = picture(cam.file, path.join(x.work, 'pictures'));
  return { n, file, raw: cam.file, duration: cam.duration, w: cam.video!.w, h: cam.video!.h, fps: cam.video!.fps, sound };
});
writeJson(path.join(x.work, 'media.json'), { takes, mics: mics.map((m) => m.file) });

// the brand's names, and the names in this batch's scripts (Lepanto, Pio V...), prime the transcription
const scriptNames = has(path.join(x.work, 'scripts.json')) ? readJson<{ names: string[] }>(path.join(x.work, 'scripts.json')).names : [];
const names = [x.brand.names, scriptNames.join(', ')].filter(Boolean).join(' ');
const words: Word[] = [];
for (const t of takes) {
  const got = transcribeTake(path.join(takesDir, t.n), t.n, t.duration, { lang: x.brand.lang, names, fix, again: flag('again') });
  for (const w of got) words.push({ ...w, i: words.length });
  console.log(`take ${t.n}: ${got.length} words, ${got.filter((w) => w.filler).length} fillers`);
}
writeJson(path.join(x.work, 'words.json'), words);
// the bits (stretches of full voice between soft pauses) of every take: where the cuts go
writeJson(path.join(x.work, 'bits.json'), takes.flatMap((t) => readJson<Bit[]>(path.join(takesDir, `${t.n}.bits.json`))));
setState(x, { phase: 'prepared' });
log(x, `prepare: ${takes.length} take(s), ${words.length} words, ${words.filter((w) => w.filler).length} fillers`);
