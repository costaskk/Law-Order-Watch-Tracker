# Wolf Universe: per-user Trakt login + Supabase sync

## Why Supabase, not SQLite

Use **Supabase** for the public/Vercel version. SQLite is fine only for a single local machine, but it will not work well on Vercel because serverless functions do not have reliable persistent local disk. Supabase also fixes the Vercel deployment limit problem because user sync writes watched status to the database instead of committing `watched_status.json` and triggering redeploys.

Your Supabase URL:

```text
gfkopzlnssoowcbfacpg.supabase.co
```

## 1. Run the database SQL

Open Supabase → SQL Editor → paste and run:

```text
sql/SUPABASE_TRAKT_USER_SYNC.sql
```

## 2. Set Vercel environment variables

In Vercel → Project → Settings → Environment Variables, add:

```text
SUPABASE_URL=https://gfkopzlnssoowcbfacpg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your Supabase service role key, never anon key
TRAKT_CLIENT_ID=your Trakt app client id
TRAKT_CLIENT_SECRET=your Trakt app client secret
TRAKT_REDIRECT_URI=https://YOUR-VERCEL-DOMAIN/api/auth/trakt/callback
PUBLIC_BASE_URL=https://YOUR-VERCEL-DOMAIN
SESSION_SECRET=generate a long random value
```

Generate `SESSION_SECRET` locally:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

## 3. Update your Trakt app redirect URI

In Trakt API app settings, add exactly the same redirect URI:

```text
https://YOUR-VERCEL-DOMAIN/api/auth/trakt/callback
```

For local OAuth testing with `vercel dev`, use:

```text
http://localhost:3000/api/auth/trakt/callback
```

and set `TRAKT_REDIRECT_URI` to that locally.

## 4. Copy files

Copy the files from this package into your project, preserving paths.

## 5. Commit safely

Do not commit `.env.local`.

```powershell
git rm --cached .env.local 2>$null
git add .gitignore api law_order_tracker_app/app.js law_order_tracker_app/styles.css sql/SUPABASE_TRAKT_USER_SYNC.sql docs/TRAKT_SUPABASE_USER_SYNC_SETUP.md
git commit -m "Add per-user Trakt Supabase sync"
git pull --rebase origin main
git push origin main
```

## 6. How it works after deployment

Each user can click **Login with Trakt**. Their Trakt token is stored server-side in Supabase. When they press **Sync with Trakt**, the app calls `/api/sync/trakt`, updates Supabase, and loads their personal watched status immediately.

This does **not** trigger GitHub Actions and does **not** trigger a Vercel redeploy.

The old shared GitHub Actions sync is still kept as a fallback for non-logged-in/shared usage.
