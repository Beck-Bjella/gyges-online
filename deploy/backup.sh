#!/usr/bin/env bash
#
# Nightly backup, for cron. See deploy/README.md for the crontab line.
#
# Two halves, and the second is the one that matters: a copy on the same disk
# protects against a bad UPDATE, and against nothing else. The copy in S3 is
# what survives the instance.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${GYGES_DATA_DIR:-/var/lib/gyges}"
KEEP_DAYS="${KEEP_DAYS:-14}"

export GYGES_DB_PATH="${GYGES_DB_PATH:-$DATA_DIR/gyges.db}"
export GYGES_BACKUP_DIR="${GYGES_BACKUP_DIR:-$DATA_DIR/backups}"

cd "$APP_DIR"

# Uses SQLite's online backup API, so it is safe while the site is serving —
# unlike `cp`, which can catch the file mid-write.
npm run --silent db:backup

latest="$(ls -t "$GYGES_BACKUP_DIR"/*.db | head -1)"

if [[ -n "${GYGES_BACKUP_BUCKET:-}" ]]; then
  aws s3 cp "$latest" "s3://$GYGES_BACKUP_BUCKET/$(basename "$latest")" --only-show-errors
  echo "sent $(basename "$latest") to s3://$GYGES_BACKUP_BUCKET"
else
  echo "GYGES_BACKUP_BUCKET unset — kept a local copy only, which is not a backup" >&2
fi

# Local copies are a convenience; the bucket is the archive. Trimming keeps the
# 20 GB disk from filling with them.
find "$GYGES_BACKUP_DIR" -name '*.db' -mtime "+$KEEP_DAYS" -delete
