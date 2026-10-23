# The media machine

One machine for every video Josef and Luca post: the reels of three Instagram pages, the YouTube channel, the clips cut
from it, and the trial versions of all of them. Built 2026-10-22 from two things that each did half the job: Josef's
own cut engine (it cuts a take the way he cuts, in Italian and English, to a script) and Jason's video editor (the
look after the cut: layouts, real screens, captions, sound, the quality gates). The editor sits beside this repo in
its own folder, unchanged, so Jason's updates still merge; this repo tells it what to do.

```
Claude Code/
  media-machine/        this repo (github.com/jojovo102/media-machine-2.0, private; clone it as "media-machine")
    README.md           this file: the one runbook
    CLAUDE.md           the rules that always hold, for any session in this folder
    engine/             the cut engine and the pipeline (Bun + TypeScript, no packages)
    brands/<key>/       one folder per brand: brand.json (the OS workspace, language, speed, music, trials), TASTE.md
                        (every note Josef gave, as rules), look.json (the brand kit the preset applies), .music-pool.json
    presets/<name>/     the look after the cut, brand-neutral: run.ts drives the editor's tools on a job
    library/            sound effects, editing packs, music (never in git; index.json is): library/README.md
    jobs/<brand>/       recording sessions of the brands that live here (Ophanim, L Ven); VolpinVeritas' live in
                        volpinveritas-website/contenuti/reels (its files never sit in an Ophanim folder)
    setup/              install on another Mac, the scheduled task, the /media skill
  video-editor/         Jason's editor (bought 2026-10-22): presets, workflows, the render kit; never edited here
  OPHANIM AI OS/        the OS: scripts come from it, finished reels go back into it (review), trials are posted by it
```

## The accounts and the cadence

| Where | What | How often | Trials |
|---|---|---|---|
| @josefvolpin (Ophanim AI, English) | talking-head reels he records, alternating weekly with the clips of the YouTube video | 3 to 5 a week | 3 per approved reel |
| @volpinveritas (Italian) | talking-head reels he records, scripts checked by the priest | 3 to 5 a week | 3 per approved reel |
| @app.ophanimai (company) | one animated video made by Claude | 1 a week (last priority) | none |
| YouTube (Ophanim AI) | one long video, then 5 clips for @josefvolpin | 1 every 2 weeks | 3 per clip |

Trials are posted by the OS every 3 hours from 09:00 to 22:00 (5 slots a day). 3 per reel leaves room for two
reels' trials on one day; 5 would book the whole day for one reel. Until a brand's `trials.verified` is set (after
Josef has seen the first trial stay off his profile grid), one trial only.

## How it runs by itself (2026-10-23)

Josef records and approves; everything between is the machine's. A macOS LaunchAgent runs `engine/watch.ts` every
5 minutes (installed by `bash setup/watch/install.sh`, removed with `... uninstall`); it starts no AI and costs
nothing when there is nothing to do.

- **Drop folders:** `~/Desktop/Drop/Business` (Ophanim), `~/Desktop/Drop/VolpinVeritas`, `~/Desktop/Drop/L Ven` (on
  Luca's Mac), `~/Desktop/Drop/YouTube` (the long video: handed to the YouTube machine, into the video the Monday task
  prepared, else a folder named by the date; subfolders `broll` and `screen` keep their role). Takes that have not changed for 10 minutes become a new session of that brand, moved in, and the whole
  chain runs (scripts → … → the reel on its OS post in Review). A script dropped with them (`.md` or `.txt`) is used
  when the OS has none for that video.
- **Approvals:** a reel he schedules or posts in the OS (scheduled for later, or approved within the last 24 hours)
  gets its trials within 5 minutes.
