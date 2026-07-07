Merged single-click sync fix.

Replace:
- law_order_tracker_app/app.js
- api/_wolf_auth.js
- api/sync/trakt.js
- api/me/status.js

Run once in Supabase SQL Editor:
- sql/FIX_WATCH_STATUS_SINGLE_ROW.sql

What changed:
- Backend now returns canonical guide episode rows alongside statuses.
- Frontend imports the full payload, not only statuses.
- Exact episode IDs and normalized show|season|episode keys are kept synced.
- Stale local Not Started values can no longer shadow fresh Trakt Watched values.
- Existing UI/progress/filter/mobile code from your uploaded app.js is preserved.
