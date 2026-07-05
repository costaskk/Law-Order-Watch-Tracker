import crypto from 'crypto';
import { getRedirectUri } from '../../_wolf_auth.js';

export default async function handler(req, res) {
  try {
    const clientId = process.env.TRAKT_CLIENT_ID;
    if (!clientId) return res.status(500).send('Missing TRAKT_CLIENT_ID');

    const redirectUri = getRedirectUri(req);
    const state = crypto.randomBytes(24).toString('base64url');

    res.setHeader('Set-Cookie', `wolf_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`);

    const url = new URL('https://trakt.tv/oauth/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);

    return res.redirect(302, url.toString());
  } catch (err) {
    return res.status(500).send(`Trakt login start failed: ${err.message || String(err)}`);
  }
}
