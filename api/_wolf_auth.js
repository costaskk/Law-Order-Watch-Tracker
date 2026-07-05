import crypto from 'crypto';

const COOKIE_NAME = 'wolf_session';
const OAUTH_STATE_COOKIE = 'wolf_oauth_state';
const OAUTH_REDIRECT_COOKIE = 'wolf_oauth_redirect';
const SESSION_DAYS = 30;
const DEFAULT_TRAKT_USER_AGENT = 'Wolf-Universe-Watch-Tracker/1.0 (+https://law-and-order-watch-tracker1.vercel.app)';

export function getTraktUserAgent() {
  return (process.env.TRAKT_USER_AGENT || DEFAULT_TRAKT_USER_AGENT).trim();
}

export function traktBaseHeaders(extra = {}) {
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': getTraktUserAgent(),
    ...extra
  };
}

export function traktApiHeaders(accessToken = '', extra = {}) {
  return traktBaseHeaders({
    'trakt-api-version': '2',
    'trakt-api-key': requiredEnv('TRAKT_CLIENT_ID'),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...extra
  });
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (_) { return { raw: text }; }
}

function cloudflareHint(data) {
  const raw = typeof data === 'string' ? data : (data?.raw || '');
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, ' ').trim();
  const ray = compact.match(/Cloudflare Ray ID:\s*([a-zA-Z0-9]+)/i)?.[1];
  const blocked = /cloudflare|you have been blocked|security service|enable cookies|error 1015/i.test(compact);
  if (!blocked && !ray) return '';
  return ` Cloudflare blocked the Trakt API request${ray ? ` (Ray ID: ${ray})` : ''}. Make sure TRAKT_USER_AGENT is set in Vercel or retry later if Trakt firewall rules are aggressive.`;
}

function traktError(prefix, response, data, extra = '') {
  const detail = data?.error_description || data?.error || data?.message || data?.raw || `HTTP ${response.status}`;
  const rawDetail = String(detail).replace(/\s+/g, ' ').trim();
  return new Error(`${prefix}: HTTP ${response.status}. ${rawDetail}${cloudflareHint(data)}${extra}`);
}


function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) throw new Error(`Missing environment variable ${name}`);
  return String(value).trim();
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
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
    headers: traktBaseHeaders(),
    body: JSON.stringify(body)
  });
  const data = await parseResponseBody(response);
  if (!response.ok) {
    throw traktError('Trakt token exchange failed', response, data, `. Redirect used: ${body.redirect_uri}. User-Agent used: ${getTraktUserAgent()}`);
  }
  return data;
}

export async function getTraktSettings(accessToken) {
  const response = await fetch('https://api.trakt.tv/users/settings', {
    headers: traktApiHeaders(accessToken)
  });
  const data = await parseResponseBody(response);
  if (!response.ok) {
    throw traktError('Could not read Trakt user', response, data);
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
    headers: traktBaseHeaders(),
    body: JSON.stringify({
      refresh_token: user.trakt_refresh_token,
      client_id: requiredEnv('TRAKT_CLIENT_ID'),
      client_secret: requiredEnv('TRAKT_CLIENT_SECRET'),
      redirect_uri: redirectUri,
      grant_type: 'refresh_token'
    })
  });
  const token = await parseResponseBody(response);
  if (!response.ok) throw traktError('Trakt token refresh failed', response, token, `. User-Agent used: ${getTraktUserAgent()}`);

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
    headers: traktApiHeaders(accessToken)
  });
  const data = await parseResponseBody(response);
  if (!response.ok) throw traktError('Trakt API request failed', response, data);
  return data;
}

export function buildWatchedStatusesFromTrakt(watchedShows = []) {
  const statuses = {};
  for (const item of watchedShows || []) {
    const showTitle = item?.show?.title;
    if (!showTitle) continue;
    for (const season of item.seasons || []) {
      const seasonNo = Number(season.number);
      if (!Number.isFinite(seasonNo)) continue;
      for (const episode of season.episodes || []) {
        const episodeNo = Number(episode.number);
        if (!Number.isFinite(episodeNo)) continue;
        statuses[`${showTitle}|${seasonNo}|${episodeNo}`] = 'Watched';
      }
    }
  }
  return statuses;
}

export function requireMethod(req, res, method) {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  res.status(405).json({ ok: false, error: 'Method not allowed' });
  return false;
}
