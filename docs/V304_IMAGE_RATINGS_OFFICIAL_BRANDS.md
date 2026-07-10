# v3.0.4 — Artwork ratings and service brand logos

## Included changes

- Moved Next Episode ratings into the lower-right corner of the Next Episode artwork.
- Moved episode-detail modal ratings into the lower-right corner of the main episode artwork.
- Kept list-card ratings inside episode artwork.
- Replaced text-only provider monograms with recognizable service brand logo artwork for IMDb, Rotten Tomatoes, Metacritic, Trakt, TMDB and TheTVDB.
- Added resilient text fallbacks when a logo cannot be loaded.
- Added responsive limits so rating overlays do not cover important artwork on small screens.
- Bumped the application asset version and service-worker cache version to prevent stale CSS/JavaScript after deployment.
- Added local artwork fallbacks for `Exiled: A Law & Order Movie` and `Homicide: The Movie`.
- Removed the obsolete `CIA_1992.svg` asset.

## Files changed

- `law_order_tracker_app/app.js`
- `law_order_tracker_app/styles.css`
- `law_order_tracker_app/index.html`
- `law_order_tracker_app/service-worker.js`
- `law_order_tracker_app/data/wolf_artwork_base.js`
- deleted: `law_order_tracker_app/assets/CIA_1992.svg`

## Validation

`npm test` passes with 3,905 guide entries and 47 shows.

## Deployment note

The provider glyphs are loaded from the Simple Icons CDN over HTTPS. The existing Content Security Policy already permits HTTPS images. If a glyph cannot load, the compact provider abbreviation remains available as a fallback.
