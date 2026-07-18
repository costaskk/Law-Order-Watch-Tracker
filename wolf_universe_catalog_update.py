#!/usr/bin/env python3
"""
Wolf Universe catalog updater for the tracker app.

Safe replacement version.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

TRAKT_BASE = "https://api.trakt.tv"
TMDB_BASE = "https://api.themoviedb.org/3"

EPISODES_JS = Path("law_order_tracker_app/data/episodes.js")
SHOWS_JSON = Path("wolf_universe_shows.json")
REPORT_JSON = Path("law_order_tracker_app/data/wolf_catalog_update_debug.json")
CHANGES_CSV = Path("law_order_tracker_app/data/wolf_catalog_update_changes.csv")
ARTWORK_JS = Path("law_order_tracker_app/data/wolf_artwork.js")
CONFIG_PATH = Path("trakt_config.json")

REQUEST_TIMEOUT = 30
REQUEST_SLEEP = 0.06


def load_dotenv_local() -> None:
    """Load simple KEY=VALUE pairs from .env.local so TMDB_API_KEY works locally."""
    env = Path('.env.local')
    if not env.exists():
        return
    for line in env.read_text(encoding='utf-8', errors='ignore').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value

DEFAULT_UNIVERSE: Dict[str, Any] = {
    "aliases": {
        "Law & Order: SVU": "Law & Order: Special Victims Unit",
        "Law & Order SVU": "Law & Order: Special Victims Unit",
        "Criminal Intent": "Law & Order: Criminal Intent",
        "Trial by Jury": "Law & Order: Trial by Jury",
        "True Crime": "Law & Order True Crime",
        "NY Undercover": "New York Undercover",
        "Chicago PD": "Chicago P.D.",
        "Chicago P.D": "Chicago P.D."
    },
    "shows": [
        {"show": "Law & Order", "slug": "law-order", "franchise": "Law & Order"},
        {"show": "Law & Order: Special Victims Unit", "slug": "law-order-special-victims-unit", "franchise": "Law & Order"},
        {"show": "Law & Order: Criminal Intent", "slug": "law-order-criminal-intent", "franchise": "Law & Order", "aliases": ["Criminal Intent"]},
        {"show": "Law & Order: Trial by Jury", "slug": "law-order-trial-by-jury", "franchise": "Law & Order", "aliases": ["Trial by Jury"]},
        {"show": "Law & Order: Organized Crime", "slug": "law-order-organized-crime", "franchise": "Law & Order"},
        {"show": "Law & Order: LA", "slug": "law-and-order-la", "alt_slugs": ["law-order-la", "law-order-los-angeles", "law-and-order-los-angeles"], "franchise": "Law & Order", "optional": True},
        {"show": "Law & Order: UK", "slug": "law-order-uk", "franchise": "Law & Order"},
        {"show": "Law & Order True Crime", "slug": "law-order-true-crime", "franchise": "Law & Order", "aliases": ["True Crime"]},
        {"show": "Law & Order Toronto: Criminal Intent", "slug": "law-order-toronto-criminal-intent", "franchise": "Law & Order"},
        {"show": "Homicide: Life on the Street", "slug": "homicide-life-on-the-street", "franchise": "Law & Order"},
        {"show": "New York Undercover", "slug": "new-york-undercover", "franchise": "Law & Order"},
        {"show": "Deadline", "slug": "deadline", "franchise": "Law & Order"},
        {"show": "Conviction", "slug": "conviction", "franchise": "Law & Order"},
        {"show": "In Plain Sight", "slug": "in-plain-sight", "franchise": "Crossover Adjacent"},
        {"show": "Chicago Fire", "slug": "chicago-fire", "franchise": "One Chicago"},
        {"show": "Chicago P.D.", "slug": "chicago-p-d", "alt_slugs": ["chicago-pd"], "franchise": "One Chicago"},
        {"show": "Chicago Med", "slug": "chicago-med", "franchise": "One Chicago"},
        {"show": "Chicago Justice", "slug": "chicago-justice", "franchise": "One Chicago"},
        {"show": "FBI", "slug": "fbi", "franchise": "FBI"},
        {"show": "FBI: Most Wanted", "slug": "fbi-most-wanted", "franchise": "FBI"},
        {"show": "FBI: International", "slug": "fbi-international", "franchise": "FBI"},
        {"show": "CIA (2026)", "slug": "cia-2026", "alt_slugs": ["fbi-cia-2026"], "imdb": "tt35515227", "franchise": "FBI", "optional": True},
        {"show": "Crime & Punishment", "slug": "crime-punishment", "franchise": "Crossover Adjacent", "optional": True},
        {"show": "Mann & Machine", "slug": "mann-machine", "franchise": "Crossover Adjacent", "optional": True},
        {"show": "Players", "slug": "players", "alt_slugs": ["players-1997"], "franchise": "Crossover Adjacent", "optional": True},
        {"show": "New York News", "slug": "new-york-news", "franchise": "Crossover Adjacent", "optional": True},
        {"show": "Arrest & Trial", "slug": "arrest-trial", "alt_slugs": ["arrest-and-trial"], "franchise": "Crossover Adjacent", "optional": True},
        {"show": "Cold Justice", "slug": "cold-justice", "franchise": "Crossover Adjacent", "optional": True},
        {"show": "Blood & Money", "slug": "blood-money-2023", "alt_slugs": ["blood-money", "blood-and-money"], "imdb": "tt26746481", "franchise": "Crossover Adjacent", "optional": True},
        {"show": "LA Fire & Rescue", "slug": "la-fire-rescue", "alt_slugs": ["la-fire-and-rescue"], "franchise": "Crossover Adjacent", "optional": True},
        {"show": "On Call", "slug": "on-call", "franchise": "Crossover Adjacent", "optional": True}
    ],
    "movies": [
        {"show": "Exiled: A Law & Order Movie", "slug": "exiled-a-law-order-movie", "alt_slugs": ["exiled"], "franchise": "Wolf Specials", "optional": True},
        {"show": "Homicide: The Movie", "slug": "homicide-the-movie", "imdb": "tt0226771", "franchise": "Wolf Specials", "optional": True},
        {"show": "The Invisible Man", "slug": "the-invisible-man-1998", "alt_slugs": ["the-invisible-man"], "imdb": "tt0275427", "franchise": "Wolf Specials", "optional": True}
    ]
}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=False) + "\n", encoding="utf-8")


def merge_universe(custom: Dict[str, Any]) -> Dict[str, Any]:
    merged = json.loads(json.dumps(DEFAULT_UNIVERSE))
    merged["aliases"].update(custom.get("aliases") or {})
    for key in ("scopes", "removeShows", "removeTraktSlugs", "removeImdbIds", "removeTraktShowIds"):
        if key in custom:
            merged[key] = custom[key]
    by_show = {x["show"]: x for x in merged["shows"]}
    for item in custom.get("shows") or []:
        base = by_show.get(item.get("show"), {})
        base.update(item)
        by_show[item["show"]] = base
    merged["shows"] = list(by_show.values())
    by_movie = {x["show"]: x for x in merged["movies"]}
    for item in custom.get("movies") or []:
        base = by_movie.get(item.get("show"), {})
        base.update(item)
        by_movie[item["show"]] = base
    merged["movies"] = list(by_movie.values())
    return merged


def load_universe() -> Dict[str, Any]:
    if SHOWS_JSON.exists():
        return merge_universe(read_json(SHOWS_JSON))
    write_json(SHOWS_JSON, DEFAULT_UNIVERSE)
    return DEFAULT_UNIVERSE


def load_config() -> Dict[str, str]:
    if CONFIG_PATH.exists():
        cfg = read_json(CONFIG_PATH)
    else:
        cfg = {
            "client_id": os.environ.get("TRAKT_CLIENT_ID", ""),
            "client_secret": os.environ.get("TRAKT_CLIENT_SECRET", "")
        }
    if not cfg.get("client_id"):
        raise SystemExit("Missing Trakt client_id. Create trakt_config.json or set TRAKT_CLIENT_ID.")
    return cfg


def trakt_headers(cfg: Dict[str, str]) -> Dict[str, str]:
    return {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": cfg["client_id"],
        "User-Agent": "Wolf-Universe-Watch-Tracker/1.1"
    }


def get_json(url: str, headers: Dict[str, str], optional: bool = False, sleep: float = REQUEST_SLEEP, retries: int = 3) -> Any:
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
            if optional and r.status_code in (404, 405):
                return None
            if r.status_code == 429:
                retry = int(r.headers.get("Retry-After", "5"))
                print(f"    Rate limited; sleeping {retry}s")
                time.sleep(retry)
                continue
            r.raise_for_status()
            if sleep:
                time.sleep(sleep)
            return r.json()
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(1.2 * attempt)
                continue
            if optional:
                return None
            raise
    if last_exc:
        raise last_exc
    return None


def first_working_slug(kind: str, item: Dict[str, Any], headers: Dict[str, str]) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    slugs = [item["slug"]] + list(item.get("alt_slugs") or [])
    seen = set()
    for slug in slugs:
        if not slug or slug in seen:
            continue
        seen.add(slug)
        data = get_json(f"{TRAKT_BASE}/{kind}/{slug}?extended=full", headers, optional=True)
        if data:
            if slug != item["slug"]:
                print(f"  Resolved slug: {item['slug']} -> {slug}")
            return slug, data
    return None, None


def load_episodes() -> List[Dict[str, Any]]:
    txt = EPISODES_JS.read_text(encoding="utf-8")
    start = txt.find("[")
    end = txt.rfind("]")
    if start < 0 or end < 0:
        raise SystemExit(f"Could not parse {EPISODES_JS}")
    return json.loads(txt[start:end + 1])


def save_episodes(eps: List[Dict[str, Any]]) -> None:
    eps.sort(key=sort_key)
    for i, ep in enumerate(eps, 1):
        ep["order"] = i
        ep["code"] = build_code(ep)
        if not ep.get("id") or str(ep.get("id", "")).startswith("trakt-"):
            ep["id"] = stable_id(ep)
    EPISODES_JS.write_text("window.LAW_ORDER_EPISODES = " + json.dumps(eps, indent=2, ensure_ascii=False) + ";\n", encoding="utf-8")


def safe_int(v: Any, default: int = 0) -> int:
    try:
        if v is None or v == "":
            return default
        return int(v)
    except Exception:
        return default


def norm_text(s: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower().replace("&", "and")).strip()


def build_code(ep: Dict[str, Any]) -> str:
    s = safe_int(ep.get("season"))
    e = safe_int(ep.get("episode"))
    if ep.get("isMovie"):
        return "MOVIE"
    if ep.get("isSpecial") or s == 0:
        return f"S00.{e:02d}"
    return f"{s:02d}.{e:02d}"


def stable_id(ep: Dict[str, Any]) -> str:
    show = ep.get("show") or "Unknown"
    s = safe_int(ep.get("season"))
    e = safe_int(ep.get("episode"))
    kind = "movie" if ep.get("isMovie") else "special" if ep.get("isSpecial") or s == 0 else "episode"
    tid = ((ep.get("traktIds") or {}).get("trakt")) or ""
    return f"{show}|{s}|{e}|{kind}|{tid}" if tid else f"{show}|{s}|{e}|{kind}"


def sort_key(ep: Dict[str, Any]) -> Tuple[str, int, int, int, str]:
    date = ep.get("airDate") or "9999-12-31"
    return (date, safe_int(ep.get("isSpecial") or safe_int(ep.get("season")) == 0), safe_int(ep.get("season")), safe_int(ep.get("episode")), str(ep.get("show")))


def date_from_first_aired(first: Any) -> str:
    if not first:
        return ""
    s = str(first)
    return s[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", s) else ""


def should_update_airdate(old: str, new: str) -> bool:
    if not new:
        return False
    if not old:
        return True
    if old == new:
        return False
    try:
        d_old = datetime.fromisoformat(old).date()
        d_new = datetime.fromisoformat(new).date()
        if abs((d_new - d_old).days) == 1:
            return False
    except Exception:
        pass
    return True


def update_field(ep: Dict[str, Any], field: str, value: Any, changes: List[Dict[str, Any]], row_label: str, force: bool = False) -> None:
    if value in (None, "", [], {}):
        return
    old = ep.get(field)
    if force or old in (None, "", [], {}) or old != value:
        if old != value:
            ep[field] = value
            changes.append({"type": f"{field}_changed", "row": row_label, "old": old, "new": value})


def fetch_show_catalog(cfg: Dict[str, str], item: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]], Optional[str]]:
    headers = trakt_headers(cfg)
    slug, show = first_working_slug("shows", item, headers)
    if not slug or not show:
        return None, [], None
    seasons = get_json(f"{TRAKT_BASE}/shows/{slug}/seasons?extended=episodes,full", headers, optional=item.get("optional", False)) or []
    episodes = []
    for season in seasons:
        sn = season.get("number")
        if not isinstance(sn, int):
            continue
        for tr_ep in season.get("episodes") or []:
            en = tr_ep.get("number")
            if not isinstance(en, int):
                continue
            first = tr_ep.get("first_aired") or ""
            episodes.append({
                "show": item["show"],
                "franchise": item.get("franchise", "Wolf Universe"),
                "season": sn,
                "episode": en,
                "code": f"{sn:02d}.{en:02d}" if sn != 0 else f"S00.{en:02d}",
                "title": tr_ep.get("title") or "",
                "airDate": date_from_first_aired(first),
                "notes": "Special" if sn == 0 else "",
                "era": item.get("franchise", "Wolf Universe"),
                "sourceTab": "Trakt API",
                "sourceWatch": "",
                "status": "Not Started",
                "isSpecial": sn == 0,
                "isMovie": False,
                "traktSlug": slug,
                "traktFirstAired": first,
                "overview": tr_ep.get("overview") or "",
                "traktIds": tr_ep.get("ids") or {},
                "showTraktIds": (show.get("ids") or {}),
                "network": show.get("network") or "",
                "runtime": tr_ep.get("runtime") or show.get("runtime") or None,
                "country": show.get("country") or "",
                "language": show.get("language") or ""
            })
    return show, episodes, slug


def fetch_movie_catalog(cfg: Dict[str, str], item: Dict[str, Any], used_episode_number: int) -> Optional[Dict[str, Any]]:
    headers = trakt_headers(cfg)
    slug, movie = first_working_slug("movies", item, headers)
    if not slug or not movie:
        return None
    released = movie.get("released") or ""
    return {
        "show": item["show"],
        "franchise": item.get("franchise", "Wolf Specials"),
        "season": 0,
        "episode": used_episode_number,
        "code": "MOVIE",
        "title": movie.get("title") or item["show"],
        "airDate": released,
        "notes": "TV movie / special",
        "era": item.get("franchise", "Wolf Specials"),
        "sourceTab": "Trakt API",
        "sourceWatch": "",
        "status": "Not Started",
        "isSpecial": True,
        "isMovie": True,
        "traktSlug": slug,
        "traktFirstAired": released,
        "overview": movie.get("overview") or "",
        "traktIds": movie.get("ids") or {},
        "showTraktIds": movie.get("ids") or {},
        "runtime": movie.get("runtime") or None,
        "network": "",
        "country": movie.get("country") or "",
        "language": movie.get("language") or ""
    }


def tmdb_get(api_key: str, path: str) -> Optional[Dict[str, Any]]:
    if not api_key:
        return None
    r = requests.get(f"{TMDB_BASE}{path}", params={"api_key": api_key}, timeout=REQUEST_TIMEOUT)
    if r.status_code == 404:
        return None
    if r.status_code == 429:
        time.sleep(2)
        r = requests.get(f"{TMDB_BASE}{path}", params={"api_key": api_key}, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    time.sleep(0.035)
    return r.json()


def load_existing_artwork() -> Dict[str, Any]:
    if not ARTWORK_JS.exists():
        return {"shows": {}, "seasons": {}, "episodes": {}}
    txt = ARTWORK_JS.read_text(encoding="utf-8", errors="ignore")
    start = txt.find("{")
    end = txt.rfind("}")
    if start < 0 or end < 0:
        return {"shows": {}, "seasons": {}, "episodes": {}}
    try:
        data = json.loads(txt[start:end + 1])
        data.setdefault("shows", {})
        data.setdefault("seasons", {})
        data.setdefault("episodes", {})
        return data
    except Exception:
        return {"shows": {}, "seasons": {}, "episodes": {}}


def tmdb_image(path: Optional[str], size: str = "w780") -> str:
    return f"https://image.tmdb.org/t/p/{size}{path}" if path else ""


def enrich_artwork(eps: List[Dict[str, Any]], catalog: Dict[str, Any], show_items: List[Dict[str, Any]], episode_artwork: bool = False, episode_limit: int = 0) -> Dict[str, Any]:
    api_key = os.environ.get("TMDB_API_KEY", "").strip()
    artwork: Dict[str, Any] = load_existing_artwork()
    artwork.setdefault("shows", {})
    artwork.setdefault("seasons", {})
    artwork.setdefault("episodes", {})
    artwork["generatedAt"] = datetime.now(timezone.utc).isoformat()
    if not api_key:
        artwork["note"] = "No TMDB_API_KEY was set, so generated SVG artwork placeholders will be used."
        return artwork
    print("Fetching TMDB show/season artwork...")
    for item in show_items:
        show_name = item["show"]
        tmdb_id = (catalog.get(show_name) or {}).get("ids", {}).get("tmdb")
        if not tmdb_id:
            continue
        try:
            tv = tmdb_get(api_key, f"/tv/{tmdb_id}")
            if tv:
                artwork["shows"][show_name] = {"poster": tmdb_image(tv.get("poster_path"), "w500"), "backdrop": tmdb_image(tv.get("backdrop_path"), "w1280"), "tmdb": tmdb_id}
                for s in tv.get("seasons") or []:
                    sn = s.get("season_number")
                    poster = tmdb_image(s.get("poster_path"), "w500")
                    if sn is not None and poster:
                        artwork["seasons"][f"{show_name}|{sn}"] = {"poster": poster}
        except Exception as exc:
            artwork.setdefault("errors", []).append({"show": show_name, "error": str(exc)})
    if not episode_artwork:
        artwork["episodeStillMode"] = "disabled; rerun with --episode-artwork to fetch episode stills"
        return artwork
    print(f"Fetching TMDB episode stills, limit={episode_limit or 'none'}...")
    target_show = os.environ.get("EPISODE_ARTWORK_SHOW", "").strip()
    force_episode_art = os.environ.get("FORCE_EPISODE_ARTWORK", "0") == "1"
    fetched = 0
    for ep in eps:
        if episode_limit and fetched >= episode_limit:
            break
        tmdb_id = (ep.get("showTraktIds") or {}).get("tmdb")
        if not tmdb_id or ep.get("isMovie"):
            continue
        s, e = safe_int(ep.get("season")), safe_int(ep.get("episode"))
        if s <= 0 or e <= 0:
            continue
        key = f"{ep.get('show')}|{s}|{e}"
        if target_show and ep.get("show") != target_show:
            continue
        if key in artwork["episodes"] and not force_episode_art:
            continue
        try:
            tv_ep = tmdb_get(api_key, f"/tv/{tmdb_id}/season/{s}/episode/{e}?append_to_response=credits")
            if tv_ep:
                still = tmdb_image(tv_ep.get("still_path"), "w780")
                if still:
                    artwork["episodes"][key] = {"still": still}
                else:
                    artwork.setdefault("missingEpisodeStills", []).append(key)

                # Add episode-level cast metadata to episodes.js when TMDB provides it.
                credits = tv_ep.get("credits") or {}
                cast_rows = []
                for person in (credits.get("guest_stars") or []) + (credits.get("cast") or []):
                    name = (person.get("name") or "").strip()
                    if not name:
                        continue
                    cast_rows.append({"name": name, "character": person.get("character") or ""})
                    if len(cast_rows) >= 35:
                        break
                if cast_rows:
                    ep["cast"] = cast_rows
                crew = credits.get("crew") or []
                directors = [x.get("name") for x in crew if x.get("job") == "Director" and x.get("name")]
                writers = [x.get("name") for x in crew if x.get("department") == "Writing" and x.get("name")]
                if directors:
                    ep["directors"] = sorted(set(directors))
                if writers:
                    ep["writers"] = sorted(set(writers))
            fetched += 1
            if fetched % 50 == 0:
                print(f"  episode metadata/artwork checked: {fetched}")
        except Exception as exc:
            artwork.setdefault("episodeErrors", []).append({"key": key, "error": str(exc)})
            continue
    artwork["episodeStillChecked"] = fetched
    return artwork


def make_svg_assets(show_items: List[Dict[str, Any]]) -> None:
    assets = Path("law_order_tracker_app/assets")
    assets.mkdir(parents=True, exist_ok=True)
    palette = {"Law & Order": "#b91c1c", "One Chicago": "#dc2626", "FBI": "#1d4ed8", "Crossover Adjacent": "#d97706", "Wolf Specials": "#525252"}
    for item in show_items:
        name = item["show"]
        filename = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_") + ".svg"
        path = assets / filename
        if path.exists():
            continue
        color = palette.get(item.get("franchise"), "#334155")
        abbr = "".join([w[0] for w in re.findall(r"[A-Za-z0-9]+", name)[:4]]).upper() or "W"
        safe_name = name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="{color}"/><stop offset="1" stop-color="#050712"/></linearGradient></defs>
  <rect width="900" height="520" rx="42" fill="url(#g)"/>
  <circle cx="760" cy="90" r="180" fill="rgba(255,255,255,.08)"/>
  <text x="50%" y="46%" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="110" font-weight="900" fill="white">{abbr}</text>
  <text x="50%" y="64%" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="rgba(255,255,255,.88)">{safe_name}</text>
</svg>"""
        path.write_text(svg, encoding="utf-8")


