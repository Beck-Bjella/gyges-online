#!/usr/bin/env bash
#
# First-time provision of a fresh Ubuntu box. Run it once, from the repo:
#
#   DOMAIN=gyges.example.com bash deploy/setup.sh
#
# Safe to run again: every step checks whether it has already been done, so a
# half-finished run can simply be repeated.
#
# What it does, in order: swap (the Next build needs more memory than a small
# instance has), Node, Caddy, a data directory outside the repo, a systemd
# unit, the first build, and the services started.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="$(id -un)"
DATA_DIR="${GYGES_DATA_DIR:-/var/lib/gyges}"
NODE_MAJOR=22
PORT="${PORT:-3000}"

if [[ -z "${DOMAIN:-}" ]]; then
  echo "Set DOMAIN first, e.g.  DOMAIN=gyges.example.com bash deploy/setup.sh" >&2
  exit 1
fi
if [[ "$APP_USER" == "root" ]]; then
  echo "Run as the ordinary login user (ubuntu), not root. It uses sudo where needed." >&2
  exit 1
fi

echo "==> app:    $APP_DIR"
echo "==> user:   $APP_USER"
echo "==> data:   $DATA_DIR"
echo "==> domain: $DOMAIN"

# --- swap -------------------------------------------------------------------
# `next build` is the only memory-hungry moment here and it is comfortably the
# thing most likely to fail on a 512 MB or 1 GB instance: the kernel kills it
# and the error looks like a crash rather than a shortage. Swap is only touched
# during the build, never while serving.
if ! sudo swapon --show | grep -q '/swapfile'; then
  echo "==> creating 2G swapfile"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
else
  echo "==> swap already present"
fi

# --- packages ---------------------------------------------------------------
echo "==> apt update"
sudo apt-get update -qq
# build-essential and python3 are for better-sqlite3, which is a native module
# and is compiled on this machine — which is also why node_modules must never
# be copied here from a different architecture.
sudo apt-get install -y -qq build-essential python3 git curl debian-keyring \
  debian-archive-keyring apt-transport-https ca-certificates

if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v${NODE_MAJOR}" ]]; then
  echo "==> installing Node ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
echo "==> node $(node -v)"

if ! command -v caddy >/dev/null; then
  echo "==> installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy
fi

# --- data directory ---------------------------------------------------------
# Outside the repo on purpose: a deploy replaces the working tree, and the
# database must not be anywhere near that.
sudo mkdir -p "$DATA_DIR"
sudo chown "$APP_USER:$APP_USER" "$DATA_DIR"

# --- build ------------------------------------------------------------------
echo "==> installing dependencies"
cd "$APP_DIR"
npm ci
echo "==> building (slow on a small instance — this is what the swap is for)"
npm run build

# --- systemd ----------------------------------------------------------------
echo "==> installing the service"
sed -e "s|@APP_DIR@|$APP_DIR|g" \
    -e "s|@APP_USER@|$APP_USER|g" \
    -e "s|@DATA_DIR@|$DATA_DIR|g" \
    -e "s|@PORT@|$PORT|g" \
    "$APP_DIR/deploy/gyges.service" | sudo tee /etc/systemd/system/gyges.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now gyges

# --- caddy ------------------------------------------------------------------
# DNS must already point here: Caddy proves it controls the name over port 80
# before Let's Encrypt will issue a certificate. If this step fails, check the
# A record first — it is nearly always that.
echo "==> configuring Caddy for $DOMAIN"
sed -e "s|@DOMAIN@|$DOMAIN|g" -e "s|@PORT@|$PORT|g" \
    "$APP_DIR/deploy/Caddyfile" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl reload caddy || sudo systemctl restart caddy

echo
echo "Done. https://$DOMAIN"
echo
echo "  systemctl status gyges       is it running"
echo "  journalctl -u gyges -f       what it is saying"
echo "  bash deploy/deploy.sh        ship a change"
echo
echo "Still to do by hand: the backup cron (see deploy/README.md) and an"
echo "external uptime check."
