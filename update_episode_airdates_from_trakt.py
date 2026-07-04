#!/usr/bin/env python3
"""
Update the Law & Order tracker guide from Trakt for ALL configured shows.

What it does:
- Checks every episode currently in law_order_tracker_app/data/episodes.js.
- Updates air dates from Trakt using the show's local airing timezone when available
  (avoids UTC +1 day mistakes).
- Updates episode titles from Trakt when different.
- Adds episodes that exist on Trakt but are missing from the guide.
- Includes Trakt season 0 specials and marks them as specials.
- Captures show/season/episode artwork fields when Trakt returns them.
- Writes detailed reports listing every proposed/applied change.

Usage:
  python update_episode_airdates_from_trakt.py --dry-run
  python update_episode_airdates_from_trakt.py
  python update_episode_airdates_from_trakt.py --show "Law & Order"
  python update_episode_airdates_from_trakt.py --no-specials

Outputs:
  law_order_tracker_app/data/airdate_update_debug.json
  law_order_tracker_app/data/airdate_update_changes.csv
  law_order_tracker_app/data/trakt_artwork_metadata.json
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import sys
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone, date
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore

EPISODES_JS = Path("law_order_tracker_app/data/episodes.js")
CONFIG_JSON = Path("trakt_config.json")
TOKEN_JSON = Path("trakt_token.json")
DEBUG_JSON = Path("law_order_tracker_app/data/airdate_update_debug.json")
CHANGES_CSV = Path("law_order_tracker_app/data/airdate_update_changes.csv")
ARTWORK_JSON = Path("law_order_tracker_app/data/trakt_artwork_metadata.json")

SHOWS = {
    "Law & Order": "law-order",
    "Homicide: Life on the Street": "homicide-life-on-the-street",
    "Law & Order: SVU": "law-order-special-victims-unit",
    "Law & Order: Special Victims Unit": "law-order-special-victims-unit",
    "Criminal Intent": "law-order-criminal-intent",
    "Law & Order: Criminal Intent": "law-order-criminal-intent",
    "Trial by Jury": "law-order-trial-by-jury",
    "Law & Order: Trial by Jury": "law-order-trial-by-jury",
    "Conviction": "conviction",
    "Law & Order: UK": "law-order-uk",
    "Law & Order: LA": "law-order-la",
    "True Crime": "law-order-true-crime",
    "Law & Order True Crime": "law-order-true-crime",
    "Law & Order: Organized Crime": "law-order-organized-crime",
    "Law & Order Toronto: Criminal Intent": "law-order-toronto-criminal-intent",
    "Criminal Intent: Toronto": "law-order-toronto-criminal-intent",
    "New York Undercover": "new-york-undercover",
    "NY Undercover": "new-york-undercover",
    "Deadline": "deadline",
    "In Plain Sight": "in-plain-sight",
}

# Canonical display names used by your tracker.
SHOW_ALIASES = {
    "Law & Order: Special Victims Unit": "Law & Order: SVU",
    "Law & Order: Criminal Intent": "Criminal Intent",
    "Law & Order: Trial by Jury": "Trial by Jury",
    "Law & Order True Crime": "True Crime",
    "Criminal Intent: Toronto": "Law & Order Toronto: Criminal Intent",
    "NY Undercover": "New York Undercover",
}

# Some Trakt slugs are unstable or have duplicates. This lets you keep correcting them
# without touching the main logic.
SLUG_OVERRIDES = {
    "Law & Order: LA": ["law-order-la", "law-and-order-la"],
}


def canonical_show(name: str) -> str:
    return SHOW_ALIASES.get((name or "").strip(), (name or "").strip())


def slug_candidates(show: str) -> List[str]:
    return SLUG_OVERRIDES.get(show, [SHOWS[show]])


def load_trakt_headers() -> Dict[str, str]:
    if not CONFIG_JSON.exists():
        raise SystemExit("Missing trakt_config.json. Run from your project root after Trakt auth setup.")
    config = json.loads(CONFIG_JSON.read_text(encoding="utf-8"))
    client_id = config.get("client_id") or config.get("trakt_client_id")
    if not client_id:
        raise SystemExit("trakt_config.json is missing client_id")
    headers = {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": client_id,
        "User-Agent": "Law-Order-Watch-Tracker/2.0",
    }
    if TOKEN_JSON.exists():
        try:
            token = json.loads(TOKEN_JSON.read_text(encoding="utf-8"))
            access = token.get("access_token")
            if access:
                headers["Authorization"] = "Bearer " + access
        except Exception:
            pass
    return headers


def parse_episodes_js(path: Path) -> List[Dict[str, Any]]:
    text = path.read_text(encoding="utf-8-sig")
    m = re.search(r"window\.LAW_ORDER_EPISODES\s*=\s*(\[.*\])\s*;?\s*$", text, re.S)
    if not m:
        raise SystemExit(f"Could not parse {path}. Expected: window.LAW_ORDER_EPISODES = [...];")
    return json.loads(m.group(1))


def write_episodes_js(path: Path, episodes: List[Dict[str, Any]]) -> None:
    path.write_text(
        "window.LAW_ORDER_EPISODES = " + json.dumps(episodes, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )


def trakt_get(url: str, headers: Dict[str, str]) -> Any:
    r = requests.get(url, headers=headers, timeout=45)
    if r.status_code == 404:
        return None
    if r.status_code == 429:
        raise SystemExit("Trakt rate limit hit. Wait a few minutes and run again.")
    r.raise_for_status()
    return r.json()


def image_url(images: Any, preferred: Tuple[str, ...] = ("thumb", "medium", "full")) -> Optional[str]:
    """Extract a useful image URL from Trakt's possible images structure."""
    if not isinstance(images, dict):
        return None
    # Trakt image shapes may be {screenshot:{thumb,medium,full}} or {poster:{...}}
    for group in ("screenshot", "poster", "fanart", "thumb", "logo", "clearart", "banner"):
        val = images.get(group)
        if isinstance(val, str):
            return val
        if isinstance(val, dict):
            for size in preferred:
                if isinstance(val.get(size), str):
                    return val[size]
            for v in val.values():
                if isinstance(v, str):
                    return v
    for val in images.values():
        if isinstance(val, str):
            return val
        if isinstance(val, dict):
            for v in val.values():
                if isinstance(v, str):
                    return v
    return None


