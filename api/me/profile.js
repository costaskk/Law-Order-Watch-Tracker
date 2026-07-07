import { getSessionUser, refreshTraktTokenIfNeeded, getTraktSettings, supabaseFetch, statusesToGuideEpisodes } from '../_wolf_auth.js';

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function countWatched(statuses) {
  if (!statuses || typeof statuses !== 'object') return 0;
  return Object.values(statuses).filter(v => String(v).toLowerCase() === 'watched').length;
}

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    let user = await getSessionUser(req);
    if (!user) return res.status(200).json({ ok: true, authenticated: false });
    user = await refreshTraktTokenIfNeeded(user);

    let settings = {};
    try { settings = await getTraktSettings(user.trakt_access_token); } catch (_) {}

    const rows = await supabaseFetch(
      `/watch_status?user_id=eq.${encodeURIComponent(user.id)}&select=status,updated_at&order=updated_at.desc&limit=1`,
      { method: 'GET' }
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const statuses = row?.status && typeof row.status === 'object' ? row.status : {};
    const episodes = statusesToGuideEpisodes(statuses);
    const trakt = settings?.user || {};

    return res.status(200).json({
      ok: true,
      authenticated: true,
      user: {
        username: trakt.username || user.trakt_username,
        name: trakt.name || '',
        vip: Boolean(trakt.vip),
        private: Boolean(trakt.private),
        joined_at: trakt.joined_at || null,
        location: trakt.location || '',
        about: trakt.about || '',
        avatar: trakt.images?.avatar?.full || trakt.images?.avatar?.medium || ''
      },
      stats: {
        updated_at: row?.updated_at || null,
        watched_count: countWatched(statuses),
        matched: episodes.length,
        status_count: Object.keys(statuses).length
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
