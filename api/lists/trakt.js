import {
  assertSameOrigin,
  getSessionUser,
  refreshTraktTokenIfNeeded,
  getTraktSettings,
  traktFetch,
  loadGuideEpisodes,
  setNoStore,
  setApiSecurityHeaders
} from '../_wolf_auth.js';

const PRIVACY_VALUES = new Set(['private', 'friends', 'public']);
const MODES = new Set(['shows', 'episodes']);
const MAX_SELECTED_SHOWS = 100;
const MAX_EPISODE_ITEMS = 5000;
const ADD_CHUNK_SIZE = 100;

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function positiveTraktId(ids = {}) {
  const id = Number(ids?.trakt || 0);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function normalizedMediaIds(ids = {}) {
  const output = {};
  const trakt = positiveTraktId(ids);
  if (trakt) output.trakt = trakt;
  for (const key of ['tmdb', 'tvdb']) {
    const value = Number(ids?.[key] || 0);
    if (Number.isSafeInteger(value) && value > 0) output[key] = value;
  }
  const imdb = cleanText(ids?.imdb, 24);
  if (/^tt\d+$/i.test(imdb)) output.imdb = imdb.toLowerCase();
  return output;
}

function hasMediaIds(ids = {}) {
  return Object.keys(normalizedMediaIds(ids)).length > 0;
}

function showNamesFromBody(body = {}) {
  if (!Array.isArray(body.shows)) return [];
  const unique = [];
  const seen = new Set();
  for (const raw of body.shows.slice(0, MAX_SELECTED_SHOWS + 1)) {
    const name = cleanText(raw, 160);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
  }
  return unique;
}

function uniqueByIds(items = []) {
  const seen = new Set();
  return items.filter(item => {
    const ids = normalizedMediaIds(item.ids);
    const keys = ['trakt', 'imdb', 'tmdb', 'tvdb']
      .filter(name => ids[name])
      .map(name => `${name}:${ids[name]}`);
    if (!keys.length || keys.some(key => seen.has(key))) return false;
    keys.forEach(key => seen.add(key));
    item.ids = ids;
    return true;
  });
}

function countResultValues(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return Number(value) || 0;
  return Object.values(value).reduce((total, item) => total + countResultValues(item), 0);
}

export function summarizeAddResults(results = []) {
  return results.reduce((summary, result) => {
    summary.added += countResultValues(result?.added);
    summary.existing += countResultValues(result?.existing);
    summary.notFound += countResultValues(result?.not_found);
    summary.present = summary.added + summary.existing;
    return summary;
  }, { added: 0, existing: 0, notFound: 0, present: 0 });
}

export function buildListItems(guide, selectedShows, mode, includeSpecials = false, includeUnreleased = false) {
  const selected = new Set(selectedShows);
  const today = new Date().toISOString().slice(0, 10);
  const rows = (guide || [])
    .filter(row => selected.has(row.show))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  const payload = { shows: [], episodes: [], movies: [] };
  const skipped = [];

  if (mode === 'shows') {
    for (const show of selectedShows) {
      const showRows = rows.filter(row => row.show === show);
      if (!showRows.length) {
        skipped.push({ show, reason: 'not in guide' });
        continue;
      }
      const movie = showRows.find(row => row.isMovie);
      if (movie) {
        const ids = hasMediaIds(movie.traktIds) ? normalizedMediaIds(movie.traktIds) : normalizedMediaIds(movie.showTraktIds);
        if (hasMediaIds(ids)) payload.movies.push({ ids });
        else skipped.push({ show, reason: 'missing Trakt movie ID' });
        continue;
      }
      const ids = normalizedMediaIds(showRows.find(row => hasMediaIds(row.showTraktIds))?.showTraktIds);
      if (hasMediaIds(ids)) payload.shows.push({ ids });
      else skipped.push({ show, reason: 'missing Trakt show ID' });
    }
  } else {
    for (const row of rows) {
      if ((row.isSpecial || Number(row.season) === 0) && !row.isMovie && !includeSpecials) continue;
      if (!includeUnreleased && (row.unaired || (row.airDate && row.airDate > today))) continue;
      const ids = normalizedMediaIds(row.traktIds);
      if (!hasMediaIds(ids)) {
        skipped.push({ show: row.show, season: row.season, episode: row.episode, reason: 'missing Trakt item ID' });
        continue;
      }
      if (row.isMovie) payload.movies.push({ ids });
      else payload.episodes.push({ ids });
    }
  }

  payload.shows = uniqueByIds(payload.shows);
  payload.episodes = uniqueByIds(payload.episodes);
  payload.movies = uniqueByIds(payload.movies);
  return { payload, skipped, count: payload.shows.length + payload.episodes.length + payload.movies.length };
}

function chunkPayload(payload, size = ADD_CHUNK_SIZE) {
  const tagged = [
    ...(payload.shows || []).map(item => ['shows', item]),
    ...(payload.episodes || []).map(item => ['episodes', item]),
    ...(payload.movies || []).map(item => ['movies', item])
  ];
  const chunks = [];
  for (let index = 0; index < tagged.length; index += size) {
    const chunk = { shows: [], episodes: [], movies: [] };
    for (const [kind, item] of tagged.slice(index, index + size)) chunk[kind].push(item);
    chunks.push(chunk);
  }
  return chunks;
}

function configuredItemLimit(settings = {}) {
  const limits = settings?.limits || {};
  const candidates = [
    limits?.list?.item_count,
    limits?.lists?.item_count,
    limits?.list_items,
    limits?.list_item_count
  ].map(Number).filter(value => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.min(...candidates) : MAX_EPISODE_ITEMS;
}

export default async function handler(req, res) {
  setNoStore(res);
  setApiSecurityHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let createdListId = '';
  let accessToken = '';
  let rollbackAttempted = false;
  let rollbackSucceeded = false;
  try {
    assertSameOrigin(req);
    let user = await getSessionUser(req);
    if (!user) return res.status(401).json({ ok: false, authenticated: false, error: 'Login with Trakt before creating a list.' });
    user = await refreshTraktTokenIfNeeded(user, req);
    accessToken = user.trakt_access_token;

    const name = cleanText(req.body?.name, 100);
    const description = cleanText(req.body?.description, 1000);
    const privacy = PRIVACY_VALUES.has(req.body?.privacy) ? req.body.privacy : 'private';
    const mode = MODES.has(req.body?.mode) ? req.body.mode : 'shows';
    const selectedShows = showNamesFromBody(req.body);
    const includeSpecials = Boolean(req.body?.include_specials);
    const includeUnreleased = Boolean(req.body?.include_unreleased);
    if (name.length < 2) return res.status(400).json({ ok: false, error: 'List name must contain at least two characters.' });
    if (!selectedShows.length) return res.status(400).json({ ok: false, error: 'Select at least one show.' });
    if (selectedShows.length > MAX_SELECTED_SHOWS) return res.status(400).json({ ok: false, error: `Select no more than ${MAX_SELECTED_SHOWS} shows.` });

    const built = buildListItems(loadGuideEpisodes(), selectedShows, mode, includeSpecials, includeUnreleased);
    if (!built.count) return res.status(422).json({ ok: false, error: 'The selected titles do not have usable Trakt IDs.', skipped: built.skipped.slice(0, 50) });

    let settings = {};
    try { settings = await getTraktSettings(accessToken); } catch (_) {}
    const itemLimit = Math.min(configuredItemLimit(settings), MAX_EPISODE_ITEMS);
    if (built.count > itemLimit) {
      return res.status(413).json({
        ok: false,
        error: `This list would contain ${built.count.toLocaleString()} items; your current safe Trakt limit is ${itemLimit.toLocaleString()}. Choose fewer shows or use show mode.`,
        item_count: built.count,
        item_limit: itemLimit
      });
    }

    const created = await traktFetch('/users/me/lists', accessToken, {
      method: 'POST',
      body: {
        name,
        description,
        privacy,
        display_numbers: mode === 'episodes',
        allow_comments: true,
        sort_by: mode === 'episodes' ? 'rank' : 'title',
        sort_how: 'asc'
      }
    });
    createdListId = String(created?.ids?.trakt || created?.ids?.slug || '');
    if (!createdListId) throw new Error('Trakt created the list but did not return a usable list ID.');

    const chunks = chunkPayload(built.payload);
    const addResults = [];
    for (const chunk of chunks) {
      addResults.push(await traktFetch(`/users/me/lists/${encodeURIComponent(createdListId)}/items`, accessToken, { method: 'POST', body: chunk }));
    }
    const addSummary = summarizeAddResults(addResults);
    if (addSummary.notFound || addSummary.present < built.count) {
      const err = new Error(`Trakt accepted ${addSummary.present.toLocaleString()} of ${built.count.toLocaleString()} requested items; the incomplete list was not kept.`);
      err.status = 422;
      throw err;
    }

    const userSlug = settings?.user?.ids?.slug || user.trakt_user_slug || user.trakt_username || 'me';
    const listSlug = created?.ids?.slug || createdListId;
    const url = `https://trakt.tv/users/${encodeURIComponent(userSlug)}/lists/${encodeURIComponent(listSlug)}`;
    return res.status(201).json({
      ok: true,
      authenticated: true,
      list: { id: created?.ids?.trakt || createdListId, slug: listSlug, name: created?.name || name, url },
      mode,
      include_unreleased: includeUnreleased,
      selected_shows: selectedShows.length,
      item_count: built.count,
      added: addSummary.added,
      existing: addSummary.existing,
      skipped_count: built.skipped.length,
      skipped: built.skipped.slice(0, 50)
    });
  } catch (err) {
    if (createdListId && accessToken) {
      rollbackAttempted = true;
      try {
        await traktFetch(`/users/me/lists/${encodeURIComponent(createdListId)}`, accessToken, { method: 'DELETE', retries: 0 });
        rollbackSucceeded = true;
      } catch (_) {}
    }
    const message = err.message || String(err);
    const status = message.toLowerCase().includes('origin') ? 403 : Number(err.status) || 500;
    return res.status(status).json({ ok: false, error: message, rollback_attempted: rollbackAttempted, rolled_back: rollbackSucceeded });
  }
}
