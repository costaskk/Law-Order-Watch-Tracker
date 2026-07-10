# Deployment and GitHub instructions

## 1. Back up before replacing files

Keep a private copy of your current project and export the Supabase tables before running a migration.

## 2. Configure Supabase

Use one SQL file only:

- Fresh Supabase project: run `sql/001_SUPABASE_SCHEMA.sql`.
- Existing tracker database: run `sql/002_MIGRATE_EXISTING.sql`.

Do not rerun the historic FK repair scripts after the canonical migration.

## 3. Configure the Trakt application

In Trakt → Your API Apps, set the redirect URI exactly to:

```text
https://YOUR-VERCEL-DOMAIN/api/auth/trakt/callback
```

Use no trailing slash. The Trakt client ID and secret identify this application; they do not lock the app to the developer's Trakt account. Every visitor can authorize their own account.

## 4. Configure Vercel environment variables

Required:

```text
PUBLIC_BASE_URL=https://YOUR-VERCEL-DOMAIN
TRAKT_REDIRECT_URI=https://YOUR-VERCEL-DOMAIN/api/auth/trakt/callback
TRAKT_CLIENT_ID=<your Trakt app client ID>
TRAKT_CLIENT_SECRET=<your Trakt app client secret>
TRAKT_USER_AGENT=Wolf-Universe-Watch-Tracker/3.0 (+https://YOUR-VERCEL-DOMAIN)
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only service-role key>
SESSION_SECRET=<long random secret>
TOKEN_ENCRYPTION_SECRET=<a different long random secret>
```

Recommended production switches:

```text
ENABLE_AUTH_DEBUG=0
ENABLE_SHARED_GITHUB_SYNC=0
ALLOW_MISSING_ORIGIN=0
```

Generate safe secrets in PowerShell:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Generate twice—once for `SESSION_SECRET` and once for `TOKEN_ENCRYPTION_SECRET`.

After changing Vercel environment variables, redeploy.

## 5. Validate the project before pushing

From the project folder:

```powershell
npm test
```

Expected results include 3,905 guide rows, 47 shows, no duplicate IDs, no 1992 CIA, and zero unset scopes.

## 6. Push an existing repository

```powershell
cd "R:\Law_Order_Professional_Watch_Tracker_Package"

git status
git add -A
git commit -m "Upgrade Wolf Universe tracker to professional v3"
git pull --rebase origin main
git push origin main
```

If Git reports there is nothing to commit, run `git status` and confirm the updated files are in the repository folder.

## 7. First push to a new GitHub repository

```powershell
cd "R:\Law_Order_Professional_Watch_Tracker_Package"

git init
git branch -M main
git add -A
git commit -m "Initial professional Wolf Universe tracker release"
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

Create the empty GitHub repository first and do not initialize it with another README when using these commands.

## 8. Vercel deployment

Connect the GitHub repository in Vercel. Framework preset can remain **Other**. No build command is required for normal source deployments because optimized data is committed.

The application opens at:

```text
https://YOUR-VERCEL-DOMAIN/law_order_tracker_app/
```

The root URL redirects to the app.

## 9. Optional GitHub shared-status workflow

Personal Supabase sync is the recommended system and does not require GitHub commits or redeploys. The workflow `.github/workflows/trakt-sync.yml` is manual-only.

To use it, add these GitHub repository secrets:

```text
TRAKT_CLIENT_ID
TRAKT_CLIENT_SECRET
TRAKT_TOKEN_JSON
```

Also set `ENABLE_SHARED_GITHUB_SYNC=1` in Vercel only if the website's optional trigger endpoint is needed. Otherwise leave it disabled.

## 10. Cache after deployment

The service worker may keep one previous shell briefly. Hard refresh once after a major deployment, or close/reopen the installed PWA. The service worker uses a versioned cache and will replace older caches automatically.
