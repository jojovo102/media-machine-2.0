#!/usr/bin/env bun
// Effects on a talking-head take (2026-10-24): the person cut out of every frame on this Mac (Apple Vision,
// engine/core/matte.swift), pictures drawn by Chrome, and each effect composed frame by frame (engine/fx/fx.py, numpy
// and Pillow from the editor's venv: nothing added). Started from a reel Josef sent (16 effects "Claude can make") so
// he can see each one on his own footage and pick what becomes part of a look.
//   bun engine/fx.ts sampler <brand> <name> <take> [effect...]   one short shot per effect, then all of them in a row
// The shots and what is drawn on them are written in SAMPLER below (lines from the "people are not lazy" take).
import path from 'node:path';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { ROOT, brand, ensure, ffmpeg, has, readJson, run, writeJson } from './lib';
import { esc, renderPngs } from './core/text';

const PY = process.env.FX_PYTHON ?? path.join(process.env.HOME ?? '', '.cache', 'video-editor', 'whisperx-venv', 'bin', 'python');
const W = 1080, H = 1920, FPS = 30;
const YELLOW = '#FFD23F', BONE = '#F4F1EA';

interface Shot { effect: string; title: string; segs: [number, number][]; [k: string]: unknown }
const SAMPLER: Shot[] = [
  { effect: 'depth', title: 'depth', segs: [[0.15, 2.15]], word: 'NOT<br>LAZY' },
  { effect: 'digital-zoom', title: 'digital zoom', segs: [[2.0, 4.6]] },
  { effect: 'zoom-through', title: 'zoom-through cut', segs: [[21.15, 23.55], [23.95, 26.4]] },
  { effect: 'vertigo', title: 'vertigo', segs: [[28.35, 32.3]] },
  { effect: 'green-screen', title: 'green screen', segs: [[39.1, 40.95]], place: 'Costa Smeralda Sardinia sea' },
  { effect: 'orbit', title: 'orbit', segs: [[42.95, 46.85]], cards: ['Calls booked', 'Still working', 'Having fun'] },
  { effect: 'doodle-boil', title: 'doodle boil', segs: [[49.6, 51.6]] },
  { effect: 'headline-wall', title: 'headline wall', segs: [[60.3, 63.75]], clips: ['Still booking calls from the beach', 'Deals closed on autopilot', 'The software never clocked out', 'No more excuses', 'Founder spotted in Sardinia'] },
  { effect: 'frame-break', title: 'frame break', segs: [[67.05, 73.1]] },
  { effect: 'paper-cut', title: 'paper cut', segs: [[87.25, 89.95]], word: '12 HOURS' },
  { effect: 'pull-back', title: 'pull-back reveal', segs: [[103.55, 107.75]] },
];

const [cmd, brandKey, name, take, ...only] = process.argv.slice(2);
if (cmd !== 'sampler' || !brandKey || !name || !take) throw new Error('usage: bun engine/fx.ts sampler <brand> <name> <take> [effect...]');
if (!has(take)) throw new Error(`no take at ${take}`);
if (!existsSync(PY)) throw new Error(`no python with numpy and Pillow at ${PY} (set FX_PYTHON)`);
const dir = path.join(brand(brandKey).root, name);
ensure(path.join(dir, 'shots'), path.join(dir, 'work'));
const MATTE = path.join(ROOT, 'vendor', 'matte'), FACES = path.join(ROOT, 'vendor', 'faces');
for (const [bin, src] of [[MATTE, 'matte.swift'], [FACES, 'faces.swift']] as const) {
  if (!existsSync(bin) && Bun.spawnSync(['swiftc', '-O', path.join(ROOT, 'engine', 'core', src), '-o', bin]).exitCode !== 0) throw new Error(`${src} did not compile (xcode-select --install)`);
}

