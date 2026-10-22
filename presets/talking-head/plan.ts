#!/usr/bin/env bun
// The business reel's plan, written by the machine (2026-10-22). Josef: "start building the machine for the biz": the
// first business reel's plan and storyboard were written by hand; this writes both from the cut alone, so a take goes
// from his recording to a dressed reel with no hand edits. It follows the editor's own rules (layout.py § 13), so the
// plan gates judge it exactly as they judged the hand-written one:
//   beats    the V1 pieces of the cut; a piece over 4.5 s is split at a sentence or clause end (1 frame before the
//            next word, the editor's switch rule); a piece under 0.5 s joins the one before it
//   hook     split (S) from frame 0 on a real screen; the beat after it on his face (T, the editor's post-hook rule)
//   the ask  "comment <Keyword>" in the last stretch: split to the end, the editor's DM-thread enactment (comment_ask)
//   face     about a fifth of the reel on his face (T 1.5-4.5 s, W under 1.5 s): the lines no screen matches, a
//            question or a line about "I"/"you" first; never two of one mode side by side, never just before the ask
//   screens  every other beat on the real OS screen its words call (library/os-screens/index.json keywords), the
//            least used and never the one just shown when nothing matches; each use of a screen frames its next spot
//   shots    a beat over 4 s is cut in two on a word (the editor's stale rule: something changes every 4.5 s)
//   emphasis one word per face line (the last strong one) and the ask's keyword: the captions' big gold word
// Writes graphics-plan.json and storyboard.json (the STORYBOARD the run's build step puts into the job's build.py, and
// the screens its stage step stages). The run never overwrites a plan it did not write (planned_by), so a hand plan
// stays a hand plan.
//   bun presets/talking-head/plan.ts <job folder> [look.json]
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { EDITOR, LIBRARY, ROOT, readJson } from '../../engine/lib';
import { tmpdir } from 'node:os';

const J = path.resolve(process.argv[2] ?? '');
const name = path.basename(J);
type Look = { captionY?: { wide: number; tight: number }; join?: string[]; cta?: { reply_text: string; attachment?: [string, string] }; screens?: 'match' | 'none' };
const look: Look = process.argv[3] && existsSync(process.argv[3]) ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : {};
const FPS = 30;
const fr = (t: number) => Math.round(t * FPS);
const sec = (f: number) => +(f / FPS).toFixed(6);

// ---- the cut: words, V1 cuts (the editor's own reading of cuts.json: piece lengths summed), the length
type W = { text: string; start: number; end: number; f: number };
const words: W[] = readJson<{ words: { text: string; start: number; end: number }[] }>(path.join(J, 'outputs', `${name}.transcript.json`))
  .words.filter((w) => w.text.trim()).map((w) => ({ ...w, f: fr(w.start) }));
const segs = readJson<{ segments: { start: number; end: number }[] }>(path.join(J, 'transcript', 'cuts.json')).segments;
const cutF: number[] = [];
let acc = 0;
for (const s of segs) { acc += s.end - s.start; cutF.push(fr(acc)); }
const END = cutF.pop()!;
const DUR = sec(END);
const isCut = (f: number) => cutF.includes(f);
const nearCut = (f: number, n: number) => cutF.some((c) => c !== f && Math.abs(c - f) <= n);

