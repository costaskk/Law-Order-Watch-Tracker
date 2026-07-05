Wolf Universe Watch Tracker Upgrade
==================================

This upgrade turns the project into a broader Wolf Universe tracker covering:
- Law & Order universe and crossover-adjacent shows
- One Chicago: Chicago Fire, Chicago P.D., Chicago Med, Chicago Justice
- FBI universe: FBI, FBI: Most Wanted, FBI: International, CIA / FBI: CIA when available on Trakt
- Trakt season 0 specials
- supported TV movies such as Exiled: A Law & Order Movie and Homicide: The Movie when available on Trakt

Files added/updated:
- wolf_universe_catalog_update.py
- wolf_universe_shows.json
- law_order_tracker_app/data/wolf_artwork.js
- law_order_tracker_app/data/show_themes.js
- law_order_tracker_app/app.js
- law_order_tracker_app/index.html
- generated SVG placeholder artwork for new shows

How to test safely:
  python wolf_universe_catalog_update.py --dry-run

How to apply:
  python wolf_universe_catalog_update.py
  python sync_trakt_and_excel.py

Optional real artwork:
  Set TMDB_API_KEY before running the catalog updater.
  PowerShell example:
    $env:TMDB_API_KEY="YOUR_TMDB_API_KEY"
    python wolf_universe_catalog_update.py

Git push:
  git add wolf_universe_catalog_update.py wolf_universe_shows.json law_order_tracker_app/data/wolf_artwork.js law_order_tracker_app/data/show_themes.js law_order_tracker_app/data/episodes.js law_order_tracker_app/data/wolf_catalog_update_debug.json law_order_tracker_app/data/wolf_catalog_update_changes.csv law_order_tracker_app/app.js law_order_tracker_app/index.html law_order_tracker_app/assets
  git commit -m "Upgrade to Wolf Universe tracker"
  git pull --rebase origin main
  git push

Important:
- The updater does NOT timezone-shift existing air dates by default.
- It preserves watched status and IDs as much as possible.
- Run sync_trakt_and_excel.py after catalog updates so watched_status.json is regenerated for the expanded guide.
