#!/usr/bin/env python3
"""Enrich episode ratings from local TMDB cache, OMDb and Trakt.

Sources:
- TMDB: read from law_order_tracker_app/data/tmdb_cache.json (no network needed).
- OMDb: IMDb, Rotten Tomatoes and Metacritic when OMDB_API_KEY is set.
- Trakt: public episode rating when TRAKT_CLIENT_ID is set.

Examples:
  python wolf_fetch_episode_ratings.py --write
  python wolf_fetch_episode_ratings.py --show "Law & Order" --limit 50 --write

After writing, optimized web JSON files are rebuilt automatically.
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

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "law_order_tracker_app" / "data"
EPISODES_JS = DATA / "episodes.js"
CACHE_PATH = DATA / "ratings_cache.json"
TMDB_CACHE_PATH = DATA / "tmdb_cache.json"
USER_AGENT = "Wolf-Universe-Watch-Tracker/3.0"


def load_window_array(path: Path, variable: str) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"window\.{re.escape(variable)}\s*=\s*(\[.*\])\s*;?\s*$", text, re.S)
    if not match:
        raise SystemExit(f"Could not parse {variable} from {path}")
    return json.loads(match.group(1))


def save_episodes(episodes: list[dict]) -> None:
    EPISODES_JS.write_text(
        "window.LAW_ORDER_EPISODES = " + json.dumps(episodes, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default
    except Exception:
        return default


def request_json(url: str, headers: dict | None = None, attempts: int = 3, timeout: int = 25):
    last_error = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
                raise
            retry_after = int(exc.headers.get("Retry-After", "0") or 0)
            time.sleep(retry_after or (attempt + 1) * 2)
        except Exception as exc:
            last_error = exc
            if attempt == attempts - 1:
                raise
            time.sleep(attempt + 1)
    raise last_error or RuntimeError("request failed")


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
    return {"tmdb": round(float(item.get("vote_average") or 0), 1), "tmdbVotes": int(item.get("vote_count") or 0)}


def fetch_omdb(ep: dict, cache: dict, api_key: str) -> dict:
    ttid = imdb_id(ep)
    if not api_key or not ttid:
        return {}
    key = f"omdb:{ttid}"
    if key in cache:
        return cache[key]
    url = "https://www.omdbapi.com/?" + urllib.parse.urlencode({"apikey": api_key, "i": ttid, "plot": "short"})
    data = request_json(url)
    result: dict = {}
    if data.get("Response") != "False":
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
    return result


def fetch_trakt(ep: dict, cache: dict, client_id: str) -> dict:
    trakt_id = (ep.get("traktIds") or {}).get("trakt")
    if not client_id or not trakt_id:
        return {}
    key = f"trakt:{trakt_id}"
    if key in cache:
        return cache[key]
    url = f"https://api.trakt.tv/episodes/{trakt_id}/ratings"
    try:
        data = request_json(url, {
            "trakt-api-version": "2",
            "trakt-api-key": client_id,
            "Content-Type": "application/json",
        })
        result = {"trakt": round(float(data.get("rating") or 0), 1), "traktVotes": int(data.get("votes") or 0)}
    except Exception as exc:
        result = {"error": str(exc)}
    cache[key] = result
    time.sleep(0.11)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--show", default="")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--refresh", action="store_true", help="ignore cached OMDb/Trakt results")
    args = parser.parse_args()

    episodes = load_window_array(EPISODES_JS, "LAW_ORDER_EPISODES")
    cache = {} if args.refresh else read_json(CACHE_PATH, {})
    tmdb_cache = read_json(TMDB_CACHE_PATH, {})
    omdb_key = os.environ.get("OMDB_API_KEY", "").strip()
    trakt_client_id = os.environ.get("TRAKT_CLIENT_ID", "").strip()
    checked = changed = 0

    for ep in episodes:
        if args.show and ep.get("show") != args.show:
            continue
        if args.limit and checked >= args.limit:
            break
        checked += 1
        before = json.dumps(ep.get("ratings") or {}, sort_keys=True)
        ratings = dict(ep.get("ratings") or {})
        ratings.update(apply_tmdb_rating(ep, tmdb_cache))
        ratings.update(fetch_omdb(ep, cache, omdb_key))
        ratings.update(fetch_trakt(ep, cache, trakt_client_id))
        ratings = {key: value for key, value in ratings.items() if key != "error" and value not in (None, "", [], {})}
        if ratings:
            ep["ratings"] = ratings
        if json.dumps(ratings, sort_keys=True) != before:
            changed += 1
            print(f"updated {ep.get('show')} {ep.get('code')} -> {ratings}")

    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(f"checked={checked} changed={changed} write={args.write}")
    if args.write:
        save_episodes(episodes)
        subprocess.run([sys.executable, str(ROOT / "wolf_build_web_data.py"), "--no-enrich"], check=True)


if __name__ == "__main__":
    main()
