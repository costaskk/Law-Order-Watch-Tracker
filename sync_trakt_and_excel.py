#!/usr/bin/env python3
"""
Sync Trakt watched status into the Law & Order chronological Excel guide.

What it updates:
- Workbook: Law_Order_Professional_Watch_Tracker.xlsx
- Sheet: Chronological Guide
- Column B: Status
- Marks rows as "Watched" when Trakt has the same show/season/episode in watched history.

Requirements:
    pip install requests openpyxl

Setup:
    1) Copy trakt_config.example.json to trakt_config.json
    2) Add your Trakt client_id and client_secret
    3) Run: python trakt_sync_law_order.py
"""

from __future__ import annotations

import json
import sys
import time
import warnings
import argparse
from pathlib import Path
from typing import Dict, Iterable, Set, Tuple

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

APP_DEBUG_PATH = Path("law_order_tracker_app/data/trakt_sync_debug.json")

# Canonical show names in the guide plus known Trakt slug/title variants.
# Trakt sometimes uses "and" where the guide uses "&", and some slugs omit "and".
SHOW_MATCHERS = {
    "Law & Order": {
        "slugs": ["law-and-order", "law-order"],
        "titles": ["Law & Order", "Law and Order"],
    },
    "Homicide: Life on the Street": {
        "slugs": ["homicide-life-on-the-street"],
        "titles": ["Homicide: Life on the Street"],
    },
    "Law & Order: Special Victims Unit": {
        "slugs": ["law-and-order-special-victims-unit", "law-order-special-victims-unit", "law-and-order-svu", "law-order-svu"],
        "titles": ["Law & Order: Special Victims Unit", "Law and Order: Special Victims Unit", "Law & Order: SVU", "Law and Order: SVU", "SVU"],
    },
    "Law & Order: Criminal Intent": {
        "slugs": ["law-and-order-criminal-intent", "law-order-criminal-intent"],
        "titles": ["Law & Order: Criminal Intent", "Law and Order: Criminal Intent", "Criminal Intent"],
    },
    "Law & Order: Trial by Jury": {
        "slugs": ["law-and-order-trial-by-jury", "law-order-trial-by-jury"],
        "titles": ["Law & Order: Trial by Jury", "Law and Order: Trial by Jury", "Trial by Jury"],
    },
    "Conviction": {
        "slugs": ["conviction", "conviction-2006"],
        "titles": ["Conviction"],
    },
    "Law & Order: UK": {
        "slugs": ["law-and-order-uk", "law-order-uk"],
        "titles": ["Law & Order: UK", "Law and Order: UK", "Law & Order UK", "Law and Order UK"],
    },
    "Law & Order: LA": {
        "slugs": ["law-and-order-la", "law-order-la", "law-and-order-los-angeles", "law-order-los-angeles"],
        "titles": ["Law & Order: LA", "Law and Order: LA", "Law & Order LA", "Law and Order LA", "Law & Order: Los Angeles", "Law and Order: Los Angeles"],
    },
    "Law & Order True Crime": {
        "slugs": ["law-and-order-true-crime", "law-order-true-crime"],
        "titles": ["Law & Order True Crime", "Law and Order True Crime", "Law & Order: True Crime", "Law and Order: True Crime"],
    },
    "Law & Order: Organized Crime": {
        "slugs": ["law-and-order-organized-crime", "law-order-organized-crime"],
        "titles": ["Law & Order: Organized Crime", "Law and Order: Organized Crime", "Organized Crime"],
    },
    "Criminal Intent: Toronto": {
        "slugs": ["criminal-intent-toronto", "law-and-order-toronto-criminal-intent", "law-order-toronto-criminal-intent"],
        "titles": ["Criminal Intent: Toronto", "Law & Order Toronto: Criminal Intent", "Law and Order Toronto: Criminal Intent", "Law & Order: Toronto Criminal Intent", "Law and Order: Toronto Criminal Intent"],
    },
    "Deadline": {
        "slugs": ["deadline", "deadline-2000"],
        "titles": ["Deadline"],
    },
    "New York Undercover": {
        "slugs": ["new-york-undercover", "ny-undercover"],
        "titles": ["New York Undercover", "NY Undercover"],
    },
}

SHOW_SLUGS = {show: data["slugs"][0] for show, data in SHOW_MATCHERS.items()}

SHOW_ALIASES = {}
for canonical, data in SHOW_MATCHERS.items():
    for title in data["titles"]:
        SHOW_ALIASES[title] = canonical


def normalize_text(value: str) -> str:
    return " ".join(
        "".join(ch.lower() if ch.isalnum() else " " for ch in str(value or "").replace("&", " and "))
        .split()
    )


SLUG_TO_SHOW = {}
TITLE_TO_SHOW = {}
for canonical, data in SHOW_MATCHERS.items():
    for slug in data["slugs"]:
        SLUG_TO_SHOW[slug] = canonical
    for title in data["titles"]:
        TITLE_TO_SHOW[normalize_text(title)] = canonical



