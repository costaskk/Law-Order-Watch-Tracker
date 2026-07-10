import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const COOKIE_NAME = 'wolf_session';
const OAUTH_STATE_COOKIE = 'wolf_oauth_state';
const OAUTH_REDIRECT_COOKIE = 'wolf_oauth_redirect';
const SESSION_DAYS = 30;
const DEFAULT_TRAKT_TIMEOUT_MS = 25000;
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tokenCryptoKey() {
  return crypto.createHash('sha256')
    .update(optionalEnv('TOKEN_ENCRYPTION_SECRET', requiredEnv('SESSION_SECRET')))
    .digest();
}

export function encryptToken(value = '') {
  value = String(value || '');
  if (!value || value.startsWith('enc:v1:')) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenCryptoKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptToken(value = '') {
  value = String(value || '');
  if (!value || !value.startsWith('enc:v1:')) return value;
  const [, version, iv64, tag64, data64] = value.split(':');
  if (version !== 'v1' || !iv64 || !tag64 || !data64) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', tokenCryptoKey(), Buffer.from(iv64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data64, 'base64url')), decipher.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
}

export function withDecryptedTokens(user) {
  if (!user) return user;
  return {
    ...user,
    trakt_access_token: decryptToken(user.trakt_access_token),
    trakt_refresh_token: decryptToken(user.trakt_refresh_token)
  };
}

function traktUserAgent() {
  return optionalEnv('TRAKT_USER_AGENT', 'Wolf-Universe-Watch-Tracker/3.0 (+https://law-and-order-watch-tracker1.vercel.app)');
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

export function setNoStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

export function setApiSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

export function getPublicBaseUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured && configured.trim()) return trimTrailingSlash(configured);
  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  if (!host) return '';
  return trimTrailingSlash(`${proto}://${host}`);
}

export function getRedirectUri(req) {
  const configured = process.env.TRAKT_REDIRECT_URI;
  if (configured && configured.trim()) return trimTrailingSlash(configured);
  const base = getPublicBaseUrl(req);
  if (!base) throw new Error('Missing TRAKT_REDIRECT_URI (required for token refresh outside a request)');
  return `${base}/api/auth/trakt/callback`;
}

function normalizedOrigin(value) {
  try { return new URL(String(value || '')).origin; }
  catch (_) { return ''; }
}