const norm = (t: string) => t.toLowerCase().replace(/[’`]/g, "'").normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9']/g, '');
const ends = (w: W, re: RegExp) => re.test(w.text.trim().replace(/["”’)]+$/, ''));
const wordsIn = (a: number, b: number) => words.filter((w) => w.f >= a && w.f < b);
const line = (ws: W[]) => ws.map((w) => w.text.trim()).join(' ');

// ---- the screens
type Screen = { id: string; title: string; hook?: boolean; focus: number[]; keywords: string[]; max?: number; use?: boolean };
const idx = readJson<{ fill: string; zoom: number; drift: number; screens: Screen[] }>(path.join(LIBRARY, 'os-screens', 'index.json'));
idx.screens = idx.screens.filter((s) => s.use !== false);
const VIEW = Math.round(960 / idx.zoom / 2); // half the page height the panel sees
// ink per row of a screen (pixels off the page colour): a framing's top edge is nudged (up to 90 px) onto empty rows
// for the whole drift, so the panel never opens through a line of text (2026-10-22: a title sliced at the top edge)
const inkRows = new Map<string, Uint16Array>();
function ink(id: string): Uint16Array {
  if (!inkRows.has(id)) {
    const raw = Bun.spawnSync(['ffmpeg', '-v', 'error', '-i', path.join(LIBRARY, 'os-screens', `${id}.png`), '-vf', 'format=gray', '-f', 'rawvideo', '-']).stdout;
    const rows = new Uint16Array(3248);
    for (let y = 0; y < 3248; y++) { let n = 0; for (let x = 0; x < 1500; x++) if (raw[y * 1500 + x]! > 34) n++; rows[y] = n; }
    inkRows.set(id, rows);
  }
  return inkRows.get(id)!;
}
const clampFocus = (y: number, s?: Screen) => Math.min(Math.max(y, VIEW), 3248 - VIEW - idx.drift, s?.max ?? Infinity);
function focusAt(y: number, s?: Screen): number {
  const base = clampFocus(y, s);
  if (!s) return base;
  const rows = ink(s.id);
  const cost = (f: number) => { let c = 0; for (let r = f - VIEW; r <= f - VIEW + idx.drift; r++) c += rows[r] ?? 0; return c; };
  let best = base, bc = cost(base);
  for (let d = -90; d <= 90; d += 2) {
    const f = clampFocus(base + d, s);
    const c = cost(f) + Math.abs(d) * 0.5;
    if (c < bc) { best = f; bc = c; }
  }
  return best;
}
function hits(ws: W[], s: Screen): number {
  const toks = ws.map((w) => norm(w.text));
  let n = 0;
  for (const k of s.keywords) {
    const parts = k.toLowerCase().split(/\s+/);
    const m = (tok: string, p: string) => (p.endsWith('*') ? tok.startsWith(p.slice(0, -1)) : tok === p);
    if (toks.some((_, i) => parts.every((p, j) => toks[i + j] !== undefined && m(toks[i + j]!, p)))) n++;
  }
  return n;
}

// ---- the ask: the last "comment <word>" in the final 40 %
let askAt = -1;
for (let i = words.length - 2; i >= 0; i--) if (norm(words[i]!.text) === 'comment' && words[i]!.f > END * 0.6) { askAt = i; break; }
// the ask's sentence opens after the last sentence end before "comment"
let askStart = askAt;
while (askStart > 0 && !ends(words[askStart - 1]!, /[.?!]$/)) askStart--;

// ---- beats
type Beat = { a: number; b: number; ws: W[]; mode?: 'S' | 'T' | 'W'; screen?: Screen; focus?: number; role?: string };
let beats: Beat[] = [];
const edges = [0, ...cutF, END];
for (let i = 0; i < edges.length - 1; i++) beats.push({ a: edges[i]!, b: edges[i + 1]!, ws: wordsIn(edges[i]!, edges[i + 1]!) });
// the ask opens its own beat
if (askStart >= 0) {
  const f = words[askStart]!.f - 1;
  const k = beats.findIndex((x) => x.a < f && f < x.b);
  if (k >= 0 && f - beats[k]!.a > 15 && !isCut(f) && !nearCut(f, 2)) {
    const x = beats[k]!;
    beats.splice(k, 1, { a: x.a, b: f, ws: wordsIn(x.a, f) }, { a: f, b: x.b, ws: wordsIn(f, x.b) });
  }
}
// long beats split at a sentence (then a clause) end nearest their middle, 1 frame before the next word
function split(x: Beat): Beat[] {
  if (x.b - x.a <= 4.5 * FPS) return [x];
  const mid = (x.a + x.b) / 2;
  const cands = x.ws.slice(1).map((w, i) => ({ w, prev: x.ws[i]! })).filter(({ w }) => w.f - 1 - x.a >= 36 && x.b - (w.f - 1) >= 36 && !nearCut(w.f - 1, 4))
    .map(({ w, prev }) => ({ f: w.f - 1, cost: Math.abs(w.f - 1 - mid) + (ends(prev, /[.?!]$/) ? 0 : ends(prev, /[,;:]$/) ? 20 : 60) }))
    .sort((p, q) => p.cost - q.cost);
  if (!cands.length) return [x];
  const f = cands[0]!.f;
  return [...split({ a: x.a, b: f, ws: wordsIn(x.a, f) }), ...split({ a: f, b: x.b, ws: wordsIn(f, x.b) })];
}
beats = beats.flatMap(split);
// a sliver (a "Like," between two cuts) joins the beat before it; the hook is at least 2 s
for (let i = 1; i < beats.length; i++) {
  if (beats[i]!.b - beats[i]!.a < 15 && !(askStart >= 0 && beats[i]!.ws[0] === words[askStart])) {
    beats[i - 1]!.b = beats[i]!.b; beats[i - 1]!.ws.push(...beats[i]!.ws); beats.splice(i, 1); i--;
  }
}
while (beats.length > 2 && beats[0]!.b - beats[0]!.a < 2 * FPS) { beats[0]!.b = beats[1]!.b; beats[0]!.ws.push(...beats[1]!.ws); beats.splice(1, 1); }

// ---- modes
const ask = askStart >= 0 ? beats.findIndex((x) => x.ws.includes(words[askStart]!)) : -1;
if (ask >= 0) { const x = beats[ask]!; x.b = END; x.ws = wordsIn(x.a, END); beats = beats.slice(0, ask + 1); x.mode = 'S'; x.role = 'cta'; }
// Josef 2026-10-22 on the screens matched by keyword: "all the other from the OS had nothing to do". look.json
// "screens": "none" keeps his face full frame from frame 0 to the ask, a jump cut alternating wide and punched in at
// every beat (his own May edit of this take); the ask keeps its DM thread ("that was cool")
const FACE_ONLY = look.screens === 'none';
if (FACE_ONLY) beats.forEach((x, i) => { if (x.role !== 'cta') x.mode = i % 2 === 0 ? 'W' : 'T'; });
else { beats[0]!.mode = 'S'; beats[0]!.role = 'hook'; }
const last = ask >= 0 ? ask - 1 : beats.length; // the beat before the ask stays split (L-CTA)
const faceMode = (x: Beat) => (x.b - x.a < 1.5 * FPS ? 'W' : 'T') as 'T' | 'W';
const canFace = (i: number) => i >= 1 && i < last && beats[i]!.b - beats[i]!.a <= 4.5 * FPS && !beats[i]!.mode;
const besideOk = (i: number) => [beats[i - 1], beats[i + 1]].every((n) => !n || n.mode === 'S' || !n.mode || n.mode !== faceMode(beats[i]!));
const target = 0.2 * END;
let face = 0;
const choose = (i: number) => { beats[i]!.mode = faceMode(beats[i]!); face += beats[i]!.b - beats[i]!.a; };
if (!FACE_ONLY && canFace(1)) choose(1);
const personal = (x: Beat) => x.ws.some((w) => /\?$/.test(w.text.trim())) || x.ws.some((w) => ['i', "i'm", 'my', 'me', 'you', "you're", 'your'].includes(norm(w.text)));
const order = beats.map((x, i) => ({ i, best: Math.max(0, ...idx.screens.map((s) => hits(x.ws, s))), personal: personal(x), d: x.b - x.a }))
  .filter(({ i }) => canFace(i)).sort((p, q) => p.best - q.best || Number(q.personal) - Number(p.personal) || p.d - q.d);
for (const { i, d } of FACE_ONLY ? [] : order) {
  if (face + d > target + 1.5 * FPS || !canFace(i) || !besideOk(i)) continue;
  choose(i);
}
for (const x of beats) x.mode ??= 'S';

// ---- a screen for every split beat but the ask
const used = new Map<string, number>();
let prev = '';
for (const x of beats) {
  if (x.mode !== 'S' || x.role === 'cta') { if (x.mode !== 'S') prev = ''; continue; }
  const pool = idx.screens.map((s) => ({ s, h: hits(x.ws, s) }));
  const best = Math.max(...pool.map((p) => p.h));
  const cands = best > 0 ? pool : pool.filter((p) => (x.role === 'hook' ? p.s.hook : true));
  const pick = cands.map((p) => ({ ...p, cost: -3 * p.h + (p.s.id === prev ? 2 : 0) + 0.5 * (used.get(p.s.id) ?? 0) }))
    .sort((p, q) => p.cost - q.cost)[0]!.s;
  const n = used.get(pick.id) ?? 0;
  x.screen = pick; x.focus = focusAt(pick.focus[n % pick.focus.length]! + (n >= pick.focus.length ? 200 : 0), pick);
  used.set(pick.id, n + 1);
  prev = pick.id;
}

// ---- rows and cells: the hook, each run of split beats, each face beat, the ask
type Shot = { screen: Screen; focus: number; a: number; b: number };
type Cell = { id: string; a: number; b: number; role: string; beats: Beat[]; shots: Shot[] };
const rows: { a: number; b: number; mode: string; why: string }[] = [];
const cells: Cell[] = [];
for (let i = 0; i < beats.length; i++) {
  const x = beats[i]!;
  if (x.mode !== 'S') {
    rows.push({ a: x.a, b: x.b, mode: x.mode!, why: `"${line(x.ws)}": on his face, full frame (${x.mode === 'T' ? 'punched in' : FACE_ONLY ? 'wide' : 'a breath, wide'})` });
    continue;
  }
  const run = [x];
  if (!x.role) while (beats[i + 1] && beats[i + 1]!.mode === 'S' && !beats[i + 1]!.role) run.push(beats[++i]!);
  const c: Cell = { id: `g${cells.length + 1}`, a: run[0]!.a, b: run[run.length - 1]!.b, role: x.role ?? 'demo', beats: run, shots: [] };
  cells.push(c);
  rows.push({ a: c.a, b: c.b, mode: 'S', why: x.role === 'cta' ? 'the ask: the comment thread, split to the end' : x.role === 'hook' ? `the hook on the real ${x.screen!.title}` : `the real ${[...new Set(run.map((r) => r.screen!.title))].join(', then the ')}` });
}
// a shot changes 0-2 frames before a word: on a V1 cut when the next word starts within 2 frames of it, else 1 frame
// before that word when no cut is within 5 frames (a shot change next to a cut is a double cut on the program)
function shotEdge(f: number): number | null {
  const w = words.find((x) => x.f >= f);
  if (!w) return null;
  if (w.f - f <= 2) return f;
  const s = w.f - 1;
  return nearCut(s, 5) || isCut(s) ? null : s;
}
function midEdge(a: number, b: number): number | null {
  const mid = (a + b) / 2;
  const opts = words.filter((w) => w.f - 1 - a >= 45 && b - (w.f - 1) >= 45).map((w) => w.f - 1).filter((s) => !nearCut(s, 5) && !isCut(s))
    .sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
  return opts[0] ?? null;
}
for (const c of cells.filter((c) => c.role !== 'cta')) {
  let shots: Shot[] = [];
  for (const x of c.beats) {
    const e = shots.length ? shotEdge(x.a) : x.a;
    if (e === null || (shots.length && shots[shots.length - 1]!.screen.id === x.screen!.id)) { shots[shots.length - 1]!.b = x.b; continue; }
    if (shots.length) shots[shots.length - 1]!.b = e;
    shots.push({ screen: x.screen!, focus: x.focus!, a: e, b: x.b });
  }
  // nothing holds over 4 s: a long shot cut in two on a word, the second further down the same page
  for (let k = 0; k < shots.length; k++) {
    const s = shots[k]!;
    if (s.b - s.a <= 4 * FPS) continue;
    const e = midEdge(s.a, s.b);
    if (e === null) continue;
    const next = focusAt(s.focus + 420, s.screen); // further down the same page: the scroll goes on
    shots.splice(k, 1, { ...s, b: e }, { ...s, a: e, focus: next });
    k--;
  }
  c.shots = shots;
}

// ---- the ask's words (each said once in the cell, so the build finds it without doubt)
const cta = cells.find((c) => c.role === 'cta');
let askWords: { comment: string; keyword: string; send: string; reply: string } | null = null;
if (cta) {
  const ws = cta.beats[0]!.ws;
  const clean = (w: W) => w.text.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '');
  const once = (w: W) => ws.filter((v) => norm(v.text) === norm(w.text)).length === 1;
  const k = ws.findIndex((w) => norm(w.text) === 'comment');
  const rest = ws.slice(k + 2).filter((w) => clean(w).length >= 3 && once(w));
  const at = (p: number) => rest[Math.min(rest.length - 1, Math.floor(rest.length * p))];
  if (k >= 0 && ws[k + 1] && rest.length >= 2) askWords = { comment: clean(ws[k]!), keyword: clean(ws[k + 1]!), send: clean(at(0.35)!), reply: clean(at(0.8)!) };
  if (askWords && askWords.send === askWords.reply) askWords.reply = clean(rest[rest.length - 1]!);
}

// ---- emphasis: one word per face line, the strongest (a name said mid-sentence, a sentence's last word, a long one),
// and the keyword
const STOP = new Set("about after again also always because been before being both could didn't does doesn't doing don't down even every example first from give going gonna have having here into just know like little make many minute more most much never only other over place please really right second seconds same should show some someone still such than that that's their them then there these they thing things this those through time very want were what when where which while with would your you're you've we're i'm i've it's".split(' '));
const emphasis: string[] = [];
for (const x of beats.filter((x) => x.mode !== 'S')) {
  const scored = x.ws.map((w, i) => {
    const t = w.text.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '');
    const proper = i > 0 && /^\p{Lu}/u.test(t) && !ends(x.ws[i - 1]!, /[.?!]$/) && t !== 'I';
    return { t, s: (proper ? 3 : 0) + (ends(w, /[.?!]$/) ? 2 : 0) + t.length / 4 };
  }).filter(({ t }) => t.length >= 4 && !STOP.has(t.toLowerCase())).sort((a, b) => b.s - a.s);
  if (scored.length) emphasis.push(scored[0]!.t);
}
if (askWords) emphasis.push(askWords.keyword);

// ---- the copy the graphics QA must read on each screen cell: what the framing really shows, read by the same OCR
// (the editor's Apple Vision shim, compiled once into vendor/), cached per screen and spot
const OCR = path.join(ROOT, 'vendor', 'ocr');
if (!existsSync(OCR)) {
  const swift = path.join(ROOT, 'vendor', 'ocr.swift');
  Bun.spawnSync(['python3', '-c', `import ast,sys\nfor n in ast.parse(open(sys.argv[1]).read()).body:\n  if isinstance(n,ast.Assign) and any(getattr(t,'id','')=='SWIFT_OCR' for t in n.targets): open(sys.argv[2],'w').write(ast.literal_eval(n.value))`,
    path.join(EDITOR, 'workflows', 'graphics-qa-short.py'), swift]);
  if (Bun.spawnSync(['swiftc', '-O', swift, '-o', OCR]).exitCode !== 0) throw new Error('the OCR shim did not compile (xcode-select --install)');
}
const cacheFile = path.join(LIBRARY, 'os-screens', '.ocr-cache.json');
const cache: Record<string, string> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
function readAt(id: string, focus: number): string {
  const key = `${id}@${focus}`;
  if (cache[key] !== undefined) return cache[key]!;
  const png = path.join(tmpdir(), `os-view-${process.pid}.png`);
  Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-i', path.join(LIBRARY, 'os-screens', `${id}.png`), '-vf', `crop=1500:${2 * VIEW}:0:${focus - VIEW},scale=1080:960`, png]);
  const out = Bun.spawnSync([OCR], { stdin: Buffer.from(png + '\n') }).stdout.toString();
  cache[key] = out.split('\n').filter((l) => l.includes('\t')).map((l) => l.split('\t')[1]).join(' ');
  writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
  return cache[key]!;
}
function copyFor(c: Cell): string {
  const t = c.a + 0.3 * (c.b - c.a);
  const s = c.shots.find((x) => x.a <= t && t < x.b) ?? c.shots[0]!;
  const toks = (txt: string) => new Set(txt.split(/\s+/).filter((w) => /^[A-Za-z]{4,}[.,:]?$/.test(w)).map((w) => w.replace(/[.,:]$/, '')));
  const a = toks(readAt(s.screen.id, s.focus)), b = toks(readAt(s.screen.id, s.focus + idx.drift));
  const both = [...a].filter((w) => b.has(w)).sort((p, q) => Number(/^[A-Z]/.test(q)) - Number(/^[A-Z]/.test(p)) || q.length - p.length);
  return both[0] ?? '';
}

// ---- the plan
const shotCuts = (c: Cell) => c.shots.slice(1).map((s) => sec(s.a));
const plan = {
  job: name,
  format: 'short-talking-head-explainer',
  preset: 'presets/instagram/talking-head-explainer',
  planned_by: 'media-machine presets/talking-head/plan.ts',
  duration: DUR,
  fps: String(FPS),
  layout: rows.map((r) => ({ start: sec(r.a), end: sec(r.b), mode: r.mode, why: r.why })),
  beats: [
    { id: 'captions', start: 0, end: DUR, graphic: true, kind: 'captions', region: 'captions', content: 'locked caption layer', join: look.join ?? [], emphasis: [...new Set(emphasis)] },
    ...cells.map((c) => {
      const said = line(c.beats.flatMap((x) => x.ws));
      if (c.role === 'cta') return {
        id: c.id, start: sec(c.a), end: sec(c.b), role: 'cta', graphic: true, kind: 'ui-enactment', family: 'authored', readable: false, line: said,
        copy: askWords?.keyword ?? '', visuals: [`a DM thread: the ask typed on "comment", "${askWords?.keyword ?? ''}" sent, the reply landing with the link`],
        sync: [{ word: 'comment', expect: 'change' }], reply_text: look.cta?.reply_text ?? 'Here it is',
      };
      const titles = [...new Set(c.shots.map((s) => s.screen.title))];
      return {
        id: c.id, start: sec(c.a), end: sec(c.b), role: c.role, graphic: true, kind: 'screenshot', family: 'capture', readable: true, line: said,
        shows: `the real ${titles.join(', then the ')} page${titles.length > 1 ? 's' : ''} of the OS`, asset: `assets/captures/${c.id}.png`,
        copy: copyFor(c), under_caption: true, visuals: c.shots.map((s) => `the real ${s.screen.title} page, phone width`),
        ...(c.shots.length > 1 ? { shot_cuts: shotCuts(c) } : {}),
      };
    }),
  ],
  layout_deviations: FACE_ONLY ? [{ rule: 'L-OPEN', why: 'Josef 2026-10-22: his face full frame from frame 0; no screen unless the line is about it (brands/ophanim/TASTE.md)' }] : [],
  variants: {},
};
if (cta && !askWords) throw new Error(`the ask "${line(cta.beats[0]!.ws)}" has no keyword after "comment" or too few words to time the thread on`);
writeFileSync(path.join(J, 'graphics-plan.json'), JSON.stringify(plan, null, 1));

// ---- the storyboard: the editor's page() per screen cell (each shot a gentle drift down its spot), comment_ask
const storyboard = {
  crop: [0, 0, 1500, 3248],
  fill: idx.fill,
  screens: [...new Set(cells.flatMap((c) => c.shots.map((s) => s.screen.id)))],
  // each screen cell's original under its own id (the plan's `asset`, what validate-plan.py checks)
  originals: Object.fromEntries(cells.filter((c) => c.role !== 'cta').map((c) => [c.id, c.shots[0]!.screen.id])),
  cells: Object.fromEntries(cells.map((c) => [c.id, c.role === 'cta'
    ? { recipe: FACE_ONLY ? 'comment_ask_cut' : 'comment_ask', ...askWords!, reply_text: look.cta?.reply_text ?? 'Here it is', attachment: look.cta?.attachment ?? null }
    : { recipe: 'page', shots: c.shots.map((s) => ({ file: `${s.screen.id}.png`, from: [750, s.focus], to: [750, s.focus + idx.drift], zoom: idx.zoom })) }])),
};
writeFileSync(path.join(J, 'storyboard.json'), JSON.stringify(storyboard, null, 1));

// ---- the summary
const share = (m: string) => rows.filter((r) => r.mode === m).reduce((n, r) => n + r.b - r.a, 0) / END;
console.log(`plan: ${DUR.toFixed(1)} s, ${rows.length} rows (S ${(share('S') * 100).toFixed(0)} %, T ${(share('T') * 100).toFixed(0)} %, W ${(share('W') * 100).toFixed(0)} %), ${cells.length} cells`);
for (const r of rows) console.log(`  ${sec(r.a).toFixed(2).padStart(6)}-${sec(r.b).toFixed(2).padStart(6)} ${r.mode}  ${r.why}`);
for (const c of cells) console.log(`  ${c.id} ${c.role}: ${c.role === 'cta' ? JSON.stringify(askWords) : c.shots.map((s) => `${s.screen.id}@${s.focus} ${sec(s.a).toFixed(2)}`).join(' | ')}`);
console.log(`  emphasis: ${plan.beats[0]!.emphasis.join(', ')}`);