def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise SystemExit(
            "Missing trakt_config.json. Copy trakt_config.example.json to trakt_config.json "
            "and add your Trakt client_id/client_secret."
        )
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if not cfg.get("client_id") or not cfg.get("client_secret"):
        raise SystemExit("trakt_config.json must contain client_id and client_secret.")
    return cfg


def headers(cfg: dict, token: str | None = None) -> dict:
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
    r = requests.post(
        f"{BASE_URL}/oauth/device/code",
        json={"client_id": cfg["client_id"]},
        headers=headers(cfg),
        timeout=30,
    )
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
        payload = {
            "code": device["device_code"],
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
        }
        rr = requests.post(f"{BASE_URL}/oauth/device/token", json=payload, headers=headers(cfg), timeout=30)
        if rr.status_code == 200:
            token = rr.json()
            token["created_at_local"] = int(time.time())
            save_token(token)
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


def get_authenticated_user(cfg: dict, token: dict) -> dict:
    """Return Trakt settings/user info for debugging token/account problems."""
    try:
        return trakt_get(cfg, token, "/users/settings").json()
    except Exception as exc:
        return {"error": str(exc)}


def resolve_workbook_show(show_info: dict) -> str | None:
    ids = show_info.get("ids", {}) or {}
    slug = str(ids.get("slug") or "").strip().lower()
    title = str(show_info.get("title") or "").strip()

    if slug in SLUG_TO_SHOW:
        return SLUG_TO_SHOW[slug]

    title_key = normalize_text(title)
    if title_key in TITLE_TO_SHOW:
        return TITLE_TO_SHOW[title_key]

    # Last fallback: compare normalized Trakt title with normalized canonical titles.
    # This catches punctuation/ampersand differences without accidentally mapping unrelated shows.
    for known_title, canonical in TITLE_TO_SHOW.items():
        if title_key == known_title:
            return canonical

    return None


def fetch_all_watched_shows(cfg: dict, token: dict) -> tuple[Dict[str, Set[Tuple[int, int]]], dict]:
    """
    Fetch watched episodes for all shows in one call.

    Correct endpoint: /sync/watched/shows. We request extended=full because some
    Trakt responses are sparse otherwise and may omit title/year details used for matching.
    """
    r = trakt_get(cfg, token, "/sync/watched/shows?extended=full")
    data = r.json()

    watched_by_show: Dict[str, Set[Tuple[int, int]]] = {show: set() for show in SHOW_MATCHERS}
    debug = {
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "endpoint": "/sync/watched/shows?extended=full",
        "traktWatchedShowCount": len(data) if isinstance(data, list) else None,
        "matchedShows": {},
        "candidateShowsSeen": [],
        "unmatchedRelevantShows": [],
        "allLawRelatedTitlesSeen": [],
    }

    relevant_words = ("law", "order", "homicide", "criminal", "conviction", "deadline", "undercover", "svu")

    for item in data if isinstance(data, list) else []:
        show_info = item.get("show", {}) or {}
        ids = show_info.get("ids", {}) or {}
        trakt_slug = str(ids.get("slug") or "").strip()
        trakt_title = str(show_info.get("title") or "").strip()
        year = show_info.get("year")
        seasons = item.get("seasons", []) or []
        episode_count = 0
        for season in seasons:
            for ep in season.get("episodes", []) or []:
                if isinstance(ep.get("number"), int):
                    episode_count += 1

        title_norm = normalize_text(f"{trakt_title} {trakt_slug}")
        is_relevant = any(word in title_norm for word in relevant_words)
        if is_relevant:
            debug["candidateShowsSeen"].append({
                "title": trakt_title,
                "slug": trakt_slug,
                "year": year,
                "watchedEpisodes": episode_count,
            })

        workbook_show = resolve_workbook_show(show_info)
        if not workbook_show:
            if is_relevant:
                debug["unmatchedRelevantShows"].append({
                    "title": trakt_title,
                    "slug": trakt_slug,
                    "year": year,
                    "watchedEpisodes": episode_count,
                    "ids": ids,
                })
            continue

        for season in seasons:
            s_num = season.get("number")
            if not isinstance(s_num, int):
                continue
            for ep in season.get("episodes", []) or []:
                e_num = ep.get("number")
                if isinstance(e_num, int):
                    watched_by_show[workbook_show].add((s_num, e_num))

    for show, watched in watched_by_show.items():
        debug["matchedShows"][show] = len(watched)

    debug["totalMatchedLawOrderUniverseEpisodes"] = sum(len(v) for v in watched_by_show.values())
    return watched_by_show, debug

def normalize_show(show: str) -> str:
    show = str(show or "").strip()
    return SHOW_ALIASES.get(show, show)