def local_air_date(first_aired: Optional[str], show_timezone: Optional[str]) -> Optional[str]:
    """Return the best display air date for Trakt first_aired.

    Trakt usually stores US evening broadcasts as UTC timestamps on the next
    calendar day (for example 2006-03-04T03:00Z for an episode that aired
    in the US on 2006-03-03). When the show exposes an airing timezone, we
    convert into that timezone. If it does not, we return the raw date and
    later protect existing guide rows from one-day timezone-only shifts.
    """
    if not first_aired:
        return None
    raw = str(first_aired)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return raw
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if show_timezone and ZoneInfo is not None:
            try:
                dt = dt.astimezone(ZoneInfo(show_timezone))
            except Exception:
                pass
        return dt.date().isoformat()
    except Exception:
        return raw[:10] if len(raw) >= 10 else None


def parse_ymd(value: Any) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def is_one_day_timezone_shift(existing: Any, proposed: Any, raw_first_aired: Any) -> bool:
    """True when a change is probably only a UTC/local-date mismatch.

    This prevents mass changes like 2006-03-03 -> 2006-03-04 while still
    allowing real corrections such as 1990-10-04 -> 1990-11-27.
    """
    old_d = parse_ymd(existing)
    new_d = parse_ymd(proposed)
    if not old_d or not new_d:
        return False
    if abs((new_d - old_d).days) != 1:
        return False
    raw = str(raw_first_aired or "")
    # Only guard timestamp-based Trakt dates. If Trakt ever gives date-only
    # values, those are already intended as broadcast dates.
    return bool("T" in raw or raw.endswith("Z") or "+" in raw)


@dataclass
class TraktEpisode:
    show: str
    slug: str
    season: int
    episode: int
    title: str
    air_date: Optional[str]
    overview: str
    trakt_ids: Dict[str, Any]
    image: Optional[str]
    season_image: Optional[str]
    show_image: Optional[str]
    is_special: bool
    raw_first_aired: Optional[str]