/** A free picture from Wikimedia Commons (CC0, public domain, CC BY, CC BY-SA), with its credit. */
async function commons(query: string, out: string): Promise<string> {
  const ua = { 'User-Agent': 'media-machine/1.0 (effects sampler)' };
  const q = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '20', gsrsearch: `${query} filetype:bitmap`, prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '2000' });
  const res = await (await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: ua })).json() as { query?: { pages: Record<string, { title: string; index: number; imageinfo: { url: string; thumburl?: string; width: number; height: number; extmetadata: Record<string, { value: string }> }[] }> } };
  const c = Object.values(res.query?.pages ?? {}).sort((a, b) => a.index - b.index).map((p) => ({ p, i: p.imageinfo[0]! }))
    .find(({ i }) => /^(cc0|public domain|pd|cc by( |-)|cc by-sa)/i.test(i.extmetadata.LicenseShortName?.value ?? '') && i.width >= 1200);
  if (!c) throw new Error(`nothing free on Commons for "${query}"`);
  writeFileSync(out, Buffer.from(await (await fetch(c.i.thumburl ?? c.i.url, { headers: ua })).arrayBuffer()));
  const strip = (s?: string) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return `${c.p.title.replace(/^File:/, '')}, ${strip(c.i.extmetadata.Artist?.value) || 'unknown author'}, ${c.i.extmetadata.LicenseShortName?.value}, via Wikimedia Commons`;
}

const card = (inner: string, css = '') => `<div style="position:absolute;${css}">${inner}</div>`;
const credits: Record<string, string> = has(path.join(dir, 'credits.json')) ? readJson(path.join(dir, 'credits.json')) : {};
const made: string[] = [];

