import { readCookie, getRedirectUri, supabaseFetch, createSession, setSessionCookie, getPublicBaseUrl } from '../../_wolf_auth.js';

export default async function handler(req, res) {
  try {
    const { code, state, error } = req.query || {};
    if (error) throw new Error(String(error));
    if (!code) throw new Error('Missing Trakt OAuth code');

    const expectedState = readCookie(req, 'wolf_oauth_state');
    if (!state || !expectedState || state !== expectedState) {
      throw new Error('Invalid OAuth state. Please try logging in again.');
    }

    const tokenResponse = await fetch('https://api.trakt.tv/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: process.env.TRAKT_CLIENT_ID,
        client_secret: process.env.TRAKT_CLIENT_SECRET,
        redirect_uri: getRedirectUri(req),
        grant_type: 'authorization_code'
      })
    });
    const token = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      throw new Error(token.error_description || token.error || `Trakt token exchange failed: HTTP ${tokenResponse.status}`);
    }

    const settingsResponse = await fetch('https://api.trakt.tv/users/settings', {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': process.env.TRAKT_CLIENT_ID,
        Authorization: `Bearer ${token.access_token}`
      }
    });
    const settings = await settingsResponse.json().catch(() => ({}));
    if (!settingsResponse.ok) {
      throw new Error(settings.error_description || settings.error || `Could not read Trakt user: HTTP ${settingsResponse.status}`);
    }

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
    if (!user?.id) throw new Error('Supabase did not return a user id. Check table schema.');

    const sessionId = await createSession(user.id);
    setSessionCookie(res, sessionId);
    res.setHeader('Set-Cookie', [
      res.getHeader('Set-Cookie'),
      'wolf_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0'
    ].filter(Boolean));

    return res.redirect(302, `${getPublicBaseUrl(req)}/law_order_tracker_app/?trakt=connected`);
  } catch (err) {
    return res.status(500).send(`Trakt login failed: ${err.message || String(err)}`);
  }
}
