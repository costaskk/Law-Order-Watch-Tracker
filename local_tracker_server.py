#!/usr/bin/env python3
"""
Local Law & Order Tracker server.

This replaces `serve`/`python -m http.server` when you want the website's
"Sync with Trakt" button to work locally over LAN/Tailscale.

Run from the project root:
    python local_tracker_server.py --host 0.0.0.0 --port 8080

Then open:
    http://YOUR_TAILSCALE_IP:8080/law_order_tracker_app/

Default behavior:
    POST /api/trigger-sync runs: python sync_trakt_and_excel.py

Optional .env.local values:
    LOCAL_SYNC_MODE=local      # default; run local Python sync
    LOCAL_SYNC_MODE=github     # dispatch GitHub Actions instead
    GITHUB_PAT=...
    GITHUB_REPO=costaskk/Law-Order-Watch-Tracker
    GITHUB_WORKFLOW=trakt-sync.yml
    GITHUB_BRANCH=main
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, Tuple

ROOT = Path(__file__).resolve().parent


def load_dotenv(path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
            os.environ.setdefault(key, value)
    return values


def json_response(handler: SimpleHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)


def run_local_sync() -> Tuple[int, dict]:
    script = ROOT / "sync_trakt_and_excel.py"
    if not script.exists():
        return 500, {
            "ok": False,
            "mode": "local",
            "error": "sync_trakt_and_excel.py was not found in the project root.",
        }

    python_exe = sys.executable or "python"
    proc = subprocess.run(
        [python_exe, str(script)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=300,
    )

    watched_path = ROOT / "law_order_tracker_app" / "data" / "watched_status.json"
    debug_path = ROOT / "law_order_tracker_app" / "data" / "trakt_sync_debug.json"

    return (200 if proc.returncode == 0 else 500), {
        "ok": proc.returncode == 0,
        "mode": "local",
        "message": "Local Trakt sync completed." if proc.returncode == 0 else "Local Trakt sync failed.",
        "returncode": proc.returncode,
        "stdout": proc.stdout[-12000:],
        "stderr": proc.stderr[-12000:],
        "watched_status_exists": watched_path.exists(),
        "debug_exists": debug_path.exists(),
        "nextStep": "Press Pull Latest or refresh the page." if proc.returncode == 0 else "Check stdout/stderr above.",
    }


def trigger_github_workflow() -> Tuple[int, dict]:
    token = os.environ.get("GITHUB_PAT", "").strip()
    repo = os.environ.get("GITHUB_REPO", "costaskk/Law-Order-Watch-Tracker").strip()
    workflow = os.environ.get("GITHUB_WORKFLOW", "trakt-sync.yml").strip()
    branch = os.environ.get("GITHUB_BRANCH", "main").strip()

    if not token:
        return 500, {
            "ok": False,
            "mode": "github",
            "error": "Missing GITHUB_PAT in .env.local.",
        }

    url = f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches"
    payload = json.dumps({"ref": branch}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "law-order-local-tracker-server",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            return 200, {
                "ok": True,
                "mode": "github",
                "message": "GitHub Trakt sync workflow started.",
                "status": resp.status,
                "details": text,
                "nextStep": "Wait for GitHub Actions to finish, then press Pull Latest.",
            }
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        return e.code, {
            "ok": False,
            "mode": "github",
            "error": "GitHub workflow dispatch failed.",
            "status": e.code,
            "details": text,
        }
    except Exception as e:
        return 500, {"ok": False, "mode": "github", "error": str(e)}


class TrackerHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        # Avoid stale JSON when pressing Pull Latest repeatedly.
        if self.path.endswith(".json") or "/data/" in self.path:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        json_response(self, 200, {"ok": True})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] not in ("/api/trigger-sync", "/api/trigger-trakt-sync"):
            return json_response(self, 404, {"ok": False, "error": f"Unknown API route: {self.path}"})

        load_dotenv(ROOT / ".env.local")
        mode = os.environ.get("LOCAL_SYNC_MODE", "local").strip().lower()

        if mode == "github":
            status, payload = trigger_github_workflow()
        else:
            status, payload = run_local_sync()
        json_response(self, status, payload)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] == "/api/local-status":
            load_dotenv(ROOT / ".env.local")
            return json_response(self, 200, {
                "ok": True,
                "server": "local_tracker_server.py",
                "syncMode": os.environ.get("LOCAL_SYNC_MODE", "local"),
                "root": str(ROOT),
                "hasSyncScript": (ROOT / "sync_trakt_and_excel.py").exists(),
                "hasTraktConfig": (ROOT / "trakt_config.json").exists(),
                "hasTraktToken": (ROOT / "trakt_token.json").exists(),
                "hasGithubPat": bool(os.environ.get("GITHUB_PAT")),
            })
        return super().do_GET()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    os.chdir(ROOT)
    load_dotenv(ROOT / ".env.local")

    server = ThreadingHTTPServer((args.host, args.port), TrackerHandler)
    print(f"Serving Law & Order tracker at http://{args.host}:{args.port}/law_order_tracker_app/")
    print("POST /api/trigger-sync is enabled locally.")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
