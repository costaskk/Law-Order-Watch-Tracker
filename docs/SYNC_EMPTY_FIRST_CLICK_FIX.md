# Sync empty first-click guard

This package keeps your current app/trakt logic and adds the final guard for the Network trace where the first POST returned 200 but wrote `status_count: 0`.

Changes:
- Frontend posts directly to `/api/sync/trakt/` to avoid Vercel's 308 redirect.
- Frontend automatically retries the sync endpoint if the backend returns a retryable empty Trakt build.
- Backend retries Trakt watched-status building before writing Supabase.
- Backend refuses to overwrite Supabase with an empty `{}` status map.
- `/api/me/status` returns `episodes` as well as `statuses` for stronger frontend matching.