def update_show_themes(show_items: List[Dict[str, Any]], artwork: Dict[str, Any]) -> None:
    path = Path("law_order_tracker_app/data/show_themes.js")
    try:
        txt = path.read_text(encoding="utf-8")
        themes = json.loads(txt[txt.find("{"):txt.rfind("}") + 1])
    except Exception:
        themes = {}
    franchise_colors = {"Law & Order": ("#b91c1c", "#111827", "#fecaca"), "One Chicago": ("#dc2626", "#1c1917", "#fecaca"), "FBI": ("#1d4ed8", "#0f172a", "#bfdbfe"), "Crossover Adjacent": ("#d97706", "#1c1917", "#fde68a"), "Wolf Specials": ("#525252", "#171717", "#e5e5e5")}
    for item in show_items:
        show = item["show"]
        primary, secondary, accent = franchise_colors.get(item.get("franchise"), ("#475569", "#0f172a", "#e2e8f0"))
        filename = re.sub(r"[^A-Za-z0-9]+", "_", show).strip("_") + ".svg"
        abbr = "".join([w[0] for w in re.findall(r"[A-Za-z0-9]+", show)[:4]]).upper() or "W"
        img = (artwork.get("shows", {}).get(show, {}) or {}).get("backdrop") or f"assets/{filename}"
        old = themes.get(show, {})
        themes[show] = {**old, "primary": old.get("primary", primary), "secondary": old.get("secondary", secondary), "accent": old.get("accent", accent), "abbr": old.get("abbr", abbr), "image": img, "franchise": item.get("franchise", "Wolf Universe")}
    path.write_text("window.SHOW_THEMES = " + json.dumps(themes, indent=2, ensure_ascii=False) + ";\n", encoding="utf-8")


