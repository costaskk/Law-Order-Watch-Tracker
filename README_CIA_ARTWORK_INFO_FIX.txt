Wolf Universe CIA + artwork + info fix

Files:
- wolf_universe_catalog_update.py
- wolf_universe_shows.json
- apply_wolf_ui_hover_info_patch.py

What changed:
- CIA now targets the 2026 Dick Wolf/FBI spinoff via IMDb tt35515227 and rejects the older 1992 CIA show.
- FBI: CIA is treated as an alias for CIA.
- Adds optional/alwaysShow/connection metadata for scope filtering.
- Keeps adjacent shows in the data but allows the app to hide them by default.
- Adds richer episode metadata fields from Trakt.
- Reads TMDB_API_KEY from .env.local automatically.
- Supports show/season artwork and optional episode stills via --episode-artwork.
- Adds hover effects and richer episode/crossover info UI patch.

Recommended run order:
1. Copy the three files to the project root.
2. Make sure .env.local contains:
   TMDB_API_KEY=your_real_tmdb_key
3. Run:
   python apply_wolf_ui_hover_info_patch.py
   python wolf_universe_catalog_update.py --dry-run
4. If the dry-run looks good:
   python wolf_universe_catalog_update.py
5. Optional episode stills, slower:
   python wolf_universe_catalog_update.py --episode-artwork --episode-artwork-limit 200
   # or no limit for everything:
   python wolf_universe_catalog_update.py --episode-artwork
6. Restore/update watched status:
   python sync_trakt_and_excel.py
7. Test locally:
   python local_tracker_server.py --host 0.0.0.0 --port 8080

Git:
   git add wolf_universe_catalog_update.py wolf_universe_shows.json apply_wolf_ui_hover_info_patch.py law_order_tracker_app/data/episodes.js law_order_tracker_app/data/wolf_artwork.js law_order_tracker_app/data/show_themes.js law_order_tracker_app/app.js law_order_tracker_app/styles.css law_order_tracker_app/index.html
   git commit -m "Fix CIA 2026, artwork, and Wolf Universe episode info"
   git pull --rebase origin main
   git push
