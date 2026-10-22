#!/usr/bin/env bun
// Step 7: trial reels (2026-10-21, OS decision D108). Josef: "as soon as I confirm the original version, can you make
// me the other 3 trial reel versions? Always putting them in the OS and posting them directly, spreading them across
// the day automatically from the OS."
//
// For every reel of a batch whose post Josef has approved (he moved it to "scheduled", or it is out): its versions
// (_core/trials.ts, the pack's presets) from the 1080p reel, each uploaded as a post of its own in the brand's
// workspace: Instagram only, the original's caption, `options.instagram.trial = { graduation, of, n }`, status
// "scheduled". The OS posts them through Blotato as trial reels (shown to non-followers first; MANUAL: never to his
// followers unless he graduates one in the app). They are spread from the original's time: one every `everyHours`
// between `from` and `to` o'clock in the workspace's timezone, a slot past `to` moving to the next morning.
//
// This is the one step that schedules: Josef's approval of the original is the approval of its trials. Made once per
// reel (a reel with its trials is skipped). Until the brand's `trials.verified`, one version only: the first trial ever
// is checked on the profile grid before three go out.
//   bun trials.ts <brand> <batch> [--dry]    --dry: render the versions and print the plan; nothing goes to the OS
import path from 'node:path';
import { statSync } from 'node:fs';
import { OS_DIR, batch, ensure, ffmpeg, flag, has, job, log, osDb, osEnv, probe, readJson } from './lib';
import { trialVersion } from './core/trials';

const x = batch(process.argv[2] ?? '', process.argv[3] ?? '');
const DRY = flag('dry');
type TrialCfg = { count: number; everyHours: number; from: string; to: string; graduation: 'MANUAL' | 'SS_PERFORMANCE'; verified: boolean };
const cfg = (x.brand as unknown as { trials?: TrialCfg }).trials;
if (!cfg || !cfg.count) { console.log(`${x.brand.name}: no trials in its profile`); process.exit(0); }
const COUNT = cfg.verified || DRY ? cfg.count : 1;
const SHORT: Record<string, string> = { volpinveritas: 'vv', ophanim: 'oph' };

const env = osEnv();
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA || !KEY) throw new Error('the OS .env.local has no Supabase URL or service key');
const BUCKET = 'content-media', LIMIT = 48 * 1024 * 1024;
const storage = (p: string) => `${SUPA}/storage/v1/object/${BUCKET}/${p.split('/').map(encodeURIComponent).join('/')}`;
const auth = { Authorization: `Bearer ${KEY}`, apikey: KEY };

// ---- time in the workspace's own zone
function parts(t: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = Object.fromEntries(f.formatToParts(t).map((p) => [p.type, p.value]));
  return { y: +o.year!, mo: +o.month!, d: +o.day!, h: +o.hour!, mi: +o.minute! };
}
function zoned(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  let t = Date.UTC(y, mo - 1, d, h, mi);
  for (let k = 0; k < 2; k++) { const p = parts(new Date(t), tz); t += Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi); }
  return new Date(t);
}
const hm = (s: string) => s.split(':').map(Number) as [number, number];
/** The slots: one every `everyHours` from `start`, each inside from..to in `tz`, rounded to the quarter hour. */
function slots(start: Date, n: number, tz: string): Date[] {
  const [fh, fm] = hm(cfg!.from), [th, tm] = hm(cfg!.to), out: Date[] = [];
  let t = new Date(Math.ceil(start.getTime() / 900_000) * 900_000);
  while (out.length < n) {
    const p = parts(t, tz), mins = p.h * 60 + p.mi;
    if (mins < fh * 60 + fm) t = zoned(p.y, p.mo, p.d, fh, fm, tz);
    else if (mins > th * 60 + tm) { const next = new Date(zoned(p.y, p.mo, p.d, 12, 0, tz).getTime() + 86_400_000); const q = parts(next, tz); t = zoned(q.y, q.mo, q.d, fh, fm, tz); }
    else { out.push(t); t = new Date(t.getTime() + cfg!.everyHours * 3_600_000); }
  }
  return out;
}

type Reel = { n: number; postId: string | null; title: string };
const reels = readJson<Reel[]>(path.join(x.work, 'reels.json'));

