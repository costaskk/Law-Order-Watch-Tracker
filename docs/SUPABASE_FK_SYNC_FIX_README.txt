Fixes included:
1. Adds User-Agent to all Trakt API calls in api/_wolf_auth.js.
2. Makes api/sync/trakt.js return a clear schema-mismatch message if Supabase still has the wrong FK.
3. Adds sql/FIX_WATCH_STATUS_FOREIGN_KEY.sql to repair the existing Supabase schema without deleting valid users.

Apply order:
1. In Supabase SQL Editor, run sql/FIX_WATCH_STATUS_FOREIGN_KEY.sql.
2. Replace api/_wolf_auth.js and api/sync/trakt.js in your project.
3. Commit/push/redeploy Vercel.
4. Log out/in once if needed, then press Sync with Trakt.

Why this happened:
watch_status.user_id was referencing the wrong/old table. The Vercel API saves progress using trakt_users.id, so watch_status.user_id must reference public.trakt_users(id).