def update_app_title() -> None:
    html = Path("law_order_tracker_app/index.html")
    if html.exists():
        txt = html.read_text(encoding="utf-8")
        txt = txt.replace("Law & Order Master Watch Tracker", "Wolf Universe Watch Tracker")
        txt = txt.replace("L&amp;O", "WOLF").replace(">L&O<", ">WOLF<")
        txt = txt.replace("Chronological guide • Trakt sync • mobile-friendly app", "Law & Order • One Chicago • FBI • crossovers • specials")
        if 'data/wolf_artwork.js' not in txt:
            txt = txt.replace('<script src="data/show_themes.js"></script><script src="data/episodes.js"></script>', '<script src="data/show_themes.js"></script><script src="data/wolf_artwork.js"></script><script src="data/episodes.js"></script>')
        html.write_text(txt, encoding="utf-8")
    root = Path("index.html")
    if root.exists():
        r = root.read_text(encoding="utf-8").replace("Law & Order Master Watch Tracker", "Wolf Universe Watch Tracker")
        root.write_text(r, encoding="utf-8")


def patch_app_js() -> None:
    path = Path("law_order_tracker_app/app.js")
    if not path.exists():
        return
    txt = path.read_text(encoding="utf-8")
    if "const artworkMeta = window.WOLF_ARTWORK" not in txt:
        txt = txt.replace("const themes = window.SHOW_THEMES || {};", "const themes = window.SHOW_THEMES || {};\nconst artworkMeta = window.WOLF_ARTWORK || { shows: {}, seasons: {}, episodes: {} };")
    if "function episodeArtwork(ep)" not in txt:
        txt = re.sub(r"function artwork\(show\) \{.*?\n\}\n\nfunction setImageSafe", """function artwork(show) {
  const art = (artworkMeta.shows || {})[show] || {};
  if (art.backdrop || art.poster) return art.backdrop || art.poster;
  const t = theme(show);
  if (t.image) return t.image;
  const abbr = encodeURIComponent(t.abbr || String(show || 'WOLF').slice(0, 4));
  const color = encodeURIComponent((t.primary || '#b91c1c').replace('#',''));
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='520'%3E%3Crect width='900' height='520' fill='%23${color}'/%3E%3Ctext x='50%25' y='52%25' text-anchor='middle' dominant-baseline='middle' font-family='Arial' font-size='96' font-weight='900' fill='white'%3E${abbr}%3C/text%3E%3C/svg%3E`;
}

function episodeArtwork(ep) {
  const key = `${ep.show}|${Number(ep.season)||0}|${Number(ep.episode)||0}`;
  const art = (artworkMeta.episodes || {})[key] || {};
  const seasonArt = (artworkMeta.seasons || {})[`${ep.show}|${Number(ep.season)||0}`] || {};
  return art.still || seasonArt.poster || artwork(ep.show);
}

function setImageSafe""", txt, flags=re.S)
    txt = txt.replace('setImageSafe(poster, artwork(next.show));', 'setImageSafe(poster, episodeArtwork(next));')
    txt = txt.replace('src="${esc(artwork(ep.show))}"', 'src="${esc(episodeArtwork(ep))}"')
    txt = txt.replace("Your Law & Order universe tracker is complete.", "Your Wolf Universe tracker is complete.")
    path.write_text(txt, encoding="utf-8")


