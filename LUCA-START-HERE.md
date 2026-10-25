# Luca: start here

This sets up the media machine on your Mac for **L Ven**, once. When it is done, this file is deleted (step 7).
Afterwards you record, drop your takes in a folder, and the reel appears in the OS (workspace L Ven, Content,
status review) ready for you to approve. No AI runs for that: the machine does it by itself every 5 minutes.

## Before you start (you, 5 minutes)

- A Mac with macOS up to date, **Google Chrome** installed, and **Homebrew** (https://brew.sh: paste its one line in
  Terminal if `brew` is not there).
- From Josef:
  - `media-machine-keys.dmg`: an encrypted disk image holding `media-machine.env`, the keys the machine uses to read
    your scripts and put your reels in the OS. Josef tells you its password **by phone**, never in the chat that
    carried the file. Double-click it, type the password, copy `media-machine.env` out of it, then eject it and
    delete the .dmg. Treat that file like a password: never send it on, never put it in a shared folder.
  - `media-machine-music.zip`: the music it can use.
- An empty folder, for example `Documents/Claude Code`, with `media-machine.env` and `media-machine-music.zip` in it.
- Open **Claude Code** in that folder and paste this one line:

```
Clone https://github.com/jojovo102/media-machine-2.0.git as "media-machine" in this folder, then read media-machine/LUCA-START-HERE.md and do the steps for Claude, one at a time, telling me what each one did.
```

## For Claude: the steps

Work from the folder that holds `media-machine` (call it BASE). Check each step's result before the next one; if
one fails, fix it and say what was wrong. Never print the contents of the `.env` file. Never run `git push` (this
Mac only pulls) and never `git add -A`. Follow `media-machine/CLAUDE.md` and `media-machine/README.md`.

1. **Files in place.** Move `BASE/media-machine.env` to `BASE/media-machine/.env` (keep its permissions private:
   `chmod 600`). Unzip `BASE/media-machine-music.zip` into `BASE/media-machine/library/music/` (the mp3 files at
   the top of that folder, no subfolder). Create `BASE/media-machine/jobs/lven/` (this folder existing is what tells
   the machine this Mac runs L Ven).
2. **Install.** `bash media-machine/setup/install.sh`. It installs ffmpeg, whisper, Bun and the rest with Homebrew
   and downloads the transcription model once (about 550 MB). Fix every TODO it lists and run it again until it
   ends with `Ready.` The notes about Jason's editor, the render engine and the motion engine are expected: L Ven
   does not use them.
3. **Connection check.** From `media-machine`: `bun engine/new.ts lven --no-open`. It must list the scripts waiting
   in the L Ven workspace (if it says none, that is fine too, as long as there is no error). It also makes today's
   session folder in `jobs/lven/`: delete that folder afterwards if it stays empty.
4. **Test reel, nothing uploaded.** Ask Luca to record one short script that is in the OS (20 to 40 seconds is
   enough) and put the take in `~/Desktop/Drop/L Ven` (create the folder if it is not there). A take counts as
   finished once it has not changed for 10 minutes and the watcher has seen it twice, so: wait until the file is 10
   minutes old, then from `media-machine` run `MEDIA_WATCH_TEST=1 bun engine/watch.ts` twice, a minute apart. The
   second run cuts it: the take moves into a session in `jobs/lven/<date>/raw/`, and the reel comes out in that
   session's folder. Read the session's `watch.log` and `cut-1.md`. Show Luca the reel. A test notice ("Test: the
   watcher cut L Ven ...") should appear in the OS bell. If the cut stopped, read the log, fix the cause and run
   the session again with `bun engine/run.ts lven <session> --no-capcut --no-publish`.
5. **Switch it on.** `bash media-machine/setup/watch/install.sh`. From now on the Mac checks the drop folder every 5
   minutes by itself, as long as it is awake. Check it is loaded: `launchctl list | grep com.ophanim.media-watch`.
6. **Clean up.** Delete `BASE/media-machine.env` and `BASE/media-machine-music.zip` if they are still in BASE.
   Then tell Luca, in a few lines, how a normal day works (the section below).
7. **Delete this guide.** `rm media-machine/LUCA-START-HERE.md`, and tell Luca to let Josef know it is done (Josef's
   Claude removes it from the repo too, and the next `git pull` here stays clean).

## A normal day (you)

- Write the script in the OS: workspace **L Ven**, Content, a short with status idea, scripting or review.
- Record it. Drop the takes in **`Desktop/Drop/L Ven`**.
- About 10 to 20 minutes later the reel is on its post in the L Ven workspace, status **review**, with a notice in
  the OS. Watch it and approve it (schedule or post).
- Once approved, a trial version is made by itself within 5 minutes (one only, until you have checked that a trial
  stays off your profile grid; then Josef switches on three).
- If something stops, the notice says where: open Claude Code in `media-machine` and say "a cut stopped, fix it".
- Updates from Josef: `git pull` in `media-machine`.

The full page stays in the repo: `media-machine/setup/NEW-MAC.md`.
