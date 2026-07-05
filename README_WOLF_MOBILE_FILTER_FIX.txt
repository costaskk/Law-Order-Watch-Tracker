Wolf Universe mobile/filter fix

Files:
- apply_wolf_mobile_filter_fix.py
- wolf_universe_shows.json

How to apply:
1) Copy both files to your project root.
2) Run:
   python apply_wolf_mobile_filter_fix.py
   python wolf_universe_catalog_update.py --phase catalog --dry-run
   python wolf_universe_catalog_update.py --phase catalog
   python wolf_universe_catalog_update.py --phase artwork
   python sync_trakt_and_excel.py

Episode artwork:
- Make sure .env.local contains:
  TMDB_API_KEY=your_real_tmdb_key
- Show/season artwork:
  python wolf_universe_catalog_update.py --phase artwork
- Episode stills, limited test:
  python wolf_universe_catalog_update.py --phase episode-artwork --episode-artwork-limit 300
- Full episode stills:
  python wolf_universe_catalog_update.py --phase episode-artwork

Local server:
  python local_tracker_server.py --host 0.0.0.0 --port 8080
  http://localhost:8080/law_order_tracker_app/

Notes:
- The new Guide scope dropdown has Core, Connected, Adjacent only, Complete.
- The series progress strip is rebuilt from the active scope/filter and only shows shows that have visible episodes.
- Mobile keeps artwork and episode numbers visible.
- Clicking artwork opens a larger lightbox.
