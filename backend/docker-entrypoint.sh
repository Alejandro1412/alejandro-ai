#!/bin/sh
set -e
# Apply pending migrations on every start (idempotent).
node dist/database/migrate.js
# Optional demo data. Only seeds an EMPTY database, never wipes existing tenants.
if [ "$SEED_DEMO_DATA" = "true" ]; then
  SEED_FORCE=true node dist/database/seed/seed.js --if-empty
fi
exec "$@"
