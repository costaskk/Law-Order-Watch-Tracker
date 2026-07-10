import {
  assertSameOrigin,
  getSessionUser,
  refreshTraktTokenIfNeeded,
  readWatchStatusRow,
  writeWatchStatusRow,
  mergeStatusLayers,
  statusesToGuideEpisodes,
  uniqueStatusCounts,
  loadGuideEpisodes,
  episodeKey,
  normalizeStatusValue,
  cleanStatusMap,
  traktPost,
  setNoStore,
  setApiSecurityHeaders
} from '../_wolf_auth.js';

function responsePayload(user, row, guideEpisodes) {
  const traktStatus = cleanStatusMap(row?.status || {});
  const manualStatus = cleanStatusMap(row?.manual_status || {}, { includeNotStarted: true });
  const statuses = mergeStatusLayers(traktStatus, manualStatus, guideEpisodes);
  const episodes = statusesToGuideEpisodes(statuses, guideEpisodes);
  const counts = uniqueStatusCounts(statuses, guideEpisodes);
  return {
    ok: true,
    authenticated: true,
    username: user.trakt_username,
    name: user.display_name || '',
    avatar: user.avatar_url || '',
    updated_at: row?.updated_at || null,
    trakt_synced_at: row?.trakt_synced_at || null,
    guide_count: Array.isArray(guideEpisodes) ? guideEpisodes.length : 0,
    status_count: Object.keys(statuses).length,
    watched_keys: Object.keys(statuses).length,
    watched_count: counts.watched,
    watching_count: counts.watching,
    skipped_count: counts.skipped,
    matched: episodes.length,
    episodes,
    statuses
  };
}

async function syncSingleEpisodeToTrakt(user, ep, status) {
  const traktId = Number((ep.traktIds || {}).trakt || 0);
  if (!traktId) return { attempted: false };
  const body = { episodes: [{ ids: { trakt: traktId }, ...(status === 'Watched' ? { watched_at: new Date().toISOString() } : {}) }] };
  const path = status === 'Watched' ? '/sync/history' : '/sync/history/remove';
  await traktPost(path, user.trakt_access_token, body);
  return { attempted: true, ok: true };
}

export default async function handler(req, res) {
  setNoStore(res);
  setApiSecurityHeaders(res);
  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'PUT', 'PATCH'].includes(method)) {
    res.setHeader('Allow', 'GET, PUT, PATCH');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    let user = await getSessionUser(req);
    if (!user) return res.status(200).json({ ok: true, authenticated: false, statuses: {}, episodes: [] });
    const guideEpisodes = loadGuideEpisodes();

    if (method === 'GET') {
      const row = await readWatchStatusRow(user.id);
      return res.status(200).json(responsePayload(user, row, guideEpisodes));
    }

    assertSameOrigin(req);
    user = await refreshTraktTokenIfNeeded(user, req);
    const row = await readWatchStatusRow(user.id);
    const traktStatus = cleanStatusMap(row?.status || {});
    const manualStatus = cleanStatusMap(row?.manual_status || {}, { includeNotStarted: true });
    const updates = Array.isArray(req.body?.updates) ? req.body.updates.slice(0, 250) : [];
    const fullManual = req.body?.manual_status && typeof req.body.manual_status === 'object' ? req.body.manual_status : null;
    if (fullManual) Object.assign(manualStatus, cleanStatusMap(fullManual, { includeNotStarted: true }));

    const syncResults = [];
    for (const update of updates) {
      const status = normalizeStatusValue(update?.status);
      if (!status) continue;
      let ep = null;
      if (update.id !== undefined && update.id !== null) ep = guideEpisodes.find(item => String(item.id) === String(update.id));
      if (!ep && update.show !== undefined) {
        ep = guideEpisodes.find(item => item.show === update.show && Number(item.season) === Number(update.season) && Number(item.episode) === Number(update.episode));
      }
      if (!ep) continue;
      manualStatus[String(ep.id)] = status;
      manualStatus[episodeKey(ep)] = status;
      if (req.body?.sync_to_trakt !== false && ['Watched', 'Not Started'].includes(status)) {
        try { syncResults.push(await syncSingleEpisodeToTrakt(user, ep, status)); }
        catch (err) { syncResults.push({ attempted: true, ok: false, error: err.message || String(err) }); }
      }
    }

    const updatedAt = new Date().toISOString();
    const written = await writeWatchStatusRow(user.id, {
      status: traktStatus,
      manualStatus,
      updatedAt,
      traktSyncedAt: row?.trakt_synced_at || null
    });
    return res.status(200).json({ ...responsePayload(user, written || { status: traktStatus, manual_status: manualStatus, updated_at: updatedAt }, guideEpisodes), sync_results: syncResults });
  } catch (err) {
    const status = String(err.message || '').includes('origin') ? 403 : 500;
    return res.status(status).json({ ok: false, error: err.message || String(err) });
  }
}
