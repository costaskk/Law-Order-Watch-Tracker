import {
  assertSameOrigin, clearSessionCookie, deleteSession, getSessionUser,
  refreshTraktTokenIfNeeded, revokeTraktToken, supabaseFetch,
  setApiSecurityHeaders, setNoStore
} from '../../_wolf_auth.js';

export default async function handler(req, res) {
  setNoStore(res); setApiSecurityHeaders(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'Method not allowed' }); }
  try { assertSameOrigin(req); } catch (err) { return res.status(403).json({ ok: false, error: err.message }); }
  let revoked = false;
  try {
    let user = await getSessionUser(req);
    if (user) {
      user = await refreshTraktTokenIfNeeded(user, req);
      revoked = Boolean((await revokeTraktToken(user.trakt_access_token)).ok);
      await supabaseFetch(`/trakt_users?id=eq.${encodeURIComponent(user.id)}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: JSON.stringify({ trakt_access_token: null, trakt_refresh_token: null, token_expires_at: null, updated_at: new Date().toISOString() })
      });
    }
  } catch (_) {}
  try { await deleteSession(req); } catch (_) {}
  clearSessionCookie(res);
  return res.status(200).json({ ok: true, revoked });
}
