// Every word said, with when (2026-10-19, shared core). whisper-cli (large-v3-turbo, local).
//
// A take is cut into its stretches of voice ("islands": speech between pauses of a quarter second or more) and each is
// transcribed on its own (-mc 0). Whisper merges a sentence said twice into one when both are in what it hears at
// once: on 2026-10-19 cutting at half-second pauses still hid most of Josef's restarts (he restarts after 0.3 s), so
// the reel kept both tries and repeated itself. The word times inside an island come from whisper's DTW alignment;
// an island's first word starts where his voice starts and its last word ends where it stops (measured on the sound).
// All of a take's islands go through one whisper run per 80 files, so the model loads once.
//
// Filler words: whisper leaves out "um", "uh", "ehm" unless it is shown them. The prompt is written with fillers in it,
// which makes it write them down (`fillers: true`), so the cut can see them; the words come back marked `filler`.
import path from 'node:path';
import { rmSync } from 'node:fs';
import { WHISPER_MODEL, ensure, ffmpeg, has, readJson, run, samples, writeJson } from './media';

/** isl: the island (stretch of voice) the word was heard in; words of one island were said without a real pause. */
export interface Word { take: string; i: number; w: string; start: number; end: number; isl?: number; filler?: boolean; ghost?: boolean }
export interface Sentence { id: string; take: string; start: number; end: number; text: string; words: number[] }
export type Lang = 'en' | 'it';

/** Sounds that are never words. "tipo", "cioè", "allora", "praticamente", "diciamo", "like", "so" can be real words:
 * only a script (or the director) can tell, so they are not on this list. */
// Italian "e" alone is "and", a real word (cutting it chopped "i tuoi vizi e ti libererà", 2026-10-20): only a
// drawn-out "ee" or "eh", "ehm", "mmh" count.
const FILLERS: Record<Lang, RegExp> = {
  en: /^(u+m+|u+h+m*|e+r+m*|h+m+|m+h*m+|a+h+)$/i,
  it: /^(e+h+m*|e+m+|m+h*m+|u+h*m+|a+h+|e{2,})$/i,
};
export const isFiller = (w: string, lang: Lang) => FILLERS[lang].test(w.replace(/[^\p{L}]/gu, ''));

const PROMPTS: Record<Lang, (names: string) => string> = {
  // the fillers in the prompt are what make whisper write them down
  en: (names) => `Umm, so, uh, I was like, hmm, thinking about it. Okay. ${names}`,
  it: (names) => `Ehm, allora, cioè, ehm, praticamente, mmh, ecco. Va bene. ${names}`,
};

