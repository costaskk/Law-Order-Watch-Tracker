import { getSessionUser, refreshTraktTokenIfNeeded, buildWatchedStatusesForGuide, supabaseFetch } from '../_wolf_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    let user = await getSessionUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Not logged in with Trakt' });

    user = await refreshTraktTokenIfNeeded(user);
    const built = await buildWatchedStatusesForGuide(user.trakt_access_token);
    const statuses = built.statuses || {};
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
      statuses,
      debug: built.debug
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
