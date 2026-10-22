#!/usr/bin/env bun
// Step 2: the clean cut, against the script (rewritten 2026-10-20 after Josef's review of the first cut: "90% of the
// cuts are wrong, and the parts you needed to keep were removed"). It now edits the way he does in CapCut:
//
//   - The unit is a try: a stretch of his voice between two pauses (an "island", see _core/speech.ts). A try is kept
//     whole or trimmed at its ends; it is never stitched together from words of different tries.
//   - Each try is lined up against the script (Smith-Waterman, local): which clauses it says, how much of each.
//   - Going through the script, the try kept for the next clause is the last one that says it from its start to its
//     end; a try that runs on cleanly into the following clauses is kept running (no cut where he did not stop).
//   - What he adds in his own words inside a kept try stays (on 7 October he improvised "perché intanto, mentre stai
//     pregando..." and kept it). What is cut: the start of a clause he broke off at the end of a try, words already
//     said in the reel, a stray "e" or "ehm" before the first word of the clause, fillers, and restarts inside a try.
//   - Nothing is said twice: every clause is taken once, every try is used once, no two pieces share a moment.
//   - Cuts fall in his pauses (a try's own start and end on the sound), or, inside a try, at the quietest 10 ms
//     between two words. No piece is shorter than a quarter of a second.
//
// He can choose a try himself: `<batch>/choices.txt`, one line per clause, "4 1:16.5" (clause 4: the try at 1:16.5;
// "4 02@1:16.5" for take 02). cut-<n>.md lists every clause with the try kept and the other complete tries.
// Writes work/reels.json and cut-<n>.md.
//   bun match.ts <brand> <batch>
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { batch, clock, has, log, readJson, same, setState, tokens, writeJson } from './lib';
import { levels10ms, voiceThreshold, type Bit, type Word } from './core/speech';
import type { Script } from './scripts';

