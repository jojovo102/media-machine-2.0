#!/usr/bin/env bun
// The business page's captions (2026-10-22). Josef rejected the editor's boxed mono captions ("the captions with that
// background is terrible"), saw four looks on a still and asked for "a mix of all 4":
//   base   a clean subtitle (up to 4 words, one or two lines), the word being said in Ophanim gold
//   key    on a line holding one of the plan's `emphasis` words (the captions cell's "emphasis": [...], at most one
//          every 4 s): the rest of the line small, that word big in gold under it as it is said
//   punch  a sentence of three words or fewer: one big white word at a time
// White type in the site's font with a soft shadow, no box. The height is the editor's own (layout.py: the seam on
// split, the collar on wide and tight), read through caption_y.py, so the layout gates still hold. Writes the caption
// layer the editor's placement and assemble take: hf-graphics/captions/renders/captions-alpha.mov and -sa.mov
// (ProRes 4444, straight alpha, the plan's exact frame count).
//   bun presets/talking-head/captions-mix.ts <job folder>
import path from 'node:path';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { EDITOR, ffmpeg, readJson } from '../../engine/lib';
import { curly, esc, renderPngs } from '../../engine/core/text';

const J = path.resolve(process.argv[2] ?? '');
const name = path.basename(J);
const plan = readJson<{ duration: number; fps: string; layout: { start: number; end: number }[]; beats?: { id: string; kind?: string; start: number; shot_cuts?: number[]; emphasis?: string[] }[] }>(path.join(J, 'graphics-plan.json'));
const FPS = Number(plan.fps) || 30, DUR = plan.duration, FRAMES = Math.round(DUR * FPS);
const words = readJson<{ words: { text: string; start: number; end: number }[] }>(path.join(J, 'outputs', `${name}.transcript.json`)).words.filter((w) => w.text.trim());
const capCell = (plan.beats ?? []).find((c) => c.kind === 'captions');
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9']/g, '');
const EMPH = new Set((capCell?.emphasis ?? []).map(norm));
// a thin dark outline under the fill and a soft shadow: the type reads on sun-lit skin and on a page alike, with no box
const GOLD = '#C9A84C', SHADOW = 'text-shadow: 0 4px 22px rgba(0,0,0,.6), 0 1px 3px rgba(0,0,0,.7); -webkit-text-stroke: 5px rgba(8,8,8,.75); paint-order: stroke fill;';

