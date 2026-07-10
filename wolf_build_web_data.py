#!/usr/bin/env python3
"""Build optimized browser data files from the canonical project sources.

Outputs:
- law_order_tracker_app/data/episodes.json
- law_order_tracker_app/data/wolf_artwork_base.js
- law_order_tracker_app/data/wolf_episode_artwork.json
- law_order_tracker_app/data/wolf_cast_index.json

It also enriches episodes.js with locally cached TMDB episode metadata (ratings,
missing summaries, runtimes and air dates) without making network requests.
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "law_order_tracker_app" / "data"
EPISODES_JS = DATA / "episodes.js"
EPISODES_JSON = DATA / "episodes.json"
ARTWORK_JS = DATA / "wolf_artwork.js"
ARTWORK_BASE_JS = DATA / "wolf_artwork_base.js"
EPISODE_ART_JSON = DATA / "wolf_episode_artwork.json"
CAST_JS = DATA / "wolf_cast_index.js"
CAST_JSON = DATA / "wolf_cast_index.json"
TMDB_CACHE = DATA / "tmdb_cache.json"


def parse_window_assignment(path: Path, variable: str):
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"window\.{re.escape(variable)}\s*=\s*([\[\{{].*[\]\}}])\s*;?\s*$", text, re.S)
    if not match:
        raise RuntimeError(f"Could not parse {variable} from {path}")
    return json.loads(match.group(1))


def write_window_assignment(path: Path, variable: str, value) -> None:
    path.write_text(
        f"window.{variable} = " + json.dumps(value, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )


def enrich_episodes(episodes: list[dict], cache: dict) -> dict:
    changed = 0
    ratings_added = 0
    overview_added = 0
    runtime_added = 0
    airdate_added = 0
    title_added = 0

    for ep in episodes:
        show_tmdb = (ep.get("showTraktIds") or {}).get("tmdb")
        season = ep.get("season")
        episode = ep.get("episode")
        if not show_tmdb or season in (None, "") or episode in (None, ""):
            continue
        item = cache.get(f"/tv/{show_tmdb}/season/{int(season)}/episode/{int(episode)}")
        if not isinstance(item, dict):
            continue

        before = json.dumps(ep, sort_keys=True, ensure_ascii=False)

        vote_count = int(item.get("vote_count") or 0)
        vote_average = item.get("vote_average")
        if vote_count > 0 and vote_average not in (None, ""):
            ratings = dict(ep.get("ratings") or {})
            if "tmdb" not in ratings:
                ratings["tmdb"] = round(float(vote_average), 1)
                ratings["tmdbVotes"] = vote_count
                ep["ratings"] = ratings
                ratings_added += 1

        if not ep.get("overview") and item.get("overview"):
            ep["overview"] = item["overview"]
            overview_added += 1
        if not ep.get("runtime") and item.get("runtime"):
            ep["runtime"] = item["runtime"]
            runtime_added += 1
        if not ep.get("airDate") and item.get("air_date"):
            ep["airDate"] = item["air_date"]
            airdate_added += 1
        if not ep.get("title") and item.get("name"):
            ep["title"] = item["name"]
            title_added += 1

        after = json.dumps(ep, sort_keys=True, ensure_ascii=False)
        if before != after:
            changed += 1

    return {
        "episodes_changed": changed,
        "ratings_added": ratings_added,
        "overviews_added": overview_added,
        "runtimes_added": runtime_added,
        "airdates_added": airdate_added,
        "titles_added": title_added,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-enrich", action="store_true", help="only rebuild optimized files")
    args = parser.parse_args()

    episodes = parse_window_assignment(EPISODES_JS, "LAW_ORDER_EPISODES")
    report = {}
    if not args.no_enrich and TMDB_CACHE.exists():
        cache = json.loads(TMDB_CACHE.read_text(encoding="utf-8"))
        report.update(enrich_episodes(episodes, cache))
        write_window_assignment(EPISODES_JS, "LAW_ORDER_EPISODES", episodes)

    EPISODES_JSON.write_text(
        json.dumps(episodes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    artwork = parse_window_assignment(ARTWORK_JS, "WOLF_ARTWORK")
    base = {key: value for key, value in artwork.items() if key != "episodes"}
    base["note"] = "Optimized base artwork. Episode stills load asynchronously from wolf_episode_artwork.json."
    write_window_assignment(ARTWORK_BASE_JS, "WOLF_ARTWORK", base)
    EPISODE_ART_JSON.write_text(
        json.dumps(artwork.get("episodes") or {}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    cast = parse_window_assignment(CAST_JS, "WOLF_CAST_INDEX")
    # Compact v3 format: actor portraits/names are deduplicated into a people
    # table; episode credits reference a numeric person index. The browser
    # decodes only the episode being opened instead of expanding 70k+ objects.
    people = []
    people_index = {}
    compact_by_episode = {}
    for episode_key, credits in (cast.get("byEpisode") or {}).items():
        compact_credits = []
        for raw in credits or []:
            if not isinstance(raw, dict):
                continue
            name = raw.get("name") or raw.get("actor") or ""
            if not name:
                continue
            profile = raw.get("profile") or raw.get("profile_path") or raw.get("image") or ""
            person_key = (name, profile)
            if person_key not in people_index:
                people_index[person_key] = len(people)
                people.append([name, profile])
            character = raw.get("character") or raw.get("role") or ""
            item = [people_index[person_key]]
            if character:
                item.append(character)
            compact_credits.append(item)
        compact_by_episode[episode_key] = compact_credits
    compact_cast = {
        "format": 3,
        "generatedAt": cast.get("generatedAt"),
        "minEpisodes": cast.get("minEpisodes"),
        "actorCount": cast.get("actorCount"),
        "actors": cast.get("actors") or {},
        "people": people,
        "byEpisode": compact_by_episode,
        "note": "Compact actor index. Episode credits reference people by numeric index."
    }
    CAST_JSON.write_text(
        json.dumps(compact_cast, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    report.update({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "episodes": len(episodes),
        "episode_artwork": len(artwork.get("episodes") or {}),
        "actors": len((cast or {}).get("actors") or {}),
        "cast_people": len(people),
        "cast_episode_rows": len((cast or {}).get("byEpisode") or {}),
    })
    (DATA / "web_data_build_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
