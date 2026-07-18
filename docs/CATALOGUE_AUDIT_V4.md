# Catalogue and chronology audit — v4

Audited: 18 July 2026

## Result

The canonical guide contains 3,571 entries across 46 titles. Every title in the supplied IMDb “Dick Wolf Cinematic Universe” list and every connected title in the supplied Wolf Universe article is represented.

The guide now contains 91 episode-role annotations: 77 are curated crossover, backdoor-pilot, character-bridge, continuation, or unaired annotations; 14 additional multi-episode installments are conservatively inferred from Roman-numeral part labels in their canonical episode titles.

## Corrected same-title collisions

| Tracker title | Incorrect match removed | Correct entry retained |
|---|---|---|
| Blood & Money | 1981 six-episode drama, IMDb `tt0081833` | 2023 Dick Wolf true-crime series, 10 episodes, IMDb `tt26746481` |
| South Beach | 2006 UPN drama, IMDb `tt0460677` | 1993 Dick Wolf/Bob DeLaurentis NBC drama, seven produced episodes, IMDb `tt0106141` |
| The Invisible Man | Unrelated 2000 series, IMDb `tt0220238` | 1998 Dick Wolf-produced TV movie/unaired pilot, IMDb `tt0275427` |
| Dragnet | Unrelated 1951 series | Removed; the correct 2003 **L.A. Dragnet** revival remains |
| Exiled: A Law & Order Movie | Five duplicate rows plus unrelated IMDb `tt0169421` | One canonical 84-minute movie entry, IMDb `tt0164023` |
| Homicide: The Movie | Thirteen duplicate rows from the old updater | One canonical movie entry, IMDb `tt0226771` |

The catalogue updater was also repaired so every movie is keyed as one canonical item. Re-running it can no longer allocate a new season-zero number and duplicate the movie.

## Supplied-source coverage

- IMDb list: <https://www.imdb.com/list/ls563325462/>
- Wolf Universe: <https://one-chicago-fbi.fandom.com/wiki/Wolf_Universe>
- Crossovers and milestones: <https://one-chicago-fbi.fandom.com/wiki/Crossovers_and_Milestones>

Supporting title checks:

- Blood & Money episode catalogue: <https://www.oxygen.com/blood-money/season-1/episode-5/high-society-schemers>
- South Beach episode catalogue: <https://www.tvguide.com/tvshows/south-beach/episodes-season-1/1030084708/>
- The Invisible Man production report: <https://variety.com/1998/voices/columns/wolf-s-disappearing-act-two-hour-sein-off-1117467116/>
- Exiled: A Law & Order Movie: <https://www.imdb.com/title/tt0164023/>
- Homicide: The Movie: <https://www.imdb.com/title/tt0226771/>

## Reproducibility

Apply the deterministic corrections and rebuild browser/API data:

```powershell
python scripts/apply_v4_catalog_and_roles.py
python wolf_build_web_data.py
npm test
```

The generated `law_order_tracker_app/data/v4_catalog_audit.json` records row counts, role counts, exclusions, and supplied-source coverage. `scripts/audit_project.py` fails if any known false match returns, a supplied-source title disappears, movie duplicates recur, or the curated role count falls below the verified baseline.
