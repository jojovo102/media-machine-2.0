#!/usr/bin/env bun
// The talking-head preset (2026-10-22): Jason's Instagram "Talking Head Explainer" (video-editor/presets/instagram/
// talking-head-explainer) driven on a job the engine cut, on the editor's chat-only lane, with the brand's kit
// (brands/<key>/look.json) laid over the editor's house look. The WHAT is the editor's docs (its README's ten laws,
// layout.md, graphics.md, captures.md, captions-style.md, sfx.md); this file is only the HOW, in order:
//   measure   the face (face-frame.py --modes) -> face-frame.json
//   plan      the plan and its storyboard written by plan.ts when the job has none (a hand plan is never overwritten;
//             --again rewrites one plan.ts wrote), the collar and the crowns for the plan's rows (no collar measured:
//             the brand's caption heights, look.json captionY), then the plan gates (validate-plan.py, layout.py --check)
//   init      the kit staged into the job (engine.py init), then the brand's fonts, colours and mark laid over the
//             job's copy (never the editor's own files), and the render script freed of the npm date freeze this
//             Mac cannot combine with its release-age guard
//   stage     the planned OS screens from library/os-screens, and every other capture of the plan from
//             <session>/captures/<id>.<ext> (engine.py stage)
//   build     the job's storyboard (hf-graphics/gfx/build.py; an empty STORYBOARD filled from storyboard.json)
//   render    every composition (engine.py render <id>)
//   captions  the caption layer, placed build and straight-alpha build
//   place     placement.json (placement.py --write)
//   qa        graphics-qa-short.py, layout.py --check, change-events.py --sync
//   assemble  the composite (assemble.py) and the face verified on it
//   sfx       the sound plan (sfx-plan.py) and the mix (mix-sfx.py) -> outputs/<slug>-final.mp4
//   flash     flash-scan.py on the deliverable
// The plan (graphics-plan.json) and the storyboard are written by plan.ts from the cut (2026-10-22); Claude can still
// write either by hand for a reel that needs it (a hand plan has no planned_by), and the run keeps it.
//   bun presets/talking-head/run.ts <brand> <session> [reel n] [--from <step>] [--to <step>] [--again]
import path from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { BASE, EDITOR, LIBRARY, arg, batch, brandDir, flag, has, job, log, readJson, slug } from '../../engine/lib';

const x = batch(process.argv[2] ?? '', process.argv[3] ?? '');
const only = process.argv.slice(4).filter((a) => /^\d+$/.test(a)).map(Number);
type Reel = { n: number; title: string; pieces: unknown[] };
const reels = readJson<Reel[]>(path.join(x.work, 'reels.json')).filter((r) => r.pieces.length && (!only.length || only.includes(r.n)));
const STEPS = ['measure', 'plan', 'init', 'stage', 'build', 'render', 'captions', 'place', 'qa', 'assemble', 'sfx', 'flash'] as const;
type Step = (typeof STEPS)[number];
const from = Math.max(0, STEPS.indexOf((arg('from', 'measure') ?? 'measure') as Step)), to = STEPS.indexOf((arg('to', 'flash') ?? 'flash') as Step);
const AGAIN = flag('again');
const PRESET = path.join(EDITOR, 'presets', 'instagram', 'talking-head-explainer');
const KIT = path.join(PRESET, 'kit', 'engine.py');
if (!existsSync(KIT)) throw new Error(`Jason's editor is not at ${EDITOR} (set VIDEO_EDITOR to its folder)`);
type Look = { accent: string; accentSoft?: string; grid?: string; light?: string; fonts?: Record<string, string>; logo?: string; captions?: 'mix'; captionY?: { wide: number; tight: number } };
const lookFile = path.join(brandDir(x.brand.key), 'look.json');
const look: Look | null = has(lookFile) ? (JSON.parse(readFileSync(lookFile, 'utf8').replace(/\{base\}/g, BASE)) as Look) : null;

