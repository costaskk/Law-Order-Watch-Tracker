# v3.0.1 Trakt guide-bundle recovery

This patch fixes a serverless deployment issue where API functions could not reliably read
`law_order_tracker_app/data/episodes.js` through `fs`. When Vercel omitted that dynamically-read
file from a function bundle, `/api/me/status` could return thousands of raw Trakt keys while
reporting `watched_count: 0` and `matched: 0`.

## Changes

- Adds `api/_guide_index.js`, a generated minimal server-side guide with all 3,905 rows.
- Statically imports the guide so Vercel always bundles it with every API function.
- Refuses to overwrite cloud progress when the guide bundle is missing/incomplete.
- Refuses to overwrite progress when Trakt returns items but matching yields zero.
- Preserves the final retry diagnostics instead of replacing them with an empty debug object.
- Fixes status normalization so a missing exact ID no longer masks a valid normalized show/season/episode key.
- Filters whole-account Trakt keys down to Wolf Universe guide keys.
- Adds `guide_count` to `/api/me/status` for deployment verification.

## Expected verification

The normal `python wolf_build_web_data.py` command now regenerates the server API guide too.

After deployment, `/api/me/status` must include:

```json
"guide_count": 3905
```

Reconnect is not normally required. Press **Sync with Trakt** once. A healthy response should
show non-zero `watched_count` and `matched` values for a Trakt account that has watched guide episodes.
