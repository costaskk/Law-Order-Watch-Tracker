import crypto from 'crypto';

const COOKIE_NAME = 'wolf_session';
const SESSION_DAYS = 30;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function getPublicBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
}

export function getRedirectUri(req) {
  return process.env.TRAKT_REDIRECT_URI || `${getPublicBaseUrl(req)}/api/auth/trakt/callback`;
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

export function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map(v => v.trim());
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx) === name) return decodeURIComponent(part.slice(idx + 1));
  }
  return '';
}

export function getSessionId(req) {
  return verifyCookieValue(readCookie(req, COOKIE_NAME));
}

export function setSessionCookie(res, sessionId) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(encodeCookieValue(sessionId))}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`);
}

export async function supabaseFetch(path, options = {}) {
  const url = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
  const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${url}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || options.headers?.Prefer || '',
      ...(options.headers || {})
    }
  });
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

export async function getSessionUser(req) {
  const sessionId = getSessionId(req);
  if (!sessionId) return null;
  const sessions = await supabaseFetch(`/app_sessions?session_id=eq.${encodeURIComponent(sessionId)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=user_id`, { method: 'GET' });
  const session = Array.isArray(sessions) ? sessions[0] : null;
  if (!session?.user_id) return null;
  const users = await supabaseFetch(`/trakt_users?id=eq.${encodeURIComponent(session.user_id)}&select=*`, { method: 'GET' });
  return Array.isArray(users) ? users[0] : null;
}

export async function deleteSession(req) {
  const sessionId = getSessionId(req);
  if (!sessionId) return;
  await supabaseFetch(`/app_sessions?session_id=eq.${encodeURIComponent(sessionId)}`, { method: 'DELETE', prefer: 'return=minimal' });
}

export async function refreshTraktTokenIfNeeded(user) {
  const expiresAt = user?.token_expires_at ? new Date(user.token_expires_at).getTime() : 0;
  if (expiresAt && expiresAt - Date.now() > 10 * 60 * 1000) return user;
  if (!user?.trakt_refresh_token) return user;

  const body = {
    refresh_token: user.trakt_refresh_token,
    client_id: requiredEnv('TRAKT_CLIENT_ID'),
    client_secret: requiredEnv('TRAKT_CLIENT_SECRET'),
    redirect_uri: process.env.TRAKT_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob',
    grant_type: 'refresh_token'
  };
  const response = await fetch('https://api.trakt.tv/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(token.error_description || token.error || `Trakt token refresh failed: HTTP ${response.status}`);

  const updated = {
    trakt_access_token: token.access_token,
    trakt_refresh_token: token.refresh_token || user.trakt_refresh_token,
    token_expires_at: new Date(Date.now() + Number(token.expires_in || 7776000) * 1000).toISOString()
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
      'trakt-api-version': '2',
      'trakt-api-key': requiredEnv('TRAKT_CLIENT_ID'),
      Authorization: `Bearer ${accessToken}`
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error_description || data?.error || `Trakt HTTP ${response.status}`);
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
