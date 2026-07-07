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

function optionalEnv(name, fallback = '') {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function traktUserAgent() {
  return optionalEnv('TRAKT_USER_AGENT', 'Wolf-Universe-Watch-Tracker/1.0 (+https://law-and-order-watch-tracker1.vercel.app)');
}

function traktBaseHeaders(accessToken = '') {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': traktUserAgent(),
    'trakt-api-version': '2',
    'trakt-api-key': requiredEnv('TRAKT_CLIENT_ID')
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
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

export async function supabaseFetch(pathPart, options = {}) {
  const url = trimTrailingSlash(requiredEnv('SUPABASE_URL'));
  const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(options.prefer ? { Prefer: options.prefer } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${url}/rest/v1${pathPart}`, { ...options, headers });
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

async function parseJsonResponse(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch (_) { return { raw: text }; }
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
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': traktUserAgent()
    },
    body: JSON.stringify(body)
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    const details = data.error_description || data.error || data.message || data.raw || `HTTP ${response.status}`;
    throw new Error(`Trakt token exchange failed: HTTP ${response.status}. ${details}. Redirect used: ${body.redirect_uri}`);
  }
  return data;
}

export async function getTraktSettings(accessToken) {
  const response = await fetch('https://api.trakt.tv/users/settings', {
    headers: traktBaseHeaders(accessToken)
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || data?.raw || `Could not read Trakt user: HTTP ${response.status}`);
  }
  return data;
}

export async function refreshTraktTokenIfNeeded(user) {
  const expiresAt = user?.token_expires_at ? new Date(user.token_expires_at).getTime() : 0;
  if (expiresAt && expiresAt - Date.now() > 10 * 60 * 1000) return user;
  if (!user?.trakt_refresh_token) return user;

  const response = await fetch('https://api.trakt.tv/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': traktUserAgent()
    },
    body: JSON.stringify({
      refresh_token: user.trakt_refresh_token,
      client_id: requiredEnv('TRAKT_CLIENT_ID'),
      client_secret: requiredEnv('TRAKT_CLIENT_SECRET'),
      redirect_uri: getRedirectUri(),
      grant_type: 'refresh_token'
    })
  });
  const token = await parseJsonResponse(response);
  if (!response.ok) throw new Error(token.error_description || token.error || token.raw || `Trakt token refresh failed: HTTP ${response.status}`);

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

export async function traktFetch(pathPart, accessToken) {
  const response = await fetch(`https://api.trakt.tv${pathPart}`, {
    headers: traktBaseHeaders(accessToken)
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) throw new Error(data?.error_description || data?.error || data?.raw || `Trakt HTTP ${response.status}`);
  return data;
}

export function normText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.trunc(n)) : String(value ?? '').trim();
}

const SHOW_NAME_ALIASES = {
  [normText('Law & Order: SVU')]: normText('Law & Order: Special Victims Unit'),
  [normText('Law Order SVU')]: normText('Law & Order: Special Victims Unit'),
  [normText('SVU')]: normText('Law & Order: Special Victims Unit'),
  [normText('Criminal Intent')]: normText('Law & Order: Criminal Intent'),
  [normText('Law Order Criminal Intent')]: normText('Law & Order: Criminal Intent'),
  [normText('Organized Crime')]: normText('Law & Order: Organized Crime'),
  [normText('Trial by Jury')]: normText('Law & Order: Trial by Jury'),
  [normText('Law Order UK')]: normText('Law & Order: UK'),
  [normText('Law Order LA')]: normText('Law & Order: LA'),
  [normText('True Crime')]: normText('Law & Order True Crime'),
  [normText('NY Undercover')]: normText('New York Undercover'),
  [normText('Chicago PD')]: normText('Chicago P.D.'),
  [normText('Chicago P D')]: normText('Chicago P.D.')
};

export function normShow(value) {
  const n = normText(value);
  return SHOW_NAME_ALIASES[n] || n;
}

export function episodeKeyFromParts(show, season, episode) {
  return `${normShow(show)}|${normNum(season)}|${normNum(episode)}`;
}

export function episodeKey(ep) {
  return episodeKeyFromParts(ep.show, ep.season, ep.episode);
}

export function loadGuideEpisodes() {
  const candidates = [
    path.join(process.cwd(), 'law_order_tracker_app', 'data', 'episodes.js'),
    path.join(process.cwd(), 'data', 'episodes.js')
  ];
  const file = candidates.find(p => fs.existsSync(p));
  if (!file) return [];
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/window\.LAW_ORDER_EPISODES\s*=\s*(\[[\s\S]*?\])\s*;?\s*$/);
  if (!match) return [];
  try { return JSON.parse(match[1]); }
  catch (_) { return []; }
}

