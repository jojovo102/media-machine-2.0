# Library

The media every machine edits with: 434 files, 3.2 GB. Nothing in this folder is in git except this file and index.json.

## Folders

- `sfx/`: 122 sound effects (wav, mp3, aiff) from Jason's Master SFX Pack.
- `packs/`: Jason's ULTIMATE Editing Pack, volumes 01 and 02 merged into one set of folders.
  - `motion-backgrounds/`: looping backgrounds (mp4, mov), one subfolder per creator pack.
  - `shapes/`: circles, rectangles, underlines, marks and arrows as animations with alpha (mov).
  - `overlays/`: film grain (HeavyGrain.mov, 16 mm, 35 mm, old film).
  - `memes/`: meme clips (mp4) and one sound.
  - `green-screen/`: chroma key clips (mp4) and two phone pngs.
  - `transitions-film-burn/`: film burn transitions (mp4).
  - `luts/`: `rec709/*.cube` and `CinePacks LUTS.zip`, left zipped and indexed as one file.
  - `emojis/`: emoji images (png, webp, one gif).
  - `dotted-lines/`: animated dotted arrows (mp4).
  - `pngs/`: logos and icons (png).
- `music/`: Josef's own pool, 6 tracks (mp3).

## Where it came from

Moved here on 2026-10-22 from Jason's Master SFX Pack and his ULTIMATE Editing Pack volumes 01 and 02. The two copies of the SFX pack that sat inside the ULTIMATE packs were duplicates and went to the Trash. The music is Josef's pool, copied from the old machine's two music folders and deduped.

## Adding files

Drop the file in the folder that fits and run `bun engine/library.ts`. The script hashes new files, reads them with ffprobe (duration, size, fps, alpha, audio) and measures sounds and music with ffmpeg (LUFS and true peak), then rewrites index.json. A file whose path, size and mtime are unchanged keeps its entry, so a re-run takes seconds; `--force` measures everything again. A file in a folder the script has no kind for is listed at the end of the run and left out of the index.

## index.json

One entry per file: `id` (the first 12 hex of its sha1), `path`, `kind`, a cleaned `name`, `tags`, `source`, `rights`, and what ffprobe and ffmpeg measured. A byte-for-byte copy of another file is kept but marked `duplicateOf` with the first copy's path. Commit index.json together with the change that made it.

## Git

The library itself is never committed (`library/**` in .gitignore): the files live on this Mac and are copied by hand to another. Only index.json and this README are in git.

## Rights

Files from the packs (`rights: pack`) are usable under the terms of Jason's pack. Music marked `rights: own` is Josef's. Anything with `rights: unknown` (a track with a YouTube id or an artist's name in its file name) must not be used on the business page until it is cleared; the script lists them at the end of every run.
