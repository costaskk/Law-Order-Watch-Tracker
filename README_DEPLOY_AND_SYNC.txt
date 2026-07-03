LAW & ORDER PROFESSIONAL TRACKER — MOBILE / TRAKT / VERCEL SETUP

WHAT IS NEW IN THIS VERSION
1. Each show has its own color theme and generated artwork card.
2. The app auto-checks law_order_tracker_app/data/watched_status.json every 5 minutes.
3. The Trakt sync script now writes that watched_status.json file automatically.
4. New update_episode_catalog_from_trakt.py scans Trakt catalogs and appends missing/new episodes.
5. Added Vercel/GitHub deployment files and a GitHub Actions workflow for cloud syncing.
6. Better visibility: larger controls, clearer contrast, colored show stripes, progress bar, and mobile layout.

LOCAL USE ON WINDOWS
1. Extract this folder.
2. Copy trakt_config.example.json to trakt_config.json and add your Client ID and Client Secret.
3. Run:
   python sync_trakt_and_excel.py
4. For automatic scans while your PC is on:
   python sync_trakt_and_excel.py --loop --minutes 15
5. Open law_order_tracker_app/index.html in your browser. If the auto JSON fetch is blocked by file://, run a tiny local server:
   python -m http.server 8000 --directory law_order_tracker_app
   Then open http://localhost:8000

UPDATE MISSING / NEW EPISODES FROM TRAKT
Run:
   python update_episode_catalog_from_trakt.py
It creates:
   Law_Order_Professional_Watch_Tracker_Updated_Catalog.xlsx
   catalog_refresh_report.json
and updates:
   law_order_tracker_app/data/episodes.js
Then run the sync script again to mark watched status.

PHONE / MOBILE USE
Best option: deploy the app to Vercel and open it from your phone.
The app can be installed to your home screen from Chrome/Safari/Edge via Add to Home Screen.

GITHUB + VERCEL DEPLOYMENT
1. Create a new GitHub repository.
2. Upload the contents of this package folder to the repo.
3. Go to vercel.com → Add New Project → Import your GitHub repository.
4. Vercel should deploy the static app automatically.
5. Open the Vercel URL on your phone.

AUTOMATIC CLOUD TRAKT SYNC VIA GITHUB ACTIONS
This is optional. It lets GitHub update watched_status.json so your Vercel app sees your latest Trakt status automatically.
1. In GitHub, open your repo → Settings → Secrets and variables → Actions → New repository secret.
2. Add:
   TRAKT_CLIENT_ID = your Trakt Client ID
   TRAKT_CLIENT_SECRET = your Trakt Client Secret
   TRAKT_TOKEN_JSON = the full contents of trakt_token.json after you have authorized once locally
3. Open Actions → Trakt status sync → Run workflow.
4. The workflow also runs every 6 hours. Vercel redeploys after GitHub commits the updated JSON.

IMPORTANT SECURITY NOTE
Do not commit trakt_config.json or trakt_token.json publicly. They are in .gitignore. Use GitHub Secrets for automation.

IMPORTANT FIXED APP NOTES
=========================
If you open index.html directly with file://, the app itself works, but browser security blocks automatic fetching of data/watched_status.json.
For automatic sync/status refresh, use one of these:

LOCAL SERVER ON PC
1. Double-click start_local_app.bat
2. Open http://localhost:8080/law_order_tracker_app/
3. For phone use, open the IPv4 URL printed by the batch file while your phone is on the same Wi-Fi.

GITHUB/VERCEL
1. Upload the whole package to GitHub.
2. Deploy to Vercel.
3. The app can auto-refresh data/watched_status.json every 5 minutes.
4. The GitHub Actions workflow can regenerate watched_status.json from Trakt when configured with repository secrets.

This version fixes the JavaScript syntax error in app.js and adds safer rendering, mobile visibility improvements, a Load More button, clearer local-server guidance, and better empty/error states.
