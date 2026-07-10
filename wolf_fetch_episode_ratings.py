#!/usr/bin/env python3
"""Enrich Wolf Universe episode ratings from TMDB cache, OMDb and Trakt.

Improvements over the original script:
- OMDb HTTP 401/403 responses no longer abort the entire run.
- Progress is checkpointed, so completed API requests are not lost on failure.
- Transient Trakt failures are not permanently cached as valid results.
- Optional provider switches and request caps make free-tier usage safer.
- Writes are atomic to reduce the risk of corrupting JSON/episode files.

Sources:
- TMDB: local law_order_tracker_app/data/tmdb_cache.json (no network request).
- OMDb: IMDb, Rotten Tomatoes and Metacritic when OMDB_API_KEY is set.
- Trakt: public episode rating when TRAKT_CLIENT_ID is set.

Examples:
  python wolf_fetch_episode_ratings.py --write
  python wolf_fetch_episode_ratings.py --show "Law & Order" --write
  python wolf_fetch_episode_ratings.py --write --max-omdb-requests 900
  python wolf_fetch_episode_ratings.py --write --skip-omdb
  python wolf_fetch_episode_ratings.py --write --skip-trakt
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "law_order_tracker_app" / "data"
EPISODES_JS = DATA / "episodes.js"
CACHE_PATH = DATA / "ratings_cache.json"
TMDB_CACHE_PATH = DATA / "tmdb_cache.json"
USER_AGENT = "Wolf-Universe-Watch-Tracker/3.1"

RETRYABLE_HTTP_CODES = {429, 500, 502, 503, 504}
AUTH_HTTP_CODES = {401, 403}


class ProviderAuthError(RuntimeError):
    """Raised when an API rejects its configured credential or daily allowance."""

    def __init__(self, provider: str, status: int, message: str = "") -> None:
        self.provider = provider
        self.status = status
        self.message = message.strip()
        detail = f": {self.message}" if self.message else ""
        super().__init__(f"{provider} returned HTTP {status}{detail}")


def load_window_array(path: Path, variable: str) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"window\.{re.escape(variable)}\s*=\s*(\[.*\])\s*;?\s*$", text, re.S)
    if not match:
        raise SystemExit(f"Could not parse {variable} from {path}")
    return json.loads(match.group(1))


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def atomic_write_json(path: Path, value: Any) -> None:
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


def save_episodes(episodes: list[dict]) -> None:
    atomic_write_text(
        EPISODES_JS,
        "window.LAW_ORDER_EPISODES = "
        + json.dumps(episodes, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
    )


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default
    except Exception as exc:
        print(f"warning: could not read {path}: {exc}", file=sys.stderr)
        return default


def decode_http_error(exc: urllib.error.HTTPError) -> str:
    try:
        body = exc.read().decode("utf-8", errors="replace").strip()
    except Exception:
        return ""
    if not body:
        return ""
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return body[:500]
    if isinstance(payload, dict):
        return str(payload.get("Error") or payload.get("error") or payload.get("message") or body)[:500]
    return body[:500]


def request_json(
    url: str,
    headers: dict | None = None,
    attempts: int = 3,
    timeout: int = 25,
    provider: str = "API",
):
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            message = decode_http_error(exc)
            if exc.code in AUTH_HTTP_CODES:
                raise ProviderAuthError(provider, exc.code, message) from exc
            last_error = exc
            if exc.code not in RETRYABLE_HTTP_CODES or attempt == attempts - 1:
                raise RuntimeError(
                    f"{provider} returned HTTP {exc.code}{': ' + message if message else ''}"
                ) from exc
            retry_after = int(exc.headers.get("Retry-After", "0") or 0)
            time.sleep(retry_after or (attempt + 1) * 2)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt == attempts - 1:
                raise RuntimeError(f"{provider} request failed: {exc}") from exc
            time.sleep(attempt + 1)
    raise last_error or RuntimeError(f"{provider} request failed")


def imdb_id(ep: dict) -> str:
    value = (ep.get("traktIds") or {}).get("imdb") or ep.get("imdb") or ep.get("imdbId")
    return str(value) if value and str(value).startswith("tt") else ""


def apply_tmdb_rating(ep: dict, tmdb_cache: dict) -> dict:
    show_id = (ep.get("showTraktIds") or {}).get("tmdb")
    if not show_id:
        return {}
    try:
        key = f"/tv/{show_id}/season/{int(ep.get('season'))}/episode/{int(ep.get('episode'))}"
    except (TypeError, ValueError):
        return {}
    item = tmdb_cache.get(key)
    if not isinstance(item, dict) or not item.get("vote_count"):
        return {}
    return {
        "tmdb": round(float(item.get("vote_average") or 0), 1),
        "tmdbVotes": int(item.get("vote_count") or 0),
    }


def fetch_omdb(ep: dict, cache: dict, api_key: str) -> tuple[dict, bool]:
    """Return (ratings, network_request_made)."""
    ttid = imdb_id(ep)
    if not api_key or not ttid:
        return {}, False
    key = f"omdb:{ttid}"
    if key in cache:
        cached = cache[key]
        return (cached if isinstance(cached, dict) else {}), False

    url = "https://www.omdbapi.com/?" + urllib.parse.urlencode(
        {"apikey": api_key, "i": ttid, "plot": "short"}
    )
    data = request_json(url, provider="OMDb")
    result: dict = {}

    if data.get("Response") == "False":
        message = str(data.get("Error") or "OMDb rejected the request")
        lowered = message.lower()
        if "limit" in lowered or "api key" in lowered or "invalid" in lowered:
            raise ProviderAuthError("OMDb", 401, message)
        print(f"OMDb skipped {ttid}: {message}")
    else:
        if data.get("imdbRating") not in (None, "", "N/A"):
            result["imdb"] = data["imdbRating"]
        if data.get("Metascore") not in (None, "", "N/A"):
            result["metacritic"] = data["Metascore"]
        for item in data.get("Ratings") or []:
            if item.get("Source") == "Rotten Tomatoes":
                result["rottenTomatoes"] = item.get("Value")
        if data.get("Ratings"):
            result["omdbRatings"] = data["Ratings"]

    cache[key] = result
    time.sleep(0.11)
    return result, True


def fetch_trakt(ep: dict, cache: dict, client_id: str) -> tuple[dict, bool]:
    """Return (ratings, network_request_made)."""
    trakt_id = (ep.get("traktIds") or {}).get("trakt")
    if not client_id or not trakt_id:
        return {}, False
    key = f"trakt:{trakt_id}"
    if key in cache:
        cached = cache[key]
        return (cached if isinstance(cached, dict) else {}), False

    url = f"https://api.trakt.tv/episodes/{trakt_id}/ratings"
    data = request_json(
        url,
        {
            "trakt-api-version": "2",
            "trakt-api-key": client_id,
            "Content-Type": "application/json",
        },
        provider="Trakt",
    )
    result = {
        "trakt": round(float(data.get("rating") or 0), 1),
        "traktVotes": int(data.get("votes") or 0),
    }
    cache[key] = result
    time.sleep(0.11)
    return result, True


def checkpoint(cache: dict, episodes: list[dict], write_episodes: bool, reason: str = "checkpoint") -> None:
    atomic_write_json(CACHE_PATH, cache)
    if write_episodes:
        save_episodes(episodes)
    print(f"saved {reason}: cache={len(cache)} write={write_episodes}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="maximum guide rows to examine")
    parser.add_argument("--show", default="", help="process only one exact show name")
    parser.add_argument("--write", action="store_true", help="write ratings into episodes.js and rebuild web data")
    parser.add_argument("--refresh", action="store_true", help="ignore existing OMDb/Trakt cache")
    parser.add_argument("--skip-omdb", action="store_true", help="do not make OMDb requests")
    parser.add_argument("--skip-trakt", action="store_true", help="do not make Trakt requests")
    parser.add_argument(
        "--max-omdb-requests",
        type=int,
        default=0,
        help="stop making new OMDb requests after this many; 0 means no script-side cap",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=25,
        help="save cache/episode progress after this many new network requests",
    )
    args = parser.parse_args()

    if args.checkpoint_every < 1:
        raise SystemExit("--checkpoint-every must be at least 1")

    episodes = load_window_array(EPISODES_JS, "LAW_ORDER_EPISODES")
    cache = {} if args.refresh else read_json(CACHE_PATH, {})
    tmdb_cache = read_json(TMDB_CACHE_PATH, {})
    omdb_key = "" if args.skip_omdb else os.environ.get("OMDB_API_KEY", "").strip()
    trakt_client_id = "" if args.skip_trakt else os.environ.get("TRAKT_CLIENT_ID", "").strip()

    if not args.skip_omdb and not omdb_key:
        print("OMDb disabled: OMDB_API_KEY is not set.")
    if not args.skip_trakt and not trakt_client_id:
        print("Trakt ratings disabled: TRAKT_CLIENT_ID is not set.")

    checked = 0
    changed = 0
    network_since_checkpoint = 0
    omdb_requests = 0
    trakt_requests = 0
    omdb_disabled_reason = ""
    trakt_disabled_reason = ""

    try:
        for ep in episodes:
            if args.show and ep.get("show") != args.show:
                continue
            if args.limit and checked >= args.limit:
                break

            checked += 1
            before = json.dumps(ep.get("ratings") or {}, sort_keys=True)
            ratings = dict(ep.get("ratings") or {})
            ratings.update(apply_tmdb_rating(ep, tmdb_cache))

            if omdb_key and not omdb_disabled_reason:
                if args.max_omdb_requests and omdb_requests >= args.max_omdb_requests:
                    omdb_disabled_reason = f"script cap of {args.max_omdb_requests} new requests reached"
                    print(f"OMDb paused: {omdb_disabled_reason}. Cached OMDb data will still be reused.")
                else:
                    try:
                        omdb_result, requested = fetch_omdb(ep, cache, omdb_key)
                        ratings.update(omdb_result)
                        if requested:
                            omdb_requests += 1
                            network_since_checkpoint += 1
                    except ProviderAuthError as exc:
                        omdb_disabled_reason = str(exc)
                        print(
                            "\nOMDb has been disabled for the remainder of this run. "
                            "This normally means the key is invalid/deactivated or its daily allowance is exhausted."
                        )
                        print(f"OMDb response: {exc}")
                        checkpoint(cache, episodes, args.write, "OMDb stop")

            if trakt_client_id and not trakt_disabled_reason:
                try:
                    trakt_result, requested = fetch_trakt(ep, cache, trakt_client_id)
                    ratings.update(trakt_result)
                    if requested:
                        trakt_requests += 1
                        network_since_checkpoint += 1
                except ProviderAuthError as exc:
                    trakt_disabled_reason = str(exc)
                    print(f"Trakt disabled for the remainder of this run: {exc}")
                    checkpoint(cache, episodes, args.write, "Trakt stop")
                except Exception as exc:
                    # A transient failure should not poison the cache or abort all remaining work.
                    print(f"Trakt warning for {ep.get('show')} {ep.get('code')}: {exc}")

            ratings = {
                key: value
                for key, value in ratings.items()
                if key != "error" and value not in (None, "", [], {})
            }
            if ratings:
                ep["ratings"] = ratings

            if json.dumps(ratings, sort_keys=True) != before:
                changed += 1
                print(f"updated {ep.get('show')} {ep.get('code')} -> {ratings}")

            if network_since_checkpoint >= args.checkpoint_every:
                checkpoint(cache, episodes, args.write)
                network_since_checkpoint = 0

    except KeyboardInterrupt:
        print("\nInterrupted by user; saving progress before exit.")
        checkpoint(cache, episodes, args.write, "interrupt")
        raise SystemExit(130)
    except Exception:
        print("\nUnexpected failure; saving progress before re-raising the error.", file=sys.stderr)
        checkpoint(cache, episodes, args.write, "failure")
        raise

    checkpoint(cache, episodes, args.write, "final")
    print(
        "summary: "
        f"checked={checked} changed={changed} write={args.write} "
        f"omdb_requests={omdb_requests} trakt_requests={trakt_requests}"
    )
    if omdb_disabled_reason:
        print(f"OMDb ended early: {omdb_disabled_reason}")
    if trakt_disabled_reason:
        print(f"Trakt ended early: {trakt_disabled_reason}")

    if args.write:
        subprocess.run(
            [sys.executable, str(ROOT / "wolf_build_web_data.py"), "--no-enrich"],
            check=True,
        )


if __name__ == "__main__":
    main()
