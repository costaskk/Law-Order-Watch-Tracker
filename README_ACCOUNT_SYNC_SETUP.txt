ACCOUNT-BASED WATCH STATUS SETUP
================================

This version saves manual status changes to a Supabase account instead of only localStorage/cookies.
It still keeps localStorage as a fallback for offline use.

1) Create a free Supabase project
---------------------------------
Go to https://supabase.com/dashboard -> New project.

2) Create the database table
----------------------------
In Supabase: SQL Editor -> New query.
Paste the contents of SUPABASE_SETUP.sql and click Run.

3) Enable email/password or magic-link login
-------------------------------------------
Supabase Dashboard -> Authentication -> Providers -> Email.
Enable Email provider.
For password login, allow email/password signups.
For magic links, email OTP also works.

4) Add your site URL
--------------------
Supabase Dashboard -> Authentication -> URL Configuration.
Add your Vercel URL, for example:
https://law-and-order-watch-tracker1.vercel.app

Also add your local development URL if needed:
http://localhost:8080

5) Add your public Supabase config
----------------------------------
Open:
law_order_tracker_app/data/account_config.js

Replace:
YOUR_SUPABASE_PROJECT_URL
YOUR_SUPABASE_ANON_PUBLIC_KEY

Get them from:
Supabase Dashboard -> Project Settings -> API

Use:
Project URL
anon public key

6) Push to GitHub / redeploy Vercel
-----------------------------------
git add .
git commit -m "Add account-based watch status sync"
git pull --rebase origin main
git push

7) How it works
---------------
- Sign in on the website.
- Manual changes save to Supabase automatically.
- Refreshing the page restores your account status.
- Opening on your phone and signing in loads the same status.
- When you trigger Trakt sync in the site, the app polls watched_status.json.
- Once the Trakt result is imported, it is also saved to your account automatically.

IMPORTANT
---------
The Supabase anon key is public by design. Security comes from Row Level Security in SUPABASE_SETUP.sql.
Do NOT put your Supabase service-role key in the website.
