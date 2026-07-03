Law & Order Watch Tracker - Trakt status root fix

What this fixes:
1. The sync script now creates law_order_tracker_app/data/trakt_sync_debug.json every run.
2. It commits that debug file in GitHub Actions.
3. It uses more robust Trakt matching for show slugs/titles, including variants like law-order vs law-and-order and Law and Order vs Law & Order.
4. It writes version 6 watched_status.json with source/trakt summary counters.

After pushing this package:
1. Go to GitHub > Actions > Trakt status sync > Run workflow.
2. When it finishes, open law_order_tracker_app/data/trakt_sync_debug.json in GitHub.
3. Check these fields:
   - account.username: confirms which Trakt account the token belongs to.
   - traktWatchedShowCount: how many watched shows Trakt returned.
   - candidateShowsSeen: Law/Order-related watched shows detected from Trakt.
   - matchedShows: counts matched to each guide show.
   - workbookRowsMarkedWatched: number of guide rows marked watched.

If workbookRowsMarkedWatched is still 0:
- If traktWatchedShowCount is 0: the TRAKT_TOKEN_JSON secret is for a Trakt account with no watched history, or your watched items are not marked as watched on Trakt.
- If candidateShowsSeen is empty: Trakt did not return watched Law & Order-universe shows for that account.
- If candidateShowsSeen has shows but matchedShows is 0: send the debug JSON; it will show the exact Trakt titles/slugs to add.
