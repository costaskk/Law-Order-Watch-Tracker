# Security

## Secrets

The following values must remain private and server-side:

- `SUPABASE_SERVICE_ROLE_KEY`
- `TRAKT_CLIENT_SECRET`
- `SESSION_SECRET`
- `TOKEN_ENCRYPTION_SECRET`
- Trakt access/refresh tokens
- `GITHUB_PAT`
- `OMDB_API_KEY` and `TMDB_API_KEY` when their provider terms require it

Do not put these values in frontend JavaScript or commit them to GitHub. Use Vercel environment variables and GitHub Actions secrets.

## Token and session protection

- Trakt tokens are encrypted with AES-256-GCM before database storage.
- `TOKEN_ENCRYPTION_SECRET` is recommended; otherwise `SESSION_SECRET` is used.
- New application sessions store a SHA-256 hash in Supabase. The raw session identifier remains only in a signed, HttpOnly cookie.
- State-changing APIs validate the request origin.
- Supabase Row Level Security is enabled and no public browser policies are created. Only serverless APIs use the service-role key.

## Production switches

Keep these disabled unless required:

```text
ENABLE_AUTH_DEBUG=0
ENABLE_SHARED_GITHUB_SYNC=0
ALLOW_MISSING_ORIGIN=0
```

For additional trusted origins, use a comma-separated `ALLOWED_ORIGINS` value.

## Local server

`local_tracker_server.py` binds to `127.0.0.1` by default. To expose it to a LAN/Tailscale network, explicitly set:

```text
ALLOW_LAN_SYNC=1
LOCAL_SYNC_TOKEN=<long-random-secret>
```

Then store the same token in the browser localStorage key `wolf_local_sync_token`.

## If the original archive was shared

Older project archives contained local secret/token files. Rotate any exposed GitHub PAT, Trakt client secret, Trakt access/refresh tokens, TMDB key, and Supabase service-role key.
