import { clearSessionCookie, deleteSession, getSessionUser, refreshTraktTokenIfNeeded, revokeTraktToken, supabaseFetch } from '../../_wolf_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let revoked = false;
  try {
    let user = await getSessionUser(req);
    if (user) {
      user = await refreshTraktTokenIfNeeded(user);
      const result = await revokeTraktToken(user.trakt_access_token);
      revoked = Boolean(result.ok);
      await supabaseFetch(`/trakt_users?id=eq.${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: JSON.stringify({
          trakt_access_token: null,
          trakt_refresh_token: null,
          token_expires_at: null,
          updated_at: new Date().toISOString()
        })
      });
    }
  } catch (_) {
    // Keep logout reliable even if Trakt revoke or token cleanup fails.
  }

  try { await deleteSession(req); } catch (_) {}
  clearSessionCookie(res);
  return res.status(200).json({ ok: true, revoked });
}
