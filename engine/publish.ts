#!/usr/bin/env bun
// Step 5: the reels into the OS, each brand into its own workspace (2026-10-19): VolpinVeritas reels onto VolpinVeritas
// posts, Ophanim reels onto Ophanim AI posts. Never schedules or posts anything: a reel lands on its post in "review",
// with the video attached, and waits for Josef there (the OS publishes only what he moves to "scheduled").
//   - the post: the one the script came from; a script that came from scripts.md gets a new post (title, script)
//   - the file: <job>/outputs/<slug>.final.mp4 (finish.ts), re-encoded smaller when it is over 48 MB (Supabase's free plan takes 50 MB a file)
//   - storage: content-media/<org>/reels/<batch>/<n>-<time>.mp4; the reel it replaces on that post is deleted
//   bun publish.ts <brand> <batch> [reel numbers]
//   bun publish.ts <brand> --cleanup    deletes the files of this brand's reels posted more than 3 days ago (Blotato
//                                      keeps its own copy; the OS's 1 GB fills in two months otherwise)
import path from 'node:path';
import { statSync } from 'node:fs';
import { batch, brand, ffmpeg, finished, flag, has, job, log, osDb, osEnv, probe, readJson, setState } from './lib';

const env = osEnv();
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA || !KEY) throw new Error('the OS .env.local has no Supabase URL or service key');
const BUCKET = 'content-media', LIMIT = 48 * 1024 * 1024;
const storage = (p: string) => `${SUPA}/storage/v1/object/${BUCKET}/${p.split('/').map(encodeURIComponent).join('/')}`;
const auth = { Authorization: `Bearer ${KEY}`, apikey: KEY };

if (flag('cleanup')) {
  const b = brand(process.argv[2] ?? '');
  const sql = await osDb();
  try {
    const rows = await sql`select id, media_path from content_posts where org_id = ${b.os.org} and status = 'posted' and media_path like ${`${b.os.org}/reels/%`} and coalesce(posted_at, updated_at) < now() - interval '3 days'`;
    for (const r of rows) {
      const res = await fetch(`${SUPA}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [r.media_path] }) });
      if (!res.ok) { console.warn(`could not delete ${r.media_path}: ${res.status}`); continue; }
      await sql`update content_posts set media_path = null, media_mime = null, media_bytes = null, updated_at = now() where id = ${r.id}`;
      console.log(`freed ${r.media_path}`);
    }
    console.log(`${rows.length} posted reel file(s) freed`);
  } finally { await sql.end({ timeout: 5 }); }
  process.exit(0);
}

const x = batch(process.argv[2] ?? '', process.argv[3] ?? '');
const only = process.argv.slice(4).filter((a) => /^\d+$/.test(a)).map(Number);
type Reel = { n: number; postId: string | null; title: string; caption: string };
const reels = readJson<Reel[]>(path.join(x.work, 'reels.json')).filter((r) => !only.length || only.includes(r.n));
const { scripts } = readJson<{ scripts: { postId: string | null; title: string; sentences: { text: string }[] }[] }>(path.join(x.work, 'scripts.json'));

const sql = await osDb();
try {
  for (const r of reels) {
    const j = job(x, r.title);
    let src = has(j.final) ? j.final : '';
    if (!src) { console.warn(`reel ${r.n}: no final yet (finish.ts)${finished(j) ? `; the base cut exists` : ''}`); continue; }
    // under the free plan's file limit: the same picture at a lower bitrate
    if (statSync(src).size > LIMIT) {
      const dur = probe(src).duration, kbps = Math.floor((LIMIT * 8) / dur / 1000) - 220;
      const small = src.replace(/\.mp4$/, '.post.mp4');
      ffmpeg(['-i', src, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', small]);
      src = small;
    }
    const bytes = statSync(src).size;
    // the post: the script's own, or a new one in this brand's workspace
    let postId = r.postId;
    if (!postId) {
      const sc = scripts[r.n - 1];
      const [row] = await sql`insert into content_posts (org_id, kind, title, script, status, style, platforms, author_key) values (${x.brand.os.org}, 'short', ${r.title || `Reel ${r.n}`}, ${sc ? sc.sentences.map((s) => s.text).join('\n') : null}, 'editing', 'with_media', ${sql.json(x.brand.os.platforms)}, ${x.brand.os.linkedinAuthor ?? null}) returning id`;
      postId = row.id as string;
    }
    const [post] = await sql`select id, org_id, status, media_path, platforms from content_posts where id = ${postId}`;
    if (!post) throw new Error(`reel ${r.n}: post ${postId} is gone`);
    if (post.org_id !== x.brand.os.org) throw new Error(`reel ${r.n}: post ${postId} is not in the ${x.brand.os.workspace} workspace: refusing`);
    if (post.status === 'scheduled' || post.status === 'posted') { console.warn(`reel ${r.n}: its post is already ${post.status}; not replacing its video`); continue; }
    const key = `${x.brand.os.org}/reels/${x.name}/${r.n}-${Date.now()}.mp4`;
    const up = await fetch(storage(key), { method: 'POST', headers: { ...auth, 'content-type': 'video/mp4', 'x-upsert': 'false', 'cache-control': '3600' }, body: Bun.file(src) });
    if (!up.ok) throw new Error(`reel ${r.n}: upload failed (${up.status}): ${(await up.text()).slice(0, 300)}`);
    await sql`update content_posts set media_path = ${key}, media_mime = 'video/mp4', media_bytes = ${bytes}, media_url = null, media_paths = '[]'::jsonb, style = 'with_media',
      status = 'review', platforms = ${sql.json((post.platforms as string[])?.length ? post.platforms : x.brand.os.platforms)},
      author_key = coalesce(author_key, ${x.brand.os.linkedinAuthor ?? null}), updated_at = now() where id = ${postId}`;
    // the reel this one replaces, if the machine put it there
    if (post.media_path && String(post.media_path).startsWith(`${x.brand.os.org}/reels/`)) {
      await fetch(`${SUPA}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [post.media_path] }) }).catch(() => {});
    }
    console.log(`reel ${r.n} -> ${x.brand.os.workspace} post "${r.title}" (${(bytes / 1e6).toFixed(1)} MB), now in review`);
    log(x, `publish reel ${r.n}: on ${x.brand.os.workspace} post ${postId}, in review (${(bytes / 1e6).toFixed(1)} MB)`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
setState(x, { phase: 'in review' });
