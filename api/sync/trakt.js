import {
  getSessionUser,
  refreshTraktTokenIfNeeded,
  traktFetch,
  buildWatchedStatusesFromTrakt,
  supabaseFetch
} from '../_wolf_auth.js';

async function saveWatchStatus(userId, statuses, now) {
  try {
    return await supabaseFetch('/watch_status?on_conflict=user_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify({ user_id: userId, status: statuses, updated_at: now })
    });
  } catch (err) {
    const message = String(err?.message || err || '');
    if (message.includes('watch_status_user_id_fkey') || message.includes('foreign key constraint')) {
      throw new Error(
        'Supabase schema mismatch: watch_status.user_id is still linked to an old table. ' +
        'Run sql/FIX_WATCH_STATUS_FOREIGN_KEY.sql in Supabase, then try Sync again. Original error: ' + message
      );
    }
    throw err;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    let user = await getSessionUser(req);
    if (!user?.id) return res.status(401).json({ ok: false, error: 'Not logged in with Trakt' });

    user = await refreshTraktTokenIfNeeded(user);

    const watched = await traktFetch('/sync/watched/shows?extended=full', user.trakt_access_token);
    const statuses = buildWatchedStatusesFromTrakt(watched);
    const now = new Date().toISOString();

    await saveWatchStatus(user.id, statuses, now);

    return res.status(200).json({
      ok: true,
      username: user.trakt_username,
      user_id: user.id,
      updated_at: now,
      watched_keys: Object.keys(statuses).length,
      statuses
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
