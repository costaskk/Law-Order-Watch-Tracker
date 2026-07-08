# Wolf Universe v2.2 UI / Trakt Fix

Changes:
- Restores and exposes `loadTraktUser()` so Trakt login/status loads on first page load.
- Moves the Trakt account controls into a compact top-right dropdown.
- Loads the avatar with the page and keeps Profile/Statistics as separate views.
- Removes the automatic refresh card, tip card, and duplicate lower show-list card.
- Keeps hourly auto-sync as a toggle inside the account dropdown.
- Rebuilds the hero/stats section so the stats card sits beside the Up Next episode and uses the unused vertical space.
- Adds current-view count and progress details.
- Prevents sync calls from hitting the non-slash Vercel route redirect by using `/api/sync/trakt/`.
- Simplifies episode status controls to Unwatched / Watching / Watched.

Updated files:
- law_order_tracker_app/index.html
- law_order_tracker_app/app.js
- law_order_tracker_app/styles.css