// ---- lines: break at a sentence's end, at every layout switch and shot cut, and at 4 words or 26 characters
const breaks = [...plan.layout.map((r) => r.start), ...(plan.beats ?? []).flatMap((c) => c.shot_cuts ?? [])].filter((t) => t > 0).sort((a, b) => a - b);
type W = { text: string; start: number; end: number };
type Line = { words: W[]; kind: 'base' | 'key' | 'punch'; key?: number; y: number; mode?: string };
const sentences: W[][] = [];
let cur: W[] = [];
for (const w of words) {
  cur.push(w);
  if (/[.?!]["”]?$/.test(w.text)) { sentences.push(cur); cur = []; }
}
if (cur.length) sentences.push(cur);
const lines: Line[] = [];
let lastKey = -99;
for (const s of sentences) {
  if (s.length <= 3) { for (const w of s) lines.push({ words: [w], kind: 'punch', y: 0 }); continue; }
  let ln: W[] = [];
  const flush = () => { if (ln.length) lines.push({ words: ln, kind: 'base', y: 0 }); ln = []; };
  for (const w of s) {
    const crosses = ln.length && breaks.some((t) => t > ln[0]!.start + 0.01 && t <= w.start + 0.01);
    if (ln.length && (crosses || ln.length >= 4 || [...ln, w].map((x) => x.text).join(' ').length > 26)) flush();
    ln.push(w);
  }
  flush();
}
// ---- heights and layout modes from the editor's layout
const ys = JSON.parse(Bun.spawnSync(['uv', 'run', '--no-project', '--python', '3.12', 'python', path.join(import.meta.dir, 'caption_y.py'),
  path.join(EDITOR, 'presets', 'instagram', 'talking-head-explainer'), J, ...lines.map((l) => String(l.words[0]!.start + 0.01))]).stdout.toString()) as [number, string][];
lines.forEach((l, i) => { [l.y, l.mode] = ys[i]!; });
for (const l of lines) {
  // the big keyword only over his face (wide, tight): on a split shot it would sit on the page's own text
  if (l.kind !== 'base' || l.mode === 'S' || l.mode === 'F') continue;
  const k = l.words.findIndex((w) => EMPH.has(norm(w.text)));
  if (k >= 0 && l.words[k]!.start - lastKey >= 4) { l.kind = 'key'; l.key = k; lastKey = l.words[k]!.start; }
}


// ---- the states: one picture per word said, held to the next
const dir = path.join(J, 'hf-graphics', 'captions', 'mix');
mkdirSync(dir, { recursive: true });
const wordHtml = (w: W, on: boolean) => `<span style="${on ? `color:${GOLD}` : ''}">${esc(curly(w.text.replace(/[,;:]$/, '')))}</span>`;
const box = (y: number, inner: string) => `<div style="position:absolute;left:70px;right:70px;top:${y}px;transform:translateY(-50%);text-align:center;color:#fff;${SHADOW}">${inner}</div>`;
function state(l: Line, said: number): string {
  if (l.kind === 'punch') return box(l.y, `<div style="font-weight:800;font-size:140px;line-height:1;letter-spacing:-4px">${esc(curly(l.words[0]!.text.replace(/[,;:]$/, '')))}</div>`);
  if (l.kind === 'key') {
    const k = l.key!, rest = l.words.filter((_, i) => i !== k);
    const small = `<div style="font-weight:600;font-size:48px;line-height:1.2">${rest.map((w) => wordHtml(w, l.words.indexOf(w) === said)).join(' ')}</div>`;
    const big = said >= k ? `<div style="font-weight:800;font-size:150px;line-height:1;letter-spacing:-5px;color:${GOLD};text-transform:uppercase">${esc(curly(l.words[k]!.text.replace(/[,;:.!?]$/, '')))}</div>` : '';
    return box(l.y - 40, small + big);
  }
  return box(l.y, `<div style="font-weight:700;font-size:58px;line-height:1.2;max-width:820px;margin:0 auto">${l.words.map((w, i) => wordHtml(w, i === said)).join(' ')}</div>`);
}
const jobs: { body: string; out: string }[] = [{ body: '', out: path.join(dir, 'empty.png') }];
const timeline: { file: string; d: number }[] = [];
let now = 0;
lines.forEach((l, li) => {
  const next = lines[li + 1];
  l.words.forEach((w, wi) => {
    const out = path.join(dir, `l${li}-w${wi}.png`);
    jobs.push({ body: state(l, wi), out });
    const a = Math.max(now, w.start);
    const lastWord = wi === l.words.length - 1;
    const end = lastWord ? Math.min(next ? next.words[0]!.start : DUR, w.end + (next && next.words[0]!.start - w.end < 0.6 ? 10 : 0.25)) : l.words[wi + 1]!.start;
    if (a > now + 0.001) { timeline.push({ file: jobs[0]!.out, d: a - now }); now = a; }
    const b = Math.max(a + 1 / FPS, Math.min(end, DUR));
    timeline.push({ file: out, d: b - now }); now = b;
  });
});
if (DUR > now) timeline.push({ file: jobs[0]!.out, d: DUR - now });
await renderPngs(1080, 1920, jobs);
const list = path.join(dir, 'list.txt');
writeFileSync(list, timeline.map((x) => `file '${x.file}'\nduration ${x.d.toFixed(5)}`).join('\n') + `\nfile '${timeline[timeline.length - 1]!.file}'\n`);
const renders = path.join(J, 'hf-graphics', 'captions', 'renders');
mkdirSync(renders, { recursive: true });
const out = path.join(renders, 'captions-alpha-sa.mov');
ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${FPS},format=yuva444p10le`, '-frames:v', String(FRAMES), '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', out]);
copyFileSync(out, path.join(renders, 'captions-alpha.mov'));
const counts = { base: 0, key: 0, punch: 0 };
for (const l of lines) counts[l.kind]++;
console.log(`captions (mix): ${lines.length} lines (${counts.base} base, ${counts.key} key, ${counts.punch} punch), ${words.length} words, ${FRAMES} frames -> ${path.relative(J, out)}`);
