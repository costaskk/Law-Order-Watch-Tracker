export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const token = process.env.GITHUB_PAT || process.env.GH_PAT || process.env.GITHUB_TOKEN_FOR_DISPATCH;
  const repo = process.env.GITHUB_REPO || 'costaskk/Law-Order-Watch-Tracker';
  const workflow = process.env.GITHUB_WORKFLOW || 'trakt-sync.yml';
  const ref = process.env.GITHUB_BRANCH || 'main';

  if (!token) {
    return res.status(500).json({
      ok: false,
      error: 'Missing Vercel environment variable GITHUB_PAT. Add a GitHub token with Actions/workflow permission, then redeploy.'
    });
  }

  try {
    const dispatchUrl = `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
    const gh = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'law-order-watch-tracker'
      },
      body: JSON.stringify({ ref })
    });

    if (!gh.ok) {
      const text = await gh.text();
      return res.status(gh.status).json({ ok: false, error: `GitHub dispatch failed: ${gh.status} ${text}` });
    }

    return res.status(200).json({
      ok: true,
      message: 'GitHub Actions Trakt sync started.',
      run_url: `https://github.com/${repo}/actions/workflows/${workflow}`
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
