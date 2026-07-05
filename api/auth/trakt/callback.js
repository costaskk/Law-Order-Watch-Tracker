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
  getTraktSettings
} from '../../_wolf_auth.js';

export default async function handler(req, res) {
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

    const username = settings?.user?.username || settings?.user?.ids?.slug || 'trakt-user';
    const payload = {
      trakt_username: username,
      trakt_user_slug: settings?.user?.ids?.slug || username,
      trakt_access_token: token.access_token,
      trakt_refresh_token: token.refresh_token,
      token_expires_at: new Date(Date.now() + Number(token.expires_in || 7776000) * 1000).toISOString(),
      updated_at: new Date().toISOString()
    };

    const users = await supabaseFetch('/trakt_users?on_conflict=trakt_username', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: JSON.stringify(payload)
    });
    const user = Array.isArray(users) ? users[0] : users;
    if (!user?.id) throw new Error('Supabase did not return a user id. Check the trakt_users table schema.');

    const sessionId = await createSession(user.id);
    const sessionCookieBeforeClear = [];
    setSessionCookie(res, sessionId);
    const existing = res.getHeader('Set-Cookie');
    if (Array.isArray(existing)) sessionCookieBeforeClear.push(...existing);
    else if (existing) sessionCookieBeforeClear.push(existing);
    res.setHeader('Set-Cookie', [...sessionCookieBeforeClear, ...clearOAuthCookies()]);

    return res.redirect(302, `${getPublicBaseUrl(req)}/law_order_tracker_app/?trakt=connected`);
  } catch (err) {
    return res.status(500).send(`Trakt login failed: ${err.message || String(err)}`);
  }
}
