// Vercel Serverless Function: safely triggers the GitHub Actions Trakt sync workflow.
// Required Vercel env vars:
// GITHUB_DISPATCH_TOKEN = fine-grained GitHub token with Actions: Read/Write on this repo
// Optional env vars (defaults fit costaskk/Law-Order-Watch-Tracker):
// GITHUB_OWNER, GITHUB_REPO, GITHUB_WORKFLOW_FILE, GITHUB_REF

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed. Use POST.' });

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const owner = process.env.GITHUB_OWNER || 'costaskk';
  const repo = process.env.GITHUB_REPO || 'Law-Order-Watch-Tracker';
  const workflow = process.env.GITHUB_WORKFLOW_FILE || 'trakt-sync.yml';
  const ref = process.env.GITHUB_REF || 'main';

  if (!token) {
    return res.status(500).json({
      ok: false,
      error: 'Missing Vercel environment variable GITHUB_DISPATCH_TOKEN.'
    });
  }

  const endpoint = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;

  try {
    const gh = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Law-Order-Watch-Tracker'
      },
      body: JSON.stringify({
        ref,
        inputs: {
          source: 'vercel-web-button',
          requested_at: new Date().toISOString()
        }
      })
    });

    const text = await gh.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

    if (!gh.ok) {
      return res.status(gh.status).json({
        ok: false,
        error: `GitHub returned HTTP ${gh.status}`,
        details: payload
      });
    }

    return res.status(200).json({
      ok: true,
      message: 'Trakt sync workflow triggered.',
      workflow,
      ref
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
