import crypto from 'crypto';
import { getRedirectUri, oauthCookies, setApiSecurityHeaders, setNoStore } from '../../_wolf_auth.js';

export default async function handler(req, res) {
  setNoStore(res);
  setApiSecurityHeaders(res);
  try {
    const clientId = (process.env.TRAKT_CLIENT_ID || '').trim();
    if (!clientId) return res.status(500).send('Missing TRAKT_CLIENT_ID');
    const redirectUri = getRedirectUri(req);
    const state = crypto.randomBytes(24).toString('base64url');
    res.setHeader('Set-Cookie', oauthCookies(state, redirectUri));
    const url = new URL('https://trakt.tv/oauth/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return res.redirect(302, url.toString());
  } catch (err) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const message = String(err.message || err || 'Unknown error').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500);
    return res.status(500).send(`Trakt login start failed: ${message}`);
  }
}