def fetch_show_full(slug: str, headers: Dict[str, str]) -> Dict[str, Any]:
    # full gives timezone; images may be returned when available.
    data = trakt_get(f"https://api.trakt.tv/shows/{slug}?extended=full,images", headers)
    return data if isinstance(data, dict) else {}


def fetch_show_episodes(show: str, slug: str, headers: Dict[str, str], include_specials: bool) -> Tuple[List[TraktEpisode], Dict[str, Any]]:
    show_info = fetch_show_full(slug, headers)
    show_tz = ((show_info.get("airs") or {}) if isinstance(show_info, dict) else {}).get("timezone")
    show_img = image_url(show_info.get("images"))
    meta = {
        "title": show_info.get("title") or show,
        "slug": slug,
        "year": show_info.get("year"),
        "ids": show_info.get("ids") or {},
        "timezone": show_tz,
        "image": show_img,
        "raw": {k: show_info.get(k) for k in ("title", "year", "status", "network", "runtime", "airs", "ids")},
    }

    episodes: List[TraktEpisode] = []
    # Try seasons endpoint first. It returns season 0 too if available.
    season_data = trakt_get(f"https://api.trakt.tv/shows/{slug}/seasons?extended=episodes,full,images", headers)
    if not isinstance(season_data, list):
        season_data = []

    for season in season_data:
        try:
            season_no = int(season.get("number"))
        except Exception:
            continue
        if season_no == 0 and not include_specials:
            continue
        season_img = image_url(season.get("images")) or show_img
        for ep in season.get("episodes") or []:
            try:
                ep_no = int(ep.get("number"))
            except Exception:
                continue
            first_aired = ep.get("first_aired")
            episodes.append(TraktEpisode(
                show=show,
                slug=slug,
                season=season_no,
                episode=ep_no,
                title=str(ep.get("title") or f"Episode {ep_no}"),
                air_date=local_air_date(first_aired, show_tz),
                overview=str(ep.get("overview") or ""),
                trakt_ids=ep.get("ids") or {},
                image=image_url(ep.get("images")),
                season_image=season_img,
                show_image=show_img,
                is_special=(season_no == 0),
                raw_first_aired=first_aired,
            ))

    # Fallback: fetch season by season if the all-seasons endpoint omits episode arrays.
    if not episodes:
        season_numbers = list(range(0 if include_specials else 1, 50))
        for season_no in season_numbers:
            season_eps = trakt_get(f"https://api.trakt.tv/shows/{slug}/seasons/{season_no}?extended=full,images", headers)
            if not isinstance(season_eps, list) or not season_eps:
                continue
            for ep in season_eps:
                try:
                    ep_no = int(ep.get("number"))
                except Exception:
                    continue
                first_aired = ep.get("first_aired")
                episodes.append(TraktEpisode(
                    show=show,
                    slug=slug,
                    season=season_no,
                    episode=ep_no,
                    title=str(ep.get("title") or f"Episode {ep_no}"),
                    air_date=local_air_date(first_aired, show_tz),
                    overview=str(ep.get("overview") or ""),
                    trakt_ids=ep.get("ids") or {},
                    image=image_url(ep.get("images")),
                    season_image=show_img,
                    show_image=show_img,
                    is_special=(season_no == 0),
                    raw_first_aired=first_aired,
                ))
    return episodes, meta


def get_ep_date(ep: Dict[str, Any]) -> str:
    return str(ep.get("airDate") or ep.get("air_date") or "")


def set_if_changed(row: Dict[str, Any], field: str, new_value: Any, changes: List[Dict[str, Any]], identity: Dict[str, Any]) -> None:
    if new_value in (None, ""):
        return
    old = row.get(field)
    if old != new_value:
        changes.append({**identity, "changeType": f"{field}_changed", "field": field, "old": old, "new": new_value})
        row[field] = new_value


