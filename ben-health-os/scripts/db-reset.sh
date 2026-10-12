#!/usr/bin/env bash
# Drops and recreates the LOCAL development database, then applies migrations.
# Refuses to run against anything that is not localhost.
set -euo pipefail
: "${DATABASE_URL:=postgres://bho:bho@127.0.0.1:5432/ben_health_os}"
if [[ "$DATABASE_URL" != *"127.0.0.1"* && "$DATABASE_URL" != *"localhost"* ]]; then
  echo "refusing to reset a non-local database: $DATABASE_URL" >&2; exit 1
fi
ADMIN_URL="${DATABASE_URL%/*}/postgres"
DB_NAME="${DATABASE_URL##*/}"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "drop database if exists \"$DB_NAME\" with (force);" -c "create database \"$DB_NAME\";"
DATABASE_URL="$DATABASE_URL" node "$(dirname "$0")/db-migrate.mjs"
