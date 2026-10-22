#!/usr/bin/env bun
// Step 4: the cut as a CapCut project, for Josef to finish there (2026-10-19). CapCut (9.5 on this Mac) has no
// official way in, but its projects are plain JSON: draft_info.json (the timeline), a copy under Timelines/<id>/,
// draft_meta_info.json (the project and its media library), Timelines/project.json, and root_meta_info.json, the list
// of every project. So a project is written by copying one of his own (the brand's template, e.g. 1007 for
// VolpinVeritas: "veritas 31") and replacing its cuts:
//   main track   one segment per piece of work/reels.json, his take at the brand's speed, the template's voice volume
//   audio track  the brand's music under the whole reel, at the template's volume
// (b-roll tracks are not written yet). Each segment gets its own copies of the materials the template's segments
// point to (video, speed, canvas, placeholder, sound channel, colour, vocal separation), with new ids.
//
// Safety: refuses while CapCut is running (it would overwrite the list); never changes an existing project except
// one this machine wrote (a .reel-machine file inside); backs up root_meta_info.json before adding to it.
//   bun capcut.ts <brand> <batch> [reel numbers]
import path from 'node:path';
import { copyFileSync, cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { batch, ffmpeg, has, log, probe, readJson } from './lib';
import { musicFor } from './music';

const x = batch(process.argv[2] ?? '', process.argv[3] ?? '');
const only = process.argv.slice(4).filter((a) => /^\d+$/.test(a)).map(Number);
const ROOT = path.join(process.env.HOME ?? '', 'Movies/CapCut/User Data/Projects/com.lveditor.draft');
const cfg = (x.brand as any).capcut as { template: string; prefix: string } | undefined;
if (!cfg) throw new Error(`brand ${x.brand.key} has no CapCut template yet (brands/${x.brand.key}.json "capcut")`);
const TEMPLATE = path.join(ROOT, cfg.template);
if (!existsSync(path.join(TEMPLATE, 'draft_info.json'))) throw new Error(`no CapCut project ${cfg.template} to use as the template`);
if (Bun.spawnSync(['pgrep', '-x', 'CapCut']).exitCode === 0) throw new Error('CapCut is open: close it first (it rewrites its project list on quit and would drop the new project)');

type Reel = { n: number; title: string; pieces: { take: string; file: string; pic?: string; a: number; b: number }[] };
const reels = readJson<Reel[]>(path.join(x.work, 'reels.json')).filter((r) => !only.length || only.includes(r.n));
// The project points at the raw take, as Josef's own projects do: CapCut converts an iPhone HDR take the same way the
// machine's normal-colour copy was made (Apple's conversion, _core/colour.ts), and the raw take is kept for good while
// work/ may be pruned. The cover frame is taken from the normal-colour copy.
const takes = readJson<{ takes: { n: string; raw?: string }[] }>(path.join(x.work, 'media.json')).takes;
for (const r of reels) for (const p of r.pieces) { p.pic = p.file; p.file = takes.find((t) => t.n === p.take)?.raw ?? p.file; }
const UP = () => crypto.randomUUID().toUpperCase(), low = () => crypto.randomUUID();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const us = (s: number) => Math.round(s * 1e6);
const nowUs = () => Date.now() * 1000;

const tpl = readJson<any>(path.join(TEMPLATE, 'draft_info.json'));
const tplMeta = readJson<any>(path.join(TEMPLATE, 'draft_meta_info.json'));
const mainTrack = tpl.tracks.find((t: any) => t.type === 'video');
const audioTrack = tpl.tracks.find((t: any) => t.type === 'audio');
const protoSeg = mainTrack.segments[0], protoAudio = audioTrack?.segments[0];
const findMat = (id: string): [string, any] | null => {
  for (const [k, arr] of Object.entries(tpl.materials)) if (Array.isArray(arr)) { const m = (arr as any[]).find((e) => e.id === id); if (m) return [k, m]; }
  return null;
};
const libVideo = tplMeta.draft_materials[0].value.find((v: any) => v.metetype === 'video');
const libMusic = tplMeta.draft_materials[0].value.find((v: any) => v.metetype === 'music');
const libNone = tplMeta.draft_materials[0].value.find((v: any) => v.metetype === 'none');

for (const r of reels) {
  if (!r.pieces.length) continue;
  const name = `${cfg.prefix} ${x.name} ${r.n}`;
  const dir = path.join(ROOT, name);
  if (existsSync(dir)) {
    if (!existsSync(path.join(dir, '.reel-machine'))) throw new Error(`a CapCut project "${name}" exists and was not made by the machine: not touching it`);
    rmSync(dir, { recursive: true, force: true });
  }
  cpSync(TEMPLATE, dir, { recursive: true });
  writeFileSync(path.join(dir, '.reel-machine'), `${x.brand.key} ${x.name} reel ${r.n}, ${new Date().toISOString()}\n`);
  const oldTimeline = tpl.id, timelineId = UP(), draftId = UP(), projectId = UP();

  // ---- the media library: the takes and the music
  const files = [...new Set(r.pieces.map((p) => p.file))];
  // the same track as the rendered reel (music.ts), at the template's volume (his to adjust in CapCut)
  const music = musicFor(x, r.n)?.file;
  const lib: any[] = [];
  if (libNone) lib.push({ ...clone(libNone), id: low() });
  const libId = new Map<string, string>();
  for (const f of files) {
    const p = probe(f), e = clone(libVideo);
    Object.assign(e, { id: low(), file_Path: f, extra_info: path.basename(f), duration: us(p.duration), width: p.video!.w, height: p.video!.h, create_time: Math.floor(Date.now() / 1000), import_time: Math.floor(Date.now() / 1000), import_time_ms: nowUs(), roughcut_time_range: { duration: us(p.duration), start: 0 } });
    lib.push(e); libId.set(f, e.id);
  }
  let musicDur = 0;
  if (music && has(music) && libMusic) {
    musicDur = probe(music).duration;
    const e = clone(libMusic);
    Object.assign(e, { id: low(), file_Path: music, extra_info: path.basename(music), duration: us(musicDur), roughcut_time_range: { duration: us(musicDur), start: 0 } });
    lib.push(e); libId.set(music, e.id);
  }

  // ---- the timeline
  const mats: Record<string, any[]> = Object.fromEntries(Object.keys(tpl.materials).map((k) => [k, Array.isArray(tpl.materials[k]) ? [] : tpl.materials[k]]));
  const copyRefs = (refs: string[], speed?: number) => refs.map((id) => {
    const found = findMat(id);
    if (!found) return id;
    const [k, m] = found, c = clone(m);
    c.id = UP();
    if (k === 'speeds' && speed) c.speed = speed;
    (mats[k] as any[]).push(c);
    return c.id;
  });
  const protoVid = findMat(protoSeg.material_id)![1];
  let cursor = 0;
  const segments = r.pieces.map((p, i) => {
    const pr = probe(p.file), vid = clone(protoVid), seg = clone(protoSeg);
    Object.assign(vid, { id: UP(), path: p.file, media_path: '', material_name: path.basename(p.file), duration: us(pr.duration), width: pr.video!.w, height: pr.video!.h, local_material_id: libId.get(p.file) });
    mats.videos!.push(vid);
    const z = x.brand.punch[i % x.brand.punch.length]!;
    const dur = us(p.b - p.a), tdur = Math.round(dur / x.brand.speed);
    Object.assign(seg, {
      id: UP(), material_id: vid.id, extra_material_refs: copyRefs(protoSeg.extra_material_refs, x.brand.speed), speed: x.brand.speed,
      source_timerange: { start: us(p.a), duration: dur }, target_timerange: { start: cursor, duration: tdur }, render_timerange: { start: 0, duration: 0 },
      clip: { ...seg.clip, scale: { x: z, y: z }, transform: { x: 0, y: 0 } }, keyframe_refs: [], common_keyframes: [],
    });
    cursor += tdur;
    return seg;
  });
  const total = cursor;
  const tracks: any[] = [{ ...clone(mainTrack), id: UP(), segments }];
  if (music && musicDur && protoAudio) {
    const am = clone(findMat(protoAudio.material_id)![1]), seg = clone(protoAudio);
    Object.assign(am, { id: UP(), path: music, name: path.basename(music), duration: us(musicDur), local_material_id: libId.get(music), music_id: low() });
    mats.audios!.push(am);
    const len = Math.min(total, us(musicDur));
    Object.assign(seg, { id: UP(), material_id: am.id, extra_material_refs: copyRefs(protoAudio.extra_material_refs), source_timerange: { start: 0, duration: len }, target_timerange: { start: 0, duration: len }, render_timerange: { start: 0, duration: 0 }, keyframe_refs: [], common_keyframes: [] });
    tracks.push({ ...clone(audioTrack), id: UP(), segments: [seg] });
  }
  const draft = { ...clone(tpl), id: timelineId, duration: total, tracks, materials: mats, keyframes: Object.fromEntries(Object.entries(tpl.keyframes ?? {}).map(([k, v]) => [k, Array.isArray(v) ? [] : v])), name: '' };
  const json = JSON.stringify(draft);
  for (const f of ['draft_info.json', 'draft_info.json.bak', 'template-2.tmp']) writeFileSync(path.join(dir, f), json);
  rmSync(path.join(dir, 'Timelines', oldTimeline), { recursive: true, force: true });
  cpSync(path.join(TEMPLATE, 'Timelines', oldTimeline), path.join(dir, 'Timelines', timelineId), { recursive: true });
  for (const f of ['draft_info.json', 'draft_info.json.bak', 'template-2.tmp']) writeFileSync(path.join(dir, 'Timelines', timelineId, f), json);
  const proj = readJson<any>(path.join(TEMPLATE, 'Timelines', 'project.json'));
  Object.assign(proj, { id: projectId, main_timeline_id: timelineId, create_time: nowUs(), update_time: nowUs() });
  proj.timelines = [{ ...proj.timelines[0], id: timelineId, create_time: nowUs(), update_time: nowUs() }];
  for (const f of ['project.json', 'project.json.bak']) writeFileSync(path.join(dir, 'Timelines', f), JSON.stringify(proj));
  writeFileSync(path.join(dir, 'timeline_layout.json'), JSON.stringify({ dockItems: [{ dockIndex: 0, ratio: 1, timelineIds: [timelineId], timelineNames: [proj.timelines[0].name ?? 'Timeline 01'] }], layoutOrientation: 1 }));
  writeFileSync(path.join(dir, 'key_value.json'), '{}');

  // ---- the project and its cover
  const cover = path.join(dir, 'draft_cover.jpg');
  ffmpeg(['-ss', (r.pieces[0]!.a + 0.5).toFixed(2), '-i', r.pieces[0]!.pic ?? r.pieces[0]!.file, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '3', cover]);
  copyFileSync(cover, path.join(dir, 'Timelines', timelineId, 'draft_cover.jpg'));
  const size = files.reduce((t, f) => t + statSync(f).size, 0) + (music && has(music) ? statSync(music).size : 0);
  const meta = clone(tplMeta);
  meta.draft_materials[0].value = lib;
  Object.assign(meta, { draft_id: draftId, draft_name: name, draft_fold_path: dir, draft_root_path: ROOT, tm_draft_create: nowUs(), tm_draft_modified: nowUs(), tm_duration: total, draft_timeline_materials_size_: size, draft_segment_extra_info: [] });
  writeFileSync(path.join(dir, 'draft_meta_info.json'), JSON.stringify(meta));
  const store = readJson<any>(path.join(TEMPLATE, 'draft_virtual_store.json'));
  store.draft_virtual_store = store.draft_virtual_store.map((g: any) => (g.type === 1 ? { ...g, value: lib.map((e) => ({ child_id: e.id, parent_id: '' })) } : g));
  writeFileSync(path.join(dir, 'draft_virtual_store.json'), JSON.stringify(store));

  // ---- the list of projects (backed up first)
  const rootFile = path.join(ROOT, 'root_meta_info.json');
  copyFileSync(rootFile, `${rootFile}.before-reel-machine`);
  const root = readJson<any>(rootFile);
  const tplEntry = root.all_draft_store.find((d: any) => d.draft_fold_path === TEMPLATE);
  root.all_draft_store = root.all_draft_store.filter((d: any) => d.draft_fold_path !== dir);
  root.all_draft_store.unshift({ ...clone(tplEntry), draft_cover: cover, draft_fold_path: dir, draft_id: draftId, draft_json_file: path.join(dir, 'draft_info.json'), draft_name: name, draft_root_path: ROOT, draft_timeline_materials_size: size, tm_draft_create: nowUs(), tm_draft_modified: nowUs(), tm_duration: total });
  root.draft_ids = root.all_draft_store.length;
  writeFileSync(rootFile, JSON.stringify(root));
  console.log(`CapCut project "${name}": ${segments.length} cuts, ${(total / 1e6).toFixed(1)} s${music ? `, music ${path.basename(music)}` : ''}`);
  log(x, `capcut: "${name}" (${segments.length} cuts, ${(total / 1e6).toFixed(1)} s)`);
}
