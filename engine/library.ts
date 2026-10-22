// The media library's index (2026-10-22). Walks library/ and writes library/index.json: one entry per file with what
// ffprobe knows (duration, size, fps, alpha, audio) and, for sounds and music, how loud it is, so an edit can pick a
// whoosh or a loop by name, tag or length without opening anything. `bun engine/library.ts` after adding files; a file
// whose path, size and mtime are unchanged keeps its entry, `--force` measures everything again. No packages: Bun,
// Node and the ffprobe/ffmpeg binaries.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LIB = path.resolve(import.meta.dir, '..', 'library');
const INDEX = path.join(LIB, 'index.json');
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const JOBS = 6;
const FORCE = process.argv.includes('--force');

type Kind = 'sfx' | 'music' | 'motion-background' | 'shape' | 'overlay' | 'meme' | 'green-screen' | 'transition' | 'lut' | 'emoji' | 'dotted-line' | 'png';
const KINDS: Record<string, Kind> = {
  sfx: 'sfx', music: 'music',
  'packs/motion-backgrounds': 'motion-background', 'packs/shapes': 'shape', 'packs/overlays': 'overlay', 'packs/memes': 'meme',
  'packs/green-screen': 'green-screen', 'packs/transitions-film-burn': 'transition', 'packs/luts': 'lut', 'packs/emojis': 'emoji',
  'packs/dotted-lines': 'dotted-line', 'packs/pngs': 'png',
};
const SKIP = new Set(['.pool.json', 'index.json', 'README.md']);
const MEDIA = /\.(mp4|mov|m4v|webm|mkv|avi|gif|png|webp|jpe?g|mp3|wav|aiff?|m4a|aac|flac|ogg)$/i;
const STOP = new Set(['and', 'the', 'for', 'with', 'from', 'sound', 'sounds', 'effect', 'effects', 'sfx']);
// A person's name on a music file means the track was downloaded, not made for us: its rights are unknown until cleared.
const ARTISTS = ['stromae', 'vivaldi', 'glazunov', 'buckley', 'sabbah'];
const YT_ID = /\[[\w-]{11}\]/;
// What downloaders, stock sites and pack makers append to a file name, in the order they are removed.
const JUNK: RegExp[] = [
  /^y2mate\.is\s*-\s*/i, /-[\w-]{11}-1080pp-\d+$/, YT_ID, /_\d{5,}-\d{3,}$/, /\s*-\s*128\b/, /\((download|hd)\)/gi, /\[meme\]/gi,
  /\bsound effects?\b/gi, /\bsounds?\b/gi, /\beffects?\b/gi, /\bsfx\b/gi, /\bHD\b/g, /\bfree download\b/gi, /\bfree\b/gi,
  /\bvideo audio footage\b/gi, /@/g,
];
// Only these are reused from the previous index; everything else is derived from the path on every run, so a rule
// change (names, tags, rights) lands without --force.
const MEASURED = ['id', 'duration', 'width', 'height', 'fps', 'alpha', 'audio', 'channels', 'sampleRate', 'lufs', 'peakDb'] as const;

interface Item {
  id: string; path: string; kind: Kind; name: string; ext: string; bytes: number; mtime: string; tags: string[];
  source: 'Master SFX Pack' | 'ULTIMATE Editing Pack' | 'own' | "Jason's Background Music Library"; rights: 'pack' | 'own' | 'unknown' | 'commercial';
  duration?: number; width?: number; height?: number; fps?: number; alpha?: boolean; audio?: boolean; channels?: number; sampleRate?: number;
  lufs?: number | null; peakDb?: number | null;
  /** The path of the first entry with the same bytes. */
  duplicateOf?: string;
  error?: string;
}
interface Stream {
  codec_type: string; codec_name?: string; profile?: string; pix_fmt?: string; width?: number; height?: number;
  avg_frame_rate?: string; channels?: number; sample_rate?: string; disposition?: { attached_pic?: number };
}

