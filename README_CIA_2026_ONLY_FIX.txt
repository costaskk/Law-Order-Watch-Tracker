CIA 2026-only fix

Replace these files in your project root:
- wolf_universe_catalog_update.py
- wolf_universe_shows.json

What changed:
- CIA (1992) is removed/excluded from the guide.
- FBI: CIA duplicate is excluded.
- CIA (2026) is kept as the only CIA entry and is matched by IMDb tt35515227.
- The updater now removes existing legacy rows whose show is CIA, CIA (1992), or FBI: CIA from episodes.js when you run the catalog update.
- The updater no longer falls back to the Trakt slug cia for the 2026 show, because that currently resolves to the unrelated 1992 series.

Run:
python wolf_universe_catalog_update.py --phase catalog --dry-run
python wolf_universe_catalog_update.py --phase catalog
python sync_trakt_and_excel.py

If Trakt does not yet expose CIA (2026) via IMDb tt35515227, it will be skipped until Trakt adds it, but the 1992 CIA show will not be re-added.
