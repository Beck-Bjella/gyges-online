#!/usr/bin/env bash
#
# First-time provision of a fresh box. Run it once, from the repo:
#
#   DOMAIN=gyges.example.com bash deploy/setup.sh
#
# Works on Ubuntu/Debian and on Amazon Linux/RHEL — neither has a desktop and
# both are the same job, only with a different package manager. Safe to run
# again: every step checks whether it has already been done, so an interrupted
# run can simply be repeated.
#
# In order: swap (the Next build needs more memory than a small instance has),
# Node, Caddy, a data directory outside the repo, a systemd unit, the first
# build, and the services started.
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
  echo "Run as the ordinary login user (ubuntu, or ec2-user), not root." >&2
  echo "It uses sudo where it needs to." >&2
  exit 1
fi

# Which family are we on? Everything below branches on this one answer.
if command -v apt-get >/dev/null; then
  PKG=apt
elif command -v dnf >/dev/null; then
  PKG=dnf
else
  echo "No apt-get or dnf found. This expects Ubuntu/Debian or Amazon Linux/RHEL." >&2
  exit 1
fi

echo "==> app:    $APP_DIR"
echo "==> user:   $APP_USER"
echo "==> data:   $DATA_DIR"
echo "==> domain: $DOMAIN"
echo "==> pkg:    $PKG"

# --- swap -------------------------------------------------------------------
# `next build` is the only memory-hungry moment here and comfortably the thing
# most likely to fail on a 512 MB or 1 GB instance: the kernel kills it and the
# error reads as a crash rather than as a shortage. Swap is touched during the
# build and essentially never while serving.
if ! sudo swapon --show | grep -q '/swapfile'; then
  echo "==> creating 2G swapfile"
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
else
  echo "==> swap already present"
fi

# --- build tools ------------------------------------------------------------
# better-sqlite3 is a native module, compiled on this machine — which is also
# why node_modules must never be copied here from a laptop.
echo "==> build tools"
if [[ "$PKG" == apt ]]; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq build-essential python3 git curl tar \
    debian-keyring debian-archive-keyring apt-transport-https ca-certificates
else
  sudo dnf -y -q group install "Development Tools" || sudo dnf -y -q groupinstall "Development Tools"
  sudo dnf -y -q install python3 git curl tar
fi

# --- node -------------------------------------------------------------------
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v${NODE_MAJOR}" ]]; then
  echo "==> installing Node ${NODE_MAJOR}"
  if [[ "$PKG" == apt ]]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
    sudo apt-get install -y -qq nodejs
  else
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
    sudo dnf -y -q install nodejs
  fi
fi
echo "==> node $(node -v)"

# --- aws cli ----------------------------------------------------------------
# For backup.sh's copy to S3. Amazon Linux ships it; Ubuntu does not, and a
# backup cron that fails months later for a missing binary is the worst way
# to find that out.
if ! command -v aws >/dev/null; then
  echo "==> installing the AWS CLI (for backups)"
  if [[ "$PKG" == apt ]]; then
    sudo apt-get install -y -qq awscli || echo "!! could not install awscli — backups to S3 will need it later"
  else
    sudo dnf -y -q install awscli aws-cli 2>/dev/null || true
  fi
fi

# --- caddy ------------------------------------------------------------------
# Debian and Ubuntu have an official apt repository, so upgrades arrive with
# everything else. The RPM family does not, so there Caddy comes from its
# release binary and brings its own unit — see deploy/caddy.service.
if ! command -v caddy >/dev/null; then
  echo "==> installing Caddy"
  if [[ "$PKG" == apt ]]; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    sudo apt-get update -qq
    sudo apt-get install -y -qq caddy
  else
    case "$(uname -m)" in
      x86_64) CADDY_ARCH=amd64 ;;
      aarch64 | arm64) CADDY_ARCH=arm64 ;;
      *) echo "Unknown architecture $(uname -m)" >&2; exit 1 ;;
    esac
    # Whatever the current release is, unless CADDY_VERSION says otherwise.
    CADDY_VERSION="${CADDY_VERSION:-$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest \
      | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)}"
    if [[ -z "$CADDY_VERSION" ]]; then
      echo "Could not determine the latest Caddy version. Set CADDY_VERSION and re-run." >&2
      exit 1
    fi
    echo "==> Caddy ${CADDY_VERSION} (${CADDY_ARCH})"
    tmp="$(mktemp -d)"
    curl -fsSL -o "$tmp/caddy.tar.gz" \
      "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_${CADDY_ARCH}.tar.gz"
    tar -xzf "$tmp/caddy.tar.gz" -C "$tmp" caddy
    sudo install -m 0755 "$tmp/caddy" /usr/bin/caddy
    rm -rf "$tmp"

    id caddy >/dev/null 2>&1 || sudo useradd --system --home /var/lib/caddy \
      --create-home --shell /usr/sbin/nologin --comment "Caddy web server" caddy
    sudo mkdir -p /etc/caddy
    sudo install -m 0644 "$APP_DIR/deploy/caddy.service" /etc/systemd/system/caddy.service
    sudo systemctl daemon-reload
    sudo systemctl enable caddy
  fi
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

# --- the service ------------------------------------------------------------
echo "==> installing the service"
sed -e "s|@APP_DIR@|$APP_DIR|g" \
    -e "s|@APP_USER@|$APP_USER|g" \
    -e "s|@DATA_DIR@|$DATA_DIR|g" \
    -e "s|@PORT@|$PORT|g" \
    "$APP_DIR/deploy/gyges.service" | sudo tee /etc/systemd/system/gyges.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now gyges

# --- the front door ---------------------------------------------------------
# DNS must already point here: Caddy proves it controls the name over port 80
# before Let's Encrypt will issue a certificate. If this step fails, check the
# A record first — it is nearly always that.
echo "==> configuring Caddy for $DOMAIN"
sed -e "s|@DOMAIN@|$DOMAIN|g" -e "s|@PORT@|$PORT|g" \
    "$APP_DIR/deploy/Caddyfile" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy

echo
echo "Done. https://$DOMAIN"
echo
echo "  systemctl status gyges       is it running"
echo "  journalctl -u gyges -f       what it is saying"
echo "  bash deploy/deploy.sh        ship a change"
echo
echo "Still to do by hand: the backup cron (see deploy/README.md) and an"
echo "external uptime check."
