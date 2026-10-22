#!/usr/bin/env bun
// Step 0: the scripts of a batch (2026-10-19), from the brand's own workspace in the OS (VolpinVeritas posts for
// VolpinVeritas, Ophanim AI posts for Ophanim; never the other's), where Josef writes them and the priest checks the
// VolpinVeritas ones. A post counts when it is a short with a script and is not out yet (idea, scripting, review),
// written in the last three weeks. A script can also be given in <batch>/scripts.md ("## Title" then the text).
//
// A script is cut into the sentences he will say. Not said: section headings (a line in capitals: "HOOK",
// "LA TUA BATTAGLIA") and directions in square brackets ("[B-roll: ...]", "[Testo a schermo: ...]"), which are kept
// apart as notes on the sentence before them. Writes work/scripts.json; its names prime the transcription.
//   bun scripts.ts <brand> <batch> [--posts <id,id>] [--match <words in the title>] [--days 21]
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { arg, batch, ensure, has, log, osDb, tokens, writeJson } from './lib';

const x = batch(process.argv[2] ?? '', process.argv[3] ?? '');
ensure(x.work);

export interface Script { postId: string | null; title: string; caption: string; sentences: { i: number; text: string; notes: string[] }[]; directions: string[] }

function parse(postId: string | null, title: string, caption: string, body: string): Script {
  const sentences: Script['sentences'] = [], directions: string[] = [];
  let pending: string[] = [];
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    // directions in square brackets: notes on the sentence just said
    line = line.replace(/\[([^\]]*)\]/g, (_, d: string) => { (sentences.length ? sentences[sentences.length - 1]!.notes : pending).push(d.trim()); directions.push(d.trim()); return ' '; }).trim();
    if (!line) continue;
    const letters = line.replace(/[^\p{L}]/gu, '');
    if (letters.length >= 3 && letters === letters.toUpperCase() && tokens(line).length <= 6) continue; // a section heading
    // sentences, then clauses: he redoes a clause, not the whole sentence (7 October: the second half of sentence 15
    // four times, and kept the last), so each clause gets its own best take. Split at colons and semicolons, and at a
    // comma between two parts of six words or more.
    for (const s of line.split(/(?<=[.?!…])\s+(?=\S)/)) {
      const clauses: string[] = [];
      for (const part of s.split(/(?<=[:;])\s+/)) {
        const bits = part.split(/(?<=,)\s+/);
        let cur = '';
        bits.forEach((b, k) => {
          const rest = bits.slice(k).join(' ');
          if (cur && tokens(cur).length >= 6 && tokens(rest).length >= 6) { clauses.push(cur); cur = b; }
          else cur = cur ? `${cur} ${b}` : b;
        });
        if (cur) clauses.push(cur);
      }
      for (const c of clauses) {
        const text = c.trim().replace(/^[-–•]\s*/, '');
        if (tokens(text).length < 2) continue;
        sentences.push({ i: sentences.length, text, notes: pending });
        pending = [];
      }
    }
  }
  return { postId, title, caption, sentences, directions };
}

const scripts: Script[] = [];
const sql = await osDb();
try {
  const ids = (arg('posts', '') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const match = arg('match', '');
  const days = Number(arg('days', '21'));
  const rows = ids.length
    ? await sql`select id, title, caption, script from content_posts where org_id = ${x.brand.os.org} and id in ${sql(ids)}`
    : match
      ? await sql`select id, title, caption, script from content_posts where org_id = ${x.brand.os.org} and title ilike ${'%' + match + '%'} and coalesce(script, '') <> '' order by created_at desc limit 1`
      : await sql`select id, title, caption, script from content_posts where org_id = ${x.brand.os.org} and kind = 'short' and status in ('idea', 'scripting', 'review')
          and coalesce(script, '') <> '' and created_at > now() - make_interval(days => ${days}) order by created_at`;
  for (const r of rows) scripts.push(parse(r.id, r.title ?? '', r.caption ?? '', r.script ?? ''));
} finally {
  await sql.end({ timeout: 5 });
}
// scripts kept in the batch folder (## Title, then the text)
if (has(x.p('scripts.md'))) {
  const parts = readFileSync(x.p('scripts.md'), 'utf8').split(/^##\s+/m).slice(1);
  // a script already in the OS is not counted twice (same title, or the same opening words)
  const key = (sc: Script) => tokens(sc.sentences.slice(0, 2).map((t) => t.text).join(' ')).slice(0, 8).join(' ');
  const seen = new Set(scripts.flatMap((sc) => [tokens(sc.title).join(' '), key(sc)]));
  for (const part of parts) {
    const [title, ...rest] = part.split('\n');
    const sc = parse(null, title!.trim(), '', rest.join('\n'));
    if (seen.has(tokens(sc.title).join(' ')) || seen.has(key(sc))) { console.log(`scripts.md: "${sc.title}" is already in the OS, skipped`); continue; }
    scripts.push(sc);
  }
}
if (!scripts.length) console.warn('no scripts: the cut will keep the last take of every sentence and cut fillers only');

// names worth priming the transcription with: words written with a capital inside a sentence, numbers
const names = new Set<string>();
for (const s of scripts) for (const sen of s.sentences) {
  sen.text.split(/\s+/).slice(1).forEach((w) => { const c = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''); if (/^\p{Lu}/u.test(c) && c.length >= 3) names.add(c); });
}
writeJson(path.join(x.work, 'scripts.json'), { scripts, names: [...names].slice(0, 40) });
log(x, `scripts: ${scripts.map((s) => `"${s.title}" (${s.sentences.length} sentences)`).join(', ') || 'none'}`);
for (const s of scripts) console.log(`${s.title}: ${s.sentences.length} sentences, ${s.directions.length} directions`);