- **YouTube:** rendered clips of the YouTube machine become business reels in Review.
- **Telling him:** the OS bell and a push to his phone (`POST /api/webhooks/machine`, signed with a key derived from
  the OS's SECRETS_KEY), plus a Mac notice. A step that fails says where; Claude picks it up when asked.
- The Mac must be awake: asleep, nothing runs and the work waits; while a job runs, the watcher keeps it awake.
  `/media <brand>` still works (a session folder to drop into by hand): the watcher picks those up too.
- Logs: `.watch/watch.log`, and `watch.log` inside each session.

## A reel's life

1. **Record.** `/media vv`, `/media biz` or `/media lven` makes today's session folder (`<root>/<date>/raw/`) and
   lists the scripts waiting in the brand's OS workspace. He records, drops the takes in, says done.
2. **Scripts** (`engine/scripts.ts`): the scripts from the OS (or `<session>/scripts.md`), cut into the clauses he
   will say. Names in them prime the transcription.
3. **Prepare** (`prepare.ts`): every take in normal colour (an iPhone HDR take converted once, Apple's conversion,
   never a grade), its sound lined up, every word transcribed (whisper large-v3-turbo, the brand's language), the
   stretches of full voice where his cuts fall.
4. **Match** (`match.ts`): the last complete try of every clause, his own words allowed, cut only in his pauses; a
   report per reel (`cut-<n>.md`); `choices.txt` to pick another try. Benchmarked against his own CapCut cuts
   (`bench.ts`: Lepanto 88 % kept by both, 89 % of his found).
5. **Cut** (`cut.ts`): the base cut of each reel as a job in the editor's layout, `<session>/<slug>/`: his voice as
   recorded, one gain to -15 LUFS, no music yet. Hard cuts at his voice, no air.
6. **Check** (`check.ts`): the reel re-transcribed and lined up against the script: a phrase said twice, a stutter, a
   false start or a cut inside the voice fails the run. Nothing half-right goes further.
7. **Graphics** (`presets/<name>/run.ts`): the brand's preset dresses the job with the editor's tools: the face
   measured, the layout rotation, real screens filling the top half, captions, sound effects, the quality gates
   (flash scan, graphics QA, caption gate). On the business page the plan is the machine's own (`plan.ts`: which line
   goes on which screen, which on his face, the ask), judged by the editor's plan gates like a hand plan; a plan
   written by hand for a reel is kept. A brand without a preset skips this: the base cut goes on.
8. **Finish** (`finish.ts`): the brand's music from the library under the finished picture, levelled to -14.5 LUFS,
   as `outputs/<slug>.final.mp4`.
9. **CapCut** (`capcut.ts`): a CapCut project from his own template, for hand edits (never touches a project the
   machine did not write).
10. **Publish** (`publish.ts`): the final onto its post in the brand's OS workspace, status review. Never scheduled,
    never posted: Josef moves it on.
11. **Trials** (`trials.ts`, the hourly task): once he has approved a reel, its trial versions (zoom, speed, trim,
    fresh metadata) are scheduled in the OS across the day, Instagram only, MANUAL graduation. The one thing the
    machine schedules.

**YouTube clips** take a shorter road: the long video is made by the YouTube machine
(`ophanim-ai/media-exports/youtube/_machine`, its own hourly task), and `bun engine/youtube.ts <video>` brings its
rendered clips over as a business session `yt-<video>` (one reel per clip), which `publish.ts` and `trials.ts` then
handle like any recording. The hourly task does it as soon as the clips exist.

Whole chain: `bun engine/run.ts <brand> <session> [--from <step>] [--to <step>] [--no-capcut] [--no-publish]`.
Each step runs alone too: `bun engine/<step>.ts <brand> <session>`.

## The two brands, side by side

| | Ophanim AI (@josefvolpin) | VolpinVeritas |
|---|---|---|
| Language, scripts | English; scripts written by the Monday task in the Ophanim AI workspace | Italian; scripts checked by the priest, wording never changed |
| Cut | the same engine; speed 1.0 | the same engine; speed 1.05 |
| Voice, colour | as recorded, one gain; no grade | the same |
| Look after the cut | none for now (Josef 2026-10-23): the clean cut with music; the look is set with him on his next recording. The editor's talking-head preset and the machine's screen planner (`presets/talking-head`) stay in the repo, switched off | preset `vv-captions`: captions in its own type (EB Garamond cream, the word said in red), his own pictures (`broll.json`) under his face; his to evolve |
| Sound | sound effects on visible events only, from the library | to be decided on its first reel |
| Music | the shared pool, -41 LUFS | the shared pool, -39 LUFS |
| Publishing | Ophanim AI workspace: Instagram, YouTube, LinkedIn | VolpinVeritas workspace: Instagram, TikTok, YouTube |

## The library

`library/sfx` (the Master SFX Pack), `library/packs/<category>` (Jason's editing packs: motion backgrounds, shapes,
overlays, transitions, LUTs, emojis, memes, green screen, PNGs), `library/music` (the shared pool). `bun
engine/library.ts` indexes it (`library/index.json`: kind, duration, loudness, tags, rights). A track whose rights are
unknown is never picked by the machine. Details and provenance: `library/README.md`. `library/os-screens`: the real OS screens the business reels show (the Atlas Consulting demo workspace at phone width), with `index.json` (the words that call each screen, where to frame it, what to keep out of view).

## Taste

Every note Josef gives on a reel becomes a row in that brand's `brands/<key>/TASTE.md` and, where it is a number, a
value in `brand.json` or the preset. Standing rules, from the first reels and Jason's house rules: graphics never sit
on the person; real screens before drawn ones, filling the top half edge to edge with no border, shadow or glow; no
card that repeats the caption; big type rare; sound only on something visible; nothing pops in with a gold border.

## Tools this Mac needs

ffmpeg, whisper-cli (whisper.cpp) with the large-v3-turbo model, Bun, uv (Jason's Python tools), Node and npx (the
render engine `hyperframes@0.8.105`, pinned; it resolves its packages under this Mac's one-day release-age guard, so
Jason's date freeze is not used), Google Chrome, CapCut (optional), the OS repo with its `.env.local` (from Josef,
never through git). `setup/install.sh` checks and installs what is missing.

## The old machines

`ophanim-ai/media-exports/reel-machine` and `youtube/_machine` stay where they are, untouched, until this machine
has replaced each of their jobs; the hourly task is switched over step by step. Nothing is deleted.
