Wolf Universe final fix package

Replace these files in your project root:
- wolf_universe_catalog_update.py
- wolf_universe_shows.json
- apply_wolf_scope_ui_patch.py

What this fixes:
- Preserves watched sync status when the guide expands/reorders.
- Adds scope metadata: core, complete, adjacent.
- Keeps crossover/storyline-relevant adjacent shows visible by default.
- Keeps optional adjacent-only shows available in Complete Guide.
- Loads TMDB_API_KEY from .env.local automatically.
- Searches TMDB when Trakt lacks a TMDB id, helping shows like CIA get artwork.
- Supports show posters, season posters, and optional episode stills.
- Uses Season 1/original-era artwork preference for original Law & Order.
- Adds manual fallbacks for Exiled and Homicide: The Movie if Trakt cannot find them.

Recommended run order:

1) Patch the website UI once:
   python apply_wolf_scope_ui_patch.py

2) Dry run catalog update:
   python wolf_universe_catalog_update.py --dry-run

3) Apply catalog + show/season artwork:
   python wolf_universe_catalog_update.py

4) Optional: fetch episode stills from TMDB. This is slower, but adds episode images where TMDB has them:
   python wolf_universe_catalog_update.py --episode-artwork

   To test episode artwork with a limit first:
   python wolf_universe_catalog_update.py --episode-artwork --episode-artwork-limit 200

5) Restore/sync watched status after catalog update:
   python sync_trakt_and_excel.py

6) Start local server:
   python local_tracker_server.py --host 0.0.0.0 --port 8080

7) Commit when happy:
   git add wolf_universe_catalog_update.py wolf_universe_shows.json apply_wolf_scope_ui_patch.py law_order_tracker_app/data/episodes.js law_order_tracker_app/data/wolf_artwork.js law_order_tracker_app/data/show_themes.js law_order_tracker_app/data/watched_status.json law_order_tracker_app/data/wolf_catalog_update_debug.json law_order_tracker_app/data/wolf_catalog_update_changes.csv
   git commit -m "Finalize Wolf Universe catalog, artwork and status preservation"
   git pull --rebase origin main
   git push

TMDB setup:
Make sure your .env.local contains:
TMDB_API_KEY=your_tmdb_api_key

The script now reads .env.local directly.