/** One of the editor's tools, from its folder; a non-zero exit is the gate speaking. */
function uv(args: string[], o: { ok?: number[]; cwd?: string } = {}): number {
  const r = Bun.spawnSync(['uv', 'run', ...args], { cwd: o.cwd ?? EDITOR, stdout: 'inherit', stderr: 'inherit', env: { ...process.env } });
  if (!(o.ok ?? [0]).includes(r.exitCode)) throw new Error(`${path.basename(args[0]!)} exited ${r.exitCode}`);
  return r.exitCode;
}
const rel = (p: string) => path.relative(EDITOR, p);

/** plan.ts's storyboard.json as the build.py STORYBOARD (the editor's own recipes: page per screen cell, comment_ask). */
type Sb = { crop: number[]; fill: string; cells: Record<string, { recipe: string; shots?: { file: string; from: number[]; to: number[]; zoom: number }[]; [k: string]: unknown }> };
function storyboardPy(sb: Sb): string {
  const q = (v: unknown) => JSON.stringify(v);
  const lines = Object.entries(sb.cells).map(([id, c]) => {
    if (c.recipe === 'page') return `    ${q(id)}: (page, dict(shots=[${c.shots!.map((s) => `(${q(s.file)}, None, (((${s.from[0]}, ${s.from[1]}), ${s.zoom}), ((${s.to[0]}, ${s.to[1]}), ${s.zoom})), CROP, FILL)`).join(',\n' + ' '.repeat(30))}])),`;
    const a = c.attachment as [string, string] | null;
    return `    ${q(id)}: (comment_ask, dict(comment=${q(c.comment)}, keyword=${q(c.keyword)}, send=${q(c.send)}, reply=${q(c.reply)}, reply_text=${q(c.reply_text)}${a ? `, attachment=(${q(a[0])}, ${q(a[1])})` : ''})),`;
  });
  return `# written by media-machine presets/talking-head/plan.ts (storyboard.json): real OS screens, each shot a framing at\n# z ${sb.cells && Object.values(sb.cells).find((c) => c.shots)?.shots?.[0]?.zoom} drifting down the page; the ask as the editor's DM thread\nCROP = ${q(sb.crop)}\nFILL = ${q(sb.fill)}\nSTORYBOARD = {\n${lines.join('\n')}\n}`;
}

