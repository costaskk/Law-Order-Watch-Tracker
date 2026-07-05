import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const COOKIE_NAME = 'wolf_session';
const OAUTH_STATE_COOKIE = 'wolf_oauth_state';
const OAUTH_REDIRECT_COOKIE = 'wolf_oauth_redirect';
const SESSION_DAYS = 30;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) throw new Error(`Missing environment variable ${name}`);
  return String(value).trim();
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function getTraktUserAgent() {
  return process.env.TRAKT_USER_AGENT || 'Wolf-Universe-Watch-Tracker/1.0 (+https://law-and-order-watch-tracker1.vercel.app)';
}

export function getPublicBaseUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured && configured.trim()) return trimTrailingSlash(configured);
  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  return trimTrailingSlash(`${proto}://${host}`);
}

export function getRedirectUri(req) {
  const configured = process.env.TRAKT_REDIRECT_URI;
  if (configured && configured.trim()) return trimTrailingSlash(configured);
  return `${getPublicBaseUrl(req)}/api/auth/trakt/callback`;
}

export function readCookie(req, name) {
  const raw = req?.headers?.cookie || '';
  const parts = raw.split(';').map(v => v.trim()).filter(Boolean);
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx) === name) {
      try { return decodeURIComponent(part.slice(idx + 1)); }
      catch (_) { return part.slice(idx + 1); }
    }
  }
  return '';
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value || '')}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure'];
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join('; ');
}

export function oauthCookies(state, redirectUri) {
  return [
    cookie(OAUTH_STATE_COOKIE, state, { maxAge: 600 }),
    cookie(OAUTH_REDIRECT_COOKIE, redirectUri, { maxAge: 600 })
  ];
}

export function clearOAuthCookies() {
  return [
    cookie(OAUTH_STATE_COOKIE, '', { maxAge: 0 }),
    cookie(OAUTH_REDIRECT_COOKIE, '', { maxAge: 0 })
  ];
}

export function getOauthRedirectFromCookie(req) {
  return readCookie(req, OAUTH_REDIRECT_COOKIE) || '';
}

export function createSessionId() {
  return crypto.randomBytes(32).toString('base64url');
}

export function sign(value) {
  const secret = requiredEnv('SESSION_SECRET');
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function encodeCookieValue(sessionId) {
  return `${sessionId}.${sign(sessionId)}`;
}

export function verifyCookieValue(value = '') {
  const [sessionId, signature] = String(value).split('.');
  if (!sessionId || !signature) return '';
  const expected = sign(sessionId);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return '';
  } catch (_) {
    return '';
  }
  return sessionId;
}

export function getSessionId(req) {
  return verifyCookieValue(readCookie(req, COOKIE_NAME));
}

export function setSessionCookie(res, sessionId) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader('Set-Cookie', cookie(COOKIE_NAME, encodeCookieValue(sessionId), { maxAge }));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', cookie(COOKIE_NAME, '', { maxAge: 0 }));
}

export async function supabaseFetch(path, options = {}) {
  const url = trimTrailingSlash(requiredEnv('SUPABASE_URL'));
  const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(options.prefer ? { Prefer: options.prefer } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${url}/rest/v1${path}`, { ...options, headers });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = text; }
  }
  if (!response.ok) {
    const message = typeof data === 'string' ? data : (data?.message || data?.error || text || `Supabase HTTP ${response.status}`);
    throw new Error(message);
  }
  return data;
}

export async function createSession(userId) {
  const sessionId = createSessionId();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await supabaseFetch('/app_sessions', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({ session_id: sessionId, user_id: userId, expires_at: expiresAt })
  });
  return sessionId;
}

export async function deleteSession(req) {
  const sessionId = getSessionId(req);
  if (!sessionId) return;
  await supabaseFetch(`/app_sessions?session_id=eq.${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    prefer: 'return=minimal'
  });
}

export async function getSessionUser(req) {
  const sessionId = getSessionId(req);
  if (!sessionId) return null;
  const now = encodeURIComponent(new Date().toISOString());
  const sessions = await supabaseFetch(`/app_sessions?session_id=eq.${encodeURIComponent(sessionId)}&expires_at=gt.${now}&select=user_id`, { method: 'GET' });
  const session = Array.isArray(sessions) ? sessions[0] : null;
  if (!session?.user_id) return null;
  const users = await supabaseFetch(`/trakt_users?id=eq.${encodeURIComponent(session.user_id)}&select=*`, { method: 'GET' });
  return Array.isArray(users) ? users[0] : null;
}

