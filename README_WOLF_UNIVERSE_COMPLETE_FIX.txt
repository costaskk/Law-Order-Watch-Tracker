Wolf Universe complete fix package

Files to copy into the project root:
- wolf_universe_catalog_update.py
- wolf_universe_shows.json
- apply_wolf_ui_complete_patch.py

What this fixes/adds:
- Splits CIA (1992) and CIA (2026) into separate shows.
- CIA (2026) is resolved by IMDb tt35515227 so it will not scrape the 1992 show.
- Adds/keeps more Dick Wolf / Wolf Entertainment adjacent shows, but marks them with scope metadata.
- Keeps direct/crossover-relevant shows always visible.
- Adds app-side guide scope modes:
  * Core Wolf Universe
  * Core + important adjacent
  * Complete Dick Wolf archive
- Adds hover effects for episode/show cards and images.
- Keeps TMDB artwork support and reads TMDB_API_KEY from .env.local.
- Adds optional episode still fetching with --episode-artwork.

Recommended run order:
1) Copy/replace the files above.
2) Make sure .env.local contains:
   TMDB_API_KEY=your_real_tmdb_key
3) Apply UI patch:
   python apply_wolf_ui_complete_patch.py
4) Dry-run catalog:
   python wolf_universe_catalog_update.py --dry-run
5) Apply catalog:
   python wolf_universe_catalog_update.py
6) Optional episode still artwork, start with a limit:
   python wolf_universe_catalog_update.py --episode-artwork --episode-artwork-limit 300
   Full run can take a long time:
   python wolf_universe_catalog_update.py --episode-artwork
7) Restore/run your known working Trakt sync if needed:
   git checkout 7fcb9cb -- sync_trakt_and_excel.py
   python sync_trakt_and_excel.py

Important:
- This package does NOT replace sync_trakt_and_excel.py, because the proven working sync logic is from commit 7fcb9cb.
- If watched status breaks after catalog changes, restore that sync file and rerun sync.
