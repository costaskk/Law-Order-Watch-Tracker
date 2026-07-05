Wolf Universe final UI/catalog fix

Replace these files in your project root:
- wolf_universe_catalog_update.py
- wolf_universe_shows.json
- apply_wolf_ui_complete_patch.py

What this fixes/adds:
- Fixes NameError: remove_shows is not defined.
- Keeps only CIA (2026) and purges legacy CIA/FBI: CIA/CIA 1992 rows.
- Adds missing optional Dick Wolf / Law & Order-adjacent archive entries where available:
  The Wright Verdicts, H.E.L.P., The Human Factor, The Invisible Man, Paris enquêtes criminelles, Law & Order: Division of Field Investigation.
- Adds click-to-enlarge image lightbox.
- Keeps artwork visible on mobile.
- Adds a mobile-friendly series progress strip with watched/total counts per series.
- Keeps Core / Connected / Complete guide scope filtering.

Recommended run order:

python apply_wolf_ui_complete_patch.py
python wolf_universe_catalog_update.py --phase catalog --dry-run
python wolf_universe_catalog_update.py --phase catalog
python wolf_universe_catalog_update.py --phase artwork
python wolf_universe_catalog_update.py --phase episode-artwork --episode-artwork-limit 300
python sync_trakt_and_excel.py

If the dry-run looks too large, do not apply and inspect:
- law_order_tracker_app/data/wolf_catalog_update_debug.json
- law_order_tracker_app/data/wolf_catalog_update_changes.csv

For TMDB artwork, make sure .env.local contains:
TMDB_API_KEY=your_real_tmdb_key