function walk(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}
function kindOf(rel: string): Kind | undefined {
  const [top, sub] = rel.split('/');
  return KINDS[top === 'packs' ? `packs/${sub}` : top!];
}
function cleanName(file: string): string {
  let s = file.replace(/\.[^.]+$/, '');
  for (const re of JUNK) s = s.replace(re, ' ');
  return s
    .replace(/(\w)_s\b/g, "$1's") // "That_s" was "That's" before a downloader replaced the apostrophe
    .replace(/(?<=\w)[_-](?=\w)/g, ' ').replace(/_(?=\W|$)/g, '')
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ').replace(/(\s-)+\s-/g, ' -').replace(/^[\s\-,]+|[\s\-,]+$/g, '');
}
function tagsOf(name: string, kind: Kind): string[] {
  const words = name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set([...words, kind])];
}
const sourceOf = (kind: Kind, file = '') => kind === 'sfx' ? 'Master SFX Pack' : kind === 'music' ? (file.startsWith('music/jason/') ? "Jason's Background Music Library" : 'own') : 'ULTIMATE Editing Pack';
function rightsOf(kind: Kind, file: string): Item['rights'] {
  if (kind !== 'music') return 'pack';
  // Jason's Background Music Library (music/jason, 2026-10-22, downloaded with Josef's OK): mostly commercial songs as
  // instrumentals and slowed versions; never in the automatic rotation, chosen per reel by Josef
  if (file.startsWith('music/jason/')) return 'commercial';
  const n = file.toLowerCase();
  return YT_ID.test(file) || ARTISTS.some((a) => n.includes(a)) ? 'unknown' : 'own';
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const hasAlpha = (pix = '', profile = '') => /^(yuva|rgba|argb|bgra|abgr|gbrap|ya\d)/.test(pix) || profile.includes('4444');
function fpsOf(rate = ''): number | undefined {
  const [n, d] = rate.split('/').map(Number);
  return n && d ? round2(n / d) : undefined;
}

async function run(cmd: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}
async function sha1(file: string): Promise<string> {
  const h = createHash('sha1');
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex').slice(0, 12);
}
async function probe(file: string): Promise<Partial<Item>> {
  const fields = 'format=duration:stream=codec_type,codec_name,profile,pix_fmt,width,height,avg_frame_rate,channels,sample_rate:stream_disposition=attached_pic';
  const r = await run([FFPROBE, '-v', 'error', '-show_entries', fields, '-of', 'json', file]);
  if (r.code !== 0) throw new Error((r.err.trim().split('\n').pop() || `exit ${r.code}`).replace(`${file}: `, ''));
  const j = JSON.parse(r.out) as { streams?: Stream[]; format?: { duration?: string } };
  const streams = (j.streams ?? []).filter((s) => s.disposition?.attached_pic !== 1); // cover art in an mp3 is not a video
  const v = streams.find((s) => s.codec_type === 'video'), a = streams.find((s) => s.codec_type === 'audio');
  const out: Partial<Item> = {};
  const dur = Number(j.format?.duration);
  if (Number.isFinite(dur)) out.duration = round2(dur);
  if (v) {
    out.width = v.width; out.height = v.height; out.alpha = hasAlpha(v.pix_fmt, v.profile);
    if (out.duration !== undefined) out.fps = fpsOf(v.avg_frame_rate); // a still image has no duration and no real frame rate
  }
  out.audio = !!a;
  if (a) { out.channels = a.channels; out.sampleRate = Number(a.sample_rate); }
  return out;
}
async function loudness(file: string): Promise<{ lufs: number | null; peakDb: number | null }> {
  // A second of silence after the file: silence is gated out of the integrated value, so long files measure the same,
  // and a click shorter than the 400 ms block (which ffmpeg floors at -70) gets a real value.
  const r = await run([FFMPEG, '-hide_banner', '-nostats', '-i', file, '-filter_complex', 'apad=pad_dur=1,ebur128=peak=true', '-f', 'null', '-']);
  const tail = r.err.split('Summary:').pop() ?? '';
  const num = (re: RegExp) => { const v = Number(tail.match(re)?.[1]); return Number.isFinite(v) ? v : null; };
  const i = num(/I:\s+(-?[\d.]+) LUFS/);
  return { lufs: i !== null && i > -70 ? i : null, peakDb: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); }
  }));
  return out;
}

