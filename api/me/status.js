import { getSessionUser, supabaseFetch } from '../_wolf_auth.js';

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function countWatched(statuses) {
  if (!statuses || typeof statuses !== 'object') return 0;
  return Object.values(statuses).filter(value => String(value).toLowerCase() === 'watched').length;
}

export default async function handler(req, res) {
  noStore(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) {
      return res.status(200).json({ ok: true, authenticated: false, statuses: {} });
    }

    /*
      Always return the newest row. Older versions of the app could create duplicate
      watch_status rows, so selecting without order/limit could return an outdated
      empty row and make the UI look like it needed a second sync press.
    */
    const rows = await supabaseFetch(
      `/watch_status?user_id=eq.${encodeURIComponent(user.id)}&select=status,updated_at&order=updated_at.desc&limit=1`,
      { method: 'GET' }
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const statuses = row?.status && typeof row.status === 'object' ? row.status : {};

    return res.status(200).json({
      ok: true,
      authenticated: true,
      username: user.trakt_username,
      updated_at: row?.updated_at || null,
      watched_keys: Object.keys(statuses).length,
      watched_count: countWatched(statuses),
      statuses
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
