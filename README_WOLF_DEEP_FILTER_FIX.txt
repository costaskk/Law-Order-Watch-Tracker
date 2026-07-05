Wolf Universe deep filter/lightbox/mobile fix

Files:
- apply_wolf_deep_filter_lightbox_patch.py
- wolf_universe_shows.json

Install/run from your project root:

  copy apply_wolf_deep_filter_lightbox_patch.py R:\Law_Order_Professional_Watch_Tracker_Package\
  copy wolf_universe_shows.json R:\Law_Order_Professional_Watch_Tracker_Package\
  cd R:\Law_Order_Professional_Watch_Tracker_Package
  python apply_wolf_deep_filter_lightbox_patch.py
  python wolf_universe_catalog_update.py --phase catalog
  python wolf_universe_catalog_update.py --phase artwork
  python sync_trakt_and_excel.py

Optional episode stills:

  python wolf_universe_catalog_update.py --phase episode-artwork --episode-artwork-limit 0

What it fixes:
- Images open in a large lightbox when clicked.
- Core / Connected / Adjacent / Complete are strictly separated.
- Adjacent-only shows only optional/archive adjacent shows.
- Core + Connected no longer equals Complete.
- Show chips/dropdowns are limited to shows with entries in the active scope.
- Mobile keeps episode numbers and artwork visible.

Artwork notes:
- Main show/season artwork: python wolf_universe_catalog_update.py --phase artwork
- Episode stills: python wolf_universe_catalog_update.py --phase episode-artwork --episode-artwork-limit 0
- TMDB key can be in PowerShell env or .env.local as TMDB_API_KEY=...
