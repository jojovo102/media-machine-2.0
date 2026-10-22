---
name: media
description: The media machine (media-machine repo): Josef's reels for @josefvolpin (Ophanim AI, English) and @volpinveritas (Italian), Luca's for L Ven, the YouTube video and its clips, the trial reels. Use when the user types /media (often with a brand, "/media vv", "/media biz", "/media lven", to start today's video) or mentions the media machine, a recording session, a new video to record, a reel's cut, captions, screens or b-roll on a reel, trial reels, the music or sound library, or notes on a reel. Works from any folder.
---

# The media machine

Repo: `{base}/media-machine` (README.md is the runbook; CLAUDE.md the rules). The engine is `engine/` (Bun), the brands
`brands/<key>/` (brand.json, TASTE.md, look.json), the look after the cut `presets/<name>/run.ts`, which drives Jason's
editor at `{base}/video-editor` (never edited, never set up from here). The library is `library/`.

## Starting today's video ("/media vv", "/media biz", "/media lven", "nuovo video", "I'm recording today")

1. The brand from the words: VolpinVeritas (vv, veritas, the Catholic page, Italian), Ophanim (biz, business,
   @josefvolpin, English) or L Ven (lven, luca, Luca's page, Italian). Ask only if nothing says which.
2. From `{base}/media-machine/engine`: `bun new.ts <vv|biz|lven>`. It makes today's session (`<root>/<date>/raw/`, or
   `<date>-2` if today's already has footage), opens it in Finder, lists the scripts waiting in the brand's OS workspace.
3. Tell him in a few lines: the folder is open in Finder; which script(s) to record (if none, write one in the OS
   first or give it for `<date>/scripts.md`); record as always (one long take or several, a sentence repeated until
   right, nothing to say when he trips, his own words are fine); drop the takes in; say "done" when the copy finished.
4. When he says it's in: check the files (sizes stable), then `bun run.ts <brand> <session> --to check`. Read every
   `cut-<n>.md` and the check's output (a failed check stops the run). Then, for a brand with a preset (Ophanim:
   talking-head), the look: write the job's `graphics-plan.json` and the STORYBOARD of `hf-graphics/gfx/build.py` from
   Jason's docs (`video-editor/presets/instagram/talking-head-explainer/README.md`, layout.md, graphics.md,
   captures.md), real screens from the OS's Atlas Consulting demo workspace into `<session>/captures/<id>.png`, and
   `bun presets/talking-head/run.ts <brand> <session>` (measure, plan, init, stage, build, render, captions, place,
   qa, assemble, sfx, flash). Then `bun engine/finish.ts <brand> <session>` (music), `bun engine/publish.ts` (the OS,
   status review), a phone copy under 30 MB sent with SendUserFile, and what is in it: length, which sentences are in
   his own words, anything missing. Look at a contact sheet before sending.
5. After he approves the reel in the OS (scheduled, or Publish now), its trials: `bun engine/trials.ts <brand> <session>`
   (only approved reels; one trial until `trials.verified`).

## Anything else

Read README.md and the brand's brand.json and TASTE.md first. Show where every session stands (state.json, the last
lines of PROGRESS.md, raw/, the jobs' RUN.md). Then do what he asks: the whole chain `bun engine/run.ts <brand>
<session>`, or one step (scripts, prepare, match, cut, check, graphics, finish, capcut, publish, trials).

## Rules that always hold
- The brands never mix; VolpinVeritas files never go into an Ophanim folder or the OS folder; a reel goes only into
  its brand's OS workspace. Never change or delete anything in `raw/`. Never schedule or post: the reel lands in
  status review and Josef moves it on; the one exception is the trials of a reel he approved.
- No colour grade, no voice cleaning, no effect he did not ask for. No drawn card templates: real screens, real
  pictures, footage. A new look is shown to him on one reel before it goes into a preset; his look evolves.
- Ophanim words: no prices, nothing internal, never the previous offer, never who builds the OS; no em dashes.
  VolpinVeritas scripts are the priest's: never change their wording. OS screens come from the Atlas Consulting demo
  workspace, never the real one.
- His notes on a reel become rows in `brands/<key>/TASTE.md` the same session. Commit only the files you changed.
