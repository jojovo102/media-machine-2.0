#!/usr/bin/env bun
// The watcher (2026-10-23). Josef: "can this be automated, cause it seems there's always a new request being asked of
// me", then yes to drop folders on the Desktop. macOS runs this every 5 minutes (setup/watch/, a LaunchAgent); it costs
// nothing when there is nothing to do and starts no AI: the machine's normal road is all scripts. In order:
//   1. drop folders  ~/Desktop/Drop/<Business|VolpinVeritas|L Ven>: files that have not changed for 10 minutes become
//                    a new session of that brand (new.ts), moved into its raw/, and the session runs
//   2. sessions      a session "waiting for takes" whose raw/ holds settled takes (the /media route) runs too:
//                    run.ts, every step from the scripts to the reel on its OS post in review
//   3. approvals     a reel Josef approved in the OS (scheduled or posted) with fewer trials than its brand makes:
//                    trials.ts for its session
//   4. YouTube       rendered clips newer than their business session: youtube.ts, then publish.ts
//   5. once a day    publish.ts --cleanup per brand
// Each result is said through the OS (POST /api/webhooks/machine: the bell and a push to his phone) and in a macOS
// notice. A step that fails says so and where, and leaves the session in its failed phase: Claude takes it from there
// when Josef asks. One run at a time (.watch/lock); the Mac is kept awake while a job runs (caffeinate).
//   bun engine/watch.ts [--dry]     --dry: say what it would do, do nothing
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { BASE, ROOT, brand, brandKeys, flag, osDb, osEnv, readJson } from './lib';

const DRY = flag('dry');
const STATE_DIR = path.join(ROOT, '.watch');
mkdirSync(STATE_DIR, { recursive: true });
const LOG = path.join(STATE_DIR, 'watch.log');
const say = (line: string) => { const l = `${new Date().toISOString().slice(0, 19).replace('T', ' ')} ${line}`; console.log(l); appendFileSync(LOG, l + '\n'); };

// ---- one run at a time
const LOCK = path.join(STATE_DIR, 'lock');
if (existsSync(LOCK)) {
  const pid = Number(readFileSync(LOCK, 'utf8'));
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch { /* gone */ }
  if (alive) process.exit(0);
}
writeFileSync(LOCK, String(process.pid));
process.on('exit', () => { try { if (readFileSync(LOCK, 'utf8') === String(process.pid)) Bun.spawnSync(['rm', '-f', LOCK]); } catch { /* ok */ } });
let awake = false;
const keepAwake = () => { if (!awake && !DRY) { Bun.spawn(['caffeinate', '-i', '-w', String(process.pid)]).unref(); awake = true; } };   // unref: it waits for us, we never wait for it

// ---- what this Mac runs: the drop folder of each brand whose root folder lives here
const DROP = path.join(homedir(), 'Desktop', 'Drop');
const DROPS: Record<string, string> = { ophanim: 'Business', volpinveritas: 'VolpinVeritas', lven: 'L Ven' };
const here = brandKeys().filter((k) => existsSync(brand(k).root));
const TAKE = /\.(mov|mp4|m4v|wav|m4a|aif|aiff)$/i;
const SETTLE_S = 600;
const seenFile = path.join(STATE_DIR, 'seen.json');
const seen: Record<string, number> = existsSync(seenFile) ? JSON.parse(readFileSync(seenFile, 'utf8')) : {};
const nextSeen: Record<string, number> = {};
/** a take that has not changed for SETTLE_S and kept its size since the last look: the copy is over */
function settled(f: string): boolean {
  const s = statSync(f);
  nextSeen[f] = s.size;
  return Date.now() - s.mtimeMs > SETTLE_S * 1000 && seen[f] === s.size;
}