export async function exchangeTraktCode({ code, redirectUri }) {
  const body = {
    code,
    client_id: requiredEnv('TRAKT_CLIENT_ID'),
    client_secret: requiredEnv('TRAKT_CLIENT_SECRET'),
    redirect_uri: trimTrailingSlash(redirectUri),
    grant_type: 'authorization_code'
  };
  const response = await fetch('https://api.trakt.tv/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': getTraktUserAgent() },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!response.ok) {
    const details = data.error_description || data.error || data.message || data.raw || `HTTP ${response.status}`;
    throw new Error(`Trakt token exchange failed: HTTP ${response.status}. ${details}. Redirect used: ${body.redirect_uri}`);
  }
  return data;
}

export async function getTraktSettings(accessToken) {
  const response = await fetch('https://api.trakt.tv/users/settings', {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': getTraktUserAgent(),
      'trakt-api-version': '2',
      'trakt-api-key': requiredEnv('TRAKT_CLIENT_ID'),
      Authorization: `Bearer ${accessToken}`
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || `Could not read Trakt user: HTTP ${response.status}`);
  }
  return data;
}

export async function refreshTraktTokenIfNeeded(user) {
  const expiresAt = user?.token_expires_at ? new Date(user.token_expires_at).getTime() : 0;
  if (expiresAt && expiresAt - Date.now() > 10 * 60 * 1000) return user;
  if (!user?.trakt_refresh_token) return user;

  const redirectUri = getRedirectUri();
  const response = await fetch('https://api.trakt.tv/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': getTraktUserAgent() },
    body: JSON.stringify({
      refresh_token: user.trakt_refresh_token,
      client_id: requiredEnv('TRAKT_CLIENT_ID'),
      client_secret: requiredEnv('TRAKT_CLIENT_SECRET'),
      redirect_uri: redirectUri,
      grant_type: 'refresh_token'
    })
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(token.error_description || token.error || `Trakt token refresh failed: HTTP ${response.status}`);

  const updated = {
    trakt_access_token: token.access_token,
    trakt_refresh_token: token.refresh_token || user.trakt_refresh_token,
    token_expires_at: new Date(Date.now() + Number(token.expires_in || 7776000) * 1000).toISOString(),
    updated_at: new Date().toISOString()
  };
  await supabaseFetch(`/trakt_users?id=eq.${encodeURIComponent(user.id)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: JSON.stringify(updated)
  });
  return { ...user, ...updated };
}

export async function traktFetch(path, accessToken) {
  const response = await fetch(`https://api.trakt.tv${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': getTraktUserAgent(),
      'trakt-api-version': '2',
      'trakt-api-key': requiredEnv('TRAKT_CLIENT_ID'),
      Authorization: `Bearer ${accessToken}`
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error_description || data?.error || `Trakt HTTP ${response.status}`);
  return data;
}


function serverNormText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const SERVER_SHOW_ALIASES = new Map([
  [serverNormText('Law & Order: SVU'), serverNormText('Law & Order: Special Victims Unit')],
  [serverNormText('Law Order SVU'), serverNormText('Law & Order: Special Victims Unit')],
  [serverNormText('SVU'), serverNormText('Law & Order: Special Victims Unit')],
  [serverNormText('Criminal Intent'), serverNormText('Law & Order: Criminal Intent')],
  [serverNormText('Law Order Criminal Intent'), serverNormText('Law & Order: Criminal Intent')],
  [serverNormText('Organized Crime'), serverNormText('Law & Order: Organized Crime')],
  [serverNormText('Trial by Jury'), serverNormText('Law & Order: Trial by Jury')],
  [serverNormText('Law Order UK'), serverNormText('Law & Order: UK')],
  [serverNormText('Law Order LA'), serverNormText('Law & Order: LA')],
  [serverNormText('Law & Order: Los Angeles'), serverNormText('Law & Order: LA')],
  [serverNormText('Law & Order: True Crime'), serverNormText('Law & Order True Crime')],
  [serverNormText('True Crime'), serverNormText('Law & Order True Crime')],
  [serverNormText('NY Undercover'), serverNormText('New York Undercover')],
  [serverNormText('Chicago PD'), serverNormText('Chicago P.D.')],
  [serverNormText('Chicago P D'), serverNormText('Chicago P.D.')]
]);

