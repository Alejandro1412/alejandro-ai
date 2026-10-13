#!/usr/bin/env sh
# Alejandro AI — PostgreSQL backup.
#   DATABASE_URL=postgres://… ./scripts/backup.sh
# Optional:
#   BACKUP_DIR=./backups           where dumps are written (default ./backups)
#   BACKUP_RETENTION_DAYS=14       local dumps older than this are deleted
#   BACKUP_S3_URI=s3://bucket/path upload with the AWS CLI (any S3-compatible storage: R2, B2, MinIO…)
#   BACKUP_ENCRYPTION_PASSPHRASE   encrypt the dump with AES-256 (openssl) before it leaves the machine
# Restore: ./scripts/restore.sh <file>
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
DIR="${BACKUP_DIR:-./backups}"
KEEP="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/alejandro-$STAMP.dump"

echo "→ pg_dump (custom format, compressed)"
pg_dump --format=custom --compress=9 --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$FILE"
pg_restore --list "$FILE" > /dev/null   # integrity check: the archive must be readable

if [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  echo "→ encrypting"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$FILE" -out "$FILE.enc" -pass env:BACKUP_ENCRYPTION_PASSPHRASE
  rm -f "$FILE"
  FILE="$FILE.enc"
fi
sha256sum "$FILE" > "$FILE.sha256"

if [ -n "${BACKUP_S3_URI:-}" ]; then
  echo "→ uploading to $BACKUP_S3_URI"
  aws s3 cp "$FILE" "$BACKUP_S3_URI/" --only-show-errors ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"}
  aws s3 cp "$FILE.sha256" "$BACKUP_S3_URI/" --only-show-errors ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"}
fi

find "$DIR" -name 'alejandro-*' -type f -mtime "+$KEEP" -delete
echo "✔ backup written: $FILE ($(du -h "$FILE" | cut -f1))"
