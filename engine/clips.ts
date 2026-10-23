#!/usr/bin/env bun
// Clips from a long video (2026-10-23): a podcast or a call in, 6 to 10 vertical clips out, each following whoever is
// on screen, with word captions, a plain hook line and b-roll laid over where it helps. Nothing here posts or touches
// the OS: the clips are files in the job, for a person to watch first.
//   bun engine/clips.ts prep <brand> <name> <video>     job folder, every word timed (whisper), work/outline.md to pick from
//   (the moments are picked by reading the outline: work/picks.json, see Pick below)
//   bun engine/clips.ts broll <brand> <name> <n> "<query>" [from] [to]   a free picture or video from Wikimedia Commons
//                                                       into broll/, added to pick n, its licence in broll/credits.json
//   bun engine/clips.ts render <brand> <name> [n...]   the clips into clips/ (all, or the numbers given)
import path from 'node:path';
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ROOT, brand, ensure, ffmpeg, has, probe, readJson, run, slug, writeJson, WHISPER_MODEL } from './lib';
import { captionTrack, type TimedWord } from './core/captions';
import { esc, curly, renderPngs } from './core/text';

/** A moment to clip: seconds on the long video's clock. */
interface Pick { n: number; start: number; end: number; title: string; hook?: string; why?: string; broll?: Broll[] }
/** A picture or video over the speaker from `from` to `to` (seconds into the clip), the voice going on under it. */
interface Broll { file: string; from: number; to: number; credit?: string }
interface Word { w: string; start: number; end: number }

const [cmd, brandKey, name, ...rest] = process.argv.slice(2);
if (!cmd || !brandKey || !name) throw new Error('usage: bun engine/clips.ts prep|broll|render <brand> <name> ...');
const b = brand(brandKey);
const dir = path.join(b.root, name);
const P = (...xs: string[]) => path.join(dir, ...xs);
const W = 1080, H = 1920, FPS = 30;