def make_new_episode_row(te: TraktEpisode, next_temp_id: int) -> Dict[str, Any]:
    code = f"{te.season:02d}.{te.episode:02d}"
    row = {
        "id": f"{te.show}|{te.season}|{te.episode}|trakt-{next_temp_id}",
        "order": 999999 + next_temp_id,
        "status": "Not Started",
        "airDate": te.air_date or "",
        "show": te.show,
        "season": te.season,
        "episode": te.episode,
        "code": code,
        "title": te.title,
        "notes": "Special from Trakt" if te.is_special else "Added from Trakt",
        "sourceWatch": "Trakt",
        "era": "Specials" if te.is_special else "Added from Trakt",
        "sourceTab": "Trakt catalog update",
        "isSpecial": bool(te.is_special),
        "episodeType": "Special" if te.is_special else "Episode",
        "traktSlug": te.slug,
    }
    if te.overview:
        row["overview"] = te.overview
    if te.trakt_ids:
        row["traktIds"] = te.trakt_ids
    if te.image:
        row["image"] = te.image
    if te.season_image:
        row["seasonImage"] = te.season_image
    if te.show_image:
        row["showImage"] = te.show_image
    if te.raw_first_aired:
        row["traktFirstAired"] = te.raw_first_aired
    return row


def sort_key(ep: Dict[str, Any], original_index: int) -> Tuple[str, int, int, int, int]:
    air = get_ep_date(ep) or "9999-12-31"
    try: season = int(ep.get("season") or 0)
    except Exception: season = 0
    try: episode = int(ep.get("episode") or 0)
    except Exception: episode = 0
    try: old_order = int(ep.get("order") or original_index + 1)
    except Exception: old_order = original_index + 1
    return (air, old_order, season, episode, original_index)


