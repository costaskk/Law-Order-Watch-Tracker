# Trakt list creator

Trakt calls playlists **lists**. Version 4 can create one from user-selected Wolf Universe titles and save it directly to the Trakt account connected through the existing OAuth flow.

## User workflow

1. Log in with Trakt.
2. Select **Create Trakt list**.
3. Choose a name, description, privacy, and titles.
4. Choose one of two modes:
   - **Shows & movies** — one item per selected title; recommended and compact.
   - **Chronological episodes** — every matched episode in guide order, with separate options for season-zero specials and scheduled/unaired entries.
5. Select **Create on Trakt** and open the returned list link.

The picker defaults to the active guide scope. It also supports selecting all titles, clearing the selection, and filtering the title list.

## Server-side safety

`POST /api/lists/trakt` performs all mutations server-side. The browser sends title names and preferences—not arbitrary Trakt IDs or access tokens. The endpoint:

- requires the signed application session;
- enforces same-origin mutation checks;
- refreshes expired OAuth tokens;
- resolves IDs only from the bundled canonical guide;
- validates list name, description, privacy, mode, and selection size;
- checks the account's reported list-item limit when available;
- excludes scheduled/unaired entries from episode lists unless the user explicitly includes them;
- adds items in bounded chunks and verifies Trakt's added/existing/not-found response; and
- deletes the newly created partial list if insertion fails or Trakt accepts fewer items than requested.

No additional client-side secret or database table is required. The existing Trakt and Supabase environment variables documented in `DEPLOYMENT.md` remain authoritative.
