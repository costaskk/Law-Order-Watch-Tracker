import { getSessionUser, supabaseFetch, statusesToGuideEpisodes } from '../_wolf_auth.js';

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function normalizeStatusValue(value) {
  if (value && typeof value === 'object') value = value.status ?? value.value ?? value.state ?? '';
  const v = String(value ?? '').trim().toLowerCase();
  if (['watched', 'complete', 'completed', 'yes', 'true', '1'].includes(v)) return 'Watched';
  if (['watching', 'in progress', 'started'].includes(v)) return 'Watching';
  if (['skipped', 'skip'].includes(v)) return 'Skipped';
  if (['not started', 'todo', 'unwatched', 'false', '0', ''].includes(v)) return 'Not Started';
  return null;
}

function cleanStatuses(statuses) {
  const out = {};
  if (!statuses || typeof statuses !== 'object') return out;
  for (const [key, value] of Object.entries(statuses)) {
    const status = normalizeStatusValue(value);
    if (!key || !status) continue;
    if (status === 'Watched') out[key] = 'Watched';
  }
  return out;
}

function countWatched(statuses) {
  if (!statuses || typeof statuses !== 'object') return 0;
  return Object.values(statuses).filter(value => normalizeStatusValue(value) === 'Watched').length;
}

export default async function handler(req, res) {
  noStore(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(200).json({ ok: true, authenticated: false, statuses: {} });

    // Always read the newest non-null row. This protects older DBs where duplicate
    // watch_status rows were created before the unique user_id fix was applied.
    const rows = await supabaseFetch(
      `/watch_status?user_id=eq.${encodeURIComponent(user.id)}&select=status,updated_at&order=updated_at.desc&limit=1`,
      { method: 'GET' }
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const statuses = cleanStatuses(row?.status || {});
    const episodes = statusesToGuideEpisodes(statuses);

    return res.status(200).json({
      ok: true,
      authenticated: true,
      username: user.trakt_username,
      updated_at: row?.updated_at || null,
      status_count: Object.keys(statuses).length,
      watched_keys: Object.keys(statuses).length,
      watched_count: countWatched(statuses),
      matched: episodes.length,
      episodes,
      statuses
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
