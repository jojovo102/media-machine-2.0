#!/usr/bin/env bun
// VolpinVeritas' look after the cut (2026-10-22): its approved captions (2026-10-21, "Contro l'AI nei video": "This
// is very good, good job"): three words at a time in EB Garamond, cream, the word being said in the logo's red,
// at 52 % of the height, drawn by Chrome over the base cut. No drawn cards, no grade. Real pictures as b-roll from
// <session>/broll.json: [{"file": "broll/calendar.jpg", "from": "12 ore", "to": "giorno", "tail": 0.6}], each a
// picture floating over a blurred, darkened copy of itself (his own CapCut reels' way), hard cut in on the first word
// of `from` and out at the end of `to` (+ tail), above the captions' line. A picture from the web needs his OK.
// Style "hook" (2026-10-30, Josef: put the hook's pictures "in the same way" as his friend Tommaso's reel): his picture
// moved down (`shift` px, over a blurred copy of itself), two or more `files` side by side across the top, a `title`
// in white boxes with black type over their lower edge, the captions moved down with him; tried on one reel first.
// Writes outputs/<slug>-final.mp4, which finish.ts puts the music under.
//   bun presets/vv-captions/run.ts <brand> <session> [reel numbers]
import path from 'node:path';
import { batch, ensure, ffmpeg, has, job, log, probe, readJson } from '../../engine/lib';
import { captionTrack, type CaptionLook } from '../../engine/core/captions';
import { esc, renderPngs } from '../../engine/core/text';