def write_reports(report: Dict[str, Any], changes: List[Dict[str, Any]]) -> None:
    write_json(REPORT_JSON, report)
    CHANGES_CSV.parent.mkdir(parents=True, exist_ok=True)
    with CHANGES_CSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["type", "row", "old", "new"])
        writer.writeheader()
        for c in changes:
            writer.writerow({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v for k, v in c.items()})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-artwork", action="store_true")
    ap.add_argument("--episode-artwork", action="store_true", help="Also fetch TMDB episode stills. Slower.")
    ap.add_argument("--episode-artwork-limit", type=int, default=0, help="Limit TMDB episode still checks. 0 = no limit.")
    ap.add_argument("--episode-artwork-show", default="", help="Only fetch episode stills for one show, e.g. Law & Order.")
    ap.add_argument("--force-episode-artwork", action="store_true", help="Retry episodes even if an artwork key already exists.")
    args = ap.parse_args()

    cfg = load_config()
    universe = load_universe()
    show_items = universe["shows"]
    movie_items = universe.get("movies", [])
    aliases = universe.get("aliases", {})

    eps = load_episodes()
    original_rows = len(eps)

    # Remove known false-positive catalogue matches before refreshing.  Trakt
    # contains several identically named, unrelated shows (notably the 1951
    # Dragnet, 1981 Blood & Money, 2006 South Beach and 2000 Invisible Man).
    remove_shows = {norm_text(v) for v in universe.get("removeShows", [])}
    remove_slugs = {norm_text(v) for v in universe.get("removeTraktSlugs", [])}
    remove_imdb = {str(v).lower() for v in universe.get("removeImdbIds", [])}
    remove_trakt = {safe_int(v) for v in universe.get("removeTraktShowIds", [])}

    def excluded_row(ep: Dict[str, Any]) -> bool:
        show_ids = ep.get("showTraktIds") or {}
        return (
            norm_text(ep.get("show")) in remove_shows
            or norm_text(show_ids.get("slug") or ep.get("showSlug") or "") in remove_slugs
            or str(show_ids.get("imdb") or "").lower() in remove_imdb
            or safe_int(show_ids.get("trakt")) in remove_trakt
        )

    eps = [ep for ep in eps if not excluded_row(ep)]
    for ep in eps:
        if ep.get("show") in aliases:
            ep["show"] = aliases[ep["show"]]
        item = next((x for x in show_items if x["show"] == ep.get("show")), None)
        if item:
            ep.setdefault("franchise", item.get("franchise"))

    existing = {(norm_text(ep.get("show")), safe_int(ep.get("season")), safe_int(ep.get("episode")), bool(ep.get("isMovie"))): ep for ep in eps}

    changes: List[Dict[str, Any]] = []
    show_catalog: Dict[str, Dict[str, Any]] = {}
    failed: List[Dict[str, Any]] = []
    added = 0

    print("Wolf Universe catalog update")
    print(f"Original guide rows: {len(eps)}")

    for item in show_items:
        print(f"Fetching Trakt catalog: {item['show']} ({item['slug']})")
        try:
            show, tr_eps, resolved_slug = fetch_show_catalog(cfg, item)
        except Exception as exc:
            failed.append({"show": item["show"], "slug": item["slug"], "error": str(exc)})
            print(f"  WARNING failed: {exc}")
            continue
        if not show:
            print("  Not found/unsupported; skipped")
            failed.append({"show": item["show"], "slug": item["slug"], "error": "not found"})
            continue

        show_catalog[item["show"]] = show
        regular = sum(1 for e in tr_eps if not e.get("isSpecial"))
        specials = sum(1 for e in tr_eps if e.get("isSpecial"))
        print(f"  Found {regular} regular + {specials} specials")

        for tr_ep in tr_eps:
            key = (norm_text(tr_ep["show"]), safe_int(tr_ep["season"]), safe_int(tr_ep["episode"]), False)
            row_label = f"{tr_ep['show']} S{safe_int(tr_ep['season']):02d}E{safe_int(tr_ep['episode']):02d}"
            ep = existing.get(key)

            if not ep:
                tr_ep["id"] = stable_id(tr_ep)
                eps.append(tr_ep)
                existing[key] = tr_ep
                added += 1
                changes.append({"type": "missing_episode_added", "row": row_label, "old": "", "new": tr_ep["id"]})
                continue

            if should_update_airdate(str(ep.get("airDate") or ""), tr_ep.get("airDate") or ""):
                update_field(ep, "airDate", tr_ep.get("airDate"), changes, row_label, force=True)

            for f in ["title", "overview", "traktSlug", "traktFirstAired", "traktIds", "showTraktIds", "franchise", "network", "runtime", "country", "language", "isSpecial"]:
                update_field(ep, f, tr_ep.get(f), changes, row_label)

    for item in movie_items:
        print(f"Fetching Trakt movie/special: {item['show']} ({item['slug']})")
        try:
            # A movie is one canonical guide row.  Earlier versions allocated
            # the next season-zero number on every refresh and created a new
            # duplicate each time.
            movie_ep = fetch_movie_catalog(cfg, item, 1)
        except Exception as exc:
            failed.append({"movie": item["show"], "slug": item["slug"], "error": str(exc)})
            print(f"  WARNING failed: {exc}")
            continue
        if not movie_ep:
            print("  Not found/unsupported; skipped")
            continue
        key = (norm_text(movie_ep["show"]), 0, 1, True)
        current_movie = next((e for e in eps if norm_text(e.get("show")) == key[0] and e.get("isMovie")), None)
        if current_movie:
            for field, value in movie_ep.items():
                update_field(current_movie, field, value, changes, movie_ep["show"], force=field in {"episode", "airDate", "traktIds", "showTraktIds"})
            current_movie["episode"] = 1
            current_movie["id"] = stable_id(current_movie)
            # Collapse any duplicates left by older updater versions.
            eps = [e for e in eps if e is current_movie or not (norm_text(e.get("show")) == key[0] and e.get("isMovie"))]
            existing[key] = current_movie
        else:
            movie_ep["id"] = stable_id(movie_ep)
            eps.append(movie_ep)
            existing[key] = movie_ep
            added += 1
            changes.append({"type": "movie_added", "row": movie_ep["show"], "old": "", "new": movie_ep["id"]})

    artwork = {"shows": {}, "seasons": {}, "episodes": {}, "generatedAt": datetime.now(timezone.utc).isoformat(), "note": "Artwork skipped."}
    if not args.no_artwork:
        try:
            if getattr(args, "episode_artwork_show", ""):
                os.environ["EPISODE_ARTWORK_SHOW"] = args.episode_artwork_show
            if getattr(args, "force_episode_artwork", False):
                os.environ["FORCE_EPISODE_ARTWORK"] = "1"
            artwork = enrich_artwork(eps, show_catalog, show_items, args.episode_artwork, args.episode_artwork_limit)
        except Exception as exc:
            artwork = {"shows": {}, "seasons": {}, "episodes": {}, "generatedAt": datetime.now(timezone.utc).isoformat(), "error": str(exc)}

    eps.sort(key=sort_key)
    report = {"generatedAt": datetime.now(timezone.utc).isoformat(), "dryRun": args.dry_run, "originalRows": original_rows, "finalRows": len(eps), "rowsAdded": added, "changesReported": len(changes), "failed": failed, "showsChecked": len(show_items), "moviesChecked": len(movie_items), "changesSample": changes[:300]}
    write_reports(report, changes)

    print(f"Final guide rows: {len(eps)}")
    print(f"Rows added from Trakt: {added}")
    print(f"Total changes reported: {len(changes)}")
    print(f"Failed/optional missing: {len(failed)}")
    print(f"Report: {REPORT_JSON}")
    print(f"Changes CSV: {CHANGES_CSV}")

    if args.dry_run:
        print("Dry run: episodes.js and UI/support files were not modified.")
        return

    ARTWORK_JS.parent.mkdir(parents=True, exist_ok=True)
    ARTWORK_JS.write_text("window.WOLF_ARTWORK = " + json.dumps(artwork, indent=2, ensure_ascii=False) + ";\n", encoding="utf-8")
    make_svg_assets(show_items + movie_items)
    update_show_themes(show_items + movie_items, artwork)
    update_app_title()
    patch_app_js()
    save_episodes(eps)
    print(f"Updated {EPISODES_JS}")
    print(f"Artwork JS: {ARTWORK_JS}")


if __name__ == "__main__":
    main()
