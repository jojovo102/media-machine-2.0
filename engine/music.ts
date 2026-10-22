// The music pool (2026-10-21, moved to the library 2026-10-22). Josef: "I want to provide you with a pool of music
// templates that you can use", and of the tracks he put in the VolpinVeritas folder: "we can use these tracks also for
// the biz page". So every brand draws from one pool, library/music (plus any folder the brand's `music.dirs` adds).
//
// A track whose rights the library index marks unknown is never picked (library/README.md § Rights). A reel gets the
// track this brand used least recently (never used first), so a track comes back only after the others have had a
// turn, and keeps that track when it is rendered again (work/reel-<n>/music.json). Each brand keeps its own rotation
// in brands/<key>/.music-pool.json. Every track sits at the same loudness under his voice, whatever the file's own
// level: `music.lufs` (VolpinVeritas -39 LUFS under a -15 LUFS voice, the balance of "Contro l'AI nei video", which
// he approved). `music.skip`: words of file names this brand leaves out.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { LIBRARY, brandDir, ensure, has, loudness, readJson, writeJson, type Batch } from './lib';

const AUDIO = /\.(mp3|wav|m4a|aac|flac|aif|aiff|ogg)$/i;
type Pool = Record<string, { used?: string; lufs?: number }>;

export function musicDirs(x: Batch): string[] {
  return [path.join(LIBRARY, 'music'), ...(x.brand.music.dirs ?? [])].filter((d) => existsSync(d));
}

/** Tracks the library index marks with unknown rights: a YouTube rip, a commercial song; never picked by the machine. */
function unknownRights(): Set<string> {
  const f = path.join(LIBRARY, 'index.json');
  if (!has(f)) return new Set();
  const idx = readJson<{ items: { path: string; kind: string; rights?: string }[] }>(f);
  return new Set(idx.items.filter((i) => i.kind === 'music' && i.rights === 'unknown').map((i) => path.join(LIBRARY, i.path)));
}

/** Every track of the pool, a byte-for-byte copy of another left out (kept: the one the rotation already knows, else the first by name). */
export function poolTracks(x: Batch): string[] {
  const skip = (x.brand.music.skip ?? []).map((s) => s.toLowerCase());
  const poolFile = path.join(brandDir(x.brand.key), '.music-pool.json');
  const known = new Set(existsSync(poolFile) ? Object.keys(JSON.parse(readFileSync(poolFile, 'utf8'))) : []);
  const noRights = unknownRights();
  const byContent = new Map<string, string>();
  for (const d of musicDirs(x)) {
    for (const f of readdirSync(d).filter((n) => AUDIO.test(n) && !n.startsWith('.'))) {
      if (skip.some((s) => f.toLowerCase().includes(s))) continue;
      const file = path.join(d, f);
      if (noRights.has(file)) continue;
      const id = `${statSync(file).size}:${createHash('sha1').update(readFileSync(file)).digest('hex')}`;
      const kept = byContent.get(id);
      if (!kept || (known.has(file) && !known.has(kept)) || (known.has(file) === known.has(kept) && path.basename(file) > path.basename(kept))) byContent.set(id, file);
    }
  }
  return [...byContent.values()].sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

/** The track for reel `n` and the gain that sets it at the brand's loudness, or null when the pool is empty. */
export function musicFor(x: Batch, n: number): { file: string; gainDb: number } | null {
  const tracks = poolTracks(x);
  if (!tracks.length) return null;
  const target = x.brand.music.lufs ?? -39;
  const poolFile = path.join(brandDir(x.brand.key), '.music-pool.json');
  const pool: Pool = existsSync(poolFile) ? JSON.parse(readFileSync(poolFile, 'utf8')) : {};
  const choiceFile = path.join(x.work, `reel-${n}`, 'music.json');
  let file = has(choiceFile) ? readJson<{ file: string }>(choiceFile).file : '';
  if (file && !path.isAbsolute(file)) file = musicDirs(x).map((d) => path.join(d, file)).find((f) => existsSync(f)) ?? '';
  if (!file || !existsSync(file)) {
    // least recently used by this brand, never used first; ties in name order
    file = [...tracks].sort((a, b) => (pool[a]?.used ?? '').localeCompare(pool[b]?.used ?? '') || path.basename(a).localeCompare(path.basename(b)))[0]!;
    ensure(path.dirname(choiceFile));
    writeJson(choiceFile, { file, chosen: new Date().toISOString() });
    pool[file] = { ...pool[file], used: new Date().toISOString() };
  }
  if (pool[file]?.lufs === undefined) pool[file] = { ...pool[file], lufs: loudness(file).lufs };
  writeFileSync(poolFile, JSON.stringify(pool, null, 1));
  return { file, gainDb: +(target - pool[file]!.lufs!).toFixed(2) };
}
