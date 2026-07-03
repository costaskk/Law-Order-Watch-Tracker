#!/usr/bin/env python3
"""
Sync Trakt watched status into the Law & Order chronological tracker.

This fixed version writes a website-friendly watched_status.json that marks
watched items by stable Show+Season+Episode keys. It also writes a diagnostic
file so you can see exactly what Trakt returned and why something did/didn't
match.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import warnings
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

import requests
from openpyxl import load_workbook

warnings.filterwarnings("ignore", message=".*Unknown extension is not supported.*")
warnings.filterwarnings("ignore", message=".*Conditional Formatting extension is not supported.*")

BASE_URL = "https://api.trakt.tv"
CONFIG_PATH = Path("trakt_config.json")
TOKEN_PATH = Path("trakt_token.json")
WORKBOOK_PATH = Path("Law_Order_Professional_Watch_Tracker.xlsx")
OUTPUT_PATH = Path("Law_Order_Professional_Watch_Tracker_Trakt_Synced.xlsx")
APP_STATUS_PATH = Path("law_order_tracker_app/data/watched_status.json")
DEBUG_PATH = Path("law_order_tracker_app/data/trakt_sync_debug.json")

# The actual show names used in your guide + Trakt names/slugs that may appear.
SHOW_VARIANTS: Dict[str, List[str]] = {
    "Law & Order": ["Law & Order", "law-and-order", "law-order"],
    "Homicide: Life on the Street": ["Homicide: Life on the Street", "homicide-life-on-the-street"],
    "Law & Order: SVU": [
        "Law & Order: SVU", "Law & Order: Special Victims Unit",
        "Special Victims Unit", "SVU", "law-and-order-special-victims-unit",
        "law-order-special-victims-unit"
    ],
    "Criminal Intent": [
        "Criminal Intent", "Law & Order: Criminal Intent",
        "law-and-order-criminal-intent", "law-order-criminal-intent"
    ],
    "Trial by Jury": ["Trial by Jury", "Law & Order: Trial by Jury", "law-and-order-trial-by-jury", "law-order-trial-by-jury"],
    "Conviction": ["Conviction", "conviction"],
    "Law & Order: UK": ["Law & Order: UK", "Law & Order UK", "Law and Order UK", "law-and-order-uk", "law-order-uk"],
    "Law & Order: LA": ["Law & Order: LA", "Law & Order LA", "Law and Order LA", "law-and-order-la", "law-order-la"],
    "True Crime": ["True Crime", "Law & Order True Crime", "Law & Order: True Crime", "law-and-order-true-crime", "law-order-true-crime"],
    "Law & Order: Organized Crime": ["Law & Order: Organized Crime", "Organized Crime", "law-and-order-organized-crime", "law-order-organized-crime"],
    "Law & Order Toronto: Criminal Intent": [
        "Law & Order Toronto: Criminal Intent", "Law & Order Toronto Criminal Intent",
        "Law & Order: Toronto Criminal Intent", "Criminal Intent: Toronto",
        "Law & Order: Toronto: Criminal Intent", "law-and-order-toronto-criminal-intent",
        "law-order-toronto-criminal-intent", "criminal-intent-toronto"
    ],
    "Deadline": ["Deadline", "deadline"],
    "NY Undercover": ["NY Undercover", "New York Undercover", "new-york-undercover"],
    "In Plain Sight": ["In Plain Sight", "in-plain-sight"],
}


def norm_text(value: object) -> str:
    value = str(value or "").lower().strip()
    value = value.replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


VARIANT_TO_GUIDE: Dict[str, str] = {}
for guide_show, variants in SHOW_VARIANTS.items():
    for variant in [guide_show] + variants:
        VARIANT_TO_GUIDE[norm_text(variant)] = guide_show

# Some common title formats normalize differently; add explicit aliases.
VARIANT_TO_GUIDE[norm_text("Law and Order Special Victims Unit")] = "Law & Order: SVU"
VARIANT_TO_GUIDE[norm_text("Law Order Special Victims Unit")] = "Law & Order: SVU"
VARIANT_TO_GUIDE[norm_text("Law Order Criminal Intent")] = "Criminal Intent"
VARIANT_TO_GUIDE[norm_text("New York Undercover")] = "NY Undercover"


def match_show(title: object = "", slug: object = "") -> Optional[str]:
    candidates = [norm_text(title), norm_text(slug)]
    # Slugs from Trakt may contain years or omit "and". Try broad contains too.
    joined = " ".join(c for c in candidates if c)
    for c in candidates:
        if c in VARIANT_TO_GUIDE:
            return VARIANT_TO_GUIDE[c]
    for variant_norm, guide_show in VARIANT_TO_GUIDE.items():
        if variant_norm and joined and (variant_norm in joined or joined in variant_norm):
            return guide_show
    return None


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise SystemExit("Missing trakt_config.json. Create it with client_id/client_secret.")
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if not cfg.get("client_id") or not cfg.get("client_secret"):
        raise SystemExit("trakt_config.json must contain client_id and client_secret.")
    return cfg


def headers(cfg: dict, token: Optional[str] = None) -> dict:
    h = {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": cfg["client_id"],
    }
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def save_token(token: dict) -> None:
    TOKEN_PATH.write_text(json.dumps(token, indent=2), encoding="utf-8")


def refresh_token(cfg: dict, token: dict) -> dict:
    payload = {
        "refresh_token": token["refresh_token"],
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
        "grant_type": "refresh_token",
    }
    r = requests.post(f"{BASE_URL}/oauth/token", json=payload, headers=headers(cfg), timeout=30)
    r.raise_for_status()
    new_token = r.json()
    new_token["created_at_local"] = int(time.time())
    save_token(new_token)
    return new_token


def device_auth(cfg: dict) -> dict:
    r = requests.post(f"{BASE_URL}/oauth/device/code", json={"client_id": cfg["client_id"]}, headers=headers(cfg), timeout=30)
    r.raise_for_status()
    device = r.json()
    print("\nAuthorize this script with Trakt:")
    print(f"  1) Open: {device['verification_url']}")
    print(f"  2) Enter code: {device['user_code']}")
    print("Waiting for authorization...\n")
    interval = int(device.get("interval", 5))
    deadline = time.time() + int(device.get("expires_in", 600))
    while time.time() < deadline:
        time.sleep(interval)
        rr = requests.post(
            f"{BASE_URL}/oauth/device/token",
            json={"code": device["device_code"], "client_id": cfg["client_id"], "client_secret": cfg["client_secret"]},
            headers=headers(cfg),
            timeout=30,
        )
        if rr.status_code == 200:
            token = rr.json(); token["created_at_local"] = int(time.time()); save_token(token)
            print("Authorized successfully.\n")
            return token
        if rr.status_code in (400, 404):
            continue
        if rr.status_code == 418:
            raise SystemExit("Authorization was denied in Trakt.")
        rr.raise_for_status()
    raise SystemExit("Timed out waiting for Trakt authorization.")


def get_token(cfg: dict) -> dict:
    if TOKEN_PATH.exists():
        token = json.loads(TOKEN_PATH.read_text(encoding="utf-8"))
        created = int(token.get("created_at", token.get("created_at_local", 0)))
        expires = int(token.get("expires_in", 0))
        if created and expires and time.time() > created + expires - 300:
            return refresh_token(cfg, token)
        return token
    return device_auth(cfg)


def trakt_get(cfg: dict, token: dict, path: str) -> requests.Response:
    r = requests.get(f"{BASE_URL}{path}", headers=headers(cfg, token["access_token"]), timeout=60)
    if r.status_code == 401:
        token = refresh_token(cfg, token)
        r = requests.get(f"{BASE_URL}{path}", headers=headers(cfg, token["access_token"]), timeout=60)
    r.raise_for_status()
    return r


def merge_watched(watched: Dict[str, Set[Tuple[int, int]]], show: Optional[str], season: object, episode: object) -> bool:
    if not show:
        return False
    try:
        s = int(season); e = int(episode)
    except (TypeError, ValueError):
        return False
    if s < 0 or e <= 0:
        return False
    watched.setdefault(show, set()).add((s, e))
    return True


def fetch_watched(cfg: dict, token: dict) -> Tuple[Dict[str, Set[Tuple[int, int]]], dict]:
    """Fetch watched episodes using both Trakt watched and history endpoints."""
    watched: Dict[str, Set[Tuple[int, int]]] = {show: set() for show in SHOW_VARIANTS}
    debug = {
        "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "matchedShows": {},
        "unmatchedTraktShows": [],
        "sources": {},
    }

    # 1) Main watched state endpoint.
    try:
        data = trakt_get(cfg, token, "/sync/watched/shows").json()
        debug["sources"]["/sync/watched/shows"] = len(data)
        for item in data:
            show_info = item.get("show", {}) or {}
            ids = show_info.get("ids", {}) or {}
            guide_show = match_show(show_info.get("title"), ids.get("slug"))
            if not guide_show:
                debug["unmatchedTraktShows"].append({"title": show_info.get("title"), "slug": ids.get("slug"), "source": "watched"})
                continue
            before = len(watched.get(guide_show, set()))
            for season in item.get("seasons", []) or []:
                for ep in season.get("episodes", []) or []:
                    merge_watched(watched, guide_show, season.get("number"), ep.get("number"))
            after = len(watched.get(guide_show, set()))
            debug["matchedShows"].setdefault(guide_show, {"watchedEndpoint": 0, "historyEndpoint": 0})["watchedEndpoint"] += max(0, after - before)
    except Exception as exc:
        debug["sources"]["/sync/watched/shows_error"] = str(exc)

    # 2) Fallback: watched history endpoint. This catches accounts where history is populated
    # but watched state is not returned as expected. Paginate defensively.
    page = 1
    total_history_items = 0
    while page <= 20:  # 20 * 1000 entries is plenty for this tracker; prevents accidental infinite loops.
        try:
            r = trakt_get(cfg, token, f"/sync/history/shows?page={page}&limit=1000")
        except Exception as exc:
            debug["sources"]["/sync/history/shows_error"] = str(exc)
            break
        items = r.json()
        total_history_items += len(items)
        for item in items:
            show_info = item.get("show", {}) or {}
            ids = show_info.get("ids", {}) or {}
            ep_info = item.get("episode", {}) or {}
            guide_show = match_show(show_info.get("title"), ids.get("slug"))
            if not guide_show:
                # Keep debug small and relevant: only list items that look related.
                title_norm = norm_text(show_info.get("title"))
                if any(w in title_norm for w in ["law", "order", "criminal", "homicide", "undercover", "plain sight", "deadline", "conviction"]):
                    debug["unmatchedTraktShows"].append({"title": show_info.get("title"), "slug": ids.get("slug"), "source": "history"})
                continue
            before = len(watched.get(guide_show, set()))
            merge_watched(watched, guide_show, ep_info.get("season"), ep_info.get("number"))
            after = len(watched.get(guide_show, set()))
            debug["matchedShows"].setdefault(guide_show, {"watchedEndpoint": 0, "historyEndpoint": 0})["historyEndpoint"] += max(0, after - before)
        if len(items) < 1000:
            break
        page += 1
    debug["sources"]["/sync/history/shows"] = total_history_items
    debug["finalCounts"] = {show: len(items) for show, items in watched.items() if items}
    return watched, debug


def find_columns(ws) -> dict:
    header = [cell.value for cell in ws[1]]
    required = ["Status", "Show", "Season", "Episode"]
    cols = {}
    for name in required:
        if name not in header:
            raise SystemExit(f"Workbook is missing expected column: {name}. Headers found: {header}")
        cols[name] = header.index(name) + 1
    cols["Order"] = 1
    return cols


def run_once() -> None:
    cfg = load_config()
    token = get_token(cfg)
    if not WORKBOOK_PATH.exists():
        raise SystemExit(f"Workbook not found: {WORKBOOK_PATH}")

    print("Reading watched history from Trakt...")
    watched_by_show, debug = fetch_watched(cfg, token)
    for show in SHOW_VARIANTS:
        print(f"  {show}: {len(watched_by_show.get(show, set()))} watched episodes")

    print("\nUpdating workbook and website status...")
    wb = load_workbook(WORKBOOK_PATH)
    if "Chronological Guide" not in wb.sheetnames:
        raise SystemExit("Workbook is missing sheet: Chronological Guide")
    ws = wb["Chronological Guide"]
    cols = find_columns(ws)

    total_rows = 0
    marked_watched = 0
    app_status = {
        "version": 7,
        "source": "trakt",
        "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summary": {},
        "statuses": {},
        "episodes": [],
    }

    for row in range(2, ws.max_row + 1):
        show_raw = str(ws.cell(row=row, column=cols["Show"]).value or "").strip()
        guide_show = match_show(show_raw, show_raw) or show_raw
        season = ws.cell(row=row, column=cols["Season"]).value
        episode = ws.cell(row=row, column=cols["Episode"]).value
        order = ws.cell(row=row, column=cols["Order"]).value
        try:
            key = (int(season), int(episode))
        except (TypeError, ValueError):
            continue
        total_rows += 1
        is_watched = key in watched_by_show.get(guide_show, set())
        status = "Watched" if is_watched else "Not Started"
        ws.cell(row=row, column=cols["Status"]).value = status
        if is_watched:
            marked_watched += 1
            # Important: for the website, write keys using the exact guide show name too.
            ep_id = f"{show_raw}|{int(season)}|{int(episode)}|{order}"
            app_status["statuses"][ep_id] = "Watched"
            app_status["statuses"][f"{show_raw}|{int(season)}|{int(episode)}"] = "Watched"
            app_status["statuses"][f"{guide_show}|{int(season)}|{int(episode)}"] = "Watched"
            app_status["episodes"].append({
                "show": show_raw,
                "guideShow": guide_show,
                "season": int(season),
                "episode": int(episode),
                "status": "Watched",
            })

    app_status["summary"] = {
        "guideRowsScanned": total_rows,
        "guideRowsMarkedWatched": marked_watched,
        "traktWatchedCountsByShow": {show: len(items) for show, items in watched_by_show.items()},
    }
    debug["appStatusSummary"] = app_status["summary"]

    wb.save(OUTPUT_PATH)
    APP_STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    APP_STATUS_PATH.write_text(json.dumps(app_status, indent=2), encoding="utf-8")
    Path("law_order_watch_status_from_trakt.json").write_text(json.dumps(app_status, indent=2), encoding="utf-8")
    DEBUG_PATH.write_text(json.dumps(debug, indent=2), encoding="utf-8")

    print(f"\nDone. Matched {marked_watched}/{total_rows} guide rows as watched.")
    print(f"Saved: {OUTPUT_PATH}")
    print(f"Saved website status: {APP_STATUS_PATH}")
    print(f"Saved debug report: {DEBUG_PATH}")
    if marked_watched == 0:
        print("\nWARNING: Trakt sync ran, but 0 guide episodes were marked watched.")
        print("Open law_order_tracker_app/data/trakt_sync_debug.json to see which Trakt shows were returned.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Trakt watched status to Excel and the web app.")
    parser.add_argument("--loop", action="store_true", help="Keep scanning Trakt automatically.")
    parser.add_argument("--minutes", type=int, default=15, help="Minutes between automatic scans when --loop is used.")
    args = parser.parse_args()
    if not args.loop:
        run_once()
        return
    while True:
        run_once()
        print(f"Sleeping {args.minutes} minutes before the next automatic Trakt scan...\n")
        time.sleep(max(5, args.minutes) * 60)


if __name__ == "__main__":
    main()
