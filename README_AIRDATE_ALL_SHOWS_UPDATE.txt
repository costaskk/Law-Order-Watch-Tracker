Air-date updater for all shows
================================

This package includes an upgraded `update_episode_airdates_from_trakt.py`.

It checks every show in `law_order_tracker_app/data/episodes.js` against Trakt and updates air dates only when they differ.

Run from the repo root:

    python update_episode_airdates_from_trakt.py --dry-run

Review the output files:

    law_order_tracker_app/data/airdate_update_debug.json
    law_order_tracker_app/data/airdate_update_changes.csv

If the dry run looks correct, apply it:

    python update_episode_airdates_from_trakt.py

Then commit and push:

    git add update_episode_airdates_from_trakt.py law_order_tracker_app/data/episodes.js law_order_tracker_app/data/airdate_update_debug.json law_order_tracker_app/data/airdate_update_changes.csv README_AIRDATE_ALL_SHOWS_UPDATE.txt
    git commit -m "Update all episode air dates from Trakt"
    git pull --rebase origin main
    git push

Notes:
- Episode IDs are not changed, so watched status remains intact.
- The guide order is recalculated chronologically after date updates.
- Use `--no-reorder` if you want to change dates only.
- Use `--show "Law & Order"` to update one show only.
