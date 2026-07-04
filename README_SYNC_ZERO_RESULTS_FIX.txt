# Sync zero-results fix

This update changes Trakt sync so it no longer wipes your existing website progress when Trakt returns 0 watched episodes for Law & Order.

What changed:
- `sync_trakt_and_excel.py` now merges Trakt watched episodes with existing `watched_status.json` instead of replacing everything with Not Started.
- Added `--import-status path/to/law_order_watch_status.json` so you can restore an exported website status file.
- Added `law_order_tracker_app/data/trakt_sync_debug.json` so you can see exactly what Trakt returned and how many rows were marked.
- Added missing show aliases: `Law & Order: SVU`, `Criminal Intent`, `Trial by Jury`, `True Crime`, `NY Undercover`, `Law & Order Toronto: Criminal Intent`, etc.

## Restore your old exported status once

Copy your exported `law_order_watch_status.json` into the project folder, then run:

```powershell
python sync_trakt_and_excel.py --import-status law_order_watch_status.json

git add law_order_tracker_app/data/watched_status.json law_order_watch_status_from_trakt.json law_order_tracker_app/data/trakt_sync_debug.json Law_Order_Professional_Watch_Tracker_Trakt_Synced.xlsx

git commit -m "Restore watched status and fix Trakt merge sync"

git pull --rebase origin main

git push
```

After that, normal GitHub/Vercel sync can keep running.

## Important

The debug you shared showed Trakt returned the Law & Order and SVU shows but 0 watched episodes for them. That means Trakt itself currently is not reporting those Law & Order episodes as watched for the token/account being used. This fix preserves your local/app watched statuses instead of letting Trakt zero them out.
