Replace your existing update_episode_airdates_from_trakt.py with this file.

What changed:
- Adds missing Trakt episodes and specials as before.
- Updates titles, IDs, overviews, and artwork metadata as before.
- Prevents mass +/-1 day air-date changes caused by UTC/local timezone conversion.
- Reports those skipped changes as airDate_one_day_shift_ignored in CSV/JSON.
- Still applies real date corrections, such as Law & Order S01E09 Indifference.

Test:
  python update_episode_airdates_from_trakt.py --dry-run

Apply:
  python update_episode_airdates_from_trakt.py

Optional, not recommended unless you really want to apply every +/-1 day change:
  python update_episode_airdates_from_trakt.py --force-one-day-date-shifts
