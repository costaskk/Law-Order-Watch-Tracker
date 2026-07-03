IN-WEBSITE TRAKT SYNC SETUP (VERCEL)
====================================

This package adds a real "Sync with Trakt" button inside the website.

How it works:
1. The website calls /api/trigger-sync on Vercel.
2. The Vercel serverless API securely triggers your GitHub Actions workflow: .github/workflows/trakt-sync.yml
3. GitHub Actions updates law_order_tracker_app/data/watched_status.json and commits it.
4. Vercel redeploys automatically.
5. The website can then pull the updated watched status.

IMPORTANT: This cannot be done securely in a fully static page without a backend, because your GitHub/Trakt secrets must not be exposed in app.js or index.html. This Vercel API route is the safe way.

VERCEL ENVIRONMENT VARIABLES
----------------------------
Go to:
Vercel project -> Settings -> Environment Variables

Add these:

GITHUB_PAT
  A GitHub Personal Access Token that can dispatch workflows.
  Fine-grained token recommended:
  - Repository access: costaskk/Law-Order-Watch-Tracker only
  - Permissions: Actions = Read and write, Contents = Read-only

GITHUB_REPO
  costaskk/Law-Order-Watch-Tracker

GITHUB_WORKFLOW
  trakt-sync.yml

GITHUB_BRANCH
  main

Then click Redeploy in Vercel.

HOW TO CREATE GITHUB_PAT
------------------------
GitHub -> Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens -> Generate new token

Repository access:
Only select: costaskk/Law-Order-Watch-Tracker

Repository permissions:
Actions: Read and write
Contents: Read-only
Metadata: Read-only (automatic)

Generate token, copy it, add it to Vercel as GITHUB_PAT.

HOW TO USE
----------
Open your Vercel site and click:
Sync with Trakt

You should get a confirmation modal. After confirming, the site starts the GitHub Actions workflow.
Wait 1-3 minutes, then click:
Pull latest

The automatic 5-minute scan will also pull the updated watched_status.json.
