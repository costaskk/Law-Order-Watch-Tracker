Wolf Universe v3 professional UI/artwork fix

Replace these files in your project:

  law_order_tracker_app/app.js
  law_order_tracker_app/index.html
  law_order_tracker_app/styles.css
  wolf_universe_catalog_update.py

What changed:
- Shows in the rails are sorted chronologically by first air date.
- Season Manager card is removed.
- Episode cards open a stylized episode detail modal.
- Images open in a large lightbox.
- Show and season artwork now appear in a dedicated gallery.
- Mobile keeps episode artwork visible.
- Counts come from the active guide scope only.
- Episode artwork generation preserves existing artwork and can force-fetch a specific show.

Recommended run order:

  python wolf_universe_catalog_update.py --phase catalog
  python wolf_universe_catalog_update.py --phase artwork
  python sync_trakt_and_excel.py

If your updater does not support --phase, use:

  python wolf_universe_catalog_update.py
  python sync_trakt_and_excel.py

To fix Law & Order episode stills specifically:

  python wolf_universe_catalog_update.py --episode-artwork --episode-artwork-show "Law & Order" --force-episode-artwork

To force-check every episode still:

  python wolf_universe_catalog_update.py --episode-artwork --episode-artwork-limit 0 --force-episode-artwork

Make sure .env.local contains:

  TMDB_API_KEY=your_real_tmdb_api_key

Then start locally:

  python local_tracker_server.py --host 0.0.0.0 --port 8080
