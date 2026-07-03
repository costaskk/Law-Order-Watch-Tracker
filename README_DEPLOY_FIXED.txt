LAW & ORDER WATCH TRACKER - FIXED DEPLOY PACKAGE

This cleaned package removes the private token files and adds a root index.html, so Vercel/GitHub Pages will not show 404 at the root URL.

IMPORTANT ABOUT THE NODE.JS 20 MESSAGE
The message about Node.js 20 being deprecated is only a GitHub Actions warning. It is not the real deployment error. If a workflow fails, expand the red failed step and read the command output above the warning.

FIRST-TIME PUSH TO YOUR GITHUB REPO
1. Extract this zip.
2. Open PowerShell inside the extracted Law_Order_Watch_Tracker_DEPLOY_FIXED folder.
3. Run:

git init
git branch -M main
git remote add origin https://github.com/costaskk/Law-Order-Watch-Tracker.git
git add .
git commit -m "Initial fixed deploy package"
git push -u origin main --force

Use --force only if the repo currently contains the broken/test version and you want to replace it.

GITHUB SETTINGS REQUIRED FOR TRAKT AUTO-SYNC
Repo > Settings > Actions > General:
- Actions permissions: Allow all actions and reusable workflows
- Workflow permissions: Read and write permissions

Repo > Settings > Secrets and variables > Actions > Repository secrets:
- TRAKT_CLIENT_ID
- TRAKT_CLIENT_SECRET
- TRAKT_TOKEN_JSON

TRAKT_TOKEN_JSON must be the full JSON contents of your local trakt_token.json.

RUN WORKFLOW
Repo > Actions > Trakt status sync > Run workflow > main > Run workflow.

VERCEL SETTINGS
Vercel > Add New Project > Import GitHub repo.
Use:
- Framework Preset: Other
- Root Directory: ./
- Build Command: leave empty
- Output Directory: leave empty OR .
- Install Command: leave empty

Do NOT set Output Directory to law_order_tracker_app for this fixed package unless you want the root redirect ignored. The root index.html now redirects to the app.

APP URLS
Vercel root: https://your-project.vercel.app/
Direct app: https://your-project.vercel.app/law_order_tracker_app/
GitHub Pages: https://costaskk.github.io/Law-Order-Watch-Tracker/law_order_tracker_app/