for (const [n, sh] of SAMPLER.entries()) {
  if (only.length && !only.includes(sh.effect)) { const f = path.join(dir, 'shots', `${String(n + 1).padStart(2, '0')} ${sh.effect}.mp4`); if (has(f)) made.push(f); continue; }
  const w = path.join(dir, 'work', sh.effect);
  rmSync(w, { recursive: true, force: true });
  ensure(path.join(w, 'f'), path.join(w, 'm'), path.join(w, 'a'));
  console.log(`${String(n + 1).padStart(2, '0')} ${sh.title}`);

  // the shot at 30 fps (two pieces joined for the zoom-through), and its sound
  const v = sh.segs.map(([a, b], k) => `[0:v]trim=${a}:${b},setpts=PTS-STARTPTS[v${k}];[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS[a${k}]`).join(';');
  const join = sh.segs.map((_, k) => `[v${k}][a${k}]`).join('') + `concat=n=${sh.segs.length}:v=1:a=1[v][a]`;
  ffmpeg(['-i', take, '-filter_complex', `${v};${join};[v]fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[vo]`, '-map', '[vo]', '-q:v', '2', path.join(w, 'f', '%05d.jpg'), '-map', '[a]', '-ar', '48000', path.join(w, 'audio.wav')]);
  const frames = readdirSync(path.join(w, 'f')).sort();
  const cut = sh.segs.length > 1 ? sh.segs[0]![1] - sh.segs[0]![0] : 0;

  // the person in every frame, and the face on the first
  Bun.spawnSync([MATTE], { stdin: Buffer.from(frames.map((f) => `${path.join(w, 'f', f)}\t${path.join(w, 'm', f.replace('.jpg', '.png'))}`).join('\n') + '\n') });
  // (several frames: sunglasses or a turned head can hide the face on one)
  const tries = frames.filter((_, k) => k % 6 === 0).map((f) => path.join(w, 'f', f));
  const fl = Bun.spawnSync([FACES], { stdin: Buffer.from(tries.join('\n') + '\n') }).stdout.toString().split('\n').map((l) => l.split('\t')[1]?.split(';')[0]).find((b) => b);
  const [x, y, fw, fh] = fl ? fl.split(',').map(Number) : [0.4, 0.2, 0.2, 0.12];
  const face = [Math.round((x! + fw! / 2) * W), Math.round((y! + fh! / 2) * H), Math.round(fw! * W), Math.round(fh! * H)];
  const [fx, fy, , fhp] = face as [number, number, number, number];

  // what Chrome draws for this effect
  const A = (f: string) => path.join(w, 'a', f);
  const jobs: { body: string; out: string; opaque?: boolean }[] = [{
    out: A('label.png'),
    body: card(`<span style="opacity:.6">${String(n + 1).padStart(2, '0')}</span>&nbsp; ${esc(sh.title)}`, 'left:48px;top:60px;padding:12px 22px;border-radius:40px;background:rgba(10,10,10,.55);color:#fff;font-weight:700;font-size:34px;letter-spacing:-.5px'),
  }];
  const spec: Record<string, unknown> = { effect: sh.effect, fps: FPS, face, cut };
  if (sh.effect === 'depth') {
    const top = Math.max(60, fy - fhp * 2.6);
    jobs.push({ out: A('word.png'), body: card(String(sh.word), `left:-60px;right:-60px;top:${top}px;text-align:center;font-weight:800;font-size:330px;line-height:.82;letter-spacing:-12px;color:${BONE};text-shadow:0 10px 40px rgba(0,0,0,.25)`) });
  }
  if (sh.effect === 'digital-zoom') {
    const br = (pos: string) => card('', `${pos};width:90px;height:90px;border-color:rgba(255,255,255,.9);border-style:solid;border-width:0`);
    jobs.push({ out: A('rec.png'), body: [
      card('', `left:60px;top:150px;width:90px;height:90px;border-left:5px solid #fff;border-top:5px solid #fff`),
      card('', `right:60px;top:150px;width:90px;height:90px;border-right:5px solid #fff;border-top:5px solid #fff`),
      card('', `left:60px;bottom:220px;width:90px;height:90px;border-left:5px solid #fff;border-bottom:5px solid #fff`),
      card('', `right:60px;bottom:220px;width:90px;height:90px;border-right:5px solid #fff;border-bottom:5px solid #fff`),
      card(`<span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:#FF3B30;margin-right:12px;vertical-align:middle"></span>REC`, 'left:90px;bottom:250px;color:#fff;font-weight:700;font-size:34px;letter-spacing:2px'),
      br('display:none'),
    ].join('') });
    for (let k = 0; k <= 30; k++) jobs.push({ out: A(`x${String(k).padStart(2, '0')}.png`), body: card(`${(1 + k / 100).toFixed(2)}×`, `right:100px;bottom:244px;color:#fff;font-weight:800;font-size:46px;font-variant-numeric:tabular-nums`) });
  }
  if (sh.effect === 'green-screen') {
    credits[`${sh.effect}`] = await commons(String(sh.place), A('place.png'));
  }
  if (sh.effect === 'headline-wall') {
    const spots = [[50, 170, -6], [560, 120, 5], [30, 560, 4], [600, 520, -4], [300, 330, -2]];
    (sh.clips as string[]).forEach((t, k) => {
      const [l, tp, r] = spots[k % spots.length]!;
      jobs.push({ out: A(`clip${k}.png`), body: card(`<div style="font:600 18px Georgia,serif;letter-spacing:3px;color:#555;border-bottom:2px solid #222;padding-bottom:6px;margin-bottom:10px">THE DAILY LEDGER</div><div style="font:700 44px/1.05 Georgia,'Times New Roman',serif;color:#111">${esc(t)}</div>`, `left:${l}px;top:${tp}px;width:430px;padding:22px 26px 26px;background:#F3EEE2;transform:rotate(${r}deg);box-shadow:0 14px 34px rgba(0,0,0,.35)`) });
    });
    spec.clips = (sh.clips as string[]).length;
  }
  if (sh.effect === 'paper-cut') {
    jobs.push({ out: A('paper.png'), opaque: true, body: `<div style="position:absolute;inset:0;background:#EFE8D8;background-image:linear-gradient(rgba(70,90,140,.13) 2px,transparent 2px),linear-gradient(90deg,rgba(70,90,140,.13) 2px,transparent 2px);background-size:64px 64px"></div>${card('', 'left:-40px;top:240px;width:520px;height:300px;background:#F2C94C;transform:rotate(-7deg)')}${card('', 'right:-60px;top:820px;width:460px;height:260px;background:#E9A2A2;transform:rotate(9deg)')}${card('', 'left:380px;top:120px;width:240px;height:60px;background:rgba(255,255,255,.55);transform:rotate(-4deg)')}` });
    const word = String(sh.word), fonts = ['Georgia,serif', 'Impact,sans-serif', "'Courier New',monospace", "'Times New Roman',serif", "'Arial Black',sans-serif"];
    const bgs = ['#fff', '#111', '#F2C94C', '#fff', '#C0392B', '#fff', '#1F3A93', '#fff'];
    const letters = [...word].map((ch, k) => ch === ' ' ? '<span style="display:inline-block;width:40px"></span>' : `<span style="display:inline-block;margin:0 4px;padding:6px 16px;font-family:${fonts[k % fonts.length]};font-weight:800;font-size:${110 + (k % 3) * 18}px;background:${bgs[k % bgs.length]};color:${['#111', '#C0392B', '#1F3A93'].includes(bgs[k % bgs.length]!) ? '#fff' : '#111'};transform:rotate(${(k % 2 ? 1 : -1) * (3 + (k % 3) * 2)}deg);box-shadow:0 6px 14px rgba(0,0,0,.3)">${esc(ch)}</span>`);
    for (let k = 1; k <= letters.length; k++) jobs.push({ out: A(`word${String(k).padStart(2, '0')}.png`), body: card(letters.slice(0, k).join(''), 'left:0;right:0;top:1300px;text-align:center') });
    spec.letters = letters.length;
  }
  if (sh.effect === 'frame-break') {
    jobs.push({ out: A('phone.png'), body: card('', 'left:6px;top:6px;right:6px;bottom:6px;border:30px solid #0d0d0f;border-radius:90px;box-shadow:0 0 0 4px #3a3a3e,0 40px 80px rgba(0,0,0,.6)') });
  }
  if (sh.effect === 'doodle-boil') {
    for (let k = 0; k < 3; k++) {
      const j = (a: number) => a + (k - 1) * 6;
      const star = (cx: number, cy: number, r: number) => `<path d="M${cx} ${cy - r} L${cx + r * .25} ${cy - r * .25} L${cx + r} ${cy} L${cx + r * .25} ${cy + r * .25} L${cx} ${cy + r} L${cx - r * .25} ${cy + r * .25} L${cx - r} ${cy} L${cx - r * .25} ${cy - r * .25} Z"/>`;
      jobs.push({ out: A(`doodle${k}.png`), body: `<svg width="${W}" height="${H}" style="position:absolute;inset:0" fill="none" stroke="${YELLOW}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
        ${star(j(140), j(560), 46)}${star(j(930), j(470), 36)}${star(j(880), j(1300), 30)}
        <path d="M${j(110)} ${j(1180)} q 60 -90 140 -40 t 120 -60" /><path d="M${j(345)} ${j(1110)} l -26 -40 m 26 40 l -48 -8"/>
        <path d="M${j(960)} ${j(820)} c -40 -40 40 -80 0 -120 s 40 -80 0 -120" />
        <circle cx="${j(210)}" cy="${j(820)}" r="${22 + k * 3}"/><circle cx="${j(850)}" cy="${j(1080)}" r="${16 + k * 2}" stroke="#fff"/>
      </svg>` });
    }
  }
  if (sh.effect === 'orbit') {
    (sh.cards as string[]).forEach((t, k) => jobs.push({ out: A(`card${k}.png`), body: card(`<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${YELLOW};margin-right:16px;vertical-align:middle"></span>${esc(t)}`, 'left:0;top:0;padding:26px 36px;border-radius:26px;background:rgba(18,18,20,.82);border:2px solid rgba(255,255,255,.18);color:#fff;font-weight:700;font-size:56px;white-space:nowrap') }));
  }
  if (sh.effect === 'pull-back') {
    const blocks = Array.from({ length: 14 }, (_, k) => `<div style="position:absolute;left:${40 + k * 72}px;top:0;width:${60 + (k % 3) * 10}px;height:70px;border-radius:8px;background:${['#3D6BE0', '#E0A33D', '#3DBE7A', '#B05BE0'][k % 4]};opacity:.9"></div>`).join('');
    const wave = Array.from({ length: 120 }, (_, k) => `<div style="position:absolute;left:${40 + k * 8.4}px;top:${125 - Math.abs(Math.sin(k * 0.7) * 28 + Math.sin(k * 0.23) * 14)}px;width:4px;height:${2 * Math.abs(Math.sin(k * 0.7) * 28 + Math.sin(k * 0.23) * 14) + 4}px;background:#4FD18B;border-radius:2px"></div>`).join('');
    jobs.push({ out: A('editor.png'), opaque: true, body: `<div style="position:absolute;inset:0;background:#0E0F12"></div>
      ${card('effects reel', 'left:0;right:0;top:60px;text-align:center;color:#8A8F98;font-size:30px;font-weight:600')}
      ${card('<div style="color:#8A8F98;font-size:22px;margin-bottom:14px">CHECKLIST</div>' + ['cut pauses', 'captions', 'add effects', 'export'].map((x) => `<div style="color:#fff;font-size:26px;margin:10px 0"><span style="color:${YELLOW}">●</span> ${x}</div>`).join(''), 'left:30px;top:340px;width:200px;padding:20px;border-radius:18px;background:#16181D')}
      ${card('<div style="color:#8A8F98;font-size:22px;margin-bottom:14px">EFFECTS</div>' + SAMPLER.slice(0, 9).map((s) => `<div style="color:#cfd3da;font-size:22px;margin:8px 0">${esc(s.title)}</div>`).join(''), 'right:30px;top:340px;width:200px;padding:20px;border-radius:18px;background:#16181D')}
      ${card(`<div style="position:absolute;left:0;right:0;top:0;height:40px;border-bottom:1px solid #2a2d33;color:#8A8F98;font-size:20px;padding:8px 40px">00:00 &nbsp;&nbsp;&nbsp; 00:05 &nbsp;&nbsp;&nbsp; 00:10 &nbsp;&nbsp;&nbsp; 00:15 &nbsp;&nbsp;&nbsp; 00:20</div><div style="position:absolute;left:0;right:0;top:60px;height:80px">${blocks}</div><div style="position:absolute;left:0;right:0;top:150px;height:170px">${wave}</div><div style="position:absolute;left:520px;top:0;width:4px;height:330px;background:${YELLOW}"></div>`, 'left:0;right:0;top:1450px;height:340px;background:#121419;border-top:1px solid #2a2d33')}` });
  }
  if (sh.effect === 'orbit') spec.cards = (sh.cards as string[]).length;
  await renderPngs(W, H, jobs);
  writeJson(path.join(w, 'spec.json'), spec);

  // compose and encode
  const out = path.join(dir, 'shots', `${String(n + 1).padStart(2, '0')} ${sh.effect}.mp4`);
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  run(['bash', '-c', `${q(PY)} ${q(path.join(ROOT, 'engine', 'fx', 'fx.py'))} ${q(w)} | ffmpeg -hide_banner -loglevel error -y -f rawvideo -pix_fmt rgb24 -s ${W}x${H} -r ${FPS} -i - -i ${q(path.join(w, 'audio.wav'))} -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest ${q(out)}`], { quiet: true });
  console.log(`   -> ${path.relative(dir, out)} (${frames.length} frames)`);
  made.push(out);
}
writeJson(path.join(dir, 'credits.json'), credits);

// all of them in a row, the voice levelled
const list = path.join(dir, 'work', 'shots.txt');
writeFileSync(list, made.sort().map((f) => `file '${f.replace(/'/g, `'\\''`)}'`).join('\n') + '\n');
const reel = path.join(dir, `${name}.mp4`);
ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', reel]);
console.log(`\n${made.length} effects -> ${path.relative(dir, reel)}`);