const x = batch(process.argv[2] ?? '', process.argv[3] ?? '');
const words = readJson<Word[]>(path.join(x.work, 'words.json'));
const { scripts } = readJson<{ scripts: Script[] }>(path.join(x.work, 'scripts.json'));
const media = readJson<{ takes: { n: string; file: string; duration: number }[] }>(path.join(x.work, 'media.json'));
const fileOf = (take: string) => media.takes.find((t) => t.n === take)!.file;
const PRE = 0.05, POST = 0.03, MIN_PIECE = 0.25;
// Josef cuts where his voice starts and stops: on his Lepanto project the silence heard at a cut is 0.01 s (median),
// 80% under 0.04 s; the machine's first cuts left 0.27 s and he felt the lag (2026-10-21). So every piece is trimmed
// to his full voice (the core's "strong" level: 8 dB over his voice threshold, where his cut points sit), with this
// much air before and after. Never extended, only trimmed.
// Measured on the raw take: at his cuts the voice is still on at both sides (0.00 s of quiet kept), so the machine cuts
// at the first and last 10 ms of full voice too; the render's 8 and 12 ms fades stop a click.
const SNAP_PRE = 0, SNAP_POST = 0;
const strongOf = new Map<string, boolean[]>();
// A word's own sound, for a soft one: outdoors the wind lifts the "full voice" level over the quiet end of a sentence
// ("in the first place", "with the bushes": 2026-10-21, a take by the sea, voice threshold -28 dB, those words -30 to
// -36 dB). A word is audible above the higher of 3 dB over the take's floor and 20 dB under his median speech: outdoors
// the first, indoors the second, so an indoor cut stays as tight as before.
// Outdoors (the wind sets that level, not his voice) a word's fade-out and a soft first sound ("s", "f") are followed
// further, down to 6 dB over the wind's own level: "time." and "deals" lost their tails at the fixed level (2026-10-21,
// noise -45 dB by the sea against -85 dB on his mic indoors). Indoors nothing changes.
const softOf = new Map<string, { db: Float32Array; thr: number; fade: number; windy: boolean }>();
for (const t of media.takes) {
  const wav = path.join(x.work, 'takes', `${t.n}.16k.wav`);
  if (!has(wav)) continue;
  const db = levels10ms(wav), floor = voiceThreshold(db), thr = floor + 8;
  strongOf.set(t.n, Array.from(db, (v) => v > thr));
  const loud = Array.from(db).filter((v) => v > thr).sort((p, q) => p - q), median = loud[Math.floor(loud.length / 2)] ?? thr;
  const noise = [...db].sort((p, q) => p - q)[Math.floor(db.length * 0.1)] ?? floor, windy = floor + 3 > median - 20;
  softOf.set(t.n, { db, thr: Math.max(floor + 3, median - 20), fade: windy ? noise + 6 : Math.max(floor + 3, median - 20), windy });
}
/** Where a word's sound really is, inside the time the transcriber gave it. */
function audible(take: string, w: { start: number; end: number }) {
  const L = softOf.get(take);
  if (!L) return { start: w.start, end: w.end };
  let i = Math.max(0, Math.round((w.start - 0.05) * 100)), j = Math.min(L.db.length, Math.round(w.end * 100)) - 1;
  while (i < j && L.db[i]! <= L.thr) i++;
  while (j > i && L.db[j]! <= L.thr) j--;
  return i < j ? { start: i / 100, end: (j + 1) / 100 } : { start: w.start, end: w.end };
}
/** Where a word's fade-out ends after `t` (at most 0.25 s on): outdoors a sentence's last word dies away under the wind. */
function fadeEnd(take: string, t: number) {
  const L = softOf.get(take);
  if (!L) return t;
  let i = Math.round(t * 100);
  const stop = Math.min(L.db.length, Math.round((t + 0.25) * 100));
  while (i < stop && L.db[i]! > L.fade) i++;
  return i / 100;
}
/** A piece trimmed to his voice: from just before the first full-voice 10 ms to just after the last, never through a word it keeps. */
function snap(pc: { take: string; a: number; b: number }, words: { take: string; start: number; end: number }[] = []) {
  const s = strongOf.get(pc.take);
  if (!s) return pc;
  let i = Math.ceil(pc.a * 100), j = Math.floor(pc.b * 100) - 1;
  while (i < j && !s[i]) i++;
  while (j > i && !s[j]) j--;
  let a = Math.max(pc.a, i / 100 - SNAP_PRE), b = Math.min(pc.b, (j + 1) / 100 + SNAP_POST);
  const inside = words.filter((w) => w.take === pc.take && w.start >= pc.a - 0.02 && w.start < pc.b).sort((p, q) => p.start - q.start);
  if (inside.length) b = Math.min(pc.b, Math.max(b, audible(pc.take, inside[inside.length - 1]!).end));
  // the end follows the last word's fade-out down to the soft level (indoors that level is above where it stops already)
  const L = softOf.get(pc.take);
  if (L) { let k = Math.floor(pc.b * 100) - 1; while (k > i && L.db[k]! <= L.thr) k--; b = Math.min(pc.b, Math.max(b, (k + 1) / 100)); }
  if (L?.windy) {
    b = Math.min(pc.b, Math.max(b, fadeEnd(pc.take, b)));
    // and the start takes in a soft first sound (at most 60 ms before the full voice)
    let k = Math.round(a * 100) - 1;
    const stop = Math.max(Math.ceil(pc.a * 100), Math.round(a * 100) - 6);
    while (k >= stop && L.db[k]! > L.fade) k--;
    a = Math.max(pc.a, (k + 1) / 100);
  }
  return b - a >= MIN_PIECE ? { ...pc, a: +a.toFixed(3), b: +b.toFixed(3) } : pc;
}
const LEAD = new Set(['e', 'ed', 'ma', 'allora', 'quindi', 'ecco', 'and', 'so', 'but', 'okay', 'ok']);


// ---- the tries: words grouped by take and island, in time order
interface Try { id: number; take: string; isl: number; start: number; end: number; all: Word[]; real: Word[]; toks: string[] }
const tries: Try[] = [];
{
  const by = new Map<string, Word[]>();
  for (const w of words) { const k = `${w.take}#${w.isl ?? -1}`; if (!by.has(k)) by.set(k, []); by.get(k)!.push(w); }
  for (const all of by.values()) {
    const real = all.filter((w) => !w.ghost && !w.filler && tokens(w.w).length);
    if (!real.length) continue;
    tries.push({ id: 0, take: all[0]!.take, isl: all[0]!.isl ?? -1, start: all[0]!.start, end: all[all.length - 1]!.end, all, real, toks: real.map((w) => tokens(w.w)[0]!) });
  }
  tries.sort((a, b) => a.take.localeCompare(b.take) || a.start - b.start).forEach((t, i) => { t.id = i; });
}
const islandBounds = (t: Try) => {
  // the try's neighbours in the same take, for clamping the cut points into the pauses
  const same = tries.filter((o) => o.take === t.take);
  const k = same.indexOf(t);
  return { prevEnd: k > 0 ? same[k - 1]!.end : 0, nextStart: k < same.length - 1 ? same[k + 1]!.start : Infinity };
};

// ---- the bits of every try: stretches of full voice between soft pauses, where his cuts fall (see _core/speech.ts)
const allBits = has(path.join(x.work, 'bits.json')) ? readJson<Bit[]>(path.join(x.work, 'bits.json')) : [];
const bitsOf = (t: Try) => {
  const mine = allBits.filter((b) => b.take === t.take && b.isl === t.isl).sort((a, b) => a.k - b.k);
  return mine.length ? mine : [{ take: t.take, isl: t.isl, k: 0, start: t.start, end: t.end, words: t.real.map((w) => ({ w: w.w, start: w.start, end: w.end })) }];
};