export function assertSameOrigin(req) {
  const method = String(req?.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  const supplied = normalizedOrigin(req?.headers?.origin) || normalizedOrigin(req?.headers?.referer);
  if (!supplied) {
    if (optionalEnv('ALLOW_MISSING_ORIGIN', '0') === '1') return true;
    throw new Error('Missing request origin');
  }
  const allowed = new Set([
    normalizedOrigin(getPublicBaseUrl(req)),
    ...optionalEnv('ALLOWED_ORIGINS', '').split(',').map(normalizedOrigin).filter(Boolean)
  ].filter(Boolean));
  if (!allowed.has(supplied)) throw new Error('Request origin is not allowed');
  return true;
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
  const parts = [`${name}=${encodeURIComponent(value || '')}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.secure !== false) parts.push('Secure');
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

export function hashSessionId(sessionId) {
  return crypto.createHash('sha256').update(String(sessionId || '')).digest('hex');
}

export function sign(value) {
  return crypto.createHmac('sha256', requiredEnv('SESSION_SECRET')).update(value).digest('base64url');
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
    const error = new Error(message);
    error.status = response.status;
    error.code = data?.code || '';
    throw error;
  }
  return data;
}

export async function createSession(userId) {
  const sessionId = createSessionId();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await supabaseFetch('/app_sessions', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({ session_id: hashSessionId(sessionId), user_id: userId, expires_at: expiresAt })
  });
  return sessionId;
}

async function findSessionRow(sessionId) {
  if (!sessionId) return null;
  const now = encodeURIComponent(new Date().toISOString());
  const candidates = [hashSessionId(sessionId), sessionId]; // raw fallback keeps old sessions alive during migration
  for (const candidate of candidates) {
    const sessions = await supabaseFetch(`/app_sessions?session_id=eq.${encodeURIComponent(candidate)}&expires_at=gt.${now}&select=user_id&limit=1`, { method: 'GET' });
    const session = Array.isArray(sessions) ? sessions[0] : null;
    if (session?.user_id) return { ...session, stored_session_id: candidate };
  }
  return null;
}

export async function deleteSession(req) {
  const sessionId = getSessionId(req);
  if (!sessionId) return;
  const values = [hashSessionId(sessionId), sessionId];
  for (const value of values) {
    try {
      await supabaseFetch(`/app_sessions?session_id=eq.${encodeURIComponent(value)}`, { method: 'DELETE', prefer: 'return=minimal' });
    } catch (_) {}
  }
}

export async function getSessionUser(req) {
  const sessionId = getSessionId(req);
  const session = await findSessionRow(sessionId);
  if (!session?.user_id) return null;
  const users = await supabaseFetch(`/trakt_users?id=eq.${encodeURIComponent(session.user_id)}&select=*&limit=1`, { method: 'GET' });
  return withDecryptedTokens(Array.isArray(users) ? users[0] : null);
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch (_) { return { raw: text }; }
}

async function fetchJsonWithRetry(url, options = {}, config = {}) {
  const retries = Number(config.retries ?? 2);
  const timeoutMs = Number(config.timeoutMs ?? DEFAULT_TRAKT_TIMEOUT_MS);
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const data = await parseJsonResponse(response);
      if (response.ok) return { response, data };
      const details = data?.error_description || data?.error || data?.message || data?.raw || `HTTP ${response.status}`;
      const error = new Error(String(details));
      error.status = response.status;
      lastError = error;
      if (!RETRYABLE_HTTP.has(response.status) || attempt >= retries) return { response, data, error };
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 450 * (attempt + 1));
    } catch (err) {
      lastError = err;
      if (attempt >= retries) throw err;
      await sleep(450 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Request failed');
}

export async function exchangeTraktCode({ code, redirectUri }) {
  const body = {
    code,
    client_id: requiredEnv('TRAKT_CLIENT_ID'),
    client_secret: requiredEnv('TRAKT_CLIENT_SECRET'),
    redirect_uri: trimTrailingSlash(redirectUri),
    grant_type: 'authorization_code'
  };
  const { response, data } = await fetchJsonWithRetry('https://api.trakt.tv/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': traktUserAgent() },
    body: JSON.stringify(body)
  }, { retries: 1 });
  if (!response.ok) {
    const details = data.error_description || data.error || data.message || data.raw || `HTTP ${response.status}`;
    throw new Error(`Trakt token exchange failed: HTTP ${response.status}. ${details}. Redirect used: ${body.redirect_uri}`);
  }
  return data;
}

export async function traktFetch(pathPart, accessToken, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const requestOptions = { method, headers: { ...traktBaseHeaders(accessToken), ...(options.headers || {}) } };
  if (options.body !== undefined) requestOptions.body = JSON.stringify(options.body);
  const { response, data } = await fetchJsonWithRetry(`https://api.trakt.tv${pathPart}`, requestOptions, {
    retries: options.retries ?? 2,
    timeoutMs: options.timeoutMs ?? DEFAULT_TRAKT_TIMEOUT_MS
  });
  if (!response.ok) {
    const message = data?.error_description || data?.error || data?.message || data?.raw || `Trakt HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function traktPost(pathPart, accessToken, body) {
  return traktFetch(pathPart, accessToken, { method: 'POST', body });
}

export async function getTraktSettings(accessToken) {
  return traktFetch('/users/settings', accessToken);
}

export async function getTraktUserProfile(accessToken, username = 'me') {
  const slug = encodeURIComponent(username || 'me');
  return traktFetch(`/users/${slug}?extended=full`, accessToken);
}

export function extractTraktProfile(settings = {}, profile = {}) {
  const user = { ...(settings?.user || {}), ...(profile || {}) };
  return {
    username: user.username || user.ids?.slug || '',
    slug: user.ids?.slug || user.username || '',
    name: user.name || '',
    vip: Boolean(user.vip),
    private: Boolean(user.private),
    joined_at: user.joined_at || null,
    location: user.location || '',
    about: user.about || '',
    avatar: user.images?.avatar?.full || user.images?.avatar?.medium || user.images?.avatar?.thumb || user.images?.avatar?.original || ''
  };
}

export async function refreshTraktTokenIfNeeded(user, req = null) {
  const expiresAt = user?.token_expires_at ? new Date(user.token_expires_at).getTime() : 0;
  if (expiresAt && expiresAt - Date.now() > 10 * 60 * 1000) return user;
  if (!user?.trakt_refresh_token) return user;
  const redirectUri = getRedirectUri(req);
  const { response, data: token } = await fetchJsonWithRetry('https://api.trakt.tv/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': traktUserAgent() },
    body: JSON.stringify({
      refresh_token: user.trakt_refresh_token,
      client_id: requiredEnv('TRAKT_CLIENT_ID'),
      client_secret: requiredEnv('TRAKT_CLIENT_SECRET'),
      redirect_uri: redirectUri,
      grant_type: 'refresh_token'
    })
  }, { retries: 1 });
  if (!response.ok) throw new Error(token.error_description || token.error || token.raw || `Trakt token refresh failed: HTTP ${response.status}`);

  const updatedAt = new Date().toISOString();
  const updated = {
    trakt_access_token: encryptToken(token.access_token),
    trakt_refresh_token: encryptToken(token.refresh_token || user.trakt_refresh_token),
    token_expires_at: new Date(Date.now() + Number(token.expires_in || 7776000) * 1000).toISOString(),
    updated_at: updatedAt
  };
  await supabaseFetch(`/trakt_users?id=eq.${encodeURIComponent(user.id)}`, {
    method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(updated)
  });
  return {
    ...user,
    trakt_access_token: token.access_token,
    trakt_refresh_token: token.refresh_token || user.trakt_refresh_token,
    token_expires_at: updated.token_expires_at,
    updated_at: updatedAt
  };
}

export async function revokeTraktToken(accessToken = '') {
  if (!accessToken) return { ok: false, skipped: true };
  try {
    const { response, data } = await fetchJsonWithRetry('https://api.trakt.tv/oauth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': traktUserAgent() },
      body: JSON.stringify({
        token: accessToken,
        client_id: requiredEnv('TRAKT_CLIENT_ID'),
        client_secret: requiredEnv('TRAKT_CLIENT_SECRET')
      })
    }, { retries: 0 });
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

export function normText(value) {
  return String(value ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
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
  const normalized = normText(value);
  return SHOW_NAME_ALIASES[normalized] || normalized;
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
  const file = candidates.find(candidate => fs.existsSync(candidate));
  if (!file) return [];
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/window\.LAW_ORDER_EPISODES\s*=\s*(\[[\s\S]*?\])\s*;?\s*$/);
  if (!match) return [];
  try { return JSON.parse(match[1]); } catch (_) { return []; }
}

export function normalizeStatusValue(value) {
  if (value && typeof value === 'object') value = value.status ?? value.value ?? value.state ?? '';
  const v = String(value ?? '').trim().toLowerCase();
  if (['watched', 'complete', 'completed', 'yes', 'true', '1'].includes(v)) return 'Watched';
  if (['watching', 'in progress', 'started'].includes(v)) return 'Watching';
  if (['skipped', 'skip'].includes(v)) return 'Skipped';
  if (['not started', 'todo', 'unwatched', 'false', '0', ''].includes(v)) return 'Not Started';
  return '';
}

export function cleanStatusMap(statuses = {}, { includeNotStarted = false } = {}) {
  const out = {};
  if (!statuses || typeof statuses !== 'object') return out;
  for (const [key, value] of Object.entries(statuses)) {
    const status = normalizeStatusValue(value);
    if (!key || !status || (!includeNotStarted && status === 'Not Started')) continue;
    out[key] = status;
  }
  return out;
}

export function statusesToGuideEpisodes(statuses = {}, guideEpisodes = loadGuideEpisodes()) {
  const out = [];
  for (const ep of guideEpisodes || []) {
    const idStatus = normalizeStatusValue(statuses[String(ep.id)]);
    const keyStatus = normalizeStatusValue(statuses[episodeKey(ep)]);
    const status = idStatus || keyStatus;
    if (!status || status === 'Not Started') continue;
    out.push({ id: String(ep.id), show: ep.show, season: ep.season, episode: ep.episode, status });
  }
  return out;
}

export function canonicalizeStatuses(statuses = {}, guideEpisodes = loadGuideEpisodes()) {
  const output = cleanStatusMap(statuses, { includeNotStarted: true });
  for (const ep of guideEpisodes || []) {
    const id = String(ep.id);
    const key = episodeKey(ep);
    const status = normalizeStatusValue(output[id]) || normalizeStatusValue(output[key]);
    if (!status || status === 'Not Started') {
      delete output[id];
      delete output[key];
      continue;
    }
    output[id] = status;
    output[key] = status;
  }
  return output;
}

export function mergeStatusLayers(traktStatuses = {}, manualStatuses = {}, guideEpisodes = loadGuideEpisodes()) {
  const merged = canonicalizeStatuses(traktStatuses, guideEpisodes);
  const manual = cleanStatusMap(manualStatuses, { includeNotStarted: true });
  for (const ep of guideEpisodes || []) {
    const id = String(ep.id);
    const key = episodeKey(ep);
    const override = normalizeStatusValue(manual[id]) || normalizeStatusValue(manual[key]);
    if (!override) continue;
    if (override === 'Not Started') {
      delete merged[id];
      delete merged[key];
    } else {
      merged[id] = override;
      merged[key] = override;
    }
  }
  return merged;
}

export function uniqueStatusCounts(statuses = {}, guideEpisodes = loadGuideEpisodes()) {
  const rows = statusesToGuideEpisodes(statuses, guideEpisodes);
  const counts = { total: rows.length, watched: 0, watching: 0, skipped: 0 };
  for (const row of rows) {
    if (row.status === 'Watched') counts.watched += 1;
    else if (row.status === 'Watching') counts.watching += 1;
    else if (row.status === 'Skipped') counts.skipped += 1;
  }
  return counts;
}

export async function readWatchStatusRow(userId) {
  const encoded = encodeURIComponent(userId);
  try {
    const rows = await supabaseFetch(`/watch_status?user_id=eq.${encoded}&select=status,manual_status,updated_at,trakt_synced_at&limit=1`, { method: 'GET' });
    return Array.isArray(rows) ? rows[0] : null;
  } catch (err) {
    if (!String(err.message || '').toLowerCase().includes('manual_status') && err.code !== '42703') throw err;
    const rows = await supabaseFetch(`/watch_status?user_id=eq.${encoded}&select=status,updated_at&limit=1`, { method: 'GET' });
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ? { ...row, manual_status: {}, legacy_schema: true } : null;
  }
}

export async function writeWatchStatusRow(userId, { status = {}, manualStatus = {}, updatedAt = new Date().toISOString(), traktSyncedAt = null } = {}) {
  const modernBody = {
    user_id: userId,
    status: cleanStatusMap(status),
    manual_status: cleanStatusMap(manualStatus, { includeNotStarted: true }),
    updated_at: updatedAt,
    ...(traktSyncedAt ? { trakt_synced_at: traktSyncedAt } : {})
  };
  try {
    const rows = await supabaseFetch('/watch_status?on_conflict=user_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: JSON.stringify(modernBody)
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (err) {
    const message = String(err.message || '').toLowerCase();
    if (!message.includes('manual_status') && !message.includes('trakt_synced_at') && err.code !== '42703') throw err;
    const mergedLegacy = mergeStatusLayers(modernBody.status, modernBody.manual_status);
    const legacyBody = { user_id: userId, status: mergedLegacy, updated_at: updatedAt };
    const rows = await supabaseFetch('/watch_status?on_conflict=user_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: JSON.stringify(legacyBody)
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row ? { ...row, manual_status: modernBody.manual_status, legacy_schema: true } : row;
  }
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

function buildGuideIndexes(guideEpisodes = []) {
  const byShowSeasonEpisode = new Map();
  const byShowIdSeasonEpisode = new Map();
  const byEpisodeTraktId = new Map();
  for (const ep of guideEpisodes || []) {
    const season = normNum(ep.season);
    const episode = normNum(ep.episode);
    for (const name of new Set([ep.show, ep.titleShow].filter(Boolean).map(normShow))) {
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
    for (const eid of idValues(ep.traktIds || {})) {
      if (!byEpisodeTraktId.has(eid)) byEpisodeTraktId.set(eid, []);
      byEpisodeTraktId.get(eid).push(ep);
    }
  }
  return { byShowSeasonEpisode, byShowIdSeasonEpisode, byEpisodeTraktId };
}

function matchGuideEpisode(indexes, { showTitle, showIds, season, episode, episodeIds }) {
  const matched = new Set();
  for (const eid of idValues(episodeIds || {})) (indexes.byEpisodeTraktId.get(eid) || []).forEach(ep => matched.add(ep));
  for (const sid of idValues(showIds || {})) {
    (indexes.byShowIdSeasonEpisode.get(`${sid}|${normNum(season)}|${normNum(episode)}`) || []).forEach(ep => matched.add(ep));
  }
  (indexes.byShowSeasonEpisode.get(`${normShow(showTitle)}|${normNum(season)}|${normNum(episode)}`) || []).forEach(ep => matched.add(ep));
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
        const matches = matchGuideEpisode(indexes, { showTitle, showIds, season: seasonNo, episode: episodeNo, episodeIds: episode.ids || {} });
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
    const matches = matchGuideEpisode(indexes, { showTitle, showIds, season: seasonNo, episode: episodeNo, episodeIds: epObj?.ids || {} });
    matches.forEach(ep => addWatchedMatch(statuses, ep));
    guideMatches += matches.length;
  }
  return { statuses, debug: { source: 'history', traktItems, guideMatches, statusKeys: Object.keys(statuses).length } };
}

export async function buildWatchedStatusesForGuide(accessToken) {
  const guideEpisodes = loadGuideEpisodes();
  const watchedShows = await traktFetch('/sync/watched/shows?extended=full', accessToken);
  const primary = buildWatchedStatusesFromTrakt(watchedShows, guideEpisodes);
  let history = { statuses: {}, debug: { source: 'history', traktItems: 0, guideMatches: 0, statusKeys: 0, skipped: true } };
  try {
    const historyItems = await traktFetch('/sync/history/episodes?limit=10000&extended=full', accessToken);
    history = buildWatchedStatusesFromHistory(historyItems, guideEpisodes);
  } catch (err) {
    history.debug = { ...history.debug, error: err.message || String(err) };
  }
  const statuses = canonicalizeStatuses({ ...primary.statuses, ...history.statuses }, guideEpisodes);
  const episodes = statusesToGuideEpisodes(statuses, guideEpisodes);
  return {
    statuses,
    episodes,
    matched: episodes.length,
    guide_matches: episodes.length,
    debug: {
      guideEpisodes: guideEpisodes.length,
      watchedShows: primary.debug,
      history: history.debug,
      finalStatusKeys: Object.keys(statuses).length,
      finalGuideMatches: episodes.length
    }
  };
}

export function requireMethod(req, res, method) {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  res.status(405).json({ ok: false, error: 'Method not allowed' });
  return false;
}
