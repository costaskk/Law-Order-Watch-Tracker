Trakt catalog updater upgrade
=============================

This package replaces update_episode_airdates_from_trakt.py with a stronger all-catalog updater.

It can:
- check every configured show in the guide;
- update wrong air dates;
- update episode titles from Trakt;
- add episodes that exist on Trakt but are missing from your website guide;
- include season 0 specials and mark them as specials;
- save Trakt artwork/image fields when the API returns them;
- write a full report of every change.

Test first:

  python update_episode_airdates_from_trakt.py --dry-run

This creates:

  law_order_tracker_app/data/airdate_update_debug.json
  law_order_tracker_app/data/airdate_update_changes.csv
  law_order_tracker_app/data/trakt_artwork_metadata.json

Apply changes:

  python update_episode_airdates_from_trakt.py

Then commit/push:

  git add update_episode_airdates_from_trakt.py law_order_tracker_app/data/episodes.js law_order_tracker_app/data/airdate_update_debug.json law_order_tracker_app/data/airdate_update_changes.csv law_order_tracker_app/data/trakt_artwork_metadata.json
  git commit -m "Update guide catalog from Trakt"
  git pull --rebase origin main
  git push

Useful options:

  python update_episode_airdates_from_trakt.py --dry-run --show "Law & Order"
  python update_episode_airdates_from_trakt.py --no-specials
  python update_episode_airdates_from_trakt.py --no-add-missing
  python update_episode_airdates_from_trakt.py --no-title-update
  python update_episode_airdates_from_trakt.py --no-image-update

Important notes:
- Existing IDs and watched statuses are preserved.
- New rows get stable Trakt-generated IDs.
- Season 0 episodes are marked with isSpecial=true and episodeType="Special".
- Trakt often returns first_aired as UTC. The script converts dates to the show's local airing timezone when available, so it should avoid the one-day-off issue you saw.
- Trakt may not return real image URLs for every item. The script writes any image URLs it receives to episode rows and to trakt_artwork_metadata.json.