/** Close enough to be the same word begun again: the same, a start of it ("domina", "dominava"), or one letter off. */
function close(a: string, b: string): boolean {
  if (same(a, b)) return true;
  if (a.length >= 3 && b.startsWith(a)) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length) >= 0.75;
}

// Meaning words, for a clause said in his own words: not the little words, and the elided article gone ("l'IA" is "ia").
const STOP = new Set(('il lo la gli le un una uno di da in a o ad dei del della delle degli dello al alla ai agli alle nel nella nei negli nelle con per tra fra'
  + ' su sul sulla sui che chi cui non più meno molto anche come quando dove perché perche cosa questo questa questi queste quello quella quelli'
  + ' quelle ma ed se poi già gia solo proprio ancora sempre mai ci ce ne si mi ti vi lo sé se io tu lui lei noi voi loro mio mia tuo tua suo sua'
  + ' è e ha hanno ho hai abbiamo sono sei siamo era erano essere avere fa fare può puo può puoi possono sta stai stanno qui qua là la così cosi'
  + ' the a an and or but of to in on at for with from by as is are was were be been it its this that these those not no so do does did have has'
  + ' had can could will would just also very you your we our they their he she his her i me my').split(/\s+/));
const SYN: Record<string, string[]> = { ia: ['intelligenza', 'artificiale'], ai: ['intelligenza', 'artificiale', 'artificial', 'intelligence'] };
const bare = (w: string) => w.replace(/^\p{L}{1,3}'/u, '');
const isMeaning = (w: string) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w);
/** Whether a word he said carries a meaning word of the script: the same word, the same root, or a synonym. */
const says = (w: string, m: string) => same(w, m) || (Math.min(w.length, m.length) >= 4 && close(w, m))
  || (w.length >= 5 && m.length >= 5 && w.slice(0, 5) === m.slice(0, 5)) || (SYN[m] ?? []).some((s) => same(w, s));

/** Local alignment of a try against the script: pairs [try token, script token], preferring a place near `expect`. */
function alignTry(T: string[], S: string[], expect: number): [number, number][] {
  const n = T.length, m = S.length, MATCH = 2, MISS = -1, GAPP = -1;
  const H = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  const eq = T.map((t) => S.map((s) => same(t, s)));
  let best = 0;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const v = Math.max(0, H[i - 1]![j - 1]! + (eq[i - 1]![j - 1] ? MATCH : MISS), H[i - 1]![j]! + GAPP, H[i]![j - 1]! + GAPP);
    H[i]![j] = v; if (v > best) best = v;
  }
  if (best < MATCH) return [];
  const trace = (i: number, j: number) => {
    const pairs: [number, number][] = [];
    while (i > 0 && j > 0 && H[i]![j]! > 0) {
      if (eq[i - 1]![j - 1] && H[i]![j] === H[i - 1]![j - 1]! + MATCH) { pairs.push([i - 1, j - 1]); i--; j--; }
      else if (H[i]![j] === H[i - 1]![j]! + GAPP) i--;
      else if (H[i]![j] === H[i]![j - 1]! + GAPP) j--;
      else if (H[i]![j] === H[i - 1]![j - 1]! + MISS) { i--; j--; }
      else break;
    }
    return pairs.reverse();
  };
  // every end point about as good as the best, judged with a cost for being far from where he was in the script
  let pick: [number, number][] = [], pickScore = -Infinity;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    if (H[i]![j]! < best - 4 || H[i]![j]! < MATCH) continue;
    const pairs = trace(i, j);
    if (!pairs.length) continue;
    const s0 = pairs[0]![1], far = expect < 0 ? 0 : Math.max(0, expect - 40 - s0, s0 - expect - 20);
    const sc = H[i]![j]! - 0.05 * far;
    if (sc > pickScore) { pickScore = sc; pick = pairs; }
  }
  return pick;
}

interface Piece { take: string; file: string; a: number; b: number; sentence: number }
const reels: { n: number; postId: string | null; title: string; caption: string; pieces: Piece[]; words: { w: string; take: string; start: number; end: number }[]; missing: number[]; ownWords: number[]; duration: number }[] = [];

// his own choices: "4 1:16.5" or "4 02@1:16.5"
const choices = new Map<number, { take: string | null; at: number }>();
if (has(x.p('choices.txt'))) {
  for (const line of readFileSync(x.p('choices.txt'), 'utf8').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(?:(\d+)@)?(?:(\d+):)?(\d+(?:\.\d+)?)/);
    if (m) choices.set(Number(m[1]) - 1, { take: m[2] ? m[2].padStart(2, '0') : null, at: Number(m[3] ?? 0) * 60 + Number(m[4]) });
  }
}

