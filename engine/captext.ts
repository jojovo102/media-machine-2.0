// The words on screen: what he said, spelled as the script spells it (2026-10-21).
// The transcriber's words carry the timing, but on a short bit it doubles a word at the bit's edge ("efforts efforts")
// and mishears what the script has right ("EI ecosystem", "come in here" for "comment Yacht"). The reel's words are
// lined up with the script: a word he said as written takes the script's spelling; a short stretch the transcriber heard
// differently, but that sounds like the script's words, becomes the script's words over the same time; anything else
// (his own words) stays as heard.
import { tokens } from './lib';

export interface CapWord { w: string; at: number; end: number }

const FUNC = new Set(('a an the and or are our is as at in on of to for it its you your we were with but by be been this that than then them they there their'
  + ' e è ed o a ad al il lo la le gli di da in con per non che ci si ma').split(' '));
const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** How alike two strings are (difflib's ratio: twice the matched letters over both lengths). */
function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const match = (x: string, y: string): number => {
    if (!x.length || !y.length) return 0;
    let bi = 0, bj = 0, bk = 0;
    for (let i = 0; i < x.length; i++) for (let j = 0; j < y.length; j++) {
      let k = 0;
      while (i + k < x.length && j + k < y.length && x[i + k] === y[j + k]) k++;
      if (k > bk) { bi = i; bj = j; bk = k; }
    }
    return bk ? bk + match(x.slice(0, bi), y.slice(0, bj)) + match(x.slice(bi + bk), y.slice(bj + bk)) : 0;
  };
  return (2 * match(a, b)) / (a.length + b.length);
}

export function scriptSpelling(words: CapWord[], script: string): { words: CapWord[]; changes: string[] } {
  const changes: string[] = [];
  // 1. a word heard twice within a breath is the transcriber's double, not him (a real repeat fails the check)
  const W: CapWord[] = [];
  for (const w of words) {
    const prev = W[W.length - 1];
    if (prev && plain(prev.w) && plain(prev.w) === plain(w.w) && w.at - prev.end < 0.15) { changes.push(`"${prev.w} ${w.w}" heard once`); prev.end = Math.max(prev.end, w.end); continue; }
    W.push({ ...w });
  }
  const S = script.split(/\s+/).filter((d) => tokens(d).length);
  const A = W.map((w) => plain(w.w)), B = S.map(plain);
  const n = A.length, m = B.length;
  if (!n || !m) return { words: W, changes };
  // 2. the reel against the script, end to end (the script's clauses he left out cost nothing at either end)
  const H = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  for (let i = 1; i <= n; i++) H[i]![0] = -i;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    H[i]![j] = Math.max(H[i - 1]![j - 1]! + (A[i - 1] === B[j - 1] ? 2 : -1), H[i - 1]![j]! - 1, H[i]![j - 1]! - (i === n ? 0 : 1));
  }
  const pairs: [number, number][] = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (A[i - 1] === B[j - 1] && H[i]![j] === H[i - 1]![j - 1]! + 2) { pairs.push([i - 1, j - 1]); i--; j--; }
    else if (H[i]![j] === H[i]![j - 1]! - (i === n ? 0 : 1)) j--;
    else if (H[i]![j] === H[i - 1]![j]! - 1) i--;
    else { i--; j--; }
  }
  pairs.reverse();
  // 3. the words he said as written take the script's spelling; the stretches between them are judged one by one
  const out: CapWord[] = [];
  let pi = -1, pj = -1;
  const between = (ia: number, ib: number, ja: number, jb: number) => {
    const R = W.slice(ia, ib), Q = S.slice(ja, jb);
    if (!R.length) return;
    const r = ratio(R.map((w) => plain(w.w)).join(''), Q.map(plain).join(''));
    const oneFunc = R.length === 1 && Q.length === 1 && FUNC.has(plain(R[0]!.w)) && FUNC.has(plain(Q[0]!)) && r >= 0.4;
    if (ia > 0 && ib < n && Q.length && R.length <= 4 && Q.length <= 4 && (r >= 0.5 || oneFunc)) {
      const t0 = R[0]!.at, t1 = R[R.length - 1]!.end, total = Q.reduce((s, q) => s + plain(q).length, 0) || 1;
      let t = t0;
      for (const q of Q) { const d = ((t1 - t0) * plain(q).length) / total; out.push({ w: q, at: +t.toFixed(3), end: +(t + d).toFixed(3) }); t += d; }
      changes.push(`"${R.map((w) => w.w).join(' ')}" -> "${Q.join(' ')}"`);
    } else out.push(...R);
  };
  for (const [a, b] of pairs) {
    between(pi + 1, a, pj + 1, b);
    out.push({ ...W[a]!, w: S[b]! });
    pi = a; pj = b;
  }
  between(pi + 1, n, pj + 1, pj + 1);
  return { words: out, changes };
}