// ---------------------------------------------------------------- prep
if (cmd === 'prep') {
  const video = rest[0];
  if (!video || !has(video)) throw new Error(`no video at ${video}`);
  ensure(P('raw'), P('work'), P('clips'), P('broll'));
  const link = P('raw', `source${path.extname(video).toLowerCase()}`);
  if (!existsSync(link)) symlinkSync(path.resolve(video), link);   // the footage stays where it is, untouched
  const wav = P('work', 'audio16k.wav');
  if (!has(wav)) ffmpeg(['-i', link, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  const lang = (rest[1] ?? (b.lang === 'it' ? 'it' : 'en')) as string;
  if (!has(P('work', 'transcript.json'))) {
    console.log(`transcribing ${Math.round(probe(link).duration / 60)} min (${lang}) ...`);
    run(['whisper-cli', '-m', WHISPER_MODEL, '-l', lang, '-ojf', '-of', P('work', 'transcript'), '-dtw', 'large.v3.turbo', '-np', '--prompt', b.names ?? '', '-f', wav], { quiet: true });
  }
  type Tok = { text: string; t_dtw?: number; offsets: { from: number; to: number } };
  type Seg = { offsets: { from: number; to: number }; text: string; tokens: Tok[] };
  const segs = readJson<{ transcription: Seg[] }>(P('work', 'transcript.json')).transcription;
  const words: Word[] = [];
  for (const s of segs) {
    const ws: { w: string; t: number }[] = [];
    for (const t of s.tokens) {
      if (/^\[_.*\]$/.test(t.text)) continue;
      const at = (t.t_dtw ?? -1) >= 0 ? t.t_dtw! / 100 : t.offsets.from / 1000;
      if (!ws.length || /^\s/.test(t.text)) ws.push({ w: t.text.trim(), t: at });
      else ws[ws.length - 1]!.w += t.text;
    }
    const ok = ws.filter((x) => x.w && /[\p{L}\p{N}]/u.test(x.w));
    ok.forEach((x, k) => {
      const segEnd = s.offsets.to / 1000;
      const start = Math.max(s.offsets.from / 1000, x.t);
      const end = k === ok.length - 1 ? Math.min(segEnd, start + 0.8) : Math.min(ok[k + 1]!.t, start + 0.8);
      words.push({ w: x.w, start: +start.toFixed(3), end: +Math.max(start + 0.06, end).toFixed(3) });
    });
  }
  writeJson(P('work', 'words.json'), words);
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  writeFileSync(P('work', 'outline.md'), `# ${name}: what is said, by time\n\n` + segs.map((s) => `[${mmss(s.offsets.from / 1000)} ${(s.offsets.from / 1000).toFixed(1)}] ${s.text.trim()}`).join('\n') + '\n');
  if (!has(P('work', 'picks.json'))) writeJson(P('work', 'picks.json'), []);
  console.log(`${words.length} words. Read work/outline.md, write work/picks.json ([{n, start, end, title, hook, why}]), then render.`);
}

// ---------------------------------------------------------------- broll (Wikimedia Commons: free licences, credited)
else if (cmd === 'broll') {
  const [nS, query, fromS, toS] = rest;
  if (!nS || !query) throw new Error('usage: broll <brand> <name> <n> "<query>" [from] [to]');
  const api = 'https://commons.wikimedia.org/w/api.php';
  const ua = { 'User-Agent': 'media-machine/1.0 (clips b-roll; contact via github.com/jojovo102)' };
  const q = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '20', gsrsearch: `${query} filetype:bitmap|video`, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1600' });
  const res = await (await fetch(`${api}?${q}`, { headers: ua })).json() as { query?: { pages: Record<string, { title: string; index: number; imageinfo: { url: string; thumburl?: string; width: number; height: number; mime: string; extmetadata: Record<string, { value: string }> }[] }> } };
  const free = /^(cc0|public domain|pd|cc by( |-)|cc by-sa)/i;
  const cands = Object.values(res.query?.pages ?? {}).sort((x, y) => x.index - y.index).map((p) => ({ p, i: p.imageinfo[0]! }))
    .filter(({ i }) => i && free.test(i.extmetadata.LicenseShortName?.value ?? '') && (i.mime.startsWith('video/') ? true : i.width >= 1000));
  const c = cands[0];
  if (!c) throw new Error(`nothing free and big enough on Commons for "${query}"`);
  const isVideo = c.i.mime.startsWith('video/');
  const url = isVideo ? c.i.url : (c.i.thumburl ?? c.i.url);
  const ext = isVideo ? path.extname(new URL(url).pathname) : '.jpg';
  const file = path.join('broll', `${slug(query)}${ext}`);
  const buf = Buffer.from(await (await fetch(url, { headers: ua })).arrayBuffer());
  if (buf.length > 200e6) throw new Error('over 200 MB, not taken');
  writeFileSync(P(file), buf);
  const strip = (s?: string) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const credit = `${c.p.title.replace(/^File:/, '')}, ${strip(c.i.extmetadata.Artist?.value) || 'unknown author'}, ${c.i.extmetadata.LicenseShortName?.value}, via Wikimedia Commons (${c.i.extmetadata.LicenseUrl?.value ?? 'commons.wikimedia.org'})`;
  const credits = has(P('broll', 'credits.json')) ? readJson<Record<string, string>>(P('broll', 'credits.json')) : {};
  credits[file] = credit;
  writeJson(P('broll', 'credits.json'), credits);
  const picks = readJson<Pick[]>(P('work', 'picks.json'));
  const pk = picks.find((x) => x.n === Number(nS));
  if (pk && fromS && toS) { pk.broll = [...(pk.broll ?? []), { file, from: Number(fromS), to: Number(toS), credit }]; writeJson(P('work', 'picks.json'), picks); }
  console.log(`${file} (${(buf.length / 1e6).toFixed(1)} MB): ${credit}`);
}

// ---------------------------------------------------------------- render
else if (cmd === 'render') {
  const src = ['source.mp4', 'source.mov', 'source.m4v', 'source.mkv', 'source.webm'].map((f) => P('raw', f)).find(existsSync);
  if (!src) throw new Error('no raw/source.*: run prep first');
  const info = probe(src), SW = info.video!.w, SH = info.video!.h;
  const words = readJson<Word[]>(P('work', 'words.json'));
  const want = rest.map(Number).filter(Boolean);
  const picks = readJson<Pick[]>(P('work', 'picks.json')).filter((p) => !want.length || want.includes(p.n));
  if (!picks.length) throw new Error('no picks: write work/picks.json');
  const FACES = path.join(ROOT, 'vendor', 'faces');
  if (!existsSync(FACES) && Bun.spawnSync(['swiftc', '-O', path.join(ROOT, 'engine', 'core', 'faces.swift'), '-o', FACES]).exitCode !== 0) throw new Error('the face shim did not compile (xcode-select --install)');

  for (const pk of picks) {
    const tmp = path.join(tmpdir(), `clip-${process.pid}-${pk.n}`);
    rmSync(tmp, { recursive: true, force: true });
    ensure(tmp);
    const dur = pk.end - pk.start;
    console.log(`clip ${pk.n} "${pk.title}" ${dur.toFixed(1)} s`);

    // the shots: where the picture changes (a cut between speakers, or between one and both)
    const sc = Bun.spawnSync(['ffmpeg', '-hide_banner', '-ss', String(pk.start), '-t', String(dur), '-i', src, '-vf', "scale=320:-2,select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-']).stderr.toString();
    const cuts = [...sc.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t > 0.4 && t < dur - 0.4);
    const edges = [0, ...cuts.filter((t, i, a) => i === 0 || t - a[i - 1]! > 0.5), dur];

    // where the faces are in each shot: two pictures a second, Apple Vision
    const frames = path.join(tmp, 'f');
    ensure(frames);
    ffmpeg(['-ss', String(pk.start), '-t', String(dur), '-i', src, '-vf', 'fps=2,scale=960:-2', path.join(frames, '%05d.jpg')]);
    const list = Bun.spawnSync(['ls', frames]).stdout.toString().trim().split('\n').filter(Boolean).map((f) => path.join(frames, f));
    const seen = new Map<number, [number, number, number, number][]>();
    for (const l of Bun.spawnSync([FACES], { stdin: Buffer.from(list.join('\n') + '\n') }).stdout.toString().split('\n')) {
      const [f, boxes] = l.split('\t');
      if (!f) continue;
      const t = (Number(path.basename(f, '.jpg')) - 1) / 2 + 0.25;
      seen.set(t, (boxes ?? '').split(';').filter(Boolean).map((x) => x.split(',').map(Number) as [number, number, number, number]).filter((x) => x[2] > 0.04));
    }
    const median = (xs: number[]) => { const s = [...xs].sort((a, c) => a - c); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };

    // one shot at a time: one face → a 9:16 window on it; two faces side by side → each in its own half, stacked
    const shots: string[] = [];
    let split = 0;
    edges.slice(0, -1).forEach((a, k) => {
      const e = edges[k + 1]!, d = e - a;
      const here = [...seen.entries()].filter(([t]) => t >= a && t < e).map(([, f]) => f);
      const two = here.filter((f) => f.length >= 2 && Math.abs((f[0]![0] + f[0]![2] / 2) - (f[1]![0] + f[1]![2] / 2)) > 0.25);
      const out = path.join(tmp, `s${String(k).padStart(3, '0')}.mp4`);
      let vf: string;
      if (here.length && two.length >= here.length / 2) {
        split += d;
        // left and right speaker, each centred in a 1080x960 window cut from its own half of the frame
        const L = median(two.map((f) => Math.min(f[0]![0] + f[0]![2] / 2, f[1]![0] + f[1]![2] / 2)));
        const R = median(two.map((f) => Math.max(f[0]![0] + f[0]![2] / 2, f[1]![0] + f[1]![2] / 2)));
        const Ly = median(two.map((f) => (f[0]![0] < f[1]![0] ? f[0]! : f[1]!)).map((b) => b[1] + b[3] / 2));
        const Ry = median(two.map((f) => (f[0]![0] < f[1]![0] ? f[1]! : f[0]!)).map((b) => b[1] + b[3] / 2));
        const fh = median(two.map((f) => Math.max(f[0]![3], f[1]![3])));
        const cw = Math.min(SW / 2, Math.round(fh * SH * 3.2 * 1.125)) & ~1, ch = Math.round(cw / 1.125) & ~1;
        const win = (cx: number, cy: number, lo: number, hi: number) => {
          const x = Math.round(Math.min(hi - cw, Math.max(lo, cx * SW - cw / 2)));
          const y = Math.round(Math.min(SH - ch, Math.max(0, cy * SH - ch * 0.45)));
          return `crop=${cw}:${ch}:${x}:${y},scale=${W}:${H / 2}:flags=lanczos,setsar=1`;
        };
        vf = `split[l][r];[l]${win(L, Ly, 0, SW / 2)}[top];[r]${win(R, Ry, SW / 2, SW)}[bot];[top][bot]vstack`;
      } else {
        const xs = here.filter((f) => f.length).map((f) => f[0]![0] + f[0]![2] / 2);
        const cx = xs.length ? median(xs) : 0.5;
        const cw = Math.round(SH * 9 / 16) & ~1;
        const x = Math.round(Math.min(SW - cw, Math.max(0, cx * SW - cw / 2)));
        vf = `crop=${cw}:${SH}:${x}:0,scale=${W}:${H}:flags=lanczos,setsar=1`;
      }
      ffmpeg(['-ss', (pk.start + a).toFixed(3), '-t', d.toFixed(3), '-i', src, '-filter_complex', `[0:v]${vf},fps=${FPS}[v]`, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', out]);
      shots.push(out);
    });
    writeFileSync(path.join(tmp, 'shots.txt'), shots.map((s) => `file '${s}'`).join('\n') + '\n');
    const picture = path.join(tmp, 'picture.mp4');
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'shots.txt'), '-c', 'copy', picture]);
    const mostlySplit = split > dur / 2;

    // the captions: the words of the moment on the clip's own clock, three at a time, the word said in yellow
    const mine: TimedWord[] = words.filter((w) => w.start >= pk.start - 0.05 && w.start < pk.end - 0.05).map((w) => ({ w: w.w, at: Math.max(0, w.start - pk.start), end: Math.min(dur, w.end - pk.start) }));
    const look = { fontFace: '', family: 'Jakarta, system-ui, sans-serif', weight: 800, color: '#FFFFFF', on: '#FFD23F', tracking: -1 };
    const caps = await captionTrack(mine, dur, { w: W, h: H, y: mostlySplit ? 0.5 : 0.7, size: 74, style: 'brand3', dir: path.join(tmp, 'cap'), fps: FPS, look });

    // the hook: one plain line at the top for the first seconds (no card, no frame)
    const hookPng = path.join(tmp, 'hook.png');
    if (pk.hook) await renderPngs(W, H, [{ out: hookPng, body: `<div style="position:absolute;left:70px;right:70px;top:${mostlySplit ? 150 : 230}px;text-align:center;font-weight:800;font-size:68px;line-height:1.08;letter-spacing:-1.5px;color:#fff;text-shadow:0 4px 20px rgba(0,0,0,.9),0 0 3px #000">${esc(curly(pk.hook))}</div>` }]);

    // b-roll: full frame over the speaker, a slow push in on a still, the voice going on
    const inputs = ['-i', picture, '-ss', String(pk.start), '-t', String(dur), '-i', src];
    let fc = `[0:v]null[v0]`, last = 'v0', idx = 2;
    for (const [k, br] of (pk.broll ?? []).entries()) {
      const f = P(br.file), len = Math.max(0.5, br.to - br.from), still = /\.(jpe?g|png|webp)$/i.test(f);
      inputs.push(...(still ? ['-loop', '1', '-t', String(len), '-i', f] : ['-stream_loop', '-1', '-t', String(len), '-i', f]));
      const fill = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
      const move = still ? `,scale=${W * 2}:${H * 2},zoompan=z='min(1.0+on/${Math.round(len * FPS)}*0.12,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}` : `,fps=${FPS}`;
      fc += `;[${idx}:v]${fill}${move},format=yuv420p,setpts=PTS-STARTPTS+${br.from}/TB[b${k}];[${last}][b${k}]overlay=enable='between(t,${br.from},${br.to})':eof_action=pass[v${k + 1}]`;
      last = `v${k + 1}`; idx++;
    }
    inputs.push('-f', 'concat', '-safe', '0', '-i', caps);
    fc += `;[${last}][${idx}:v]overlay=format=auto[vc]`; last = 'vc'; idx++;
    if (pk.hook) { inputs.push('-loop', '1', '-t', '3.2', '-i', hookPng); fc += `;[${idx}:v]fade=t=out:st=2.8:d=0.4:alpha=1[hk];[${last}][hk]overlay=eof_action=pass[vh]`; last = 'vh'; idx++; }
    fc += `;[1:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]`;
    const out = P('clips', `${pk.n} ${slug(pk.title)}.mp4`);
    ffmpeg([...inputs, '-filter_complex', fc, '-map', `[${last}]`, '-map', '[a]', '-t', dur.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
    rmSync(tmp, { recursive: true, force: true });
    console.log(`  -> ${path.relative(dir, out)} (${edges.length - 1} shot(s), ${mostlySplit ? 'two speakers stacked' : 'one speaker'}, ${mine.length} words, ${(pk.broll ?? []).length} b-roll)`);
  }
  // what each clip is, for the person who watches them
  const all = readJson<Pick[]>(P('work', 'picks.json'));
  const credits = has(P('broll', 'credits.json')) ? readJson<Record<string, string>>(P('broll', 'credits.json')) : {};
  writeFileSync(P('clips', 'README.md'), `# ${name}: the clips\n\n` + all.map((p) => `## ${p.n}. ${p.title}\n${Math.floor(p.start / 60)}:${String(Math.round(p.start % 60)).padStart(2, '0')} to ${Math.floor(p.end / 60)}:${String(Math.round(p.end % 60)).padStart(2, '0')} (${(p.end - p.start).toFixed(0)} s)${p.hook ? `\nHook on screen: ${p.hook}` : ''}${p.why ? `\nWhy: ${p.why}` : ''}${(p.broll ?? []).length ? `\nB-roll: ${p.broll!.map((x) => credits[x.file] ?? x.file).join('; ')}` : ''}\n`).join('\n'));
} else throw new Error(`unknown step ${cmd}`);
