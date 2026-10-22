# Media machine: rules for every session here

Read `README.md` first (the runbook), then the brand's `brands/<key>/brand.json` and `TASTE.md` for anything about a
brand's reels. Jason's editor lives beside this repo in `video-editor/`: read its docs for the look (its
`presets/instagram/talking-head-explainer/*.md`, `CLAUDE.md` § Rules), run its tools through `presets/<name>/run.ts`,
and never edit, update or set up that folder from here (its own settings would install software without asking).

- The brands never mix. VolpinVeritas files never go into an Ophanim folder or the OS folder; a reel goes only into
  its own brand's OS workspace (publish.ts refuses the other).
- Never change or delete anything in a session's `raw/`. Never schedule or post a reel: it lands on its post in
  status review and Josef moves it on. The one exception: the trials of a reel he has approved (trials.ts).
- No colour grade, no voice cleaning, no effect he did not ask for. His voice as recorded, only made louder.
- No drawn card templates (chat, checklist, balance, logo cards) on any brand: he called them AI slop (2026-10-22).
  Graphics are real screens, real pictures, footage; a new motion look is shown to him on one reel before it goes
  into a preset.
- Captions and graphics on a brand only through its preset; a look is tried on one reel (`<session>/style.json`),
  then becomes the brand's when he says so. His look is his to change: nothing here is fixed forever.
- Ophanim words: no prices, nothing internal (revenue, clients, team, pipeline), never the previous offer, never who
  builds the OS, no em dashes anywhere you write. VolpinVeritas scripts are checked by the priest: never change
  their wording.
- Music and sound only from `library/` (never a track whose rights are unknown). Pictures from the web need his OK.
- Packages: none added without the checks in `~/.claude/CLAUDE.md`; this Mac's one-day release-age guard stays on.
- Commit only the files you changed (never `git add -A`), with why; no media in git.
- Josef's notes on a reel become rows in the brand's TASTE.md feedback table, the same session.
