// The engine's own helpers (2026-10-22). One machine for every brand (Ophanim AI, VolpinVeritas, Luca's L Ven), each a
// profile in brands/<key>/brand.json with its own root folder for recording sessions; the brands never mix. Everything
// generic (ffmpeg, whisper, the OS) is in core/. A session is one recording: <root>/<date>/ with his takes in raw/; the
// engine's own files go in work/; every reel cut from it becomes a job folder <root>/<date>/<slug>/ in the editor's
// layout (vendor/video-editor: raw/, transcript/, outputs/, RUN.md), which that editor's tools then dress.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { has, readJson, writeJson } from './core/media';
import type { Lang } from './core/speech';

export * from './core/media';
export const ENGINE = import.meta.dir;
/** The repo: engine/, brands/, library/, presets/, jobs/ (never in git), setup/. */
export const ROOT = path.resolve(ENGINE, '..');
/** The folder that holds the repos side by side (media-machine, video-editor, volpinveritas-website, OPHANIM AI OS). */
export const BASE = path.resolve(ROOT, '..');
/** Jason's editor (the presets, the workflows, the render kit): its own folder beside this repo, never copied in. */
export const EDITOR = process.env.VIDEO_EDITOR ?? path.join(BASE, 'video-editor');
export const LIBRARY = path.join(ROOT, 'library');

export interface Brand {
  key: string;
  name: string;
  lang: Lang;
  /** Where this brand's recording sessions live ("{machine}/jobs/<key>" here; VolpinVeritas in its own repo). */
  root: string;
  os: { org: string; workspace: string; platforms: string[]; linkedinAuthor?: string };
  /** Names and terms whisper should know (the prompt). */
  names: string;
  nameFixes: [string, string][];
  /** Playback speed of the finished reel (his VolpinVeritas reels run at 1.01 to 1.05x). */
  speed: number;
  frame: { w: number; h: number };
  /** The look after the cut: the preset in presets/<name> that dresses a job (none: the base cut goes out as it is). */
  preset?: string;
  /** The music pool (music.ts): every track in library/music, at `lufs` under his voice; `skip`: words of names to leave out. */
  music: { lufs?: number; skip?: string[]; dirs?: string[] };
  /** The longest pause kept between two words (seconds); longer ones are cut. */
  gap: number;
  voice?: 'natural' | 'clean';
  capcut?: { template: string; prefix: string };
  trials?: { count: number; everyHours: number; from: string; to: string; graduation: 'MANUAL' | 'SS_PERFORMANCE'; verified: boolean };
  notes?: string;
}

const expand = (v: unknown): unknown => typeof v === 'string' ? v.replace(/^\{base\}/, BASE).replace(/^\{machine\}/, ROOT).replace(/^~(?=\/)/, process.env.HOME ?? '~')
  : Array.isArray(v) ? v.map(expand) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)])) : v;
export const brandKeys = () => readdirSync(path.join(ROOT, 'brands')).filter((d) => existsSync(path.join(ROOT, 'brands', d, 'brand.json')));
export const brandDir = (key: string) => path.join(ROOT, 'brands', key);
export function brand(key: string): Brand {
  const f = path.join(brandDir(key), 'brand.json');
  if (!existsSync(f)) throw new Error(`no brand "${key}" (brands: ${brandKeys().join(', ')})`);
  return { ...(expand(readJson<Brand>(f)) as Brand), key };
}

/** A session: one recording of one brand, and the places inside it. */
export function batch(brandKey: string, name: string) {
  const b = brand(brandKey);
  const clean = name.replace(/[^a-z0-9-]/gi, '').toLowerCase();
  if (!clean) throw new Error('no session name (the recording date, 2026-10-24)');
  const dir = path.join(b.root, clean);
  if (!existsSync(dir)) throw new Error(`no folder ${dir}`);
  const p = (...xs: string[]) => path.join(dir, ...xs);
  return { brand: b, name: clean, dir, p, raw: p('raw'), work: p('work') };
}
export type Batch = ReturnType<typeof batch>;

/** A reel's job folder inside its session, in the editor's layout; `slug` from the reel's title. */
export const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'reel';
export function job(x: Batch, title: string) {
  const name = slug(title), dir = x.p(name);
  const p = (...xs: string[]) => path.join(dir, ...xs);
  return { name, dir, p, raw: p('raw'), transcript: p('transcript'), outputs: p('outputs'), base: p('outputs', `${name}.mp4`), final: p('outputs', `${name}.final.mp4`) };
}
export type Job = ReturnType<typeof job>;
/** The finished picture of a job: the editor's final when it exists, else the base cut. */
export const finished = (j: Job) => [j.final, j.p('outputs', `${j.name}-final.mp4`), j.p('outputs', `${j.name}-music.mp4`), j.base].find(has);

export interface State { phase: string; updated: string; [k: string]: unknown }
export function state(x: Batch): State {
  const f = x.p('state.json');
  return has(f) ? readJson<State>(f) : { phase: 'new', updated: new Date().toISOString() };
}
export function setState(x: Batch, patch: Partial<State>) {
  const s = { ...state(x), ...patch, updated: new Date().toISOString() };
  writeJson(x.p('state.json'), s);
  return s;
}
export function log(x: Batch, line: string) {
  const f = x.p('PROGRESS.md');
  const head = has(f) ? readFileSync(f, 'utf8') : `# PROGRESS: ${x.brand.name} ${x.name}\nTaste: brands/${x.brand.key}/TASTE.md\n\n`;
  writeFileSync(f, `${head}- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${line}\n`);
}

/** Words of a sentence, for comparing what was said with what was written: lower case, letters and digits only. */
export const tokens = (s: string) => s.toLowerCase().replace(/[’`]/g, "'").split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);

/** Whether two words are the same word (exactly, or close enough for whisper's spelling of a long word). */
export function same(a: string, b: string): boolean {
  if (a === b) return true;
  const x = a.replace(/'/g, ''), y = b.replace(/'/g, '');
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 7) return false; // "delle" and "della" are different words
  const m = x.length, n = y.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n]! / Math.max(m, n) >= 0.75;
}
