import { getSessionUser, supabaseFetch } from '../_wolf_auth.js';

export default async function handler(req, res) {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(200).json({ ok: true, authenticated: false });
    const rows = await supabaseFetch(`/watch_status?user_id=eq.${encodeURIComponent(user.id)}&select=status,updated_at`, { method: 'GET' });
    const row = Array.isArray(rows) ? rows[0] : null;
    return res.status(200).json({
      ok: true,
      authenticated: true,
      username: user.trakt_username,
      updated_at: row?.updated_at || null,
      statuses: row?.status || {}
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
