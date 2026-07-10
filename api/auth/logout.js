import { assertSameOrigin, clearSessionCookie, deleteSession, setApiSecurityHeaders, setNoStore } from '../_wolf_auth.js';

export default async function handler(req, res) {
  setNoStore(res); setApiSecurityHeaders(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'Method not allowed' }); }
  try { assertSameOrigin(req); } catch (err) { return res.status(403).json({ ok: false, error: err.message }); }
  try { await deleteSession(req); } catch (_) {}
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
