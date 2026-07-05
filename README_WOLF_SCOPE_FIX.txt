Wolf Universe scope/filter + catalog updater fix

Files:
- wolf_universe_catalog_update.py: full replacement updater.
- wolf_universe_shows.json: full replacement show/movie config with optional/alwaysShow/connection fields.
- apply_wolf_scope_ui_patch.py: patches the website UI to add Guide Scope filtering.

Recommended install:
1) Copy wolf_universe_catalog_update.py and wolf_universe_shows.json to the project root.
2) Run:
   python apply_wolf_scope_ui_patch.py
3) Test catalog update:
   python wolf_universe_catalog_update.py --dry-run
4) Apply catalog update:
   python wolf_universe_catalog_update.py
5) If you want episode stills too, run later with a limit first:
   python wolf_universe_catalog_update.py --episode-artwork --episode-artwork-limit 200

TMDB:
- The updater now reads TMDB_API_KEY from your .env.local automatically.
- By default it fetches show/season artwork only; episode stills are optional because fetching thousands can be slow.

Guide Scope in app:
- Core + crossover-relevant: default. Hides optional adjacent-only shows.
- Complete Wolf Universe: shows everything, including optional adjacent shows.
- Adjacent only: shows only optional adjacent-only rows.

Git:
   git add wolf_universe_catalog_update.py wolf_universe_shows.json apply_wolf_scope_ui_patch.py law_order_tracker_app/app.js law_order_tracker_app/index.html law_order_tracker_app/data/episodes.js law_order_tracker_app/data/wolf_artwork.js law_order_tracker_app/data/show_themes.js law_order_tracker_app/data/wolf_catalog_update_debug.json law_order_tracker_app/data/wolf_catalog_update_changes.csv
   git commit -m "Upgrade Wolf Universe catalog and scope filters"
   git pull --rebase origin main
   git push
