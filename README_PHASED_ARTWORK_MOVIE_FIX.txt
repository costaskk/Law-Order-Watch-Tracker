Wolf Universe phased updater package

Files to copy to your project root:
- wolf_universe_catalog_update.py
- wolf_universe_shows.json
- apply_wolf_ui_complete_patch.py

Recommended run order:

1) Patch the UI once:
   python apply_wolf_ui_complete_patch.py

2) Test catalog updates only:
   python wolf_universe_catalog_update.py --phase catalog --dry-run

3) Apply catalog updates only:
   python wolf_universe_catalog_update.py --phase catalog

4) Fetch/update show + season artwork only:
   python wolf_universe_catalog_update.py --phase artwork

5) Optional episode stills, limited first:
   python wolf_universe_catalog_update.py --phase episode-artwork --episode-artwork-limit 300

6) Sync watched status:
   python sync_trakt_and_excel.py

Notes:
- The updater reads TMDB_API_KEY from your environment or .env.local.
- TMDB responses are cached in law_order_tracker_app/data/tmdb_cache.json.
- Catalog phase will not overwrite existing artwork files.
- Episode artwork is deliberately separated because it can require thousands of TMDB requests.
