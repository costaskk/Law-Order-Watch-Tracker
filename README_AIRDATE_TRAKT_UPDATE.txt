Air-date update fix

This package fixes Law & Order season 1 air dates, including S01E09 Indifference = 1990-11-27, and adds update_episode_airdates_from_trakt.py.

Run from the repo root:
  python update_episode_airdates_from_trakt.py --dry-run
  python update_episode_airdates_from_trakt.py

Then:
  git add law_order_tracker_app/data/episodes.js update_episode_airdates_from_trakt.py law_order_tracker_app/data/airdate_update_debug.json README_AIRDATE_TRAKT_UPDATE.txt
  git commit -m "Update episode air dates from Trakt"
  git pull --rebase origin main
  git push

Optional GitHub Actions step, before sync_trakt_and_excel.py:
  python update_episode_airdates_from_trakt.py