scripts.forEach((sc, si) => {
  // the script as one row of tokens, each knowing its clause
  const S: string[] = [], clauseOf: number[] = [], c0: number[] = [], c1: number[] = [];
  sc.sentences.forEach((sen, c) => { c0[c] = S.length; for (const t of tokens(sen.text)) { S.push(t); clauseOf.push(c); } c1[c] = S.length; });
  if (!S.length) return;

  // every try lined up: which script tokens it says, per clause how many
  interface Lined { t: Try; pairs: [number, number][]; at: Map<number, number>; perClause: Map<number, number[]>; precision: number }
  const lined: Lined[] = [];
  let expect = -1;
  const longS = [...new Set(S.filter((w) => w.length >= 6))];
  for (const t of tries) {
    // a long word whisper heard as two ("Commenta lei panto"): the two count as the script's one word, on the first
    const toks = t.toks.map((w, k) => {
      const nx = t.toks[k + 1], pv = t.toks[k - 1];
      if (nx && !S.some((u) => same(w, u)) && longS.some((u) => same(w + nx, u))) return longS.find((u) => same(w + nx, u))!;
      if (pv && !S.some((u) => same(w, u)) && longS.some((u) => same(pv + w, u))) return '';
      return w;
    });
    const pairs = alignTry(toks, S, expect);
    if (!pairs.length) continue;
    const perClause = new Map<number, number[]>();
    for (const [, sj] of pairs) { const c = clauseOf[sj]!; if (!perClause.has(c)) perClause.set(c, []); perClause.get(c)!.push(sj); }
    const L: Lined = { t, pairs, at: new Map(pairs.map(([ti, sj]) => [ti, sj])), perClause, precision: pairs.length / t.toks.length };
    lined.push(L);
    if (pairs.length >= 3 && L.precision >= 0.5) expect = pairs[pairs.length - 1]![1] + 1;
  }
  // how much of clause c, from script token p on, a try says; whether it starts there and reaches the end
  const view = (L: Lined, c: number, p: number) => {
    const hit = (L.perClause.get(c) ?? []).filter((sj) => sj >= p);
    const len = c1[c]! - p, k = c1[c]! - c0[c]!;
    return {
      coverage: len > 0 ? hit.length / len : 0,
      starts: hit.length > 0 && Math.min(...hit) <= p + (S[p] && LEAD.has(S[p]!) ? 2 : 1),
      complete: hit.length > 0 && Math.max(...hit) >= c1[c]! - (k <= 3 ? 1 : 2),
    };
  };
  const ok = (L: Lined, c: number, p: number) => {
    const v = view(L, c, p);
    return v.coverage >= 0.6 || (v.coverage >= 0.3 && (L.perClause.get(c) ?? []).length >= 3 && (L.precision >= 0.7 || v.complete));
  };
  // a try that runs on into the next clause from its start to its end
  const continues = (L: Lined, c: number) => {
    if (c + 1 >= sc.sentences.length) return false;
    const v = view(L, c + 1, c0[c + 1]!);
    return v.coverage >= 0.6 && v.starts && v.complete;
  };


  const used = new Set<number>();
  const pieces: Piece[] = [], kept: { w: string; take: string; start: number; end: number }[] = [], missing: number[] = [];
  const md: string[] = [`# Cut ${si + 1}: ${sc.title}`, `Brand: ${x.brand.name} · batch ${x.name} · speed ${x.brand.speed}x`, ''];
  const notes: string[] = [];
  const missingMd = new Map<number, number>();
  // per clause, the script words of it that a kept try says (a try for clause 19 that ends "e che mi aiuta nella
  // produzione di ogni video" says part of 20 in his own words)
  const saidIn = new Map<number, Set<number>>(), saidWords = new Map<number, string[]>();
  let p = 0;
  while (p < S.length) {
    const c = clauseOf[p]!;
    // in the middle of a clause (the try before stopped at a breath), only a try that carries on from here: never one that
    // says the clause's start again, which would say it twice
    const cands = lined.filter((L) => !used.has(L.t.id) && ok(L, c, p) && (p <= c0[c]! + 1 || !(L.perClause.get(c) ?? []).some((sj) => sj < p - 1)));
    let chosen: Lined | undefined;
    const forced = choices.get(c);
    if (forced && p === c0[c]) {
      chosen = lined.find((L) => !used.has(L.t.id) && (!forced.take || L.t.take === forced.take) && forced.at >= L.t.start - 0.3 && forced.at <= L.t.end + 0.3);
      if (!chosen) notes.push(`choices.txt: no unused try at ${clock(forced.at)} for clause ${c + 1}; the machine chose`);
    }
    if (process.env.DEBUG_MATCH) console.error(`p=${p} clause ${c + 1}: ${lined.filter((L) => !used.has(L.t.id) && (L.perClause.get(c) ?? []).length).map((L) => { const v = view(L, c, p); return `${clock(L.t.start)} cov ${v.coverage.toFixed(2)} prec ${L.precision.toFixed(2)} ${v.starts ? 'S' : '-'}${v.complete ? 'C' : '-'}${ok(L, c, p) ? ' ok' : ''}`; }).join(' | ')}`);
    if (!chosen && cands.length) {
      // from the clause's start, to its end, running on without a cut, with the script's words (a try that ends on a
      // different word, "mentre Lepanto si è costruito", loses to one that says it); then the last
      const rank = (L: Lined) => { const v = view(L, c, p); return (v.starts ? 8 : 0) + (v.complete ? 4 : 0) + (continues(L, c) ? 2 : 0); };
      const words10 = (L: Lined) => Math.round(view(L, c, p).coverage * 10);
      chosen = [...cands].sort((a, b) => rank(b) - rank(a) || words10(b) - words10(a) || b.t.start - a.t.start)[0];
    }
    if (!chosen && (pieces.some((pc) => pc.sentence === c) || (saidIn.get(c)?.size ?? 0) > 0)) {
      // the clause is in the reel, begun in the script's words and ended in his own ("di un influencer qualsiasi" for
      // "di qualsiasi altro creator"): not missing
      md.push(`  (the end of ${String(c + 1).padStart(2, '0')} in his own words; the script: "${sc.sentences[c]!.text}")`);
      p = c1[c]!;
      continue;
    }
    if (!chosen) {
      if (!missing.includes(c)) missing.push(c);
      if (!missingMd.has(c)) missingMd.set(c, md.length);
      md.push(`- ✗ ${String(c + 1).padStart(2, '0')} MISSING: ${sc.sentences[c]!.text}`);
      p = c1[c]!;
      continue;
    }
    used.add(chosen.t.id);
    const { t } = chosen;

    // which clauses this try covers from p on: the first one, then every following one it says from start to end
    let last = c;
    for (let d = c + 1; d < sc.sentences.length; d++) {
      const v = view(chosen, d, c0[d]!);
      if (v.coverage >= 0.6 && v.starts && v.complete) last = d; else break;
    }
    // what to keep of the try, bit by bit (a bit is kept whole or not at all, so every cut falls in a pause):
    //  - a short bit he says again from the top in the next one or two is a restart ("Domina" / "dominava il
    //    Mediterraneo"; "la lotta" / "La flotta Cristiano..." / "La flotta cristiana vinse"): dropped
    //  - bits before the first one on the script from p: dropped (a stray "ma", "E onestamente"), unless more than
    //    three words of his own that are on no clause (his lead-in)
    //  - bits after the clauses the try covers: kept (his own words), unless a few words on a clause he says again in a
    //    later try (a broken-off start)
    const s0 = chosen.pairs[0]![1];
    const tb = bitsOf(t).map((b) => {
      const toks = b.words.map((w) => tokens(w.w)[0] ?? '').filter(Boolean);
      const pairs = bitsOf(t).length === 1 ? chosen!.pairs : alignTry(toks, S, s0);
      const at: (number | undefined)[] = toks.map((_, i) => pairs.find(([ti]) => ti === i)?.[1]);
      return { ...b, words: [...b.words], toks, at };
    });
    // words the try says but no bit holds (a soft end, under the full-voice level: 2026-10-21 outdoors) join the bit
    // they follow, so a cut never drops them
    for (const w of t.all) {
      if (w.ghost || w.filler || tb.some((b) => w.start >= b.start - 0.06 && w.start < b.end + 0.02)) continue;
      const tok = tokens(w.w)[0];
      if (!tok) continue;
      // only at a bit's end: before a bit, a lone word is usually a restart ("Questo Questo rosario"), which stays out
      const before = [...tb].reverse().find((b) => b.end <= w.start + 0.02);
      if (before && w.start - before.end < 0.6) { before.words.push({ w: w.w, start: w.start, end: w.end }); before.toks.push(tok); before.at.push(undefined); before.end = Math.max(before.end, audible(t.take, w).end); }
    }
    const keepB = tb.map((b) => b.toks.length > 0 || (b.end - b.start > 0.4));
    const why: string[] = [];
    for (let j = 0; j < tb.length; j++) {
      const A = tb[j]!.toks;
      if (!A.length || A.length > 6) continue;
      for (const j2 of [j + 1, j + 2]) {
        const B = tb[j2]?.toks;
        if (!B?.length || !close(A[0]!, B[0]!)) continue;
        const hits = A.filter((w, i) => [B[i], B[i - 1], B[i + 1]].some((u) => u && close(w, u))).length;
        if (hits / A.length >= 0.6) { keepB[j] = false; why.push(`restart "${tb[j]!.words.map((w) => w.w).join(' ')}"`); break; }
      }
    }
    const onP = (j: number) => tb[j]!.at.some((sj) => sj !== undefined && sj >= p);
    const firstOn = tb.findIndex((_, j) => keepB[j] && onP(j));
    for (let j = 0; j < (firstOn < 0 ? 0 : firstOn); j++) {
      if (!keepB[j]) continue;
      const own = tb[j]!.toks.length > 3 && !tb[j]!.at.some((sj) => sj !== undefined);
      if (!own) { keepB[j] = false; why.push(`lead "${tb[j]!.words.map((w) => w.w).join(' ')}"`); }
    }
    const coveredBit = (j: number) => tb[j]!.at.some((sj) => sj !== undefined && sj >= p && clauseOf[sj]! <= last);
    let lastOnB = -1;
    tb.forEach((_, j) => { if (keepB[j] && coveredBit(j)) lastOnB = j; });
    if (lastOnB >= 0) {
      const tailIdx = tb.map((_, j) => j).filter((j) => j > lastOnB && keepB[j]);
      const tailToks = tailIdx.flatMap((j) => tb[j]!.toks), tailAt = tailIdx.flatMap((j) => tb[j]!.at).filter((sj): sj is number => sj !== undefined);
      if (tailToks.length && tailToks.length <= 4 && tailAt.length && lined.some((L) => L !== chosen && !used.has(L.t.id) && L.t.start > t.start && tailAt.some((sj) => [...L.at.values()].includes(sj)))) {
        for (const j of tailIdx) keepB[j] = false;
        why.push(`broken-off start "${tailIdx.flatMap((j) => tb[j]!.words.map((w) => w.w)).join(' ')}"`);
      }
    }
    // the clauses now said: every following clause the kept bits say at least half of
    const keptTok = tb.flatMap((b, j) => (keepB[j] ? b.at : [])).filter((sj): sj is number => sj !== undefined && sj >= p);
    if (process.env.DEBUG_MATCH) console.error(`kept try ${clock(t.start)} clause ${c + 1}: ` + tb.map((b, j) => `${keepB[j] ? '' : 'DROP '}[${b.words.map((w, i) => `${w.w}${b.at[i] !== undefined ? `<${clauseOf[b.at[i]!]! + 1}>` : ''}`).join(' ')}]`).join(' '));
    for (const sj of keptTok) { const cc = clauseOf[sj]!; if (!saidIn.has(cc)) saidIn.set(cc, new Set()); saidIn.get(cc)!.add(sj); saidWords.set(cc, tb.flatMap((b, j) => (keepB[j] ? b.toks : []))); }
    let lastD = c;
    for (let d = c + 1; d < sc.sentences.length; d++) {
      if (keptTok.filter((sj) => clauseOf[sj] === d).length / (c1[d]! - c0[d]!) >= 0.5) lastD = d; else break;
    }
    // pieces: runs of kept bits, cut just before his voice starts and just after it stops (as he cuts)
    const { prevEnd, nextStart } = islandBounds(t);
    const cutPieces: Piece[] = [];
    for (let j = 0; j < tb.length; j++) {
      if (!keepB[j]) continue;
      let k = j;
      while (k + 1 < tb.length && keepB[k + 1]) k++;
      const before = tb[j - 1], after = tb[k + 1];
      const a = Math.max(tb[j]!.start - PRE, before ? before.end + 0.02 : prevEnd + 0.02);
      const b = Math.min(Math.max(tb[k]!.end + POST, fadeEnd(t.take, tb[k]!.end)), after ? after.start - 0.02 : nextStart - 0.02);
      const ws = tb.slice(j, k + 1).flatMap((bt) => bt.words);
      if (b - a < MIN_PIECE) notes.push(`dropped a ${(b - a).toFixed(2)} s blip at ${clock(a)} ("${ws.map((w) => w.w).join(' ')}")`);
      else {
        cutPieces.push({ take: t.take, file: fileOf(t.take), a: +Math.max(0, a).toFixed(3), b: +b.toFixed(3), sentence: c });
        for (const w of ws) kept.push({ w: w.w, take: t.take, start: w.start, end: w.end });
      }
      j = k;
    }
    // never the same moment twice
    for (const cp of cutPieces) {
      if (pieces.some((o) => o.take === cp.take && cp.a < o.b - 0.01 && cp.b > o.a + 0.01)) { notes.push(`skipped a piece at ${clock(cp.a)}: already in the reel`); continue; }
      pieces.push(cp);
    }
    // the report: the clauses this try covers, and the other complete tries of the first one
    const others = lined.filter((L) => L !== chosen && view(L, c, c0[c]!).starts && view(L, c, c0[c]!).complete).map((L) => `${L.t.take}@${clock(L.t.start)}`);
    const cutWords = why;
    const label = lastD > c ? `${String(c + 1).padStart(2, '0')}-${String(lastD + 1).padStart(2, '0')}` : String(c + 1).padStart(2, '0');
    md.push(`- ✓ ${label} try at ${t.take}@${clock(t.start)}${others.length ? ` · other complete tries: ${others.join(', ')}` : ''}${cutWords.length ? ` · cut: ${cutWords.join(', ')}` : ''}`);
    md.push(`  ${tb.flatMap((b, j) => (keepB[j] ? b.words.map((w) => w.w) : [])).join(' ')}`);
    // on: past the last script token this try says in the clauses it covers
    const inLast = keptTok.filter((sj) => clauseOf[sj] === lastD);
    // the last clause this try reaches is done only if the try says it to its end; else the next try may carry it on
    // ("chilling here in the middle with the bushes" [breath] "simply because we're having some fun exploring")
    const doneLast = view(chosen, lastD, lastD === c ? p : c0[lastD]!).complete;
    p = Math.max(p + 1, doneLast ? c1[lastD]! : (inLast.length ? Math.max(...inLast) + 1 : c1[c]!));
    // the try also said the first words of the next clause ("né i condottieri"): those are said too
    if (doneLast && lastD + 1 < sc.sentences.length) {
      const nx = new Set(keptTok.filter((sj) => clauseOf[sj] === lastD + 1));
      let q = c0[lastD + 1]!;
      while (nx.has(q) || nx.has(q + 1)) q = nx.has(q) ? q + 1 : q + 2;
      if (q > c0[lastD + 1]!) p = Math.max(p, q);
    }
  }

  // ---- second pass: a clause in his own words (2026-10-21, "Contro l'AI nei video": 3 of 21 clauses missing, the
  // hook and the thesis among them, though he said all three: "il rischio più grande lo corrono quei creator che
  // usano l'intelligenza artificiale" for "il rischio più grande ce l'hanno quei creator che usano l'IA"). He records
  // in the script's order and his last attempt at a passage is the good one. So, between the pieces of the clauses
  // before and after it: the last run of tries that carries most of the clause's meaning words, in any order, his
  // restarts dropped. A try with none of them is never taken ("No, no, no", a word to the editor).
  const posOf = (take: string, t: number) => media.takes.findIndex((m) => m.n === take) * 1e5 + t;
  for (const c of [...missing]) {
    if (pieces.some((pc) => pc.sentence === c)) continue; // part of it is in already, in his own words
    const meaning = [...new Set(tokens(sc.sentences[c]!.text).map(bare).filter(isMeaning))];
    // said at the end of the try kept for an earlier clause, partly in his own words: in the reel, so not missing
    const inTry = [...(saidIn.get(c) ?? [])];
    if (inTry.length / (c1[c]! - c0[c]!) >= 0.3 && meaning.some((m) => (saidWords.get(c) ?? []).some((w) => says(bare(w), m)))) {
      missing.splice(missing.indexOf(c), 1);
      md[missingMd.get(c)!] = `  (${String(c + 1).padStart(2, '0')} is at the end of the try before, partly in his own words; the script: "${sc.sentences[c]!.text}")`;
      continue;
    }
    if (meaning.length < 2) continue;
    const before = pieces.filter((pc) => pc.sentence < c), after = pieces.filter((pc) => pc.sentence > c);
    const lo = before.length ? Math.max(...before.map((pc) => posOf(pc.take, pc.b))) : -Infinity;
    const hi = after.length ? Math.min(...after.map((pc) => posOf(pc.take, pc.a))) : Infinity;
    const gap = tries.filter((t) => !used.has(t.id) && posOf(t.take, t.start) >= lo - 0.05 && posOf(t.take, t.end) <= hi + 0.05);
    const hitsOf = (t: Try) => meaning.filter((m) => t.toks.some((w) => says(bare(w), m)));
    // runs: neighbouring tries that each say some of it, under 2.5 s apart (his hook question and its answer: 1.6 s),
    // nothing in between
    const runs: Try[][] = [];
    gap.forEach((t, k) => {
      if (!hitsOf(t).length) return;
      const r = runs[runs.length - 1], prev = r?.[r.length - 1];
      if (r && prev && prev === gap[k - 1] && prev.take === t.take && t.start - prev.end < 2.5) r.push(t); else runs.push([t]);
    });
    // a short try he begins again in the next one is a restart ("ma il rischio più grande lo corrono quelli")
    const restart = (t: Try, nx: Try | undefined) => {
      if (!nx || t.toks.length > 8 || !close(t.toks[0]!, nx.toks[0]!)) return false;
      return t.toks.filter((w, i) => [nx.toks[i], nx.toks[i - 1], nx.toks[i + 1]].some((u) => u && close(w, u))).length / t.toks.length >= 0.6;
    };
    const clean = runs.map((r) => r.filter((t, k) => !restart(t, r[k + 1])));
    const score = (r: Try[]) => meaning.filter((m) => r.some((t) => t.toks.some((w) => says(bare(w), m)))).length / meaning.length;
    const best = Math.max(0, ...clean.map(score));
    if (process.env.DEBUG_MATCH) console.error(`own words, clause ${c + 1} [${meaning.join(' ')}] gap ${lo.toFixed(1)}..${hi.toFixed(1)}: ${clean.map((r, i) => `[${runs[i]!.map((t) => `${clock(t.start)}-${clock(t.end)} ${hitsOf(t).join('+') || '0'}`).join(' , ')}] ${score(r).toFixed(2)}`).join(' | ')}`);
    const pick = [...clean].reverse().find((r) => r.length && score(r) >= Math.max(0.4, 0.8 * best) && Math.round(score(r) * meaning.length) >= 2);
    if (!pick) continue;
    const added: Piece[] = [];
    for (const t of pick) {
      const { prevEnd, nextStart } = islandBounds(t);
      const a = Math.max(t.start - PRE, prevEnd + 0.02), b = Math.min(t.end + POST, nextStart - 0.02);
      if (b - a < MIN_PIECE || pieces.some((o) => o.take === t.take && a < o.b - 0.01 && b > o.a + 0.01)) continue;
      added.push({ take: t.take, file: fileOf(t.take), a: +Math.max(0, a).toFixed(3), b: +b.toFixed(3), sentence: c });
      for (const w of t.all) if (!w.ghost) kept.push({ w: w.w, take: t.take, start: w.start, end: w.end });
      used.add(t.id);
    }
    if (!added.length) continue;
    pieces.push(...added);
    missing.splice(missing.indexOf(c), 1);
    const dropped = runs.flat().filter((t) => pick.includes(t) === false && runs.find((r) => r.includes(t)) === runs[clean.indexOf(pick)]);
    md[missingMd.get(c)!] = `- ✓ ${String(c + 1).padStart(2, '0')} in his own words, try at ${pick[0]!.take}@${clock(pick[0]!.start)} (${Math.round(score(pick) * 100)}% of its meaning words)${dropped.length ? ` · cut: restart "${dropped.map((t) => t.real.map((w) => w.w).join(' ')).join('" / "')}"` : ''}\n  ${pick.flatMap((t) => t.all.filter((w) => !w.ghost).map((w) => w.w)).join(' ')}`;
  }
  pieces.sort((a, b) => a.sentence - b.sentence);

  const found = sc.sentences.length - missing.length;
  if (found < sc.sentences.length * 0.5) {
    console.log(`script "${sc.title}": ${found} of ${sc.sentences.length} clauses, not recorded in this batch`);
    reels.push({ n: si + 1, postId: sc.postId, title: sc.title, caption: sc.caption, pieces: [], words: [], missing, ownWords: [], duration: 0 });
    return;
  }
  const merged: Piece[] = [];
  for (const pc of pieces.map((pc) => snap(pc, kept))) {
    const lastP = merged[merged.length - 1];
    if (lastP && lastP.take === pc.take && Math.abs(pc.a - lastP.b) < 0.03) lastP.b = pc.b;
    else merged.push({ ...pc });
  }
  const dur = merged.reduce((s, pc) => s + (pc.b - pc.a), 0) / x.brand.speed;
  md.splice(2, 0, `${merged.length} pieces, ${clock(dur)} at ${x.brand.speed}x · ${found} of ${sc.sentences.length} clauses${missing.length ? ` · MISSING: ${missing.map((m) => m + 1).join(', ')}` : ''}`,
    `To use another try for a clause, add a line to ${x.name}/choices.txt: "<clause> <time>", e.g. "1 0:17.2".`, '');
  if (notes.length) md.push('', '## Notes', ...notes.map((n) => `- ${n}`));
  writeFileSync(x.p(`cut-${si + 1}.md`), md.join('\n') + '\n');
  reels.push({ n: si + 1, postId: sc.postId, title: sc.title, caption: sc.caption, pieces: merged, words: kept, missing, ownWords: [], duration: +dur.toFixed(2) });
  console.log(`reel ${si + 1} "${sc.title}": ${merged.length} pieces, ${dur.toFixed(1)} s, ${found}/${sc.sentences.length} clauses${missing.length ? `, missing ${missing.map((m) => m + 1).join(', ')}` : ''}${notes.length ? `, ${notes.length} notes` : ''}`);
});

writeJson(path.join(x.work, 'reels.json'), reels);
setState(x, { phase: 'matched' });
log(x, `match: ${reels.map((r) => `reel ${r.n} ${r.duration} s (${r.pieces.length} pieces${r.missing.length ? `, ${r.missing.length} missing` : ''})`).join('; ')}`);
