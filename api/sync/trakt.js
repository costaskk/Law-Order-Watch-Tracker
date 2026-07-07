import { getSessionUser, refreshTraktTokenIfNeeded, buildWatchedStatusesForGuide, supabaseFetch, statusesToGuideEpisodes } from '../_wolf_auth.js';

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
    // Supabase only needs meaningful rows. Keeping watched rows makes the payload
    // smaller and avoids stale Not Started entries shadowing Watched rows in older browsers.
    if (status === 'Watched') out[key] = 'Watched';
  }
  return out;
}

function countWatched(statuses) {
  if (!statuses || typeof statuses !== 'object') return 0;
  return Object.values(statuses).filter(value => normalizeStatusValue(value) === 'Watched').length;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function builtMatchCount(built) {
  return Number(
    built?.matched ||
    built?.guide_matches ||
    built?.debug?.watchedShows?.guideMatches ||
    built?.debug?.history?.guideMatches ||
    0
  );
}

async function buildWatchedStatusesWithRetry(accessToken) {
  const attempts = [];
  const delays = [0, 900, 1800];

  for (let i = 0; i < delays.length; i += 1) {
    if (delays[i]) await sleep(delays[i]);
    const built = await buildWatchedStatusesForGuide(accessToken);
    const statuses = cleanStatuses(built?.statuses || {});
    const episodes = Array.isArray(built?.episodes) ? built.episodes : [];
    const watchedKeys = Object.keys(statuses).length;
    const guideMatches = Math.max(builtMatchCount(built), episodes.length);
    attempts.push({ attempt: i + 1, watchedKeys, guideMatches, episodeRows: episodes.length, debug: built?.debug || {} });

    if (watchedKeys > 0 || guideMatches > 0 || episodes.length > 0) {
      return { built, statuses, attempts };
    }
  }

  return { built: attempts.length ? { debug: attempts[attempts.length - 1].debug, episodes: [] } : { episodes: [] }, statuses: {}, attempts };
}

async function readLatestWatchStatus(userId) {
  const rows = await supabaseFetch(
    `/watch_status?user_id=eq.${encodeURIComponent(userId)}&select=status,updated_at&order=updated_at.desc&limit=1`,
    { method: 'GET' }
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function writeWatchStatus(userId, statuses, updatedAt) {
  const body = JSON.stringify({ user_id: userId, status: statuses, updated_at: updatedAt });

  // Preferred path: one-row upsert. This avoids the tiny DELETE->INSERT empty-window
  // that can make the UI look like it needs a second sync click.
  try {
    const rows = await supabaseFetch('/watch_status?on_conflict=user_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row?.status) return row;
  } catch (err) {
    // If the database still lacks a unique/primary key on watch_status.user_id,
    // PostgREST cannot upsert. Fall back safely below.
    const msg = String(err?.message || err || '').toLowerCase();
    if (!msg.includes('unique') && !msg.includes('conflict') && !msg.includes('constraint') && !msg.includes('42p10')) {
      throw err;
    }
  }

  // Compatibility fallback for older databases. Delete duplicates, then insert one row.
  await supabaseFetch(`/watch_status?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    prefer: 'return=minimal'
  });

  const insertedRows = await supabaseFetch('/watch_status', {
    method: 'POST',
    prefer: 'return=representation',
    body
  });
  return Array.isArray(insertedRows) ? insertedRows[0] : insertedRows;
}

export default async function handler(req, res) {
  noStore(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    let user = await getSessionUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Not logged in with Trakt' });

    user = await refreshTraktTokenIfNeeded(user);

    const { built, statuses, attempts } = await buildWatchedStatusesWithRetry(user.trakt_access_token);
    const now = new Date().toISOString();
    const statusCount = Object.keys(statuses).length;
    const builtEpisodes = Array.isArray(built?.episodes) ? built.episodes : [];
    const matchCount = Math.max(builtMatchCount(built), builtEpisodes.length);

    // Never overwrite a user's saved progress with an empty map. The browser
    // trace showed the first click can sometimes build 0 watched entries and
    // write that empty object, making the second click appear necessary. Empty
    // builds are now treated as temporary/retryable and the previous row is kept.
    if (statusCount === 0 && matchCount === 0) {
      const previousRow = await readLatestWatchStatus(user.id);
      const previousStatuses = cleanStatuses(previousRow?.status || {});
      const previousEpisodes = statusesToGuideEpisodes(previousStatuses);
      return res.status(202).json({
        ok: false,
        retryable: true,
        authenticated: true,
        username: user.trakt_username,
        updated_at: previousRow?.updated_at || null,
        status_count: Object.keys(previousStatuses).length,
        watched_keys: Object.keys(previousStatuses).length,
        watched_count: countWatched(previousStatuses),
        matched: previousEpisodes.length,
        statuses: previousStatuses,
        episodes: previousEpisodes,
        error: 'Trakt returned 0 watched episodes on this attempt, so Supabase was not overwritten. Retrying usually succeeds in a few seconds.',
        debug: {
          empty_build_guard: true,
          build_attempts: attempts,
          previous_row_kept: Boolean(previousRow),
          returned_episode_rows: previousEpisodes.length
        }
      });
    }

    const writtenRow = await writeWatchStatus(user.id, statuses, now);
    const latestRow = writtenRow?.status ? writtenRow : await readLatestWatchStatus(user.id);
    const savedStatuses = cleanStatuses(latestRow?.status || statuses);
    const savedUpdatedAt = latestRow?.updated_at || now;
    const savedEpisodes = builtEpisodes.length ? builtEpisodes : statusesToGuideEpisodes(savedStatuses);

    return res.status(200).json({
      ok: true,
      authenticated: true,
      username: user.trakt_username,
      updated_at: savedUpdatedAt,
      status_count: Object.keys(savedStatuses).length,
      watched_keys: Object.keys(savedStatuses).length,
      watched_count: countWatched(savedStatuses),
      matched: savedEpisodes.length || matchCount,
      statuses: savedStatuses,
      episodes: savedEpisodes,
      debug: {
        ...(built?.debug || {}),
        wrote_watch_status_row: true,
        returned_from: latestRow?.status ? 'supabase_written_or_latest_row' : 'built_statuses_fallback',
        build_attempts: attempts,
        returned_episode_rows: savedEpisodes.length
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
