import {
  readCookie,
  getRedirectUri,
  getOauthRedirectFromCookie,
  clearOAuthCookies,
  supabaseFetch,
  createSession,
  setSessionCookie,
  getPublicBaseUrl,
  exchangeTraktCode,
  getTraktSettings,
  getTraktUserProfile,
  extractTraktProfile,
  encryptToken,
  setApiSecurityHeaders,
  setNoStore
} from '../../_wolf_auth.js';

async function upsertUser(payload, profileFields) {
  const modern = { ...payload, ...profileFields };
  try {
    const rows = await supabaseFetch('/trakt_users?on_conflict=trakt_username', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: JSON.stringify(modern)
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (err) {
    const message = String(err.message || '').toLowerCase();
    if (!message.includes('avatar_url') && !message.includes('profile_json') && err.code !== '42703') throw err;
    const rows = await supabaseFetch('/trakt_users?on_conflict=trakt_username', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: JSON.stringify(payload)
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }
}

export default async function handler(req, res) {
  setNoStore(res);
  setApiSecurityHeaders(res);
  try {
    const { code, state, error } = req.query || {};
    if (error) throw new Error(String(error));
    if (!code) throw new Error('Missing Trakt OAuth code');

    const expectedState = readCookie(req, 'wolf_oauth_state');
    if (!state || !expectedState || state !== expectedState) {
      throw new Error('Invalid OAuth state. Please start login again from the app.');
    }

    const redirectUri = getOauthRedirectFromCookie(req) || getRedirectUri(req);
    const token = await exchangeTraktCode({ code, redirectUri });
    const settings = await getTraktSettings(token.access_token);
    const initial = extractTraktProfile(settings, {});
    let fullProfile = {};
    try { fullProfile = await getTraktUserProfile(token.access_token, initial.username || initial.slug || 'me'); } catch (_) {}
    const profile = extractTraktProfile(settings, fullProfile);
    const username = profile.username || profile.slug || 'trakt-user';
    const now = new Date().toISOString();

    const payload = {
      trakt_username: username,
      trakt_user_slug: profile.slug || username,
      trakt_access_token: encryptToken(token.access_token),
      trakt_refresh_token: encryptToken(token.refresh_token),
      token_expires_at: new Date(Date.now() + Number(token.expires_in || 7776000) * 1000).toISOString(),
      updated_at: now
    };
    const profileFields = {
      display_name: profile.name || '',
      avatar_url: profile.avatar || '',
      profile_json: profile,
      profile_updated_at: now
    };

    const user = await upsertUser(payload, profileFields);
    if (!user?.id) throw new Error('Supabase did not return a user id. Run the current SQL migration.');

    const sessionId = await createSession(user.id);
    setSessionCookie(res, sessionId);
    const existing = res.getHeader('Set-Cookie');
    const cookies = Array.isArray(existing) ? existing : existing ? [existing] : [];
    res.setHeader('Set-Cookie', [...cookies, ...clearOAuthCookies()]);

    return res.redirect(302, `${getPublicBaseUrl(req)}/law_order_tracker_app/?trakt=connected`);
  } catch (err) {
    return res.status(500).send(`Trakt login failed: ${err.message || String(err)}`);
  }
}