// ---- telling Josef: the OS (bell + phone) and the Mac
async function tell(orgId: string, title: string, body: string, key: string) {
  say(`notice: ${title} | ${body}`);
  if (DRY) return;
  Bun.spawnSync(['osascript', '-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`]);
  try {
    const env = osEnv();
    // the signing key: given as is on a Mac that must not hold the OS's master key (Luca's: setup/make-env.sh), else
    // derived from it exactly as the OS route does
    const k = env.MACHINE_NOTIFY_KEY ? Buffer.from(env.MACHINE_NOTIFY_KEY, 'hex') : createHmac('sha256', env.SECRETS_KEY ?? '').update('media-machine-notify').digest();
    const payload = JSON.stringify({ orgId, title, body, href: '/content', dedupeKey: key });
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', k).update(`${ts}.${payload}`).digest('hex');
    const r = await fetch('https://app.ophanimai.com/api/webhooks/machine', { method: 'POST', headers: { 'content-type': 'application/json', 'x-machine-ts': String(ts), 'x-machine-sig': sig }, body: payload });
    if (!r.ok) say(`the OS notice failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) { say(`the OS notice failed: ${String(e).slice(0, 200)}`); }
}

function bun(args: string[], logTo: string): { ok: boolean; tail: string } {
  if (DRY) { say(`would run: bun ${args.join(' ')}`); return { ok: true, tail: '' }; }
  keepAwake();
  const r = Bun.spawnSync(['bun', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe', env: { ...process.env } });
  const out = r.stdout.toString() + r.stderr.toString();
  appendFileSync(logTo, `\n$ bun ${args.join(' ')}\n${out}`);
  return { ok: r.exitCode === 0, tail: out.trim().split('\n').slice(-4).join(' ').slice(0, 300) };
}

const sessionsOf = (k: string) => {
  const root = brand(k).root;
  return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('zz-') && !d.name.startsWith('_') && d.name !== 'test-lepanto')
    .map((d) => d.name);
};
const phase = (dir: string) => { try { return String(readJson<{ phase: string }>(path.join(dir, 'state.json')).phase ?? ''); } catch { return ''; } };

/** run one session from its scripts to its OS posts, and say how it went */
async function runSession(k: string, name: string) {
  const b = brand(k);
  const dir = path.join(b.root, name);
  const logTo = path.join(dir, 'watch.log');
  say(`${k} ${name}: running`);
  const TEST = process.env.MEDIA_WATCH_TEST === '1';   // a test run: everything but the CapCut project and the OS upload
  const r = bun(['engine/run.ts', k, name, ...(TEST ? ['--no-capcut', '--no-publish'] : [])], logTo);
  if (DRY) return;
  let reels: { title: string }[] = [];
  try { reels = readJson(path.join(dir, 'work', 'reels.json')); } catch { /* none */ }
  if (TEST) { await tell(b.os.org, `Test: the watcher ${r.ok ? 'cut' : 'stopped on'} ${b.os.workspace} ${name}`, r.ok ? `${reels.length} reel(s) cut, checked and finished from the drop folder (a test run: not uploaded).` : `It stopped at "${phase(dir)}". (${r.tail})`, `${k}:${name}:test:${Date.now()}`); return; }
  if (r.ok) await tell(b.os.org, `${reels.length} reel${reels.length === 1 ? '' : 's'} ready for review`, `${b.os.workspace}: ${reels.map((x) => x.title).join(', ')}. Open Content, status Review, and approve.`, `${k}:${name}:ready`);
  else await tell(b.os.org, `A cut stopped: ${b.os.workspace} ${name}`, `It stopped at "${phase(dir)}". Open Claude and say: fix the ${name} session. (${r.tail})`, `${k}:${name}:failed:${phase(dir)}`);
}

let did = 0;
// ---- 1. the drop folders
for (const k of here) {
  const folder = path.join(DROP, DROPS[k] ?? k);
  if (!existsSync(folder)) { if (!DRY) mkdirSync(folder, { recursive: true }); continue; }
  const takes = readdirSync(folder).filter((f) => !f.startsWith('.') && TAKE.test(f)).map((f) => path.join(folder, f));
  if (!takes.length) continue;
  const ready = takes.map(settled).every(Boolean);
  if (!ready) { say(`${k}: ${takes.length} file(s) in the drop folder, still settling`); continue; }
  // a new session of this brand (today's, or today-2 when today's already has footage), its takes moved in
  const made = DRY ? { stdout: Buffer.from("today's folder is DRY") } : Bun.spawnSync(['bun', 'engine/new.ts', k === 'ophanim' ? 'biz' : k === 'volpinveritas' ? 'vv' : k, '--no-open'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  const name = made.stdout.toString().match(/today's folder is (\S+)/)?.[1];
  if (!name) { say(`${k}: could not make a session: ${made.stdout.toString().slice(0, 200)}`); continue; }
  const raw = path.join(brand(k).root, name, 'raw');
  for (const f of takes) { if (DRY) say(`would move ${path.basename(f)} -> ${raw}`); else renameSync(f, path.join(raw, path.basename(f))); }
  // a script dropped with the takes (.md or .txt): the session's scripts.md, used when the OS has none for it
  const texts = readdirSync(folder).filter((f) => !f.startsWith('.') && /\.(md|txt)$/i.test(f)).map((f) => path.join(folder, f));
  if (texts.length && !DRY) {
    writeFileSync(path.join(brand(k).root, name, 'scripts.md'), texts.map((f) => (/^##\s/m.test(readFileSync(f, 'utf8')) ? '' : `## ${path.basename(f).replace(/\.(md|txt)$/i, '')}\n`) + readFileSync(f, 'utf8').trim()).join('\n\n') + '\n');
    for (const f of texts) renameSync(f, path.join(brand(k).root, name, path.basename(f)));
  }
  say(`${k}: ${takes.length} take(s) from the drop folder -> ${name}`);
  await runSession(k, name);
  did++;
}

// ---- 1b. the YouTube drop folder (Josef's Mac, with the business brand): the long video's takes go to the YouTube
// machine (ophanim-ai/media-exports/youtube), into the newest video the Monday task prepared (an outline.md, no camera
// file in raw/ yet), else a new folder named by the date. Folders named broll or screen keep their role. Its own hourly
// task (it needs Claude to direct the cut) edits it; this only hands the files over and says so.
if (here.includes('ophanim')) {
  const folder = path.join(DROP, 'YouTube');
  const yt = path.join(BASE, 'ophanim-ai', 'media-exports', 'youtube');
  if (!existsSync(folder)) { if (!DRY) mkdirSync(folder, { recursive: true }); }
  else if (existsSync(yt)) {
    const entries = readdirSync(folder).filter((f) => !f.startsWith('.'));
    const files: string[] = [];
    for (const e of entries) {
      const f = path.join(folder, e);
      if (statSync(f).isDirectory()) for (const g of readdirSync(f).filter((g) => !g.startsWith('.'))) files.push(path.join(f, g));
      else if (TAKE.test(e)) files.push(f);
    }
    if (files.length && files.map(settled).every(Boolean)) {
      const camera = (d: string) => existsSync(path.join(d, 'raw')) && readdirSync(path.join(d, 'raw')).some((f) => TAKE.test(f));
      const prepared = readdirSync(yt, { withFileTypes: true }).filter((d) => d.isDirectory() && !['_machine', 'test', 'selftest'].includes(d.name) && !d.name.startsWith('.'))
        .map((d) => path.join(yt, d.name)).filter((d) => existsSync(path.join(d, 'outline.md')) && !camera(d))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const target = prepared[0] ?? path.join(yt, day);
      for (const e of entries) {
        const f = path.join(folder, e), isDir = statSync(f).isDirectory();
        const to = isDir ? path.join(target, 'raw', /screen/i.test(e) ? 'screen' : 'broll') : path.join(target, 'raw');
        if (DRY) { say(`would move ${e} -> ${to}`); continue; }
        mkdirSync(to, { recursive: true });
        if (isDir) { for (const g of readdirSync(f).filter((g) => !g.startsWith('.'))) renameSync(path.join(f, g), path.join(to, g)); Bun.spawnSync(['rmdir', f]); }
        else if (TAKE.test(e)) renameSync(f, path.join(to, e));
      }
      say(`youtube: ${files.length} file(s) from the drop folder -> ${path.relative(yt, target)}`);
      if (!DRY) await tell(brand('ophanim').os.org, 'YouTube footage received', `Your takes are in "${path.basename(target)}". The YouTube machine edits them within the hour: the video, thumbnails, texts and clips.`, `yt-drop:${path.basename(target)}:${files.length}`);
      did++;
    }
  }
}

// ---- 2. sessions waiting with settled takes (made with /media, takes dropped straight into raw/)
for (const k of here) {
  for (const name of sessionsOf(k)) {
    const dir = path.join(brand(k).root, name);
    if (!phase(dir).startsWith('waiting for takes')) continue;
    const raw = path.join(dir, 'raw');
    if (!existsSync(raw)) continue;
    const takes = readdirSync(raw).filter((f) => !f.startsWith('.') && /\.(mov|mp4|m4v)$/i.test(f)).map((f) => path.join(raw, f));
    if (!takes.length || !takes.map(settled).every(Boolean)) continue;
    await runSession(k, name);
    did++;
  }
}

// ---- 3. trials of approved reels (one query per brand: approved posts of this machine with fewer trials than wanted)
for (const k of here) {
  const b = brand(k) as ReturnType<typeof brand> & { trials?: { count: number; verified: boolean } };
  if (!b.trials?.count) continue;
  const want = b.trials.verified ? b.trials.count : 1;
  const byPost = new Map<string, string>();                              // post id -> session
  for (const name of sessionsOf(k)) {
    const work = path.join(b.root, name, 'work');
    if (!existsSync(path.join(work, 'reels.json'))) continue;
    try {
      for (const r of readJson<{ n: number; postId: string | null }[]>(path.join(work, 'reels.json'))) {
        const remembered = path.join(work, `reel-${r.n}`, 'post.json');
        const id = r.postId ?? (existsSync(remembered) ? readJson<{ id: string }>(remembered).id : null);
        if (id) byPost.set(id, name);
      }
    } catch { /* a half-written session */ }
  }
  if (!byPost.size) continue;
  const sql = await osDb();
  try {
    const ids = [...byPost.keys()];
    const rows = await sql`select p.id, p.title, (select count(*)::int from content_posts t where t.org_id = p.org_id and t.options->'instagram'->'trial'->>'of' = p.id::text) as made
      from content_posts p where p.id::text = any(${sql.array(ids, 'text')}) and p.status in ('scheduled', 'posted')
        and coalesce(p.scheduled_at, p.posted_at, p.updated_at) > now() - interval '24 hours'`;   // fresh approvals only: an old post never gets late trials
    const due = new Set(rows.filter((r: { made: number }) => r.made < want).map((r: { id: string }) => byPost.get(r.id)!));
    for (const name of due) {
      say(`${k} ${name}: an approved reel wants its trials`);
      const r = bun(['engine/trials.ts', k, name], path.join(b.root, name, 'watch.log'));
      if (!DRY) await tell(b.os.org, r.ok ? 'Trial reels scheduled' : 'Trials could not be made', r.ok ? `${b.os.workspace} ${name}: the trial versions of your approved reel are scheduled on Instagram.${b.trials.verified ? '' : ' One trial while trials are not yet confirmed off your grid: check it is not on your profile grid, then tell Claude.'}` : `${b.os.workspace} ${name}: ${r.tail}`, `${k}:${name}:trials:${new Date().toISOString().slice(0, 13)}`);
      did++;
    }
  } finally { await sql.end({ timeout: 5 }); }
}

// ---- 4. YouTube clips (the business page)
if (here.includes('ophanim')) {
  const yt = path.join(BASE, 'ophanim-ai', 'media-exports', 'youtube');
  for (const video of existsSync(yt) ? readdirSync(yt) : []) {
    if (['_machine', 'test', 'selftest'].includes(video) || video.startsWith('.')) continue;
    const clips = path.join(yt, video, 'clips');
    if (!existsSync(clips)) continue;
    const newest = Math.max(0, ...readdirSync(clips).filter((f) => / shorts\.mp4$/.test(f)).map((f) => statSync(path.join(clips, f)).mtimeMs));
    if (!newest || Date.now() - newest < SETTLE_S * 1000) continue;
    const st = path.join(brand('ophanim').root, `yt-${video}`, 'state.json');
    if (existsSync(st) && statSync(st).mtimeMs > newest) continue;
    say(`youtube ${video}: new clips`);
    const logTo = path.join(STATE_DIR, `yt-${video}.log`);
    const a = bun(['engine/youtube.ts', video], logTo);
    const p = a.ok ? bun(['engine/publish.ts', 'ophanim', `yt-${video}`], logTo) : a;
    if (!DRY) await tell(brand('ophanim').os.org, p.ok ? 'YouTube clips ready for review' : 'YouTube clips stopped', p.ok ? `The clips of "${video}" are on their posts in Ophanim AI, status Review.` : p.tail, `yt:${video}:${Math.round(newest)}`);
    did++;
  }
}

// ---- 5. once a day: free the files of reels posted more than 3 days ago
const today = new Date().toISOString().slice(0, 10);
const cleanFile = path.join(STATE_DIR, 'cleanup');
if ((existsSync(cleanFile) ? readFileSync(cleanFile, 'utf8') : '') !== today && new Date().getHours() >= 8) {
  for (const k of here) bun(['engine/publish.ts', k, '--cleanup'], LOG);
  if (!DRY) writeFileSync(cleanFile, today);
}

writeFileSync(seenFile, JSON.stringify(nextSeen));
if (did) say(`done: ${did} job(s)`);
process.exit(0);
