# v2.2.1 Trakt avatar fix

Fixes:
- Trakt fallback initial no longer appears next to the real avatar.
- Trakt avatar is fetched silently on page load after the session/status check.
- Opening the Profile popup updates the same account avatar instead of creating a second icon.
- Failed avatar URLs fall back cleanly to the username initial.

Updated files:
- law_order_tracker_app/app.js
- law_order_tracker_app/styles.css