def run_once() -> None:
    cfg = load_config()
    token = get_token(cfg)

    if not WORKBOOK_PATH.exists():
        raise SystemExit(f"Workbook not found: {WORKBOOK_PATH}")

    print("Reading watched history from Trakt...")
    debug = {}
    try:
        account = get_authenticated_user(cfg, token)
        watched_by_show, debug = fetch_all_watched_shows(cfg, token)
        debug["account"] = {
            "username": ((account.get("user") or {}).get("username") if isinstance(account, dict) else None),
            "name": ((account.get("user") or {}).get("name") if isinstance(account, dict) else None),
            "accountFetchError": account.get("error") if isinstance(account, dict) else None,
        }
    except requests.HTTPError as exc:
        debug = {
            "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "error": f"Could not fetch Trakt watched history: {exc}",
            "statusCode": getattr(exc.response, "status_code", None),
            "responseText": getattr(exc.response, "text", "")[:2000] if getattr(exc, "response", None) is not None else "",
        }
        APP_DEBUG_PATH.parent.mkdir(parents=True, exist_ok=True)
        APP_DEBUG_PATH.write_text(json.dumps(debug, indent=2), encoding="utf-8")
        raise SystemExit(debug["error"])

    for workbook_show in SHOW_MATCHERS:
        print(f"  {workbook_show}: {len(watched_by_show.get(workbook_show, set()))} watched episodes")

    print("\nUpdating workbook...")
    wb = load_workbook(WORKBOOK_PATH)
    ws = wb["Chronological Guide"]

    header = [cell.value for cell in ws[1]]
    try:
        status_col = header.index("Status") + 1
        show_col = header.index("Show") + 1
        season_col = header.index("Season") + 1
        episode_col = header.index("Episode") + 1
    except ValueError as exc:
        raise SystemExit(f"Workbook is missing an expected column: {exc}")

    total = 0
    marked_watched = 0

    for row in range(2, ws.max_row + 1):
        show = normalize_show(ws.cell(row=row, column=show_col).value)
        season = ws.cell(row=row, column=season_col).value
        episode = ws.cell(row=row, column=episode_col).value
        if show not in watched_by_show:
            continue
        try:
            key = (int(season), int(episode))
        except (TypeError, ValueError):
            continue

        total += 1
        if key in watched_by_show[show]:
            ws.cell(row=row, column=status_col).value = "Watched"
            marked_watched += 1
        else:
            ws.cell(row=row, column=status_col).value = "Not Started"

    wb.save(OUTPUT_PATH)

    # Also export a status JSON that the mobile web app can import.
    # We include both the old exact row-id map and a safer show/season/episode array.
    # The array lets the website still match watched items even if the chronological
    # order number changed after catalog updates.
    app_status = {
        "version": 6,
        "source": "trakt",
        "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "traktMatchedEpisodeCount": marked_watched,
        "guideComparableRows": total,
        "statuses": {},
        "episodes": []
    }
    for row in range(2, ws.max_row + 1):
        order = ws.cell(row=row, column=1).value
        show = ws.cell(row=row, column=show_col).value
        season = ws.cell(row=row, column=season_col).value
        episode = ws.cell(row=row, column=episode_col).value
        status = ws.cell(row=row, column=status_col).value or "Not Started"
        ep_id = f"{show}|{season}|{episode}|{order}"
        app_status["statuses"][ep_id] = status
        try:
            s_num = int(season)
            e_num = int(episode)
        except (TypeError, ValueError):
            continue
        app_status["episodes"].append({
            "show": str(show or "").strip(),
            "season": s_num,
            "episode": e_num,
            "status": status
        })
    Path("law_order_watch_status_from_trakt.json").write_text(json.dumps(app_status, indent=2), encoding="utf-8")
    APP_STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    APP_STATUS_PATH.write_text(json.dumps(app_status, indent=2), encoding="utf-8")

    debug.update({
        "workbookRowsChecked": total,
        "workbookRowsMarkedWatched": marked_watched,
        "statusJsonPath": str(APP_STATUS_PATH),
        "outputWorkbookPath": str(OUTPUT_PATH),
        "sampleWatchedStatusRows": [ep for ep in app_status["episodes"] if ep.get("status") == "Watched"][:25],
    })
    APP_DEBUG_PATH.parent.mkdir(parents=True, exist_ok=True)
    APP_DEBUG_PATH.write_text(json.dumps(debug, indent=2), encoding="utf-8")

    print(f"\nDone. Matched {marked_watched}/{total} guide rows as watched.")
    print(f"Debug: {APP_DEBUG_PATH}")
    print(f"Saved: {OUTPUT_PATH}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Trakt watched status to Excel and the mobile web app.")
    parser.add_argument("--loop", action="store_true", help="Keep scanning Trakt automatically.")
    parser.add_argument("--minutes", type=int, default=15, help="Minutes between automatic scans when --loop is used.")
    args = parser.parse_args()
    if not args.loop:
        run_once(); return
    while True:
        run_once()
        print(f"Sleeping {args.minutes} minutes before the next automatic Trakt scan...\n")
        time.sleep(max(5, args.minutes) * 60)

if __name__ == "__main__":
    main()