function serverNormShow(value) {
  const n = serverNormText(value);
  return SERVER_SHOW_ALIASES.get(n) || n;
}

function serverNormNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.trunc(n)) : String(value ?? '').trim();
}

function addIndex(map, key, ep) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(ep);
}

let cachedGuideIndex = null;

export function loadGuideEpisodeIndex() {
  if (cachedGuideIndex) return cachedGuideIndex;
  const candidates = [
    path.join(process.cwd(), 'law_order_tracker_app', 'data', 'episodes.js'),
    path.join(process.cwd(), 'data', 'episodes.js')
  ];
  const file = candidates.find(candidate => fs.existsSync(candidate));
  const episodes = [];
  if (file) {
    const raw = fs.readFileSync(file, 'utf8');
    const match = raw.match(/window\.LAW_ORDER_EPISODES\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
    if (match) {
      try { episodes.push(...JSON.parse(match[1])); } catch (_) {}
    }
  }

  const byShowSeasonEpisode = new Map();
  const bySlugSeasonEpisode = new Map();
  const byShowTraktSeasonEpisode = new Map();
  const byEpisodeTraktId = new Map();
  const byEpisodeTvdbId = new Map();
  const byEpisodeTmdbId = new Map();

  for (const ep of episodes) {
    const season = serverNormNum(ep.season);
    const episode = serverNormNum(ep.episode);
    addIndex(byShowSeasonEpisode, `${serverNormShow(ep.show)}|${season}|${episode}`, ep);
    if (ep.traktSlug) addIndex(bySlugSeasonEpisode, `${String(ep.traktSlug)}|${season}|${episode}`, ep);
    const showIds = ep.showTraktIds || {};
    if (showIds.slug) addIndex(bySlugSeasonEpisode, `${String(showIds.slug)}|${season}|${episode}`, ep);
    if (showIds.trakt != null) addIndex(byShowTraktSeasonEpisode, `${showIds.trakt}|${season}|${episode}`, ep);
    const ids = ep.traktIds || {};
    if (ids.trakt != null) addIndex(byEpisodeTraktId, String(ids.trakt), ep);
    if (ids.tvdb != null) addIndex(byEpisodeTvdbId, String(ids.tvdb), ep);
    if (ids.tmdb != null) addIndex(byEpisodeTmdbId, String(ids.tmdb), ep);
  }

  cachedGuideIndex = {
    episodes,
    byShowSeasonEpisode,
    bySlugSeasonEpisode,
    byShowTraktSeasonEpisode,
    byEpisodeTraktId,
    byEpisodeTvdbId,
    byEpisodeTmdbId
  };
  return cachedGuideIndex;
}

function uniqEpisodes(list) {
  const seen = new Set();
  const out = [];
  for (const ep of list || []) {
    const key = ep?.id || `${ep?.show}|${ep?.season}|${ep?.episode}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(ep);
  }
  return out;
}

function guideMatchesForTraktItem(show, seasonNumber, episodeNumber, episode = {}) {
  const idx = loadGuideEpisodeIndex();
  const matches = [];
  const ids = episode?.ids || {};
  if (ids.trakt != null) matches.push(...(idx.byEpisodeTraktId.get(String(ids.trakt)) || []));
  if (ids.tvdb != null) matches.push(...(idx.byEpisodeTvdbId.get(String(ids.tvdb)) || []));
  if (ids.tmdb != null) matches.push(...(idx.byEpisodeTmdbId.get(String(ids.tmdb)) || []));

  const season = serverNormNum(episode?.season ?? seasonNumber);
  const epNo = serverNormNum(episode?.number ?? episodeNumber);
  const showIds = show?.ids || {};
  if (showIds.trakt != null) matches.push(...(idx.byShowTraktSeasonEpisode.get(`${showIds.trakt}|${season}|${epNo}`) || []));
  if (showIds.slug) matches.push(...(idx.bySlugSeasonEpisode.get(`${showIds.slug}|${season}|${epNo}`) || []));
  if (show?.title) matches.push(...(idx.byShowSeasonEpisode.get(`${serverNormShow(show.title)}|${season}|${epNo}`) || []));
  return uniqEpisodes(matches);
}

function addWatched(statuses, episodeRows, show, seasonNumber, episodeNumber, episode = {}) {
  const matches = guideMatchesForTraktItem(show, seasonNumber, episodeNumber, episode);
  const season = Number(episode?.season ?? seasonNumber);
  const epNo = Number(episode?.number ?? episodeNumber);
  if (matches.length) {
    for (const guideEp of matches) {
      statuses[guideEp.id] = 'Watched';
      statuses[`${guideEp.show}|${guideEp.season}|${guideEp.episode}`] = 'Watched';
      episodeRows.push({ show: guideEp.show, season: guideEp.season, episode: guideEp.episode, status: 'Watched', id: guideEp.id });
    }
  } else if (show?.title && Number.isFinite(season) && Number.isFinite(epNo)) {
    statuses[`${show.title}|${season}|${epNo}`] = 'Watched';
    episodeRows.push({ show: show.title, season, episode: epNo, status: 'Watched' });
  }
  return matches.length;
}

export function buildWatchedStatusPayloadFromTrakt(watchedShows = []) {
  const statuses = {};
  const episodeRows = [];
  let traktWatchedEpisodes = 0;
  let guideMatchedEpisodes = 0;

  for (const item of watchedShows || []) {
    const show = item?.show || {};
    for (const season of item.seasons || []) {
      const seasonNo = Number(season.number);
      if (!Number.isFinite(seasonNo)) continue;
      for (const episode of season.episodes || []) {
        const episodeNo = Number(episode.number);
        if (!Number.isFinite(episodeNo)) continue;
        traktWatchedEpisodes += 1;
        guideMatchedEpisodes += addWatched(statuses, episodeRows, show, seasonNo, episodeNo, episode);
      }
    }
  }

  return {
    statuses,
    episodes: episodeRows,
    watched_keys: Object.keys(statuses).length,
    trakt_watched_episodes: traktWatchedEpisodes,
    matched_guide_rows: guideMatchedEpisodes,
    guide_catalog_rows: loadGuideEpisodeIndex().episodes.length
  };
}

export function buildWatchedStatusesFromTrakt(watchedShows = []) {
  return buildWatchedStatusPayloadFromTrakt(watchedShows).statuses;
}

export async function buildWatchedStatusPayloadWithHistory(watchedShows = [], accessToken) {
  const payload = buildWatchedStatusPayloadFromTrakt(watchedShows);
  const needsHistoryFallback = payload.trakt_watched_episodes === 0 || payload.matched_guide_rows === 0;
  if (!needsHistoryFallback || !accessToken) return payload;

  const statuses = { ...payload.statuses };
  const episodeRows = [...payload.episodes];
  let historyItems = 0;
  let historyMatchedRows = 0;
  const shows = (watchedShows || []).map(item => item?.show).filter(Boolean);

  for (const show of shows) {
    const showId = show?.ids?.trakt || show?.ids?.slug || show?.ids?.tmdb || show?.title;
    if (!showId) continue;
    try {
      const encoded = encodeURIComponent(String(showId));
      const history = await traktFetch(`/sync/history/shows/${encoded}?limit=10000`, accessToken);
      for (const item of history || []) {
        const ep = item?.episode || {};
        const seasonNo = Number(ep.season);
        const episodeNo = Number(ep.number);
        if (!Number.isFinite(seasonNo) || !Number.isFinite(episodeNo)) continue;
        historyItems += 1;
        historyMatchedRows += addWatched(statuses, episodeRows, item?.show || show, seasonNo, episodeNo, ep);
      }
    } catch (err) {
      // Keep the main sync usable even if one history endpoint is blocked or unavailable.
    }
  }

  const dedupRows = [];
  const seen = new Set();
  for (const row of episodeRows) {
    const key = row.id || `${serverNormShow(row.show)}|${serverNormNum(row.season)}|${serverNormNum(row.episode)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupRows.push(row);
  }

  return {
    statuses,
    episodes: dedupRows,
    watched_keys: Object.keys(statuses).length,
    trakt_watched_episodes: payload.trakt_watched_episodes,
    matched_guide_rows: payload.matched_guide_rows + historyMatchedRows,
    guide_catalog_rows: loadGuideEpisodeIndex().episodes.length,
    history_items_checked: historyItems,
    history_matched_rows: historyMatchedRows,
    used_history_fallback: true
  };
}

export function requireMethod(req, res, method) {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  res.status(405).json({ ok: false, error: 'Method not allowed' });
  return false;
}
