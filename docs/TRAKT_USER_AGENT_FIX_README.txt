# Wolf Universe Trakt/Supabase OAuth User-Agent Fix

This fixes the Trakt HTTP 403 / Cloudflare block during OAuth token exchange by sending a real User-Agent header on every Trakt API request.

## Replace/add these files

- api/_wolf_auth.js
- api/auth/trakt/start.js
- api/auth/trakt/callback.js
- api/auth/trakt/debug.js
- api/auth/logout.js
- api/me/status.js
- api/sync/trakt.js

## Vercel environment variables

Keep these set:

SUPABASE_URL=https://gfkopzlnssoowcbfacpg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your Supabase service role key
TRAKT_CLIENT_ID=your Trakt client id
TRAKT_CLIENT_SECRET=your Trakt client secret
TRAKT_REDIRECT_URI=https://law-and-order-watch-tracker1.vercel.app/api/auth/trakt/callback
PUBLIC_BASE_URL=https://law-and-order-watch-tracker1.vercel.app
SESSION_SECRET=your 64-byte generated secret

Recommended new optional env var:

TRAKT_USER_AGENT=Wolf-Universe-Watch-Tracker/1.0 (+https://law-and-order-watch-tracker1.vercel.app)

The code has this User-Agent as a default, but setting it in Vercel makes it explicit.

## After pushing

Open:

https://law-and-order-watch-tracker1.vercel.app/api/auth/trakt/debug

Confirm:
- trakt_redirect_uri is exactly https://law-and-order-watch-tracker1.vercel.app/api/auth/trakt/callback
- trakt_user_agent is not empty
- all has_* values are true

Then retry Login with Trakt from the app.
