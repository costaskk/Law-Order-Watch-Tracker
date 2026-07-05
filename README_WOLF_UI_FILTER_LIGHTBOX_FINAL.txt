Wolf UI Filter/Lightbox Final Fix

Copy apply_wolf_ui_filter_lightbox_final.py to your project root and run:

  python apply_wolf_ui_filter_lightbox_final.py
  python wolf_universe_catalog_update.py --phase catalog
  python wolf_universe_catalog_update.py --phase artwork
  python sync_trakt_and_excel.py

For episode artwork:

  python wolf_universe_catalog_update.py --phase episode-artwork --episode-artwork-limit 0

Then restart local server:

  python local_tracker_server.py --host 0.0.0.0 --port 8080

What this fixes:
- Removes the bad S00E00 / S0E0 badge injections from older patches.
- Stops the patch from overwriting all dropdowns as “All shows”.
- Restores correct scope split: Core, Core + crossover relevant, Adjacent only, Complete.
- Adjacent only now shows only optional/archive/adjacent shows that actually have episodes.
- Show chips only show series that exist in the active scope.
- Image click opens a lightbox.
- Mobile keeps episode numbers/artwork visible without polluting stats/cards.
