#!/usr/bin/env sh
# Restores a dump produced by backup.sh into DATABASE_URL (DESTRUCTIVE: replaces existing objects).
#   DATABASE_URL=postgres://… ./scripts/restore.sh backups/alejandro-20261013T000000Z.dump[.enc]
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
FILE="${1:?usage: restore.sh <dump file>}"
if [ -f "$FILE.sha256" ]; then sha256sum -c "$FILE.sha256"; fi
case "$FILE" in
  *.enc)
    : "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required for encrypted dumps}"
    PLAIN="$(mktemp)"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -out "$PLAIN" -pass env:BACKUP_ENCRYPTION_PASSPHRASE
    FILE="$PLAIN"
    ;;
esac
printf 'This will overwrite data in the target database. Type RESTORE to continue: '
read -r answer
[ "$answer" = "RESTORE" ] || { echo "aborted"; exit 1; }
psql "$DATABASE_URL" -c 'create extension if not exists vector; create extension if not exists pgcrypto;' > /dev/null
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" "$FILE"
echo "✔ restored"
