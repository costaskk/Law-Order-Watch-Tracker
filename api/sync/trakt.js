import { getSessionUser, refreshTraktTokenIfNeeded, traktFetch, buildWatchedStatusPayloadWithHistory, supabaseFetch } from '../_wolf_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    let user = await getSessionUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Not logged in with Trakt' });
    user = await refreshTraktTokenIfNeeded(user);
    const watched = await traktFetch('/sync/watched/shows?extended=full', user.trakt_access_token);
    const statuses = buildWatchedStatusPayloadWithHistory(watched);
    const now = new Date().toISOString();
    await supabaseFetch('/watch_status?on_conflict=user_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify({ user_id: user.id, status: statuses, updated_at: now })
    });
    return res.status(200).json({
      ok: true,
      username: user.trakt_username,
      updated_at: now,
      watched_keys: Object.keys(statuses).length,
      matched_guide_rows: payload.matched_guide_rows || 0,
      trakt_watched_episodes: payload.trakt_watched_episodes || 0,
      guide_catalog_rows: payload.guide_catalog_rows || 0,
      used_history_fallback: Boolean(payload.used_history_fallback),
      history_items_checked: payload.history_items_checked || 0,
      history_matched_rows: payload.history_matched_rows || 0,
      statuses,
      episodes: payload.episodes || []
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