const x = batch(process.argv[2] ?? '', process.argv[3] ?? '');
const only = process.argv.slice(4).filter((a) => /^\d+$/.test(a)).map(Number);
type B = { captionLook: Omit<CaptionLook, 'fontFace'>; captionFixes?: [string, string][]; captionY?: number; captionSize?: number; assets: string; theme: { fonts?: [string, string, string, string][] } };
const b = x.brand as unknown as B;
const FPS = 30;
const fontFace = (b.theme.fonts ?? []).map(([family, file, weight, style]) => `@font-face { font-family: '${family}'; src: url("file://${path.join(b.assets, 'fonts', file)}") format('woff2'); font-weight: ${weight}; font-style: ${style}; }`).join('\n');
const reels = readJson<{ n: number; title: string; pieces: unknown[] }[]>(path.join(x.work, 'reels.json')).filter((r) => r.pieces.length && (!only.length || only.includes(r.n)));
for (const r of reels) {
  const j = job(x, r.title);
  const tr = j.p('outputs', `${j.name}.transcript.json`);
  if (!has(j.base) || !has(tr)) { console.warn(`reel ${r.n}: no base cut yet (cut.ts)`); continue; }
  const words = readJson<{ words: { text: string; start: number; end: number }[] }>(tr).words.map((w) => ({ w: w.text, at: w.start, end: w.end }));
  for (const [from, to] of b.captionFixes ?? []) {
    const want = from.split(/\s+/);
    for (let i = 0; i + want.length <= words.length; i++) if (want.every((wd, q) => words[i + q]!.w === wd)) { words[i]!.w = to; words[i]!.end = words[i + want.length - 1]!.end; words.splice(i + 1, want.length - 1); }
  }
  const dur = probe(j.base).duration, dir = j.p('captions');
  ensure(dir);
  const list = await captionTrack(words, dur, { w: 1080, h: 1920, y: b.captionY ?? 0.52, size: b.captionSize ?? 80, style: 'brand3', dir, fps: FPS, look: { ...b.captionLook, fontFace } });
  // b-roll pictures, anchored to his words
  type Shot = { file: string; files?: string[]; title?: string[]; shift?: number; from: string; to?: string; hold?: number; tail?: number; style?: 'under' | 'float' | 'hook' };
  const shots = has(x.p('broll.json')) ? readJson<Shot[]>(x.p('broll.json')) : [];
  const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9']/g, '');
  const find = (phrase: string, after = 0) => {
    const want = phrase.split(/\s+/).map(norm).filter(Boolean);
    for (let i = 0; i + want.length <= words.length; i++) if (words[i]!.at >= after && want.every((q, k) => norm(words[i + k]!.w) === q)) return { at: words[i]!.at, end: words[i + want.length - 1]!.end };
    return null;
  };
  const ins: string[] = ['-i', j.base, '-f', 'concat', '-safe', '0', '-i', list];
  let fc = '', last = '0:v', k = 2;
  let hook: { t0: number; t1: number; shift: number } | null = null;
  for (const sh of shots) {
    const a = find(sh.from), b = sh.to ? find(sh.to, a?.at ?? 0) : null;
    if (!a) { console.warn(`b-roll ${sh.file}: "${sh.from}" is not said in this reel: left out`); continue; }
    let t0 = Math.round(a.at * FPS) / FPS;
    const t1 = Math.round(((b ? b.end : a.at + (sh.hold ?? 2.4)) + (sh.tail ?? 0.4)) * FPS) / FPS;
    if (sh.style === 'hook' && t0 <= 3 / FPS) t0 = 0; // from the first frame: no one-frame flash of the plain layout
    const en = `enable='between(t,${(t0 - 0.5 / FPS).toFixed(4)},${(t1 - 0.5 / FPS).toFixed(4)})'`;
    if (sh.style === 'hook') {
      // his picture moved down over a blurred, darkened copy of itself, so his face sits under the pictures and title
      const D = sh.shift ?? 600, files = sh.files ?? [sh.file], TW = 410, TH = 500, X0 = Math.round((1080 - TW * files.length) / 2), Y0 = 70;
      // (only the hook's seconds are blurred; the top 90 px of his moved picture fade into the blur, no hard line)
      const mask = path.join(dir, 'hook-mask.png'), cut = `trim=0:${(t1 + 0.1).toFixed(3)}`;
      ffmpeg(['-f', 'lavfi', '-i', `color=white:s=1080x${1920 - D},format=gray,geq=lum='min(255\\,255*Y/90)'`, '-frames:v', '1', mask]);
      ins.push('-loop', '1', '-t', dur.toFixed(3), '-i', mask);
      const mk = k++;
      fc += `[${last}]split=3[hm${mk}][hb${mk}][hs${mk}];[hb${mk}]${cut},gblur=sigma=30,eq=brightness=-0.3[hbb${mk}];` +
        `[hs${mk}]${cut},crop=1080:${1920 - D}:0:0,format=yuva420p[hsc${mk}];[${mk}:v]format=gray,${cut}[hmk${mk}];[hsc${mk}][hmk${mk}]alphamerge[hsa${mk}];` +
        `[hbb${mk}][hsa${mk}]overlay=0:${D}:eof_action=pass[hk${mk}];[hm${mk}][hk${mk}]overlay=0:0:eof_action=pass:${en}[hd${mk}];`;
      let lab = `hd${mk}`;
      for (const [q, f] of files.entries()) {
        ins.push('-loop', '1', '-t', dur.toFixed(3), '-i', path.join(x.dir, f));
        fc += `[${k}:v]scale=${TW}:${TH}:force_original_aspect_ratio=increase,crop=${TW}:${TH},fps=${FPS},format=yuva420p[ht${k}];[${lab}][ht${k}]overlay=x=${X0 + q * TW}:y=${Y0}:${en}[hv${k}];`;
        lab = `hv${k}`; k++;
      }
      if (sh.title?.length) {
        // the title as Tommaso's: each line in its own white box, black type, over the pictures' lower edge
        const png = path.join(dir, 'hook-title.png');
        await renderPngs(1080, 260, [{ out: png, css: `.t { position: absolute; left: 0; right: 0; top: 10px; text-align: center; font: 600 60px/1 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #000; }
          .t span { display: inline-block; background: #fff; padding: 12px 22px 14px; border-radius: 14px; margin-top: -4px; }`,
          body: `<div class="t">${sh.title.map((l) => `<span>${esc(l)}</span>`).join('<br>')}</div>` }]);
        ins.push('-loop', '1', '-t', dur.toFixed(3), '-i', png);
        fc += `[${k}:v]fps=${FPS},format=yuva420p[htt${k}];[${lab}][htt${k}]overlay=x=0:y=${Y0 + TH - 110}:${en}[hv${k}];`;
        lab = `hv${k}`; k++;
      }
      last = lab; hook = { t0, t1, shift: D };
      console.log(`reel ${r.n}: hook ${files.map((f) => path.basename(f)).join(' + ')} ${t0.toFixed(2)}-${t1.toFixed(2)} s`);
      continue;
    }
    ins.push('-loop', '1', '-t', dur.toFixed(3), '-i', path.join(x.dir, sh.file));
    if ((sh.style ?? 'under') === 'under')
      // his own way (Josef 2026-10-22, "put it under my face as I do for other videos"): the picture over the lower
      // half of the frame, his face and the captions above it untouched
      fc += `[${k}:v]scale=920:600:force_original_aspect_ratio=decrease,fps=${FPS},format=yuva420p[sh${k}];[${last}][sh${k}]overlay=x=(W-w)/2:y=1080+(600-h)/2:${en}[o${k}];`;
    else
      fc += `[${k}:v]split[p${k}][q${k}];[p${k}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=40,eq=brightness=-0.25[bg${k}];` +
        `[q${k}]scale=1000:-2[fg${k}];[bg${k}][fg${k}]overlay=x=(W-w)/2:y=200,fps=${FPS},format=yuv420p[sh${k}];[${last}][sh${k}]overlay=0:0:${en}[o${k}];`;
    last = `o${k}`; k++;
    console.log(`reel ${r.n}: b-roll ${path.basename(sh.file)} ${t0.toFixed(2)}-${t1.toFixed(2)} s`);
  }
  const out = j.p('outputs', `${j.name}-final.mp4`);
  // the captions move down with him while the hook's layout is on
  const capAt = hook ? `x=0:y='if(between(t,${(hook.t0 - 0.5 / FPS).toFixed(4)},${(hook.t1 - 0.5 / FPS).toFixed(4)}),${hook.shift},0)':eval=frame` : '0:0';
  ffmpeg([...ins, '-filter_complex', `${fc}[1:v]fps=${FPS},format=rgba[c];[${last}][c]overlay=${capAt}:eof_action=pass,format=yuv420p[v]`, '-map', '[v]', '-map', '0:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'copy', '-t', dur.toFixed(3), '-movflags', '+faststart', out]);
  console.log(`reel ${r.n}: captions on ${j.name} (${words.length} words) -> ${path.basename(out)}`);
  log(x, `vv-captions reel ${r.n}: ${words.length} words captioned`);
}
