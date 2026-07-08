# Auto-sync, scroll preservation, and CIA cleanup fix

## What changed

- Auto-sync is now hourly instead of frequent polling.
- Auto-sync no longer runs immediately when the page loads or when the checkbox initializes.
- Background sync is quiet: no modal, no success toast, and no full page reload.
- Status imports only re-render the episode list when something actually changed.
- `/api/sync/trakt/` is called with the trailing slash to avoid Vercel's 308 redirect.
- The unrelated 1992 `CIA` rows were removed from `data/episodes.js`.
- The 2026 Dick Wolf / FBI-connected `CIA (2026)` entries remain.

## Why this fixes scrolling

The previous setup could refresh status repeatedly in the background and call a full render while you were browsing/searching. The new setup preserves scroll and avoids rendering if the background response has no new progress.

## Files changed

- `law_order_tracker_app/app.js`
- `law_order_tracker_app/data/episodes.js`
- `docs/AUTO_SYNC_SCROLL_CIA_FIX.md`
