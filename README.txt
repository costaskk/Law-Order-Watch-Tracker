LAW & ORDER PROFESSIONAL WATCH TRACKER
=====================================

Included files
--------------
1. Law_Order_Professional_Watch_Tracker.xlsx
   Professional Excel tracker with:
   - Chronological Guide
   - Tracker Dashboard
   - Tracker Control
   - Mobile View
   - Season Manager
   - Trakt Sync instructions
   - Web App Guide

2. law_order_tracker_app/index.html
   Mobile-friendly offline web app:
   - Hide watched automatically
   - Next episode card
   - Search/filter
   - One-tap mark watched/watching/skipped
   - Mark full season watched/unwatched
   - Mark full show watched
   - Export/import status JSON

3. sync_trakt_and_excel.py
   Pulls watched history from your Trakt account into the Excel workbook.
   It also exports law_order_watch_status_from_trakt.json for the web app.

4. apply_bulk_actions_to_excel.py
   Applies Season Manager bulk actions from Excel into the Chronological Guide.

Recommended phone workflow
--------------------------
- Unzip this package on your PC or phone.
- Open law_order_tracker_app/index.html in Chrome/Edge/Safari.
- Use "Hide watched" and "Mark next watched" while watching.
- Use Export Status JSON regularly as backup.

Recommended Excel workflow
--------------------------
- Open Law_Order_Professional_Watch_Tracker.xlsx.
- Use Tracker Control > Viewing mode:
  Show All / Only Unwatched / Only Watched.
- Use Mobile View on Excel mobile.
- Edit statuses directly in Chronological Guide when needed.

Trakt setup
-----------
1. Install dependencies:
   pip install requests openpyxl

2. Copy:
   trakt_config.example.json
   to:
   trakt_config.json

3. Add your Trakt client_id and client_secret.

4. Run:
   python sync_trakt_and_excel.py

5. The script creates:
   Law_Order_Professional_Watch_Tracker_Trakt_Synced.xlsx
   law_order_watch_status_from_trakt.json

6. In the web app, import law_order_watch_status_from_trakt.json.

Bulk season marking from Excel
------------------------------
1. Open the workbook.
2. Go to Season Manager.
3. Set Bulk Action for seasons you want:
   Mark Watched / Mark Unwatched / Mark Skipped.
4. Save and close Excel.
5. Run:
   python apply_bulk_actions_to_excel.py

Notes
-----
- No VBA/macros are used, so this remains safer and more mobile-compatible.
- Excel's automatic filtered Mobile View requires Excel 365 / modern Excel mobile dynamic array support.
- The web app is the best mobile experience because it is built for touch screens.