/** Phrases whisper writes into silence or noise (its well-known hallucinations), per language. */
const GHOST_PHRASES: Record<Lang, RegExp> = {
  en: /^(thank you( (so much|all))?|thanks for watching|you're welcome|bye|you)$/i,
  it: /^(grazie( a tutti| tutti| per la visione| per l'attenzione)?|sottotitoli.*|autore dei sottotitoli.*|revisione a cura.*|a cura di qtss|qtss|amara.*|iscriviti.*|you're welcome|thank you)$/i,
};

/**
 * Marks "ghost" words: whisper writes words into silence and noise (tested 2026-10-19 on a 10.5-minute Italian take:
 * "Grazie a tutti", "You're welcome" and invented words in the pauses). A word is a ghost when its own stretch of
 * sound is near silent next to his speech, or when it belongs to one of whisper's known phrases and is quiet.
 */
function markGhosts(words: Omit<Word, 'i'>[], file16k: string, lang: Lang) {
  const R = 4000, x = samples(file16k, R);
  const rms = (a: number, b: number) => {
    const i0 = Math.max(0, Math.floor(a * R)), i1 = Math.min(x.length, Math.max(i0 + 1, Math.floor(b * R)));
    let s = 0; for (let i = i0; i < i1; i++) s += x[i]! * x[i]!;
    return Math.sqrt(s / (i1 - i0));
  };
  const levels = words.map((w) => rms(w.start, w.end));
  const sorted = [...levels].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  // whisper's known phrases, as runs of words
  const flat = words.map((w) => w.w.toLowerCase().replace(/[^\p{L}' ]/gu, '').trim());
  for (let i = 0; i < words.length; i++) {
    if (levels[i]! < median * 0.07) words[i]!.ghost = true; // speech said softly at a phrase's end stays above this
    // a run of three or more quiet micro-words (whisper's subtitle credits, 60 ms each) is invented
    const micro = (k: number) => k >= 0 && k < words.length && words[k]!.end - words[k]!.start < 0.12 && levels[k]! < median * 0.45;
    if (micro(i) && ((micro(i - 1) && micro(i - 2)) || (micro(i - 1) && micro(i + 1)) || (micro(i + 1) && micro(i + 2)))) words[i]!.ghost = true;
    for (let n = 4; n >= 1; n--) {
      const phrase = flat.slice(i, i + n).join(' ');
      if (i + n <= words.length && GHOST_PHRASES[lang].test(phrase)) {
        const level = Math.max(...levels.slice(i, i + n));
        if (level < median * 0.45) for (let k = i; k < i + n; k++) words[k]!.ghost = true;
        break;
      }
    }
  }
}

/** The pauses in a file: [start, end] of every silence of `d` seconds or more. */
export function silences(file: string, d: number): [number, number][] {
  const r = Bun.spawnSync(['ffmpeg', '-hide_banner', '-i', file, '-af', `loudnorm=I=-20,silencedetect=noise=-38dB:d=${d}`, '-f', 'null', '-'], { stderr: 'pipe' });
  const e = r.stderr.toString(), out: [number, number][] = [];
  let s: number | null = null;
  for (const m of e.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === 'start') s = Number(m[2]);
    else if (s !== null) { out.push([Math.max(0, s), Number(m[2])]); s = null; }
  }
  return out;
}

/** Utterances: speech between pauses of half a second or more; anything longer than 25 s split at its longest pause. */
export function utterances(file: string, dur: number): [number, number][] {
  const long = silences(file, 0.5), short = silences(file, 0.2);
  const spans: [number, number][] = [];
  let a = 0;
  for (const [s, e] of long) { if (s - a > 0.15) spans.push([a, s]); a = e; }
  if (dur - a > 0.15) spans.push([a, dur]);
  const out: [number, number][] = [];
  const split = (x: [number, number]) => {
    if (x[1] - x[0] <= 25) { out.push(x); return; }
    const inside = short.filter(([s, e]) => s > x[0] + 3 && e < x[1] - 3).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
    const cut = inside ? (inside[0] + inside[1]) / 2 : (x[0] + x[1]) / 2;
    split([x[0], cut]); split([cut, x[1]]);
  };
  spans.forEach(split);
  return out;
}

/** The level of a 16 kHz file in dB, one value per 10 ms. */
export function levels10ms(file16k: string): Float32Array {
  const x = samples(file16k, 16000), hop = 160, n = Math.floor(x.length / hop), db = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < hop; k++) { const v = x[i * hop + k]!; s += v * v; } db[i] = 10 * Math.log10(s / hop + 1e-10); }
  return db;
}

/** Above this a 10 ms frame is voice: a third of the way from the room's floor to his speaking level. */
export function voiceThreshold(db: Float32Array): number {
  const sorted = [...db].sort((a, b) => a - b), n = sorted.length;
  const floor = sorted[Math.floor(n * 0.1)]!, speech = sorted[Math.floor(n * 0.9)]!;
  return floor + (speech - floor) * 0.35;
}

/**
 * Islands: stretches of voice, [start, end] in seconds, split at every pause of `gap` seconds or more (a quarter second:
 * shorter than the pause before a restart, longer than most pauses at a comma). Blips under 0.1 s are left out;
 * an island over 25 s is split at its longest inner pause.
 */
export function islands(file16k: string, gap = 0.25): [number, number][] {
  const db = levels10ms(file16k), thr = voiceThreshold(db);
  // first the bits of voice (bridging 120 ms dips), blips under 0.1 s (a breath, a click) dropped so they cannot bridge
  // a pause; then bits closer than `gap` joined
  const bits: [number, number][] = [];
  let a = -1, last = -1;
  for (let i = 0; i <= db.length; i++) {
    if (i < db.length && db[i]! > thr) { if (a < 0) a = i; last = i; }
    else if (a >= 0 && (i === db.length || i - last > 12)) { if (last + 1 - a >= 10) bits.push([a / 100, (last + 1) / 100]); a = -1; }
  }
  const raw: [number, number][] = [];
  for (const b of bits) {
    const p = raw[raw.length - 1];
    if (p && b[0] - p[1] < gap) p[1] = b[1];
    else raw.push([b[0], b[1]]);
  }
  const out: [number, number][] = [];
  const split = ([s, e]: [number, number]) => {
    if (e - s <= 25) { out.push([s, e]); return; }
    // the longest run of quiet frames inside, away from the ends
    let best = -1, bestLen = 0, run = 0;
    for (let i = Math.floor(s * 100) + 300; i < Math.floor(e * 100) - 300; i++) {
      run = db[i]! <= thr ? run + 1 : 0;
      if (run > bestLen) { bestLen = run; best = i - Math.floor(run / 2); }
    }
    const cut = best > 0 ? best / 100 : (s + e) / 2;
    split([s, cut]); split([cut, e]);
  };
  raw.forEach(split);
  return out;
}

/** The quietest moment between a and b (seconds), on the 10 ms levels: where a cut inside a stretch of voice goes. */
export function quietest(db: Float32Array, a: number, b: number): number {
  let best = Math.round(a * 100), lv = Infinity;
  for (let i = Math.max(0, Math.round(a * 100)); i <= Math.min(db.length - 1, Math.round(b * 100)); i++) if (db[i]! < lv) { lv = db[i]!; best = i; }
  return best / 100;
}

/**
 * Bits: the stretches of full voice inside a take, split at every soft pause of 0.15 s or more (the level more than
 * 8 dB under his voice's threshold for a breath, a hesitation, the dip before a restart; a lone 30 ms peak in it, a
 * click, does not end the pause). These are where Josef cuts in CapCut: on 7 October his cut points sat within 0.05 s
 * of a bit's start or end every time, and a restart without a real pause ("domina... dominava") is two bits.
 */
export function voiceBits(db: Float32Array): [number, number][] {
  const thr = voiceThreshold(db) + 8, strong = Array.from(db, (v) => v > thr);
  for (let i = 1; i < strong.length; i++) if (strong[i] && !strong[i - 1]) { let k = i; while (k < strong.length && strong[k]) k++; if (k - i <= 3) for (let j = i; j < k; j++) strong[j] = false; i = k; }
  const bits: [number, number][] = [];
  let a = -1, last = -1;
  for (let i = 0; i <= strong.length; i++) {
    if (i < strong.length && strong[i]) { if (a < 0) a = i; last = i; }
    else if (a >= 0 && (i === strong.length || i - last >= 15)) { if (last + 1 - a >= 12) bits.push([a / 100, (last + 1) / 100]); a = -1; }
  }
  return bits;
}

/** A bit of an island, with its own transcript when the island has more than one (`<base>.bits.json`). */
export interface Bit { take: string; isl: number; k: number; start: number; end: number; words: { w: string; start: number; end: number }[] }

/** Fixes names whisper spells wrong; the punctuation around a word is kept. */
export function nameFixer(names: [RegExp, string][]) {
  return (w: string) => {
    const m = w.match(/^([^\p{L}\p{N}]*)(.*?)(['’]s)?([^\p{L}\p{N}]*)$/u)!;
    for (const [re, to] of names) if (re.test(m[2]!)) return `${m[1]}${to}${m[3] ?? ''}${m[4]}`;
    return w;
  };
}

/**
 * Transcribes one take's 16 kHz sound (`<base>.16k.wav`), cached in `<base>.words.json`.
 * Returns the words with the take's clock times.
 */
export function transcribeTake(base: string, take: string, dur: number, o: { lang: Lang; names: string; fix?: (w: string) => string; again?: boolean }): Omit<Word, 'i'>[] {
  const cache = `${base}.words.json`;
  if (has(cache) && !o.again) {
    // ghosts and fillers are marked again on every run (cheap), so a better rule reaches transcripts already made
    const got = readJson<Omit<Word, 'i'>[]>(cache).map(({ ghost: _g, filler: _f, ...w }) => ({ ...w, ...(isFiller(w.w, o.lang) ? { filler: true } : {}) }));
    markGhosts(got, `${base}.16k.wav`, o.lang);
    writeJson(cache, got);
    if (!has(`${base}.bits.json`)) transcribeBits(base, take, islands(`${base}.16k.wav`), got, o);
    return got;
  }
  const dir = `${base}-isl`;
  rmSync(dir, { recursive: true, force: true });
  rmSync(`${base}-utt`, { recursive: true, force: true });
  ensure(dir);
  const isl = islands(`${base}.16k.wav`), PAD = 0.12;
  const files = isl.map(([a, b], i) => {
    const f = path.join(dir, `${String(i).padStart(4, '0')}.wav`);
    ffmpeg(['-ss', Math.max(0, a - PAD).toFixed(3), '-t', (b - a + 2 * PAD).toFixed(3), '-i', `${base}.16k.wav`, '-c:a', 'pcm_s16le', f]);
    return f;
  });
  for (let k = 0; k < files.length; k += 80) {
    run(['whisper-cli', '-m', WHISPER_MODEL, '-l', o.lang, '-ojf', '-np', '-mc', '0', '-dtw', 'large.v3.turbo', '-nfa', '--prompt', PROMPTS[o.lang](o.names), '--carry-initial-prompt', ...files.slice(k, k + 80).flatMap((f) => ['-f', f])], { quiet: true });
  }
  const got: Omit<Word, 'i'>[] = [];
  type Tok = { text: string; t_dtw?: number; offsets: { from: number; to: number } };
  isl.forEach(([a, b], n) => {
    const off = Math.max(0, a - PAD);
    const j = readJson<{ transcription: { tokens: Tok[] }[] }>(`${files[n]}.json`);
    // tokens into words: a token starting with a space starts a word; [_BEG_], [_TT_..] and the like are not words
    const ws: { w: string; t: number }[] = [];
    for (const seg of j.transcription) for (const t of seg.tokens) {
      if (/^\[_.*\]$/.test(t.text)) continue;
      const at = off + ((t.t_dtw ?? -1) >= 0 ? t.t_dtw! / 100 : t.offsets.from / 1000);
      if (!ws.length || /^\s/.test(t.text)) ws.push({ w: t.text.trim(), t: at });
      else ws[ws.length - 1]!.w += t.text;
    }
    const words = ws.filter((x) => x.w && !/^[\[(].*[\])]$/.test(x.w) && !/^[–—-]$/.test(x.w) && /[\p{L}\p{N}]/u.test(x.w));
    // punctuation-only tokens are glued on above; times kept inside the island, in order
    words.forEach((x, k) => {
      const fixed = o.fix ? o.fix(x.w) : x.w;
      const start = k === 0 ? a : Math.min(b - 0.05, Math.max(a, x.t));
      const end = k === words.length - 1 ? b : Math.max(start + 0.05, Math.min(b, words[k + 1]!.t));
      got.push({ take, w: fixed, start: +start.toFixed(3), end: +end.toFixed(3), isl: n, ...(isFiller(fixed, o.lang) ? { filler: true } : {}) });
    });
  });
  markGhosts(got, `${base}.16k.wav`, o.lang);
  writeJson(cache, got);
  transcribeBits(base, take, isl, got, o);
  return got;
}

/**
 * The bits of every island, each island with two or more transcribed bit by bit (whisper on the whole island hides a
 * restart with no real pause in it: "domina... dominava il Mediterraneo" came back as "dominava il Mediterraneo").
 * Written to `<base>.bits.json`; an island of one bit keeps the island's words.
 */
function transcribeBits(base: string, take: string, isl: [number, number][], got: Omit<Word, 'i'>[], o: { lang: Lang; names: string; fix?: (w: string) => string }) {
  const all = voiceBits(levels10ms(`${base}.16k.wav`));
  const out: Bit[] = [], todo: Bit[] = [];
  isl.forEach(([a, b], n) => {
    const mine = all.filter(([s, e]) => e > a && s < b).map(([s, e], k) => ({ take, isl: n, k, start: Math.max(a, s), end: Math.min(b, e), words: [] as Bit['words'] }));
    if (mine.length === 1) mine[0]!.words = got.filter((w) => w.isl === n && !w.ghost).map((w) => ({ w: w.w, start: w.start, end: w.end }));
    else todo.push(...mine);
    out.push(...mine);
  });
  const dir = `${base}-bits`, PAD = 0.06;
  rmSync(dir, { recursive: true, force: true });
  ensure(dir);
  const files = todo.map((bt, i) => {
    const f = path.join(dir, `${String(i).padStart(4, '0')}.wav`);
    ffmpeg(['-ss', Math.max(0, bt.start - PAD).toFixed(3), '-t', (bt.end - bt.start + 2 * PAD).toFixed(3), '-i', `${base}.16k.wav`, '-c:a', 'pcm_s16le', f]);
    return f;
  });
  for (let k = 0; k < files.length; k += 80) {
    run(['whisper-cli', '-m', WHISPER_MODEL, '-l', o.lang, '-ojf', '-np', '-mc', '0', '-dtw', 'large.v3.turbo', '-nfa', '--prompt', PROMPTS[o.lang](o.names), '--carry-initial-prompt', ...files.slice(k, k + 80).flatMap((f) => ['-f', f])], { quiet: true });
  }
  type Tok = { text: string; t_dtw?: number; offsets: { from: number; to: number } };
  todo.forEach((bt, i) => {
    const off = Math.max(0, bt.start - PAD);
    const j = readJson<{ transcription: { tokens: Tok[] }[] }>(`${files[i]}.json`);
    const ws: { w: string; t: number }[] = [];
    for (const seg of j.transcription) for (const t of seg.tokens) {
      if (/^\[_.*\]$/.test(t.text)) continue;
      const at = off + ((t.t_dtw ?? -1) >= 0 ? t.t_dtw! / 100 : t.offsets.from / 1000);
      if (!ws.length || /^\s/.test(t.text)) ws.push({ w: t.text.trim(), t: at });
      else ws[ws.length - 1]!.w += t.text;
    }
    const words = ws.filter((x) => x.w && !/^[\[(].*[\])]$/.test(x.w) && /[\p{L}\p{N}]/u.test(x.w));
    bt.words = words.map((x, k) => ({ w: o.fix ? o.fix(x.w) : x.w, start: +(k === 0 ? bt.start : Math.max(bt.start, Math.min(bt.end - 0.05, x.t))).toFixed(3), end: +(k === words.length - 1 ? bt.end : Math.max(bt.start + 0.05, Math.min(bt.end, words[k + 1]!.t))).toFixed(3) }));
    // whisper's phrases for silence ("Grazie a tutti") on a bit are not words
    if (GHOST_PHRASES[o.lang].test(bt.words.map((w) => w.w.toLowerCase().replace(/[^\p{L}' ]/gu, '')).join(' ').trim())) bt.words = [];
    // a short bit heard as something no one could say in it: "THE BEST OF THE BEST OF THE" in 0.45 s, a run of capitals
    // ("PRINT MONEY"), on an outdoor take (2026-10-21). The island's own words for that stretch are used instead.
    const span = Math.max(0.2, bt.end - bt.start), caps = bt.words.filter((w) => /^[A-Z]{3,}[.,!?]*$/.test(w.w)).length;
    // (he speaks fast: 3 quick words in a third of a second are real; 7 in under half a second are not)
    if ((bt.words.length >= 4 && bt.words.length / span > 10) || caps >= 2) {
      const own = got.filter((w) => w.isl === bt.isl && !w.ghost && w.start >= bt.start - 0.15 && w.start < bt.end + 0.05);
      if (own.length) bt.words = own.map((w) => ({ w: w.w, start: w.start, end: w.end }));
    }
  });
  writeJson(`${base}.bits.json`, out);
}


/** Sentences: words up to a full stop, question or exclamation mark, or a pause of more than a second. */
export function sentencesOf(words: Word[]): Sentence[] {
  const out: Sentence[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    const id = String(out.length + 1).padStart(3, '0');
    out.push({ id, take: cur[0]!.take, start: cur[0]!.start, end: cur[cur.length - 1]!.end, text: cur.map((w) => w.w).join(' ').replace(/\s+([,.?!;:])/g, '$1'), words: cur.map((w) => w.i) });
    cur = [];
  };
  words.forEach((w, k) => {
    const next = words[k + 1];
    if (cur.length && (cur[0]!.take !== w.take || w.start - cur[cur.length - 1]!.end > 1.0)) flush();
    cur.push(w);
    if (/[.?!]["”’)»]?$/.test(w.w) || !next || next.take !== w.take) flush();
  });
  flush();
  return out;
}
