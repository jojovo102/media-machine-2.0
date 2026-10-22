#!/usr/bin/env bun
// The whole chain for one session (2026-10-22): scripts, prepare, match, cut, check, graphics, finish, capcut, publish.
//   bun run.ts <brand> <session> [--from <step>] [--to <step>] [--no-capcut] [--no-publish]
// Each step is its own script and can be run alone. check fails the run when a reel fails a check (check.py): nothing
// half-right goes further. graphics runs the brand's preset (presets/<name>/run.ts) when it has one; without one the
// base cut goes on as it is. CapCut is skipped (with a note) while CapCut is open, or without a template on this Mac.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ROOT, arg, batch, flag, log, setState } from './lib';

const [brandKey, name] = [process.argv[2] ?? '', process.argv[3] ?? ''];
const x = batch(brandKey, name);
const STEPS = ['scripts', 'prepare', 'match', 'cut', 'check', 'graphics', 'finish', 'capcut', 'publish'] as const;
const from = Math.max(0, STEPS.indexOf((arg('from', 'scripts') ?? 'scripts') as (typeof STEPS)[number]));
const to = STEPS.indexOf((arg('to', 'publish') ?? 'publish') as (typeof STEPS)[number]);
const notes: string[] = [];
const drafts = path.join(process.env.HOME ?? '', 'Movies/CapCut/User Data/Projects/com.lveditor.draft');
for (const step of STEPS.slice(from, to + 1)) {
  if (step === 'capcut' && flag('no-capcut')) continue;
  if (step === 'publish' && flag('no-publish')) continue;
  if (step === 'capcut' && Bun.spawnSync(['pgrep', '-x', 'CapCut']).exitCode === 0) { notes.push('CapCut was open: no CapCut project this time (run capcut.ts later)'); continue; }
  if (step === 'capcut' && (!x.brand.capcut || !existsSync(path.join(drafts, x.brand.capcut.template, 'draft_info.json')))) {
    notes.push(`no CapCut template ${x.brand.capcut ? `"${x.brand.capcut.template}" ` : ''}on this Mac: no CapCut project`);
    continue;
  }
  let script = path.join(import.meta.dir, `${step}.ts`);
  if (step === 'graphics') {
    if (!x.brand.preset) { notes.push('no preset on this brand: the base cut goes on as it is'); continue; }
    script = path.join(ROOT, 'presets', x.brand.preset, 'run.ts');
    if (!existsSync(script)) { notes.push(`preset "${x.brand.preset}" has no run.ts yet: graphics are done by hand on this job`); continue; }
  }
  console.log(`\n== ${step}`);
  const r = Bun.spawnSync(['bun', script, brandKey, name], { stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) { setState(x, { phase: `failed at ${step}` }); log(x, `run: failed at ${step}`); throw new Error(`${step} failed`); }
}
log(x, `run: done${notes.length ? ` (${notes.join('; ')})` : ''}`);
if (notes.length) console.log(`\n${notes.join('\n')}`);
