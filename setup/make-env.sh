#!/bin/bash
# The keys for a Mac that runs the machine without the OS repo (Luca's, 2026-10-25). Run on Josef's Mac:
#   bash setup/make-env.sh [file]        (default ~/Desktop/media-machine.env)
# It writes only what the machine uses: the database, the storage, and the notice signing key DERIVED from the OS's
# SECRETS_KEY (never the master key itself, which seals the clients' stored logins). No value is printed. AirDrop the
# file to Luca, it goes to media-machine/.env on his Mac, then delete this copy. Never through git, chat or a shared folder.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HOME/Desktop/media-machine.env}"
OS_ENV="$(cd "$HERE/../.." && pwd)/OPHANIM AI OS/.env.local"
[ -f "$OS_ENV" ] || { echo "no OS keys at $OS_ENV"; exit 1; }
umask 077
bun -e '
const fs = require("node:fs"), { createHmac } = require("node:crypto");
const env = Object.fromEntries(fs.readFileSync(process.argv[1], "utf8").split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["\x27]|["\x27]$/g, "")]; }));
const keep = ["DATABASE_URL", "DIRECT_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => env[k]);
if (!env.SECRETS_KEY) throw new Error("the OS keys have no SECRETS_KEY");
const lines = keep.map((k) => `${k}=${env[k]}`);
lines.push(`MACHINE_NOTIFY_KEY=${createHmac("sha256", env.SECRETS_KEY).update("media-machine-notify").digest("hex")}`);
fs.writeFileSync(process.argv[2], "# the media machine keys (setup/make-env.sh); never in git, chat or a shared folder\n" + lines.join("\n") + "\n", { mode: 0o600 });
console.log("wrote " + process.argv[2] + ": " + [...keep, "MACHINE_NOTIFY_KEY"].join(", "));
' "$OS_ENV" "$OUT"
