Local status persistence fix
============================

This version saves user status changes in two places:

1. localStorage (primary, supports the full library)
2. chunked first-party cookies (backup/fallback)

It also protects browser-made changes from being overwritten by hosted Trakt sync files. If Trakt/hosted sync says an episode is Not Started, but you manually marked it Watched/Watching/Skipped in the site, the app keeps your local browser change.

Push instructions:

git add .
git commit -m "Persist website watch status locally"
git pull --rebase origin main
git push

After Vercel redeploys, hard refresh the site once with Ctrl+F5.
