#!/bin/bash
# Sets up the media machine on a Mac (2026-10-22; safe to run again, it only adds what is missing). Run from anywhere:
#   bash "<this folder>/install.sh"
# The folder that holds the repos side by side is the parent of media-machine: video-editor (Jason's editor, from his
# zip, never through git; only the business look needs it), OPHANIM AI OS (Josef's Mac only; another Mac gets just the
# keys the machine uses, media-machine/.env from setup/make-env.sh), volpinveritas-website (Josef's Mac only).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
BASE="$(cd "$ROOT/.." && pwd)"
ok() { printf '  ok   %s\n' "$1"; }
todo() { printf '  TODO %s\n' "$1"; TODOS=$((TODOS + 1)); }
TODOS=0
echo "The folder that holds the repos: $BASE"
[ "$(uname)" = "Darwin" ] || { echo "This needs a Mac (Apple's colour conversion, CapCut)."; exit 1; }

echo "1. Tools"
command -v brew >/dev/null || { echo "  Install Homebrew first (https://brew.sh), then run this again."; exit 1; }
for pair in ffmpeg:ffmpeg whisper-cli:whisper-cpp pnpm:pnpm uv:uv node:node; do
  cmd="${pair%%:*}"; formula="${pair##*:}"
  if command -v "$cmd" >/dev/null; then ok "$cmd"; else brew install "$formula"; ok "$cmd (installed)"; fi
done
if command -v bun >/dev/null; then ok "bun"; else brew install oven-sh/bun/bun; ok "bun (installed)"; fi
[ -x /usr/bin/avconvert ] && ok "avconvert (Apple, for iPhone colour)" || todo "avconvert is missing: update macOS"
[ -d "/Applications/Google Chrome.app" ] && ok "Google Chrome (the render engine draws in it)" || todo "install Google Chrome"
[ -d "/Applications/CapCut.app" ] && ok "CapCut" || echo "  note CapCut is not installed: reels are made without CapCut projects"

echo "2. The transcription model"
MODEL="$HOME/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin"
if [ -f "$MODEL" ]; then ok "whisper large-v3-turbo"; else
  mkdir -p "$(dirname "$MODEL")"
  curl -L --fail -o "$MODEL.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin" && mv "$MODEL.part" "$MODEL"
  ok "whisper large-v3-turbo (downloaded, about 550 MB)"
fi

echo "3. Jason's editor (the look after the cut)"
# only a brand with a preset needs it (the business page); L Ven and a clean cut do not
if [ -f "$BASE/video-editor/presets/instagram/talking-head-explainer/kit/engine.py" ]; then ok "video-editor beside this repo"; else echo "  note no video-editor beside this repo: fine for L Ven (no preset); the business look needs it (Jason's zip from Josef, never its setup.sh)"; fi

echo "4. The render engine (hyperframes 0.8.105, pinned; packages under this Mac's release-age guard)"
if [ ! -d "$BASE/video-editor" ]; then echo "  note skipped: only the editor's looks use it"; elif npx -y hyperframes@0.8.105 doctor --json 2>/dev/null | grep -q '"ok"'; then ok "hyperframes 0.8.105 answers"; else todo "npx -y hyperframes@0.8.105 doctor failed: run it by hand and read what it says"; fi

echo "5. The OS keys (the machine reads and writes the OS: scripts in, reels and trials out)"
OS="$BASE/OPHANIM AI OS"
if [ -f "$ROOT/.env" ]; then ok "the machine's own keys (media-machine/.env, from Josef's setup/make-env.sh)"
elif [ -f "$OS/.env.local" ]; then ok "the OS keys (the OS repo's .env.local, Josef's Mac)"
else todo "put the keys file from Josef at \"$ROOT/.env\" (he makes it with setup/make-env.sh and AirDrops it; never through git or chat)"; fi

echo "6. The motion engine's packages (Chrome driver for the VolpinVeritas captions)"
APP="$BASE/ophanim-ai/media-exports/vsl/motion/app"
if [ -d "$APP/node_modules/playwright-core" ]; then ok "motion engine packages"; elif [ -d "$APP" ]; then (cd "$APP" && bun install --frozen-lockfile) && ok "motion engine packages (installed)"; else echo "  note no motion engine on this Mac ($APP): VolpinVeritas captions need it, nothing else does"; fi

echo "7. The /media command"
mkdir -p "$HOME/.claude/skills/media"
sed "s#{base}#$BASE#g" "$HERE/skills/media/SKILL.md" > "$HOME/.claude/skills/media/SKILL.md"
ok "/media installed in ~/.claude/skills/media"

echo "8. The library"
[ -f "$ROOT/library/index.json" ] && ok "library index" || echo "  note copy library/ (sfx, packs, music) from Josef's Mac, then: bun engine/library.ts"
[ -d "$ROOT/library/music" ] && ok "music" || todo "copy library/music from Josef's Mac (AirDrop; L Ven needs only the music, not sfx or packs)"

echo
if [ "$TODOS" -gt 0 ]; then echo "$TODOS thing(s) to do above, then run this again."; else
  echo "Ready."
  echo "Then the drop folders, no AI needed: bash \"$HERE/watch/install.sh\" (takes dropped in ~/Desktop/Drop/L Ven are cut by themselves)"
fi
