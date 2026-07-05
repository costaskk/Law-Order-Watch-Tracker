Wolf Universe Watch Tracker v3.1 - Episode Modal / Cast / Artwork Fix

Replace these files in law_order_tracker_app:
  app.js
  index.html
  styles.css

Replace this file in the project root:
  wolf_universe_catalog_update.py

What changed:
- Bigger, clearer lightbox close button.
- Lightbox now opens above the episode details popup.
- Clicking an episode card opens a professional episode details modal.
- Episode modal includes summary/overview, metadata, cast, status buttons, and episode/season/show artwork tiles.
- Actor filter added to the main filters.
- Cast names in episode modal can be clicked to filter by actor.
- Season Manager card removed.
- Show chips/lists remain chronological by first aired date.
- Episode artwork lookup is more tolerant of key formats.
- TMDB episode metadata fetch now also stores cast/director/writer metadata in episodes.js when available.
- Missing episode stills are reported in wolf_artwork.js under missingEpisodeStills.

Run order:
  python wolf_universe_catalog_update.py --dry-run
  python wolf_universe_catalog_update.py
  python sync_trakt_and_excel.py

To force-refresh Law & Order episode stills and metadata:
  python wolf_universe_catalog_update.py --episode-artwork --episode-artwork-show "Law & Order" --force-episode-artwork

To fetch episode artwork/cast metadata for everything:
  python wolf_universe_catalog_update.py --episode-artwork --force-episode-artwork

If that is too slow, do it in chunks:
  python wolf_universe_catalog_update.py --episode-artwork --episode-artwork-limit 300

Start locally:
  python local_tracker_server.py --host 0.0.0.0 --port 8080

Open:
  http://localhost:8080/law_order_tracker_app/
