# Wolf Universe Watch Tracker

A responsive watch-order and progress tracker for the connected Dick Wolf television universe: **Law & Order**, **One Chicago**, **FBI**, crossover-relevant titles, specials, and optional archive/adjacent productions.

Version 3 modernizes the application around personal Trakt OAuth, Supabase-backed progress, asynchronous catalog data, a compact PWA shell, and a complete 3,905-entry guide.

## Highlights

- Multi-user Trakt OAuth: one Trakt application can serve any Trakt account.
- Separate progress per user in Supabase.
- One-click Trakt import with an authoritative response—no second sync click or page reload.
- Manual `Unwatched`, `Watching`, `Watched`, and `Skipped` states saved to Supabase.
- Four guide scopes: Core, Core + crossover relevant, Adjacent/archive only, and Complete.
- Search and filters update in place while preserving scroll position.
- Up Next follows the current filtered view.
- Episode summaries, artwork, cast, actor filtering, actor portraits, runtimes, and available ratings.
- Lazy-loaded cast and episode artwork data for faster startup and faster modals.
- Installable PWA with offline shell support.
- Optional local and GitHub shared-status workflows, disabled by default.

## Project layout

```text
api/                         Vercel serverless authentication and sync APIs
law_order_tracker_app/       Browser application
  assets/                    Icons and local artwork fallbacks
  data/                      Canonical/optimized guide metadata
  app.js                     Main UI/controller
  styles.css                 Application styling
  service-worker.js          PWA cache layer
sql/                         Fresh Supabase schema and safe migration
scripts/                     Validation and release tools
wolf_build_web_data.py       Builds optimized browser data
wolf_universe_catalog_update.py  Catalog/artwork updater
wolf_fetch_episode_cast.py   Cast enrichment
wolf_fetch_episode_ratings.py Ratings enrichment
sync_trakt_and_excel.py      Optional shared Trakt snapshot
local_tracker_server.py      Local development/fallback server
```

## Requirements

- Node.js 20+ for validation/Vercel development.
- Python 3.10+ for data maintenance and the local server.
- A Vercel project.
- A Supabase project.
- A Trakt API application.

## Quick setup

1. Run the correct Supabase SQL:
   - New project: `sql/001_SUPABASE_SCHEMA.sql`
   - Existing project: `sql/002_MIGRATE_EXISTING.sql`
2. Configure the Vercel environment variables listed in `docs/DEPLOYMENT.md`.
3. Register this exact Trakt redirect URI:

   ```text
   https://YOUR-PROJECT.vercel.app/api/auth/trakt/callback
   ```

4. Validate locally:

   ```powershell
   npm test
   ```

5. Push to GitHub and let Vercel deploy.

Detailed setup and deployment instructions are in:

- `docs/DEPLOYMENT.md`
- `docs/SUPABASE.md`
- `docs/DATA_MAINTENANCE.md`
- `SECURITY.md`

## Local use

The safest default binds only to your own computer:

```powershell
python local_tracker_server.py
```

Then open the address printed by the script. Personal OAuth is designed for the Vercel deployment. Local shared-sync triggering is optional and protected; see `docs/DEPLOYMENT.md`.

## Data maintenance

Rebuild optimized browser data after catalog, cast, artwork, or rating changes:

```powershell
python wolf_build_web_data.py
```

Validate the complete project:

```powershell
npm test
```

Build a clean ZIP that excludes secrets, Git history, caches, legacy patch files, and local tokens:

```powershell
npm run release
```

## Important security note

Never commit or share `.env.local`, `trakt_config.json`, `trakt_token.json`, the Supabase service-role key, Trakt client secret, GitHub PAT, access tokens, or refresh tokens. The release builder excludes these automatically.
