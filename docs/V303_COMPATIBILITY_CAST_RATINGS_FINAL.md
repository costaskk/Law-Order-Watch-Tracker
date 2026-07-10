# Wolf Universe v3.0.3 compatibility-safe cast and ratings update

This update was rebuilt directly on the supplied production versions of:

- `law_order_tracker_app/app.js`
- `law_order_tracker_app/styles.css`

## Changes

- Removes the browser-native actor tooltip that could overlap card text.
- Converts cast cards to a responsive grid with safe text wrapping and line clamping.
- Keeps actor portrait hover and actor episode filtering intact.
- Adds compact, provider-branded rating badges to the bottom-right of episode artwork.
- Adds the same branded rating treatment to the Next Episode hero and episode-detail modal.
- Supports IMDb, Rotten Tomatoes, Metacritic, Trakt, TMDB, and TVDB.
- Adds dialog/list accessibility metadata and clear actor-card labels.
- Adds light-theme and narrow-screen styling.
- Limits artwork overlays on very small screens so ratings do not cover the image.

## Installation

Copy the two files over the matching project paths, run `npm test`, commit, and deploy.

No Supabase migration or Vercel environment-variable change is required.
