# Professional Trakt auth, profile, ratings, and next-episode upgrade

## What changed

- Trakt login remains application-wide and works for any Trakt account. The Client ID/Secret identify the app, not your personal user.
- Trakt access/refresh tokens are now stored encrypted using AES-256-GCM before saving to Supabase. Existing plain tokens still read correctly and are re-encrypted on reconnect/refresh.
- Added profile endpoint: `/api/me/profile`.
- Added Trakt disconnect/revoke endpoint: `/api/auth/trakt/revoke`.
- The app now shows Profile and Disconnect buttons when logged in.
- The top Next Episode hero is clickable and opens the same professional episode modal as list cards.
- The top Next Episode card now shows the episode summary instead of only short notes when summary exists.
- Episode cards, modals, and the hero support IMDb / Rotten Tomatoes / Metacritic / Trakt / TMDB / TVDB ratings when ratings metadata exists.
- Added `wolf_fetch_episode_ratings.py` to enrich `episodes.js` from OMDb and Trakt.

## Required environment variables

Keep your existing values and optionally add:

```text
TOKEN_ENCRYPTION_SECRET=optional_long_random_secret
OMDB_API_KEY=optional_for_imdb_rotten_tomatoes_metacritic_enrichment
TRAKT_USER_AGENT=Wolf-Universe-Watch-Tracker/1.0 (+https://law-and-order-watch-tracker1.vercel.app)
```

If `TOKEN_ENCRYPTION_SECRET` is not set, the app uses `SESSION_SECRET` for token encryption.

## Ratings enrichment

The app UI supports ratings immediately, but `episodes.js` needs ratings data.

Run:

```powershell
$env:OMDB_API_KEY="your_omdb_key"
$env:TRAKT_CLIENT_ID="your_trakt_client_id"
python wolf_fetch_episode_ratings.py --limit 200 --write
```

Use `--limit 0 --write` to process all episodes. OMDb free limits may apply, so batching is safer.

## Files added/updated

- `api/_wolf_auth.js`
- `api/auth/trakt/callback.js`
- `api/auth/trakt/revoke.js`
- `api/me/profile.js`
- `law_order_tracker_app/app.js`
- `law_order_tracker_app/styles.css`
- `wolf_fetch_episode_ratings.py`
