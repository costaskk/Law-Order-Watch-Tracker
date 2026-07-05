CIA 2026-only fix

Replace these files in your project root:
- wolf_universe_catalog_update.py
- wolf_universe_shows.json

Optional UI patch file is included if you need to reapply the Wolf scope/hover UI:
- apply_wolf_ui_complete_patch.py

What changed:
- Removed the unrelated 1992 CIA show from the import list.
- Removed the raw Trakt slug `cia`, which points to the 1992 show.
- Kept only `CIA (2026)` with IMDb ID tt35515227.
- Added cleanup rules that delete any old rows already imported from the 1992 CIA show, including rows with:
  - show = CIA
  - show = CIA (1992)
  - show = FBI: CIA
  - traktSlug = cia
  - IMDb ID = tt0250140
- Prevented older custom config from re-adding CIA (1992).

Run:
python wolf_universe_catalog_update.py --phase catalog --dry-run
python wolf_universe_catalog_update.py --phase catalog
python wolf_universe_catalog_update.py --phase artwork
python sync_trakt_and_excel.py

If you want episode stills:
python wolf_universe_catalog_update.py --phase episode-artwork --episode-artwork-limit 300

After the catalog run, the dry-run/proper run should print something like:
Removing excluded legacy/1992 CIA rows: ...

CIA (2026) may be skipped until Trakt has a dedicated entry for IMDb tt35515227. That is correct; the updater will not import the unrelated 1992 show as a substitute.
