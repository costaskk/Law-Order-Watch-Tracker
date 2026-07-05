Wolf Universe UI scope/filter cleanup

Files included:
- apply_wolf_filter_scope_clean_final.py

What it fixes:
- Removes duplicate scope/show dropdown patches.
- Keeps one clean filter row: Search, Show, Franchise, Season, Guide Scope, Status, Hide watched.
- Makes Core / Connected / Adjacent / Complete actually different.
- Makes Adjacent-only show adjacent/archive rows.
- Updates the existing show-chip rail instead of adding a second list.
- Makes top totals match the selected guide scope.
- Preserves episode metadata during app normalization.
- Removes fake S00/E00 badges from non-episode cards.
- Keeps mobile artwork and episode numbers visible.
- Adds click-to-enlarge artwork lightbox.
- Adds future-proof metadata preservation in wolf_universe_catalog_update.py.

Run from your project root:

python apply_wolf_filter_scope_clean_final.py
python wolf_universe_catalog_update.py --phase catalog
python wolf_universe_catalog_update.py --phase artwork
python sync_trakt_and_excel.py

For all possible episode stills:
python wolf_universe_catalog_update.py --phase episode-artwork --episode-artwork-limit 0

Then restart local server:
python local_tracker_server.py --host 0.0.0.0 --port 8080

Hard refresh the browser.
