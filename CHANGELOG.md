# Changelog

## 3.0.0 — Professional architecture release

### Authentication and sync
- Made Trakt OAuth fully multi-user; the client ID/secret identify the app, while every account receives its own encrypted tokens.
- Added cached Trakt profile/avatar loading during page startup.
- Added disconnect/revoke and logout flows.
- Added encrypted Trakt token storage and hashed session identifiers.
- Added same-origin validation to state-changing APIs.
- Rebuilt Trakt sync to return the final authoritative status payload in one request.
- Added an empty-response guard so a temporary Trakt failure cannot erase Supabase progress.
- Added personal manual-state persistence in a separate Supabase layer.
- Changed automatic sync to an hourly, visibility-aware background check.
- Disabled debug and GitHub-trigger endpoints unless explicitly enabled.

### Catalog and metadata
- Standardized the complete 3,905-entry guide across 47 shows.
- Corrected Adjacent/Archive scope behavior.
- Removed the unrelated 1992 CIA series; retained CIA (2026).
- Assigned crossover-relevant scope to both TV-movie entries.
- Added local artwork fallbacks for Exiled and Homicide: The Movie.
- Enriched 2,845 episodes with available TMDB ratings.
- Added support for IMDb, Rotten Tomatoes, Metacritic, TMDB, and Trakt episode ratings when available.
- Modernized the optional shared status snapshot to scan the full guide instead of the old 1,796-row workbook.

### Performance and interface
- Replaced blocking 12 MB cast JavaScript with a compact, lazy-loaded JSON index.
- Split episode artwork into a lazy-loaded JSON resource.
- Loads the base guide first and defers heavy cast/artwork data.
- Opens episode modals immediately and fills cast/artwork asynchronously.
- Preserves scroll position during filter and background status updates.
- Added debounced search and targeted asynchronous rendering.
- Added a responsive account dropdown, actor interactions, ratings, summaries, and filtered Up Next behavior.
- Removed duplicate scope/show lists and obsolete refresh cards.
- Added a PWA manifest, icons, service worker, and offline app shell.

### Maintenance
- Added canonical fresh-install and migration SQL.
- Added project audit, JavaScript validation, optimized-data build, and secret-free release scripts.
- Consolidated deployment documentation and removed reliance on historic patch instructions.
