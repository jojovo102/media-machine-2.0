# The machine on another Mac (Luca's, L Ven)

Written 2026-10-25. One Mac runs one brand: L Ven runs on Luca's Mac only, the business and VolpinVeritas on Josef's.
Nothing here needs a GitHub account (the repo is public) or the OS code.

## What Josef hands over (never through git)

1. **The keys:** on Josef's Mac, `bash setup/make-env.sh "<folder>/media-machine.env"` writes only what the machine
   uses: the OS database, the storage, and the notice signing key derived from the OS's master key (never the master
   key, never Stripe, email or AI keys). Josef sends it as a plain file (2026-10-25: his choice, encryption gave
   errors); delete it from the chat or transfer afterwards.
2. **The music:** `~/Desktop/media-machine-music.zip`, the tracks of the pool whose rights are cleared (two on
   2026-10-25: Classical Cello Experience and the VSL music). Tracks marked unknown rights (YouTube rips) are never
   used by the machine and are not sent; Jason's music library is not in the pool and is not needed.

L Ven's own music: put tracks Luca has the rights to in `media-machine/library/music` (the top of the folder) and run
`bun engine/library.ts`; mark them `"rights": "own"` in `library/index.json` if the script lists them as unknown.

## What Luca does

The first time: `LUCA-START-HERE.md` at the top of the repo (a one-off guide for him and his Claude, deleted once his
Mac runs). He puts both files in an empty folder, opens Claude Code there (Josef's Claude account) and pastes:

```
Clone https://github.com/jojovo102/media-machine-2.0.git as "media-machine" in this folder, then read media-machine/LUCA-START-HERE.md and do the steps for Claude, one at a time, telling me what each one did.
```

The installer asks for Homebrew if it is missing (https://brew.sh) and downloads the transcription model once
(about 550 MB). The guide ends with a test reel that is not uploaded, before the watcher is switched on.

## Every day

- Write the script in the OS, workspace **L Ven**, Content (a short, status idea, scripting or review).
- Record. Drop the takes in **`~/Desktop/Drop/L Ven`** (several takes at once is fine; a `.md` or `.txt` script dropped
  with them is used when the OS has none).
- About 10 minutes after the files stop copying, the machine cuts them to the script, checks the cut, adds music and
  puts the reel on its post in the L Ven workspace, status **review**. A notice comes to the OS bell and the phone.
- Approve it (schedule or post it in the OS): the trial versions are made within 5 minutes. Until L Ven's
  `trials.verified` is set (brands/lven/brand.json), one trial only: check it stays off the profile grid first.
- The Mac must be awake. Asleep, nothing runs and the takes wait.

## When something stops

The notice says which step. Open Claude Code in `media-machine` and say "a cut stopped, fix it". Updates: `git pull`
in `media-machine` (this Mac cannot push: a fix made here stays here until Josef's Mac brings it into the repo).

## Remove it

`bash setup/watch/install.sh uninstall` stops the watcher; delete the folder.