/** How many of `a`'s words appear in `b` in the same order. */
function lcs(a: string[], b: string[]): number {
  let prev = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    prev = cur;
  }
  return prev[b.length]!;
}

/** Pairs [i, j] of the longest run of equal words of `a` and `b`, in order. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i]![j] = a[i] && a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: [number, number][] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] && a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

/** Where a piece's words sit in the script: word index -> script index, for the words said as written (local alignment). */
function placeIn(a: string[], S: string[]): Map<number, number> {
  const n = a.length, m = S.length, H = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  let bi = 0, bj = 0;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    H[i]![j] = Math.max(0, H[i - 1]![j - 1]! + (a[i - 1] && a[i - 1] === S[j - 1] ? 2 : -1), H[i - 1]![j]! - 1, H[i]![j - 1]! - 1);
    if (H[i]![j]! > H[bi]![bj]!) { bi = i; bj = j; }
  }
  const at = new Map<number, number>();
  let i = bi, j = bj;
  while (i > 0 && j > 0 && H[i]![j]! > 0) {
    if (a[i - 1] && a[i - 1] === S[j - 1] && H[i]![j] === H[i - 1]![j - 1]! + 2) { at.set(i - 1, j - 1); i--; j--; }
    else if (H[i]![j] === H[i - 1]![j]! - 1) i--;
    else if (H[i]![j] === H[i]![j - 1]! - 1) j--;
    else { i--; j--; }
  }
  return at;
}

type Heard = { w: string; take: string; start: number; end: number };
/**
 * The words of a piece, from two hearings of it: the short bits' (the matcher's, timed closely) and the whole
 * sentence's. Where they agree the bits' word stays; where they differ, the script decides which hearing is right at
 * that spot, and on a tie the bits stay. Outdoors (2026-10-21) the bits doubled words at their edges and heard "Zolt"
 * for "results", lost "bushes" and "entrepreneurs"; the whole sentence lost two "you"s and caught an "AI" from a dropped
 * retake. Indoors the two agree almost everywhere.
 */
export function mergeHearings<T extends Heard>(bits: T[], whole: T[], script: string, piece: { a: number; b: number }): T[] {
  if (!whole.length || !script.trim()) return bits;
  if (!bits.length) return whole;
  const S = script.split(/\s+/).map(plain).filter(Boolean);
  const A = bits.map((w) => plain(w.w)), Wt = whole.map((w) => plain(w.w));
  const at = placeIn(A, S);
  const windowFor = (a0: number, a1: number) => {
    let jl = -1, jr = -1;
    for (let k = a0 - 1; k >= 0; k--) if (at.has(k)) { jl = at.get(k)!; break; }
    for (let k = a1; k < A.length; k++) if (at.has(k)) { jr = at.get(k)!; break; }
    if (jl < 0 && jr < 0) return S;
    if (jl < 0) return S.slice(Math.max(0, jr - 3), jr);
    if (jr < 0) return S.slice(jl + 1, jl + 4);
    return S.slice(jl + 1, jr);
  };
  const score = (run: T[], win: string[]) => { const r = run.map((w) => plain(w.w)).filter(Boolean), k = lcs(r, win); return k - 0.5 * (r.length - k); };
  const out: T[] = [];
  let pa = 0, pw = 0;
  const region = (a1: number, w1: number) => {
    const Rb = bits.slice(pa, a1), Rw = whole.slice(pw, w1);
    if (!Rb.length && !Rw.length) return;
    const win = windowFor(pa, a1);
    if (score(Rw, win) <= score(Rb, win)) { out.push(...Rb); return; }
    // the whole sentence's words, in the time between the words around them
    const lo = out.length ? out[out.length - 1]!.end : piece.a, hi = a1 < bits.length ? bits[a1]!.start : piece.b;
    if (Rw.every((w) => w.start >= lo - 0.05 && w.end <= hi + 0.05)) { out.push(...Rw.map((w) => ({ ...w, start: Math.max(w.start, lo), end: Math.min(Math.max(w.end, w.start + 0.05), hi) }))); return; }
    const total = Rw.reduce((s, w) => s + Math.max(1, plain(w.w).length), 0), span = Math.max(0.05 * Rw.length, hi - lo);
    let t = lo;
    for (const w of Rw) { const d = (span * Math.max(1, plain(w.w).length)) / total; out.push({ ...w, start: +t.toFixed(3), end: +(t + d).toFixed(3) }); t += d; }
  };
  for (const [ia, iw] of lcsPairs(A, Wt)) { region(ia, iw); out.push(bits[ia]!); pa = ia + 1; pw = iw + 1; }
  region(bits.length, whole.length);
  return out;
}