function idValues(ids = {}) {
  const out = [];
  for (const key of ['trakt', 'tmdb', 'tvdb', 'imdb', 'slug']) {
    if (ids[key] !== undefined && ids[key] !== null && ids[key] !== '') out.push(`${key}:${ids[key]}`);
  }
  return out;
}

function addWatchedMatch(statuses, ep) {
  statuses[String(ep.id)] = 'Watched';
  statuses[episodeKey(ep)] = 'Watched';
}

function normalizeGuideStatusValue(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (['watched', 'complete', 'completed', 'yes', 'true', '1'].includes(v)) return 'Watched';
  if (['watching', 'in progress', 'started'].includes(v)) return 'Watching';
  if (['skipped', 'skip'].includes(v)) return 'Skipped';
  if (['not started', 'todo', 'unwatched', 'false', '0', ''].includes(v)) return 'Not Started';
  return '';
}

export function statusesToGuideEpisodes(statuses = {}, guideEpisodes = loadGuideEpisodes()) {
  const out = [];
  for (const ep of guideEpisodes || []) {
    const idStatus = normalizeGuideStatusValue(statuses[String(ep.id)]);
    const keyStatus = normalizeGuideStatusValue(statuses[episodeKey(ep)]);

    // Important: prefer Watched if either key says Watched. Older browser/local
    // data may still contain exact-id "Not Started" entries while the fresh
    // Supabase/Trakt sync contains the season/episode key as Watched.
    let status = '';
    if (idStatus === 'Watched' || keyStatus === 'Watched') status = 'Watched';
    else status = idStatus || keyStatus;

    if (!status || status === 'Not Started') continue;
    out.push({
      id: String(ep.id),
      show: ep.show,
      season: ep.season,
      episode: ep.episode,
      status
    });
  }
  return out;
}

export function normalizeStatusesForGuide(statuses = {}, guideEpisodes = loadGuideEpisodes()) {
  const normalized = { ...(statuses || {}) };
  const episodes = statusesToGuideEpisodes(normalized, guideEpisodes);

  for (const item of episodes) {
    if (item.status === 'Watched') {
      normalized[String(item.id)] = 'Watched';
      normalized[episodeKeyFromParts(item.show, item.season, item.episode)] = 'Watched';
    }
  }

  return { statuses: normalized, episodes, matched: episodes.length };
}


function buildGuideIndexes(guideEpisodes = []) {
  const byShowSeasonEpisode = new Map();
  const byShowIdSeasonEpisode = new Map();
  const byEpisodeTraktId = new Map();

  for (const ep of guideEpisodes || []) {
    const season = normNum(ep.season);
    const episode = normNum(ep.episode);
    const showNames = new Set([ep.show, ep.titleShow].filter(Boolean).map(normShow));
    for (const name of showNames) {
      const key = `${name}|${season}|${episode}`;
      if (!byShowSeasonEpisode.has(key)) byShowSeasonEpisode.set(key, []);
      byShowSeasonEpisode.get(key).push(ep);
    }

    const showIds = [
      ...idValues(ep.showTraktIds || {}),
      ep.traktSlug ? `slug:${ep.traktSlug}` : '',
      ep.showSlug ? `slug:${ep.showSlug}` : ''
    ].filter(Boolean);
    for (const sid of showIds) {
      const key = `${sid}|${season}|${episode}`;
      if (!byShowIdSeasonEpisode.has(key)) byShowIdSeasonEpisode.set(key, []);
      byShowIdSeasonEpisode.get(key).push(ep);
    }

    const episodeIds = idValues(ep.traktIds || {});
    for (const eid of episodeIds) {
      if (!byEpisodeTraktId.has(eid)) byEpisodeTraktId.set(eid, []);
      byEpisodeTraktId.get(eid).push(ep);
    }
  }
  return { byShowSeasonEpisode, byShowIdSeasonEpisode, byEpisodeTraktId };
}

function matchGuideEpisode(indexes, { showTitle, showIds, season, episode, episodeIds }) {
  const matched = new Set();
  for (const eid of idValues(episodeIds || {})) {
    const eps = indexes.byEpisodeTraktId.get(eid) || [];
    eps.forEach(ep => matched.add(ep));
  }
  for (const sid of idValues(showIds || {})) {
    const eps = indexes.byShowIdSeasonEpisode.get(`${sid}|${normNum(season)}|${normNum(episode)}`) || [];
    eps.forEach(ep => matched.add(ep));
  }
  const titleKey = `${normShow(showTitle)}|${normNum(season)}|${normNum(episode)}`;
  const eps = indexes.byShowSeasonEpisode.get(titleKey) || [];
  eps.forEach(ep => matched.add(ep));
  return [...matched];
}

