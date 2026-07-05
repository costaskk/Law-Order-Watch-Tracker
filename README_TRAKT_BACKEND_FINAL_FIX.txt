Copy these files into your project:

api/_wolf_auth.js
api/auth/trakt/start.js
api/auth/trakt/callback.js
api/auth/trakt/debug.js
api/auth/logout.js
api/me/status.js
api/sync/trakt.js

Important Trakt app settings:
Redirect uri must be exactly:
https://law-and-order-watch-tracker1.vercel.app/api/auth/trakt/callback

Vercel env vars:
PUBLIC_BASE_URL=https://law-and-order-watch-tracker1.vercel.app
TRAKT_REDIRECT_URI=https://law-and-order-watch-tracker1.vercel.app/api/auth/trakt/callback
TRAKT_CLIENT_ID=from the same Trakt API app
TRAKT_CLIENT_SECRET=from the same Trakt API app
SUPABASE_URL=https://gfkopzlnssoowcbfacpg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your service role key, never in frontend
SESSION_SECRET=64-byte random secret

After deploy, open this to verify env without revealing secrets:
https://law-and-order-watch-tracker1.vercel.app/api/auth/trakt/debug

If token exchange still returns 403, it is almost always one of:
1) wrong TRAKT_CLIENT_SECRET
2) TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET from different Trakt apps
3) TRAKT_REDIRECT_URI in Vercel differs from the Trakt dashboard redirect uri
4) Vercel was not redeployed after changing env vars