for (const r of reels) {
  const j = job(x, r.title);
  const J = j.dir, gfx = j.p('hf-graphics', 'gfx');
  const plan = j.p('graphics-plan.json');
  const need = (f: string, what: string) => { if (!has(f)) throw new Error(`reel ${r.n}: ${what} is missing (${path.relative(x.dir, f)})`); };
  need(j.base, 'the base cut (cut.ts)');
  console.log(`\n== reel ${r.n} "${r.title}" (${j.name})`);
  for (const step of STEPS.slice(from, to + 1)) {
    console.log(`\n-- ${step}`);
    switch (step) {
      case 'measure': {
        if (has(j.p('face-frame.json')) && !AGAIN) { console.log('face-frame.json exists (--again to measure again)'); break; }
        uv(['workflows/face-frame.py', J, '--modes'], { ok: [0, 3] });
        break;
      }
      case 'plan': {
        const ours = has(plan) && /plan\.ts/.test(String(readJson<{ planned_by?: string }>(plan).planned_by ?? ''));
        if (!has(plan) || (ours && AGAIN)) {
          const r = Bun.spawnSync(['bun', path.join(import.meta.dir, 'plan.ts'), J, lookFile], { stdout: 'inherit', stderr: 'inherit' });
          if (r.exitCode !== 0) throw new Error('plan.ts failed');
        } else console.log(ours ? 'graphics-plan.json from plan.ts (--again to plan again)' : 'graphics-plan.json written by hand: kept');
        need(plan, 'graphics-plan.json');
        // a planned cell's original screen under the cell's id, as the plan check expects (the stage step stages it)
        if (has(j.p('storyboard.json'))) for (const [gid, id] of Object.entries(readJson<{ originals?: Record<string, string> }>(j.p('storyboard.json')).originals ?? {})) {
          mkdirSync(j.p('assets', 'captures'), { recursive: true });
          copyFileSync(path.join(LIBRARY, 'os-screens', `${id}.png`), j.p('assets', 'captures', `${gid}.png`));
        }
        // placement.json is derived (place writes it from the plan and the renders); a copy from an earlier plan fails
        // the layout's L-ALIGN against rows that no longer exist
        const placed = j.p('hf-graphics', 'placement.json');
        if (has(placed)) { rmSync(placed); console.log('an earlier placement.json removed: place writes it again'); }
        // the collar (the W/T caption heights) and a crown per O row (the card's clearance over his head)
        uv(['workflows/face-frame.py', J, '--collar', '--plan', J], { ok: [0, 3] });
        // no collar found (a bare chest, a dark top): the brand's caption heights, set on the plan, as the editor allows
        const ff = readJson<{ collar?: number | null }>(j.p('face-frame.json'));
        const p = readJson<{ beats: { kind?: string; y?: unknown }[] }>(plan);
        const cap = p.beats.find((c) => c.kind === 'captions');
        if (ff.collar == null && cap && !cap.y && look?.captionY) {
          cap.y = { ...look.captionY, measured: 'no collar measured (face-frame.py --collar): the brand\'s caption heights (look.json captionY), checked on the contact sheet' };
          writeFileSync(plan, JSON.stringify(p, null, 1));
          console.log(`no collar measured: captions at the brand's heights (wide y${look.captionY.wide}, tight y${look.captionY.tight})`);
        }
        const rows = readJson<{ layout: { start: number; end: number; mode: string }[] }>(plan).layout ?? [];
        for (const row of rows.filter((w) => w.mode === 'O')) uv(['workflows/face-frame.py', J, '--crown', String(row.start), String(row.end)], { ok: [0, 3] });
        uv(['.claude/skills/graphics-plan/scripts/validate-plan.py', J]);
        uv([rel(path.join(PRESET, 'layout.py')), J, '--check']);
        break;
      }
      case 'init': {
        uv([rel(KIT), 'init', J]);
        if (look) {
          // the brand's type over the kit's staged display fonts (the kit reads Display-*.otf by name)
          for (const [name, src] of Object.entries(look.fonts ?? {})) {
            if (!existsSync(src)) { console.warn(`font ${src} not found: the kit's own stays`); continue; }
            copyFileSync(src, path.join(gfx, 'assets', 'fonts', name));
          }
          // the brand's accent for the house royal blue, in the job's copies of the kit only
          for (const f of ['engine.py', 'components.py']) {
            const p = path.join(gfx, 'kit', f);
            let s = readFileSync(p, 'utf8');
            s = s.replace(/("ROYAL"\s*:\s*")#[0-9a-fA-F]{6}(")/g, `$1${look.accent}$2`);
            if (look.accentSoft) s = s.replace(/("SKY"\s*:\s*")#[0-9a-fA-F]{6}(")/g, `$1${look.accentSoft}$2`);
            if (look.grid) s = s.replace(/("BG_GRID"\s*:\s*")[^"]+(")/g, `$1${look.grid}$2`);
            if (look.light) s = s.replace(/("BG_LIGHT"\s*:\s*")[^"]+(")/g, `$1${look.light}$2`);
            writeFileSync(p, s);
          }
          if (look.logo && existsSync(look.logo)) uv([rel(KIT), 'stage', J, 'brand', look.logo, '--mark', '--name', `${x.brand.key}.png`], { ok: [0, 1] });
        }
        // this Mac keeps npm's one-day release-age guard, which npm refuses to combine with the editor's date freeze:
        // the pinned engine resolves its packages under the guard instead (README § Tools)
        const rs = path.join(gfx, 'render.sh');
        if (has(rs)) writeFileSync(rs, readFileSync(rs, 'utf8').replace(/npm_config_before="\$HF_BEFORE"\s+/g, ''));
        break;
      }
      case 'stage': {
        need(plan, 'graphics-plan.json');
        // the OS screens plan.ts chose, from the library, each under its own name (the storyboard's shots name them so)
        const sb = j.p('storyboard.json');
        if (has(sb)) {
          const st = readJson<{ screens: string[]; originals?: Record<string, string> }>(sb);
          for (const [gid, id] of [...st.screens.map((id) => [id, id]), ...Object.entries(st.originals ?? {})]) {
            if (has(path.join(gfx, 'assets', 'captures', `${gid}.png`)) && !AGAIN) continue;
            uv([rel(KIT), 'stage', J, gid!, path.join(LIBRARY, 'os-screens', `${id}.png`)]);
          }
        }
        const cells = (readJson<{ beats?: { id: string; asset?: string; kind?: string }[] }>(plan).beats ?? []).filter((c) => c.asset);
        const capDir = x.p('captures');
        for (const c of cells) {
          const staged = j.p(c.asset!);
          if (has(staged) && !AGAIN) continue;
          const src = readdirSync(capDir).find((f) => f.replace(/\.[^.]+$/, '') === c.id);
          if (!src) throw new Error(`reel ${r.n}: cell ${c.id} names ${c.asset} and ${path.relative(x.dir, capDir)}/${c.id}.* is not there to stage`);
          uv([rel(KIT), 'stage', J, c.id, path.join(capDir, src)]);
        }
        break;
      }
      case 'build': {
        need(path.join(gfx, 'build.py'), 'the kit (init)');
        const bp = path.join(gfx, 'build.py');
        if (/STORYBOARD = \{\s*\}/.test(readFileSync(bp, 'utf8')) && has(j.p('storyboard.json'))) writeFileSync(bp, readFileSync(bp, 'utf8').replace(/STORYBOARD = \{\s*\}/, storyboardPy(readJson(j.p('storyboard.json')))));
        if (/STORYBOARD = \{\s*\}/.test(readFileSync(bp, 'utf8'))) throw new Error(`reel ${r.n}: the STORYBOARD in hf-graphics/gfx/build.py is empty: bind every plan cell to its recipe (graphics.md § 15)`);
        uv([path.join(gfx, 'build.py')]);
        break;
      }
      case 'render': {
        const comps = readdirSync(path.join(gfx, 'compositions')).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5));
        if (!comps.length) throw new Error(`reel ${r.n}: no compositions to render (build)`);
        for (const id of comps) {
          if (!AGAIN && readdirSync(path.join(gfx, 'renders')).some((f) => f.startsWith(`${id}-alpha`) && f.endsWith('.mov'))) { console.log(`${id}: rendered (--again to render again)`); continue; }
          uv([path.join(gfx, 'kit', 'engine.py'), 'render', id], { cwd: gfx });
        }
        break;
      }
      case 'captions': {
        // the brand's own captions (look.json "captions": "mix", Josef 2026-10-22) instead of the editor's boxed ones
        if (look?.captions === 'mix') {
          const r = Bun.spawnSync(['bun', path.join(import.meta.dir, 'captions-mix.ts'), J], { stdout: 'inherit', stderr: 'inherit' });
          if (r.exitCode !== 0) throw new Error('captions-mix.ts failed');
          break;
        }
        uv([rel(path.join(PRESET, 'captions.py')), J]);
        uv([rel(path.join(PRESET, 'captions.py')), J, '--straight-alpha', '--ver', 'sa']);
        break;
      }
      case 'place': uv(['workflows/placement.py', J, '--write']); break;
      case 'qa': {
        uv(['workflows/graphics-qa-short.py', J]);
        uv([rel(path.join(PRESET, 'layout.py')), J, '--check']);
        uv(['workflows/change-events.py', '--sync', J], { ok: [0, 2] });
        break;
      }
      case 'assemble': {
        uv([path.join(import.meta.dir, 'assemble.py'), J]); // the editor's assemble with the overlay timing fix (see its header)
        uv(['workflows/face-frame.py', '--verify', j.p('hf-graphics', 'renders', 'final.mp4'), '--plan', J]);
        break;
      }
      case 'sfx': {
        uv(['workflows/sfx-plan.py', J]);
        uv(['lanes/chat-only/mix-sfx.py', J, j.p('hf-graphics', 'renders', 'final.mp4'), j.p('outputs', `${j.name}-final.mp4`)]);
        break;
      }
      case 'flash': uv(['workflows/flash-scan.py', j.p('outputs', `${j.name}-final.mp4`), '--expect', J]); break;
    }
  }
  log(x, `talking-head reel ${r.n}: ${STEPS.slice(from, to + 1).join(', ')} done`);
}
