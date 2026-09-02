#!/usr/bin/env bash
#
# Ship a change:  bash deploy/deploy.sh
#
# Pull, install, build, restart. The build happens before the restart on
# purpose — if it fails, the old version is still serving and nothing has
# happened to the site.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "==> pulling"
git pull --ff-only

echo "==> dependencies"
# `npm ci` rather than `install`: the lockfile is the truth, and native modules
# are rebuilt for this machine.
npm ci

echo "==> building"
npm run build

echo "==> restarting"
sudo systemctl restart gyges
sleep 2
systemctl is-active --quiet gyges && echo "==> up" || {
  echo "!! it did not come back — journalctl -u gyges -n 50" >&2
  exit 1
}

# Migrations run themselves when the app opens the database, so there is no
# migration step here. `npm run db:migrate -- --status` shows what has run.
