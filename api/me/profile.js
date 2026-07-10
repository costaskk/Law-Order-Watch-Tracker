import {
  getSessionUser,
  refreshTraktTokenIfNeeded,
  getTraktSettings,
  getTraktUserProfile,
  extractTraktProfile,
  supabaseFetch,
  readWatchStatusRow,
  mergeStatusLayers,
  statusesToGuideEpisodes,
  uniqueStatusCounts,
  loadGuideEpisodes,
  setNoStore,
  setApiSecurityHeaders
} from '../_wolf_auth.js';

function cachedProfile(user) {
  const json = user?.profile_json && typeof user.profile_json === 'object' ? user.profile_json : {};
  return {
    username: json.username || user?.trakt_username || '',
    slug: json.slug || user?.trakt_user_slug || '',
    name: json.name || user?.display_name || '',
    vip: Boolean(json.vip),
    private: Boolean(json.private),
    joined_at: json.joined_at || null,
    location: json.location || '',
    about: json.about || '',
    avatar: json.avatar || user?.avatar_url || ''
  };
}

export default async function handler(req, res) {
  setNoStore(res);
  setApiSecurityHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    let user = await getSessionUser(req);
    if (!user) return res.status(200).json({ ok: true, authenticated: false });
    user = await refreshTraktTokenIfNeeded(user, req);
    let profile = cachedProfile(user);
    const cacheAge = user.profile_updated_at ? Date.now() - new Date(user.profile_updated_at).getTime() : Infinity;
    const shouldRefresh = req.query?.refresh === '1' || !profile.avatar || cacheAge > 24 * 60 * 60 * 1000;

    if (shouldRefresh) {
      try {
        const settings = await getTraktSettings(user.trakt_access_token);
        let full = {};
        try { full = await getTraktUserProfile(user.trakt_access_token, user.trakt_username || 'me'); } catch (_) {}
        profile = extractTraktProfile(settings, full);
        const now = new Date().toISOString();
        try {
          await supabaseFetch(`/trakt_users?id=eq.${encodeURIComponent(user.id)}`, {
            method: 'PATCH', prefer: 'return=minimal',
            body: JSON.stringify({ display_name: profile.name || '', avatar_url: profile.avatar || '', profile_json: profile, profile_updated_at: now, updated_at: now })
          });
        } catch (_) {}
      } catch (_) {
        // Cached profile is still useful when Trakt is temporarily unavailable.
      }
    }

    const guide = loadGuideEpisodes();
    const row = await readWatchStatusRow(user.id);
    const statuses = mergeStatusLayers(row?.status || {}, row?.manual_status || {}, guide);
    const episodes = statusesToGuideEpisodes(statuses, guide);
    const counts = uniqueStatusCounts(statuses, guide);
    const byShow = {};
    for (const item of episodes) {
      byShow[item.show] = byShow[item.show] || { total: 0, watched: 0, watching: 0, skipped: 0 };
      byShow[item.show].total += 1;
      if (item.status === 'Watched') byShow[item.show].watched += 1;
      else if (item.status === 'Watching') byShow[item.show].watching += 1;
      else if (item.status === 'Skipped') byShow[item.show].skipped += 1;
    }

    return res.status(200).json({
      ok: true, authenticated: true, user: profile,
      stats: {
        updated_at: row?.updated_at || null,
        trakt_synced_at: row?.trakt_synced_at || user.last_sync_at || null,
        watched_count: counts.watched,
        watching_count: counts.watching,
        skipped_count: counts.skipped,
        matched: episodes.length,
        status_count: Object.keys(statuses).length,
        by_show: byShow
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