def write_reports(changes: List[Dict[str, Any]], summary: Dict[str, Any], artwork: Dict[str, Any]) -> None:
    DEBUG_JSON.parent.mkdir(parents=True, exist_ok=True)
    DEBUG_JSON.write_text(json.dumps({"summary": summary, "changes": changes}, ensure_ascii=False, indent=2), encoding="utf-8")
    ARTWORK_JSON.write_text(json.dumps(artwork, ensure_ascii=False, indent=2), encoding="utf-8")
    fields = ["changeType", "show", "season", "episode", "title", "field", "old", "new", "traktSlug"]
    with CHANGES_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for ch in changes:
            writer.writerow(ch)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Report changes without modifying episodes.js")
    ap.add_argument("--show", action="append", help="Only update a specific show. Can be used multiple times.")
    ap.add_argument("--no-specials", action="store_true", help="Do not add/update season 0 specials")
    ap.add_argument("--no-add-missing", action="store_true", help="Only update existing guide rows; do not add missing Trakt episodes")
    ap.add_argument("--no-title-update", action="store_true", help="Do not update episode names")
    ap.add_argument("--no-image-update", action="store_true", help="Do not add/update image fields")
    ap.add_argument("--force-one-day-date-shifts", action="store_true", help="Also apply +/-1 day date changes caused by UTC/local timezone differences")
    args = ap.parse_args()

    if not EPISODES_JS.exists():
        raise SystemExit(f"Missing {EPISODES_JS}. Run from the repository root.")

    headers = load_trakt_headers()
    episodes = parse_episodes_js(EPISODES_JS)
    original_count = len(episodes)
    wanted = {canonical_show(x) for x in (args.show or [])}
    include_specials = not args.no_specials
    add_missing = not args.no_add_missing
    update_titles = not args.no_title_update
    update_images = not args.no_image_update
    force_one_day_date_shifts = args.force_one_day_date_shifts

    # Shows to update: all configured shows present in guide, plus configured shows requested.
    guide_shows = {canonical_show(str(ep.get("show", ""))) for ep in episodes if ep.get("show")}
    by_show = sorted(s for s in guide_shows if s in SHOWS)
    if wanted:
        by_show = [s for s in by_show if s in wanted]
        for s in wanted:
            if s in SHOWS and s not in by_show:
                by_show.append(s)

    # Current guide map.
    guide_map: Dict[Tuple[str, int, int], Dict[str, Any]] = {}
    max_order = 0
    for ep in episodes:
        try:
            key = (canonical_show(str(ep.get("show", ""))), int(ep.get("season")), int(ep.get("episode")))
            guide_map[key] = ep
            max_order = max(max_order, int(ep.get("order") or 0))
        except Exception:
            pass

    changes: List[Dict[str, Any]] = []
    artwork: Dict[str, Any] = {"shows": {}, "seasons": {}, "episodes": {}}
    show_summaries: Dict[str, Any] = {}
    next_temp_id = max_order + 1

    for show in by_show:
        print(f"Fetching Trakt catalog: {show}")
        all_trakt_eps: List[TraktEpisode] = []
        show_meta: Dict[str, Any] = {}
        used_slug = None
        last_error = None
        for slug in slug_candidates(show):
            try:
                trakt_eps, meta = fetch_show_episodes(show, slug, headers, include_specials=include_specials)
                if trakt_eps:
                    all_trakt_eps = trakt_eps
                    show_meta = meta
                    used_slug = slug
                    break
                # even zero episodes can be a valid response, but try other candidate slugs first
                show_meta = meta
                used_slug = slug
            except Exception as exc:
                last_error = str(exc)
                continue
        if not used_slug:
            print(f"  WARNING: no working slug for {show}: {last_error}")
            show_summaries[show] = {"error": last_error, "traktEpisodes": 0, "guideRows": 0}
            continue

        regular_count = sum(1 for te in all_trakt_eps if not te.is_special)
        special_count = sum(1 for te in all_trakt_eps if te.is_special)
        guide_count = sum(1 for ep in episodes if canonical_show(str(ep.get("show", ""))) == show)
        print(f"  Found {regular_count} regular + {special_count} specials on Trakt; guide has {guide_count} rows")

        artwork["shows"][show] = show_meta
        if show_meta.get("image"):
            for ep in episodes:
                if canonical_show(str(ep.get("show", ""))) == show and update_images and not ep.get("showImage"):
                    ep["showImage"] = show_meta["image"]

        added = 0
        updated = 0
        missing_existing = 0
        for te in all_trakt_eps:
            key = (show, te.season, te.episode)
            identity = {
                "show": show,
                "season": te.season,
                "episode": te.episode,
                "title": te.title,
                "traktSlug": te.slug,
            }
            artwork["episodes"][f"{show}|{te.season}|{te.episode}"] = {
                "title": te.title,
                "airDate": te.air_date,
                "isSpecial": te.is_special,
                "image": te.image,
                "seasonImage": te.season_image,
                "showImage": te.show_image,
                "ids": te.trakt_ids,
            }
            if te.season_image:
                artwork["seasons"][f"{show}|{te.season}"] = {"image": te.season_image, "show": show, "season": te.season}

            row = guide_map.get(key)
            if row is None:
                if add_missing:
                    new_row = make_new_episode_row(te, next_temp_id)
                    next_temp_id += 1
                    episodes.append(new_row)
                    guide_map[key] = new_row
                    added += 1
                    changes.append({**identity, "changeType": "missing_episode_added", "field": "row", "old": "", "new": new_row.get("id")})
                else:
                    missing_existing += 1
                continue

            before = deepcopy(row)
            # Preserve current status/id; update data fields only.
            if te.air_date and get_ep_date(row) != te.air_date:
                old_air = get_ep_date(row)
                if (not force_one_day_date_shifts) and is_one_day_timezone_shift(old_air, te.air_date, te.raw_first_aired):
                    changes.append({
                        **identity,
                        "changeType": "airDate_one_day_shift_ignored",
                        "field": "airDate",
                        "old": old_air,
                        "new": te.air_date,
                    })
                else:
                    changes.append({**identity, "changeType": "airDate_changed", "field": "airDate", "old": old_air, "new": te.air_date})
                    row["airDate"] = te.air_date
            if update_titles and te.title and str(row.get("title") or "") != te.title:
                # Avoid overwriting meaningful custom titles with generic text.
                if not re.fullmatch(r"Episode\s+\d+", te.title, re.I):
                    changes.append({**identity, "changeType": "title_changed", "field": "title", "old": row.get("title"), "new": te.title})
                    row["title"] = te.title
            # Mark season 0 and attach metadata.
            if te.is_special:
                set_if_changed(row, "isSpecial", True, changes, identity)
                set_if_changed(row, "episodeType", "Special", changes, identity)
            elif "episodeType" not in row:
                row["episodeType"] = "Episode"
            set_if_changed(row, "traktSlug", te.slug, changes, identity)
            if te.trakt_ids:
                set_if_changed(row, "traktIds", te.trakt_ids, changes, identity)
            if te.overview and not row.get("overview"):
                set_if_changed(row, "overview", te.overview, changes, identity)
            if te.raw_first_aired:
                set_if_changed(row, "traktFirstAired", te.raw_first_aired, changes, identity)
            if update_images:
                if te.image:
                    set_if_changed(row, "image", te.image, changes, identity)
                if te.season_image and not row.get("seasonImage"):
                    set_if_changed(row, "seasonImage", te.season_image, changes, identity)
                if te.show_image and not row.get("showImage"):
                    set_if_changed(row, "showImage", te.show_image, changes, identity)
            if row != before:
                updated += 1

        show_summaries[show] = {
            "slug": used_slug,
            "guideRowsBefore": guide_count,
            "traktRegularEpisodes": regular_count,
            "traktSpecials": special_count,
            "addedMissingRows": added,
            "updatedExistingRows": updated,
            "missingNotAdded": missing_existing,
        }

    # Recalculate chronological guide order after updates/additions, but keep IDs unchanged.
    indexed = list(enumerate(episodes))
    indexed.sort(key=lambda pair: sort_key(pair[1], pair[0]))
    reordered = [ep for _, ep in indexed]
    for i, ep in enumerate(reordered, start=1):
        ep["order"] = i

    summary = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "dryRun": args.dry_run,
        "originalEpisodeCount": original_count,
        "finalEpisodeCount": len(reordered),
        "addedEpisodeCount": len(reordered) - original_count,
        "changeCount": len(changes),
        "showsChecked": len(by_show),
        "showSummaries": show_summaries,
        "notes": [
            "Air dates are converted from Trakt first_aired into the show's airing timezone when Trakt exposes one.",
            "Existing guide dates are protected from +/-1 day UTC/local timezone shifts unless --force-one-day-date-shifts is used.",
            "Existing id/status fields are preserved so watched status mappings do not break.",
            "Season 0 rows are marked isSpecial=true and episodeType=Special.",
            "Artwork is saved only when Trakt returns image URLs; many Trakt API responses may not include artwork.",
        ],
    }
    write_reports(changes, summary, artwork)

    print(f"\nChecked shows: {len(by_show)}")
    print(f"Original guide rows: {original_count}")
    print(f"Final guide rows: {len(reordered)}")
    print(f"Rows added from Trakt: {len(reordered) - original_count}")
    print(f"Total changes reported: {len(changes)}")
    actual_air_changes = sum(1 for c in changes if c.get("changeType") == "airDate_changed")
    ignored_one_day = sum(1 for c in changes if c.get("changeType") == "airDate_one_day_shift_ignored")
    print(f"Actual air-date changes to apply: {actual_air_changes}")
    print(f"One-day timezone shifts ignored: {ignored_one_day}")
    for ch in changes[:80]:
        print(f"  {ch['changeType']}: {ch['show']} S{int(ch['season']):02d}E{int(ch['episode']):02d} {ch.get('field','')} {ch.get('old','')} -> {ch.get('new','')}")
    if len(changes) > 80:
        print(f"  ... plus {len(changes)-80} more")
    print(f"Report JSON: {DEBUG_JSON}")
    print(f"Changes CSV: {CHANGES_CSV}")
    print(f"Artwork/metadata JSON: {ARTWORK_JSON}")

    if args.dry_run:
        print("\nDry run: episodes.js was not modified.")
        return 0

    backup = EPISODES_JS.with_suffix(".js.bak")
    shutil.copy2(EPISODES_JS, backup)
    write_episodes_js(EPISODES_JS, reordered)
    print(f"\nSaved: {EPISODES_JS}")
    print(f"Backup: {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