const t0 = Date.now();
const old: Item[] = !FORCE && existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')).items : [];
const byPath = new Map(old.map((i) => [i.path, i]));
const files = walk(LIB);
const unplaced: string[] = [];
let reused = 0;
const built = await pool(files, JOBS, async (rel): Promise<Item | null> => {
  const kind = kindOf(rel);
  if (!kind) { unplaced.push(rel); return null; }
  const abs = path.join(LIB, rel), st = statSync(abs), mtime = new Date(st.mtimeMs).toISOString();
  const file = path.basename(rel), name = cleanName(file);
  const item: Item = {
    id: '', path: rel, kind, name, ext: path.extname(file).slice(1).toLowerCase(), bytes: st.size, mtime,
    tags: tagsOf(name, kind), source: sourceOf(kind, file) as Item['source'], rights: rightsOf(kind, file),
  };
  const prev = byPath.get(rel);
  if (prev && prev.bytes === st.size && prev.mtime === mtime && !prev.error) {
    reused++;
    for (const k of MEASURED) if (prev[k] !== undefined) (item as Record<string, unknown>)[k] = prev[k];
    return item;
  }
  item.id = await sha1(abs);
  if (!MEDIA.test(file)) return item;
  try {
    Object.assign(item, await probe(abs));
    if (item.audio && item.width === undefined) Object.assign(item, await loudness(abs)); // a sound or a track, never a video decode
  } catch (e) {
    item.error = `ffprobe: ${(e as Error).message}`;
  }
  return item;
});

const items = (built.filter(Boolean) as Item[]).sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
const first = new Map<string, string>();
for (const i of items) {
  const kept = first.get(i.id);
  if (kept) i.duplicateOf = kept; else first.set(i.id, i.path);
}
const json = `{\n  "built": ${JSON.stringify(new Date().toISOString())},\n  "count": ${items.length},\n  "items": [\n${items.map((i) => `    ${JSON.stringify(i)}`).join(',\n')}\n  ]\n}\n`;
writeFileSync(INDEX, json);

const mb = (n: number) => (n / 1048576).toFixed(1);
const col = (s: string | number, w: number, right = false) => right ? String(s).padStart(w) : String(s).padEnd(w);
console.log(`${col('kind', 18)}${col('files', 6, true)}${col('MB', 9, true)}  duration`);
for (const kind of [...new Set(items.map((i) => i.kind))]) {
  const xs = items.filter((i) => i.kind === kind);
  const durs = xs.map((i) => i.duration).filter((d): d is number => d !== undefined);
  const range = (kind === 'sfx' || kind === 'music') && durs.length ? `${Math.min(...durs).toFixed(1)} to ${Math.max(...durs).toFixed(1)} s` : '';
  console.log(`${col(kind, 18)}${col(xs.length, 6, true)}${col(mb(xs.reduce((s, i) => s + i.bytes, 0)), 9, true)}  ${range}`);
}
console.log(`${col('total', 18)}${col(items.length, 6, true)}${col(mb(items.reduce((s, i) => s + i.bytes, 0)), 9, true)}`);
const dups = items.filter((i) => i.duplicateOf), bad = items.filter((i) => i.error), unknown = items.filter((i) => i.rights === 'unknown');
console.log(`\n${items.length - reused} measured, ${reused} reused, ${dups.length} duplicates, ${((Date.now() - t0) / 1000).toFixed(1)} s. Index: ${path.relative(process.cwd(), INDEX)} (${(statSync(INDEX).size / 1024).toFixed(0)} KB)`);
for (const i of dups) console.log(`duplicate: ${i.path} = ${i.duplicateOf}`);
for (const i of bad) console.log(`unreadable: ${i.path}: ${i.error}`);
for (const f of unplaced) console.log(`not indexed (no kind for its folder): ${f}`);
for (const i of unknown) console.log(`rights unknown, not for the business page until cleared: ${i.path}`);
