// Captions burned into vertical video (2026-10-19, shared core: the YouTube machine's clips and the reel machine's
// business reels). Words with their times on the video's own clock become PNG states drawn by Chrome (text.ts) and a
// concat list ffmpeg reads as one transparent stream to lay over the picture.
//   gold3   three words at a time, the word being said in gold (the Ophanim look)
//   white1  one big white word at a time, centre (Josef's own CapCut reels before the machine)
//   brand3  three words at a time in a brand's own type and colours (`look`): VolpinVeritas, EB Garamond, cream with the
//           word being said in its gold (2026-10-21)
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { ensure } from './media';
import { BONE, GOLD, curly, esc, renderPngs } from './text';

export type CaptionStyle = 'gold3' | 'white1' | 'brand3';
/** A brand's caption type: its @font-face rules (local files), the family, the colours of the text and of the word said. */
export interface CaptionLook { fontFace: string; family: string; weight: number; color: string; on: string; tracking?: number }
export interface TimedWord { w: string; at: number; end: number }

/**
 * Renders the caption states for `words` on a `w` x `h` frame into `dir` and returns the path of the concat list
 * (an ffmpeg input: `-f concat -safe 0 -i <list>`), which lasts `dur` seconds.
 */
export async function captionTrack(words: TimedWord[], dur: number, o: { w: number; h: number; y: number; size: number; style: CaptionStyle; dir: string; fps: number; look?: CaptionLook }): Promise<string> {
  ensure(o.dir);
  const per = o.style === 'white1' ? 1 : 3;
  const groups: { words: TimedWord[]; a: number; b: number }[] = [];
  let g: TimedWord[] = [];
  const push = () => { if (g.length) groups.push({ words: g, a: g[0]!.at, b: g[g.length - 1]!.end }); g = []; };
  for (const w of words) {
    if (g.length && (g.length >= per || w.at - g[g.length - 1]!.end > 0.5 || g.map((x) => x.w).join(' ').length + w.w.length > 22)) push();
    g.push(w);
    if (/[.?!]$/.test(w.w)) push();
  }
  push();
  const empty = path.join(o.dir, 'empty.png');
  const jobs: { body: string; out: string }[] = [{ body: '', out: empty }];
  const timeline: { file: string; d: number }[] = [];
  let now = 0;
  const big = o.style === 'white1';
  const L = o.style === 'brand3' ? o.look : undefined;
  if (o.style === 'brand3' && !L) throw new Error('captions: brand3 needs the brand\'s look');
  const css = L ? `${L.fontFace}
    .cap { position: absolute; left: 70px; right: 70px; top: ${Math.round(o.h * o.y)}px; transform: translateY(-50%); text-align: center;
    font-family: ${L.family}; font-weight: ${L.weight}; font-size: ${o.size}px; line-height: 1.04; letter-spacing: ${L.tracking ?? 0}px; color: ${L.color};
    text-shadow: 0 3px 16px rgba(0,0,0,.9), 0 0 4px rgba(0,0,0,.95), 0 0 1px rgba(0,0,0,1); }
    .on { color: ${L.on}; }` : `.cap { position: absolute; left: 60px; right: 60px; top: ${Math.round(o.h * o.y)}px; transform: translateY(-50%); text-align: center;
    font-weight: 800; font-size: ${big ? Math.round(o.size * 1.25) : o.size}px; line-height: 1.08; letter-spacing: -1.5px; color: ${BONE};
    text-shadow: 0 4px 18px rgba(0,0,0,.85), 0 0 3px rgba(0,0,0,.9); -webkit-text-stroke: ${big ? 3 : 2}px rgba(10,10,10,.6); paint-order: stroke fill; }
    .on { color: ${big ? BONE : GOLD}; }`;
  groups.forEach((gr, gi) => {
    gr.words.forEach((w, wi) => {
      const body = `<div class="cap">${gr.words.map((x, k) => `<span class="${k === wi ? 'on' : ''}">${esc(curly(x.w.replace(/[,;:.]$/, '')))}</span>`).join(' ')}</div>`;
      const out = path.join(o.dir, `g${gi}-${wi}.png`);
      jobs.push({ body, out });
      const a = wi === 0 ? gr.a : w.at;
      const b = wi === gr.words.length - 1 ? (groups[gi + 1] && groups[gi + 1]!.a - gr.b < 0.5 ? groups[gi + 1]!.a : gr.b + 0.15) : gr.words[wi + 1]!.at;
      if (a > now + 0.001) { timeline.push({ file: empty, d: a - now }); now = a; }
      timeline.push({ file: out, d: Math.max(1 / o.fps, b - now) }); now = Math.max(now, b);
    });
  });
  if (dur > now) timeline.push({ file: empty, d: dur - now });
  await renderPngs(o.w, o.h, jobs.map((j) => ({ ...j, css })));
  const list = path.join(o.dir, 'list.txt');
  writeFileSync(list, timeline.map((x) => `file '${x.file}'\nduration ${x.d.toFixed(4)}`).join('\n') + `\nfile '${timeline[timeline.length - 1]!.file}'\n`);
  return list;
}

/** The hook on a dark card with a gold rule, as a PNG (laid over the first seconds). */
export async function hookCard(text: string, o: { w: number; h: number; y: number; out: string }) {
  await renderPngs(o.w, o.h, [{
    out: o.out,
    body: `<div style="position:absolute;left:0;right:0;top:${Math.round(o.h * o.y)}px;display:flex;justify-content:center">
      <div style="max-width:940px;background:rgba(10,10,10,.82);border:1.5px solid rgba(201,168,76,.55);border-radius:28px;padding:30px 40px 34px;text-align:center">
        <div style="width:90px;height:5px;background:${GOLD};margin:0 auto 20px;border-radius:3px;box-shadow:0 0 14px ${GOLD}"></div>
        <div style="font-weight:800;font-size:74px;line-height:1.06;letter-spacing:-2px;color:${BONE}">${esc(curly(text))}</div></div></div>`,
  }]);
}