// The live OS must know the trial marker (D108, OS commit 42f0014) before a trial is scheduled: an OS without it would
// post the versions as ordinary reels, onto his profile grid.
if (!DRY) {
  const OS_TRIALS = '42f0014';
  const live = await fetch('https://app.ophanimai.com/api/health').then((r) => r.json()).then((j: any) => String(j?.deployed?.commit ?? '')).catch(() => '');
  const ok = live && Bun.spawnSync(['git', '-C', OS_DIR, 'merge-base', '--is-ancestor', OS_TRIALS, live]).exitCode === 0;
  if (!ok) { console.log(`trials: the live OS (${live || 'unreachable'}) does not have trial reels yet (${OS_TRIALS}); nothing scheduled`); process.exit(0); }
}

const sql = await osDb();
try {
  const [org] = await sql`select timezone from organizations where id = ${x.brand.os.org}`;
  const tz = String(org?.timezone || 'Europe/Rome');
  for (const r of reels) {
    if (!r.postId) continue;
    const [post] = await sql`select id, org_id, status, title, caption, scheduled_at, posted_at from content_posts where id = ${r.postId}`;
    if (!post || post.org_id !== x.brand.os.org) { console.warn(`reel ${r.n}: its post is not in the ${x.brand.os.workspace} workspace`); continue; }
    if (!DRY && post.status !== 'scheduled' && post.status !== 'posted') { console.log(`reel ${r.n}: not approved yet (${post.status}), no trials`); continue; }
    const [{ made }] = await sql`select count(*)::int as made from content_posts where org_id = ${x.brand.os.org} and options->'instagram'->'trial'->>'of' = ${r.postId}`;
    if (!DRY && made > 0) { console.log(`reel ${r.n}: its ${made} trial(s) already made`); continue; }
    const j = job(x, r.title), file = has(j.final) ? j.final : null, dir = j.p('outputs', 'trials');
    ensure(dir);
    if (!file) { console.warn(`reel ${r.n}: no rendered reel in out/`); continue; }
    const base = new Date(Math.max(Date.now(), new Date(post.scheduled_at ?? post.posted_at ?? Date.now()).getTime()) + cfg.everyHours * 3_600_000);
    const when = slots(base, COUNT, tz);
    for (let i = 1; i <= COUNT; i++) {
      const id = `${SHORT[x.brand.key] ?? x.brand.key}-${x.name}-r${r.n}-t${i}`;
      let src = path.join(dir, `${id}.mp4`);
      const dur = trialVersion(file, src, i);
      if (statSync(src).size > LIMIT) {
        const kbps = Math.floor((LIMIT * 8) / dur / 1000) - 220, small = src.replace(/\.mp4$/, '.post.mp4');
        ffmpeg(['-i', src, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-map_metadata', '0', '-movflags', '+faststart', small]);
        src = small;
      }
      const at = when[i - 1]!, p = parts(at, tz);
      const day = `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`, time = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
      const bytes = statSync(src).size;
      console.log(`reel ${r.n} trial ${i}: ${id}, ${dur.toFixed(1)} s, ${(bytes / 1e6).toFixed(1)} MB, goes out ${day} ${time} (${tz})${DRY ? ' [dry run: not sent]' : ''}`);
      if (DRY) continue;
      const key = `${x.brand.os.org}/reels/${x.name}/${r.n}-t${i}-${Date.now()}.mp4`;
      const up = await fetch(storage(key), { method: 'POST', headers: { ...auth, 'content-type': 'video/mp4', 'x-upsert': 'false', 'cache-control': '3600' }, body: Bun.file(src) });
      if (!up.ok) throw new Error(`reel ${r.n} trial ${i}: upload failed (${up.status}): ${(await up.text()).slice(0, 300)}`);
      await sql`insert into content_posts (org_id, kind, title, caption, status, style, platforms, post_date, post_time, scheduled_at, media_path, media_mime, media_bytes, options)
        values (${x.brand.os.org}, 'short', ${`${post.title} · trial ${i}`}, ${post.caption}, 'scheduled', 'with_media', ${sql.json(['instagram'])}, ${day}, ${time}, ${at.toISOString()},
                ${key}, 'video/mp4', ${bytes}, ${sql.json({ instagram: { trial: { graduation: cfg.graduation, of: r.postId, n: i } } })})`;
      log(x, `trials reel ${r.n}: trial ${i} (${id}) scheduled ${day} ${time}`);
    }
    if (!cfg.verified && !DRY) console.log(`reel ${r.n}: one trial only until the first one is seen off the profile grid (brands/${x.brand.key}.json trials.verified)`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
