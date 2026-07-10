# Supabase data model

## Tables

### `trakt_users`
Stores one record per Trakt account, encrypted OAuth tokens, cached profile/avatar data, token expiry, and last sync timestamps.

### `watch_status`
Stores one row per user:

- `status`: Trakt-owned watched history.
- `manual_status`: app-owned Watching, Skipped, and explicit browser changes.
- `trakt_synced_at`: latest successful Trakt import.
- `updated_at`: latest row update.

Keeping the two layers separate prevents a Trakt refresh from deleting app-only states.

### `app_sessions`
Stores hashed session identifiers and expiry times. The browser only receives the signed raw identifier through an HttpOnly cookie.

## Fresh setup

Run:

```text
sql/001_SUPABASE_SCHEMA.sql
```

## Existing installation

Back up the database, then run:

```text
sql/002_MIGRATE_EXISTING.sql
```

The migration:

- adds profile, avatar, sync, and manual-state fields;
- removes duplicate watch-status rows;
- replaces incorrect foreign keys;
- enforces one watch-status row per Trakt user;
- enables RLS.

## RLS and keys

No public RLS policy is created. The browser never talks directly to Supabase. Vercel serverless functions use `SUPABASE_SERVICE_ROLE_KEY`; never expose this value in `account_config.js`, `app.js`, or any `NEXT_PUBLIC_`/`VITE_` variable.
