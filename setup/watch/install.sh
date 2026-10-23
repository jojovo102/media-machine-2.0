#!/bin/bash
# Installs the watcher (engine/watch.ts) as a macOS LaunchAgent: every 5 minutes while this user is logged in, at no
# cost when there is nothing to do. Josef said yes to it on 2026-10-23. Re-running replaces it; `uninstall` removes it.
#   bash setup/watch/install.sh [uninstall]
set -e
LABEL=com.ophanim.media-watch
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "$1" = "uninstall" ]; then rm -f "$PLIST"; echo "watcher removed"; exit 0; fi
BUN="$(command -v bun || echo /opt/homebrew/bin/bun)"
mkdir -p "$HOME/Library/LaunchAgents" "$REPO/.watch"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$BUN</string><string>$REPO/engine/watch.ts</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>StandardOutPath</key><string>$REPO/.watch/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$REPO/.watch/launchd.err.log</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PL
mkdir -p "$HOME/Desktop/Drop"
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "watcher installed: $PLIST (every 5 minutes), drop folders in $HOME/Desktop/Drop"
