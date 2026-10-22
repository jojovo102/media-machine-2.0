#!/usr/bin/env bun
// The machine's cut against Josef's own (2026-10-21): the benchmark. His CapCut project holds his cut as source in and
// out points on the raw take; the machine's cut is work/reels.json. Both are lined up on the take's clock.
//   kept by both   how much of the machine's time is time he kept too (the machine kept nothing he threw away)
//   his, found     how much of his time the machine kept too (the machine threw away nothing he kept)
//   same tries     of his pieces, how many the machine took from the same try (overlap of at least half his piece)
// A change to the cut ships only if neither of the first two drops (README, section 8).
//   bun bench.ts <brand> <batch> <CapCut project name> [reel n]
import path from 'node:path';
import { batch, readJson } from './lib';

const [brandKey, name, project, nArg] = process.argv.slice(2);
if (!project) throw new Error('usage: bun bench.ts <brand> <batch> <CapCut project name> [reel n]');
const x = batch(brandKey ?? '', name ?? '');
const n = Number(nArg ?? 1);
const DRAFTS = path.join(process.env.HOME ?? '', 'Movies/CapCut/User Data/Projects/com.lveditor.draft');
const draft = readJson<any>(path.join(DRAFTS, project, 'draft_info.json'));
const takes = readJson<{ takes: { n: string; file: string; raw?: string }[] }>(path.join(x.work, 'media.json')).takes;
const reel = readJson<{ n: number; pieces: { take: string; a: number; b: number }[] }[]>(path.join(x.work, 'reels.json')).find((r) => r.n === n);
if (!reel) throw new Error(`no reel ${n} in ${x.name}`);

type R = [number, number];
const rawName = (t: { file: string; raw?: string }) => path.basename(t.raw ?? t.file);
// his pieces: the main video track's segments on a take of this batch, in source seconds
const videos = new Map<string, string>((draft.materials.videos as any[]).map((m) => [m.id, path.basename(m.path ?? '')]));
const main = (draft.tracks as any[]).find((t) => t.type === 'video');
const his = new Map<string, R[]>();
for (const s of main.segments as any[]) {
  const take = takes.find((t) => rawName(t) === videos.get(s.material_id));
  if (!take) continue;
  const a = s.source_timerange.start / 1e6;
  his.set(take.n, [...(his.get(take.n) ?? []), [a, a + s.source_timerange.duration / 1e6]]);
}
const mine = new Map<string, R[]>();
for (const p of reel.pieces) mine.set(p.take, [...(mine.get(p.take) ?? []), [p.a, p.b]]);

const len = (rs: R[]) => rs.reduce((s, [a, b]) => s + (b - a), 0);
const inter = (xs: R[], ys: R[]) => xs.reduce((s, [a, b]) => s + ys.reduce((t, [c, d]) => t + Math.max(0, Math.min(b, d) - Math.max(a, c)), 0), 0);
let hisLen = 0, mineLen = 0, both = 0, same = 0, hisPieces = 0;
for (const t of new Set([...his.keys(), ...mine.keys()])) {
  const H = his.get(t) ?? [], M = mine.get(t) ?? [];
  hisLen += len(H); mineLen += len(M); both += inter(H, M);
  hisPieces += H.length;
  same += H.filter(([a, b]) => inter([[a, b]], M) >= 0.5 * (b - a)).length;
}
if (!hisLen) throw new Error(`the CapCut project "${project}" uses none of this batch's takes`);
const pct = (v: number) => `${Math.round(v * 100)}%`;
console.log(`${x.name} reel ${n} against "${project}": his ${hisLen.toFixed(1)} s in ${hisPieces} pieces, the machine ${mineLen.toFixed(1)} s in ${reel.pieces.length}`);
console.log(`  kept by both  ${pct(both / mineLen)} of the machine's time is time he kept`);
console.log(`  his, found    ${pct(both / hisLen)} of his time is in the machine's cut`);
console.log(`  same tries    ${same} of his ${hisPieces} pieces`);
