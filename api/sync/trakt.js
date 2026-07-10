import {
  assertSameOrigin,
  getSessionUser,
  refreshTraktTokenIfNeeded,
  buildWatchedStatusesForGuide,
  readWatchStatusRow,
  writeWatchStatusRow,
  mergeStatusLayers,
  cleanStatusMap,
  statusesToGuideEpisodes,
  uniqueStatusCounts,
  loadGuideEpisodes,
  supabaseFetch,
  setNoStore,
  setApiSecurityHeaders
} from '../_wolf_auth.js';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function buildWithRetry(accessToken) {
  const attempts = [];
  for (const delay of [0, 650, 1400]) {
    if (delay) await sleep(delay);
    const built = await buildWatchedStatusesForGuide(accessToken);
    attempts.push({ matched: built.matched || 0, status_keys: Object.keys(built.statuses || {}).length, debug: built.debug || {} });
    if ((built.matched || 0) > 0) return { built, attempts };
  }
  return { built: { statuses: {}, episodes: [], matched: 0, debug: {} }, attempts };
}

export default async function handler(req, res) {
  setNoStore(res);
  setApiSecurityHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    assertSameOrigin(req);
    let user = await getSessionUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Not logged in with Trakt' });
    user = await refreshTraktTokenIfNeeded(user, req);

    const previous = await readWatchStatusRow(user.id);
    const previousTrakt = cleanStatusMap(previous?.status || {});
    const manualStatus = cleanStatusMap(previous?.manual_status || {}, { includeNotStarted: true });
    const now = new Date().toISOString();

    // Very frequent background calls only return the current row. A deliberate
    // button press sends force=true and always performs a fresh Trakt request.
    const force = Boolean(req.body?.force);
    const previousSyncTime = previous?.trakt_synced_at ? new Date(previous.trakt_synced_at).getTime() : 0;
    if (!force && previousSyncTime && Date.now() - previousSyncTime < 10 * 60 * 1000) {
      const merged = mergeStatusLayers(previousTrakt, manualStatus);
      const rows = statusesToGuideEpisodes(merged);
      const counts = uniqueStatusCounts(merged);
      return res.status(200).json({
        ok: true, authenticated: true, cached: true, username: user.trakt_username,
        updated_at: previous?.updated_at || null, trakt_synced_at: previous?.trakt_synced_at || null,
        status_count: Object.keys(merged).length, watched_keys: Object.keys(merged).length,
        watched_count: counts.watched, matched: rows.length, statuses: merged, episodes: rows
      });
    }

    const { built, attempts } = await buildWithRetry(user.trakt_access_token);
    const freshTrakt = cleanStatusMap(built.statuses || {});
    if ((built.matched || 0) === 0) {
      const merged = mergeStatusLayers(previousTrakt, manualStatus);
      const rows = statusesToGuideEpisodes(merged);
      const counts = uniqueStatusCounts(merged);
      return res.status(202).json({
        ok: false, retryable: true, authenticated: true, username: user.trakt_username,
        updated_at: previous?.updated_at || null, trakt_synced_at: previous?.trakt_synced_at || null,
        status_count: Object.keys(merged).length, watched_count: counts.watched, matched: rows.length,
        statuses: merged, episodes: rows,
        error: 'Trakt returned an empty watched-history response. Existing cloud progress was kept safely.',
        debug: { empty_build_guard: true, attempts }
      });
    }

    const written = await writeWatchStatusRow(user.id, {
      status: freshTrakt,
      manualStatus,
      updatedAt: now,
      traktSyncedAt: now
    });
    const merged = mergeStatusLayers(written?.status || freshTrakt, written?.manual_status || manualStatus);
    const rows = statusesToGuideEpisodes(merged);
    const counts = uniqueStatusCounts(merged);
    try {
      await supabaseFetch(`/trakt_users?id=eq.${encodeURIComponent(user.id)}`, {
        method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ last_sync_at: now, updated_at: now })
      });
    } catch (_) {}

    return res.status(200).json({
      ok: true, authenticated: true, username: user.trakt_username,
      updated_at: written?.updated_at || now, trakt_synced_at: written?.trakt_synced_at || now,
      status_count: Object.keys(merged).length, watched_keys: Object.keys(merged).length,
      watched_count: counts.watched, watching_count: counts.watching, skipped_count: counts.skipped,
      matched: rows.length, statuses: merged, episodes: rows,
      debug: { ...(built.debug || {}), attempts, single_response_authoritative: true }
    });
  } catch (err) {
    const status = String(err.message || '').includes('origin') ? 403 : 500;
    return res.status(status).json({ ok: false, error: err.message || String(err) });
  }
}
