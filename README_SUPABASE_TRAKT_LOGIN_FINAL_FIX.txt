Wolf Universe Supabase + Trakt login final fix

Files included:
- api/_wolf_auth.js
- api/auth/trakt/start.js
- api/auth/trakt/callback.js
- api/auth/logout.js
- api/me/status.js
- api/sync/trakt.js
- law_order_tracker_app/app.js
- law_order_tracker_app/styles.css
- sql/SUPABASE_TRAKT_USER_SYNC.sql
- docs/TRAKT_SUPABASE_USER_SYNC_SETUP.md

What this fixes:
- /api/auth/trakt/start 500 crash caused by wrong relative imports in the Trakt OAuth serverless functions.
- 30-day HttpOnly session cookie for Trakt login.
- Logout clears the session cookie.
- Logged-out reset clears only local browser progress.
- On Vercel, logged-out users are not shown the old shared watched_status.json as if it were theirs.
- Logged-in users sync to Supabase without GitHub commits and without Vercel redeploys.
- Local server fallback still works for local testing.

Required Vercel env vars:
SUPABASE_URL=https://gfkopzlnssoowcbfacpg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your Supabase service role key
TRAKT_CLIENT_ID=your Trakt client id
TRAKT_CLIENT_SECRET=your Trakt client secret
TRAKT_REDIRECT_URI=https://law-and-order-watch-tracker1.vercel.app/api/auth/trakt/callback
PUBLIC_BASE_URL=https://law-and-order-watch-tracker1.vercel.app
SESSION_SECRET=64-byte random hex string

Important:
- Do NOT commit .env.local.
- Do NOT put SUPABASE_SERVICE_ROLE_KEY in frontend JS.
- In Trakt app settings, add the exact Redirect URI above.
