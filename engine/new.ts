#!/usr/bin/env bun
// Start a day's video (2026-10-21). Josef: "if I create a new chat, what do I say if I want this system to activate and
// create me the folder for that day's video". He types `/reels <brand>`; the skill runs this:
//   - makes today's batch folder (<root>/<date>/raw/, the date on his clock in Rome); if today's already has footage,
//     the next one (<date>-2, -3...), so a second session the same day never mixes with the first
//   - opens raw/ in Finder for him to drop the takes in (and the mic file, if the mic recorded on its own)
//   - lists the scripts waiting in the brand's OS workspace (shorts with a script, not out yet, written in the last
//     three weeks: the ones scripts.ts will match the takes against)
//   bun new.ts <brand: vv | oph | biz | lven> [--no-open]
import path from 'node:path';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { brand, flag, osDb } from './lib';

const ALIAS: Record<string, string> = { lven: 'lven', luca: 'lven', 'l-ven': 'lven', vv: 'volpinveritas', veritas: 'volpinveritas', volpinveritas: 'volpinveritas', oph: 'ophanim', ophanim: 'ophanim', biz: 'ophanim', business: 'ophanim', josefvolpin: 'ophanim' };
const key = ALIAS[(process.argv[2] ?? '').toLowerCase()];
if (!key) { console.log('Which brand? bun new.ts vv (VolpinVeritas), oph (Ophanim, the business page) or lven (Luca)'); process.exit(1); }
const b = brand(key);

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const hasTakes = (d: string) => existsSync(path.join(d, 'raw')) && readdirSync(path.join(d, 'raw')).some((f) => /\.(mov|mp4|m4v)$/i.test(f));
let name = today, k = 1;
while (hasTakes(path.join(b.root, name))) name = `${today}-${++k}`;
const raw = path.join(b.root, name, 'raw');
mkdirSync(raw, { recursive: true });
console.log(`${b.name}: today's folder is ${name}`);
console.log(`  drop the takes here: ${raw}`);
if (!flag('no-open')) Bun.spawnSync(['open', raw]);

const sql = await osDb();
try {
  const rows = await sql`select title, status, left(regexp_replace(coalesce(script, ''), '[[:space:]]+', ' ', 'g'), 110) as opening, length(script) as len
    from content_posts where org_id = ${b.os.org} and kind = 'short' and coalesce(script, '') <> '' and status in ('idea', 'scripting', 'review')
      and created_at > now() - interval '21 days' order by created_at`;
  if (!rows.length) console.log(`  no script waiting in the ${b.os.workspace} workspace: write one there first, or put it in ${name}/scripts.md`);
  else {
    console.log(`  scripts waiting in the ${b.os.workspace} workspace (${rows.length}):`);
    // about 18 characters a second as he speaks, rounded to 5 s
    for (const r of rows) console.log(`   - ${r.title} [${r.status}, about ${Math.max(5, Math.round(Number(r.len) / 18 / 5) * 5)} s]: ${r.opening}...`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
