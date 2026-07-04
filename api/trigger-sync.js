export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const token = process.env.GITHUB_PAT;
    const repo = process.env.GITHUB_REPO || "costaskk/Law-Order-Watch-Tracker";
    const workflow = process.env.GITHUB_WORKFLOW || "trakt-sync.yml";
    const branch = process.env.GITHUB_BRANCH || "main";

    if (!token) {
      return res.status(500).json({ ok: false, error: "Missing GITHUB_PAT in Vercel environment variables." });
    }

    const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;

    const gh = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ref: branch })
    });

    const text = await gh.text();

    if (!gh.ok) {
      return res.status(gh.status).json({
        ok: false,
        error: "GitHub workflow dispatch failed.",
        status: gh.status,
        details: text
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Trakt sync workflow started. Wait 1-2 minutes, then press Pull Latest."
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || String(err)
    });
  }
}