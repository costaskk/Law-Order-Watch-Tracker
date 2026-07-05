import { clearSessionCookie, deleteSession } from '../_wolf_auth.js';

export default async function handler(req, res) {
  try { await deleteSession(req); } catch (_) {}
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
