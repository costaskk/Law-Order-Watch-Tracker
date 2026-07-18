import { assertSameOrigin, setApiSecurityHeaders, setNoStore } from './_wolf_auth.js';

export default async function handler(req, res) {
  setNoStore(res); setApiSecurityHeaders(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'Method not allowed' }); }
  try { assertSameOrigin(req); } catch (err) { return res.status(403).json({ ok: false, error: err.message }); }
  if (process.env.ENABLE_SHARED_GITHUB_SYNC !== '1') {
    return res.status(410).json({ ok: false, error: 'Shared GitHub sync is disabled. Login with Trakt for personal Supabase sync.' });
  }
  const token = process.env.GITHUB_PAT || process.env.GH_PAT || process.env.GITHUB_TOKEN_FOR_DISPATCH;
  const repo = process.env.GITHUB_REPO || 'costaskk/Law-Order-Watch-Tracker';
  const workflow = process.env.GITHUB_WORKFLOW || 'trakt-sync.yml';
  const ref = process.env.GITHUB_BRANCH || 'main';
  if (!token) return res.status(500).json({ ok: false, error: 'Missing GITHUB_PAT' });
  try {
    const gh = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Wolf-Universe-Watch-Tracker/4.0.1'
      },
      body: JSON.stringify({ ref })
    });
    if (!gh.ok) return res.status(gh.status).json({ ok: false, error: `GitHub dispatch failed: ${gh.status} ${await gh.text()}` });
    return res.status(200).json({ ok: true, message: 'GitHub Actions sync started.', run_url: `https://github.com/${repo}/actions/workflows/${workflow}` });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
