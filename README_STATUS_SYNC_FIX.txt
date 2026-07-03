STATUS SYNC FIX

This package fixes the Trakt -> JSON -> website matching pipeline.

What changed:
1. sync_trakt_and_excel.py now writes watched_status.json with ONLY watched episodes.
2. Matching is done by Show + Season + Episode, with aliases for SVU, Criminal Intent, Trial by Jury, True Crime, Toronto, NY Undercover, and In Plain Sight.
3. It uses both Trakt endpoints:
   - /sync/watched/shows
   - /sync/history/shows
4. It writes a debug file:
   law_order_tracker_app/data/trakt_sync_debug.json

After pushing, run GitHub Actions again. Then check:
- law_order_tracker_app/data/watched_status.json should have "source": "trakt" and a non-empty "episodes" array if Trakt has watched Law & Order universe episodes.
- law_order_tracker_app/data/trakt_sync_debug.json will show exactly what Trakt matched.

If it still says 0 watched, open trakt_sync_debug.json. If finalCounts is empty, the Trakt account/token being used by GitHub does not have watched history for those shows, or it is the wrong Trakt account token.
