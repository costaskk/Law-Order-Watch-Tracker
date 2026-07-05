import { getRedirectUri, getPublicBaseUrl } from '../../_wolf_auth.js';

export default async function handler(req, res) {
  return res.status(200).json({
    ok: true,
    public_base_url: getPublicBaseUrl(req),
    trakt_redirect_uri: getRedirectUri(req),
    has_trakt_client_id: Boolean(process.env.TRAKT_CLIENT_ID),
    has_trakt_client_secret: Boolean(process.env.TRAKT_CLIENT_SECRET),
    has_session_secret: Boolean(process.env.SESSION_SECRET),
    has_supabase_url: Boolean(process.env.SUPABASE_URL),
    has_supabase_service_role_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  });
}
