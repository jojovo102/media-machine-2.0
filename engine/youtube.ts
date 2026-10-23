#!/usr/bin/env bun
// YouTube clips into the business page's reels (2026-10-23). The long video is still made by the YouTube machine
// (ophanim-ai/media-exports/youtube/_machine: ingest, cut, graphics, render, thumbnails, texts, clips); its clips are
// the reels of the weeks between Josef's own recordings (README § The accounts). This bridge makes them a session of
// the business brand, so they travel the same road as a recorded reel: publish.ts puts each clip on its own post in the
// Ophanim AI workspace (status review), and trials.ts makes the trial versions once Josef has approved one.
//   bun engine/youtube.ts <video>            the clips of media-exports/youtube/<video> (clips.md + clips/<n> shorts.mp4)
//   then: bun engine/publish.ts ophanim yt-<video>
import path from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BASE, brand, ensure, job, log, setState, writeJson } from './lib';

const video = (process.argv[2] ?? '').replace(/[^a-z0-9-]/gi, '').toLowerCase();
if (!video) throw new Error('usage: bun engine/youtube.ts <video> (a folder of ophanim-ai/media-exports/youtube)');
const src = path.join(BASE, 'ophanim-ai', 'media-exports', 'youtube', video);
const clipsMd = path.join(src, 'clips.md');
if (!existsSync(clipsMd)) throw new Error(`no ${clipsMd}: the YouTube machine writes the clips first (its step 8)`);

// clips.md: "## <n>" then "hook: ..." and "caption: ..." lines (the YouTube machine's own format, clips.ts)
type Clip = { n: number; hook: string; caption: string; file: string };
const clips: Clip[] = [];
let cur: Clip | null = null;
for (const l of readFileSync(clipsMd, 'utf8').split('\n')) {
  const h = l.match(/^##\s+(\d+)/);
  if (h) { cur = { n: Number(h[1]), hook: '', caption: '', file: path.join(src, 'clips', `${h[1]} shorts.mp4`) }; clips.push(cur); continue; }
  const m = cur && l.match(/^(hook|caption):\s*(.*)$/);
  if (m && cur) cur[m[1] as 'hook' | 'caption'] = m[2]!.trim();
}
const ready = clips.filter((c) => existsSync(c.file));
for (const c of clips.filter((c) => !existsSync(c.file))) console.warn(`clip ${c.n}: no ${path.basename(c.file)} yet (clips.ts)`);
if (!ready.length) throw new Error('no rendered clip to bring over');

// the session: <business root>/yt-<video>, one reel per clip, its final the clip as rendered
const b = brand('ophanim');
const name = `yt-${video}`;
const dir = path.join(b.root, name);
mkdirSync(path.join(dir, 'work'), { recursive: true });
const x = { brand: b, name, dir, p: (...xs: string[]) => path.join(dir, ...xs), raw: path.join(dir, 'raw'), work: path.join(dir, 'work') };
const reels = ready.map((c, i) => ({ n: i + 1, postId: null, title: c.hook || `${video} clip ${c.n}`, caption: c.caption, clip: c.n, pieces: [{ from: 'youtube', clip: c.n }] }));
const scripts = ready.map((c) => ({ postId: null, title: c.hook, sentences: c.caption ? [{ text: c.caption }] : [] }));
writeJson(path.join(x.work, 'reels.json'), reels);
writeJson(path.join(x.work, 'scripts.json'), { scripts });
for (const r of reels) {
  const j = job(x as never, r.title);
  ensure(j.outputs);
  copyFileSync(ready[r.n - 1]!.file, j.final);
  console.log(`reel ${r.n}: clip ${r.clip} "${r.title}" -> ${path.relative(dir, j.final)}`);
}
writeFileSync(path.join(dir, 'README.md'), `# ${name}\nThe clips of the YouTube video "${video}" (media-exports/youtube/${video}), brought over by engine/youtube.ts on ${new Date().toISOString().slice(0, 10)}.\n`);
setState(x as never, { phase: 'finished', from: `youtube/${video}` });
log(x as never, `youtube: ${reels.length} clip(s) of ${video} as reels`);
console.log(`\n${reels.length} clip(s) ready: bun engine/publish.ts ophanim ${name}`);