export function buildWatchedStatusesFromTrakt(watchedShows = [], guideEpisodes = []) {
  const statuses = {};
  const indexes = buildGuideIndexes(guideEpisodes);
  let traktItems = 0;
  let guideMatches = 0;

  for (const item of watchedShows || []) {
    const showTitle = item?.show?.title;
    const showIds = item?.show?.ids || {};
    if (!showTitle && !Object.keys(showIds).length) continue;
    for (const season of item.seasons || []) {
      const seasonNo = Number(season.number);
      if (!Number.isFinite(seasonNo)) continue;
      for (const episode of season.episodes || []) {
        const episodeNo = Number(episode.number);
        if (!Number.isFinite(episodeNo)) continue;
        traktItems += 1;
        statuses[episodeKeyFromParts(showTitle, seasonNo, episodeNo)] = 'Watched';
        const matches = matchGuideEpisode(indexes, {
          showTitle,
          showIds,
          season: seasonNo,
          episode: episodeNo,
          episodeIds: episode.ids || {}
        });
        matches.forEach(ep => addWatchedMatch(statuses, ep));
        guideMatches += matches.length;
      }
    }
  }
  return { statuses, debug: { source: 'watched-shows', traktItems, guideMatches, statusKeys: Object.keys(statuses).length } };
}

export function buildWatchedStatusesFromHistory(historyItems = [], guideEpisodes = []) {
  const statuses = {};
  const indexes = buildGuideIndexes(guideEpisodes);
  let traktItems = 0;
  let guideMatches = 0;

  for (const item of historyItems || []) {
    const showTitle = item?.show?.title;
    const showIds = item?.show?.ids || {};
    const epObj = item?.episode || item;
    const seasonNo = Number(epObj?.season ?? item?.season);
    const episodeNo = Number(epObj?.number ?? item?.number ?? item?.episode);
    if ((!showTitle && !Object.keys(showIds).length) || !Number.isFinite(seasonNo) || !Number.isFinite(episodeNo)) continue;
    traktItems += 1;
    statuses[episodeKeyFromParts(showTitle, seasonNo, episodeNo)] = 'Watched';
    const matches = matchGuideEpisode(indexes, {
      showTitle,
      showIds,
      season: seasonNo,
      episode: episodeNo,
      episodeIds: epObj?.ids || {}
    });
    matches.forEach(ep => addWatchedMatch(statuses, ep));
    guideMatches += matches.length;
  }
  return { statuses, debug: { source: 'history', traktItems, guideMatches, statusKeys: Object.keys(statuses).length } };
}

export async function buildWatchedStatusesForGuide(accessToken) {
  const guideEpisodes = loadGuideEpisodes();
  const watchedShows = await traktFetch('/sync/watched/shows?extended=full', accessToken);
  const primary = buildWatchedStatusesFromTrakt(watchedShows, guideEpisodes);

  // History fallback helps when Trakt watched-shows is incomplete, or when a title/ID mismatch
  // prevents the aggregate endpoint from matching the local guide.
  let history = { statuses: {}, debug: { source: 'history', traktItems: 0, guideMatches: 0, statusKeys: 0, skipped: true } };
  try {
    const historyItems = await traktFetch('/sync/history/episodes?limit=10000&extended=full', accessToken);
    history = buildWatchedStatusesFromHistory(historyItems, guideEpisodes);
  } catch (err) {
    history.debug = { ...history.debug, error: err.message || String(err) };
  }

  const rawStatuses = { ...primary.statuses, ...history.statuses };
  const normalized = normalizeStatusesForGuide(rawStatuses, guideEpisodes);
  return {
    statuses: normalized.statuses,
    episodes: normalized.episodes,
    matched: normalized.matched,
    guide_matches: normalized.matched,
    debug: {
      guideEpisodes: guideEpisodes.length,
      watchedShows: primary.debug,
      history: history.debug,
      finalStatusKeys: Object.keys(normalized.statuses).length,
      finalGuideMatches: normalized.matched
    }
  };
}

export function requireMethod(req, res, method) {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  res.status(405).json({ ok: false, error: 'Method not allowed' });
  return false;
}
