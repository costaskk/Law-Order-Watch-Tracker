# Wolf Universe v2.5.1 — Hero restore and episode modal speed fix

This patch restores the v2.4.1 compact Up Next / progress grid overrides that were accidentally dropped by the v2.5 actor interaction update.

It also speeds up episode details by caching episode cast lookups, actor cast keys, and actor credit scans, so opening an episode modal no longer recalculates cast data across the whole guide for every actor card.

Updated files:
- `law_order_tracker_app/app.js`
- `law_order_tracker_app/styles.css`
