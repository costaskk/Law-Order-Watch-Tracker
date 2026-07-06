import { getSessionUser, refreshTraktTokenIfNeeded, buildWatchedStatusesForGuide, supabaseFetch } from '../_wolf_auth.js';

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function countWatched(statuses) {
  if (!statuses || typeof statuses !== 'object') return 0;
  return Object.values(statuses).filter(value => String(value).toLowerCase() === 'watched').length;
}

async function readLatestWatchStatus(userId) {
  const rows = await supabaseFetch(
    `/watch_status?user_id=eq.${encodeURIComponent(userId)}&select=status,updated_at&order=updated_at.desc&limit=1`,
    { method: 'GET' }
  );
  return Array.isArray(rows) ? rows[0] : null;
}

export default async function handler(req, res) {
  noStore(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    let user = await getSessionUser(req);
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Not logged in with Trakt' });
    }

    user = await refreshTraktTokenIfNeeded(user);

    const built = await buildWatchedStatusesForGuide(user.trakt_access_token);
    const statuses = built?.statuses && typeof built.statuses === 'object' ? built.statuses : {};
    const now = new Date().toISOString();
    const watchedKeys = Object.keys(statuses).length;

    /*
      Important:
      We intentionally replace this user's single watch_status row instead of relying
      on an upsert that may leave older duplicate rows behind if the DB was created
      before the unique user_id constraint/fix existed.

      This fixes the "sync works only after pressing twice" symptom:
      - first press used to write a fresh row
      - /api/me/status could still read an older/empty duplicate row
      - second press appeared to work after the browser/server state caught up
    */
    await supabaseFetch(`/watch_status?user_id=eq.${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
      prefer: 'return=minimal'
    });

    const insertedRows = await supabaseFetch('/watch_status', {
      method: 'POST',
      prefer: 'return=representation',
      body: JSON.stringify({
        user_id: user.id,
        status: statuses,
        updated_at: now
      })
    });

    const inserted = Array.isArray(insertedRows) ? insertedRows[0] : insertedRows;
    const savedRow = inserted?.status ? inserted : await readLatestWatchStatus(user.id);
    const savedStatuses = savedRow?.status && typeof savedRow.status === 'object' ? savedRow.status : statuses;
    const savedUpdatedAt = savedRow?.updated_at || now;

    return res.status(200).json({
      ok: true,
      authenticated: true,
      username: user.trakt_username,
      updated_at: savedUpdatedAt,
      watched_keys: Object.keys(savedStatuses).length,
      watched_count: countWatched(savedStatuses),
      matched: built?.matched || built?.guide_matches || built?.debug?.watchedShows?.guideMatches || built?.debug?.history?.guideMatches || 0,
      statuses: savedStatuses,
      debug: {
        ...(built?.debug || {}),
        wrote_watch_status_row: true,
        returned_from: savedRow?.status ? 'supabase_saved_row' : 'built_statuses_fallback'
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
