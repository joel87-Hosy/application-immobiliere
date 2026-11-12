#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL for a dedicated backup role}"
: "${BACKUP_DIR:?Set an absolute private backup directory}"
case "$BACKUP_DIR" in /*) ;; *) echo 'Absolute BACKUP_DIR required' >&2; exit 1;; esac
mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump "$BACKUP_DATABASE_URL" --format=custom --file="$BACKUP_DIR/lagune-$stamp.dump"
tar -czf "$BACKUP_DIR/documents-$stamp.tar.gz" -C /srv/lagune storage
echo 'Backup completed. Encrypt and copy off-server, then verify restoration regularly.'
