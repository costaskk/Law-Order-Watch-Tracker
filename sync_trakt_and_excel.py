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

SHOW_SLUGS = {
    "Law & Order": "law-and-order",
    "Homicide: Life on the Street": "homicide-life-on-the-street",
    "Law & Order: Special Victims Unit": "law-and-order-special-victims-unit",
    "Law & Order: Criminal Intent": "law-and-order-criminal-intent",
    "Law & Order: Trial by Jury": "law-and-order-trial-by-jury",
    "Conviction": "conviction",
    "Law & Order: UK": "law-and-order-uk",
    "Law & Order: LA": "law-and-order-la",
    "Law & Order True Crime": "law-and-order-true-crime",
    "Law & Order: Organized Crime": "law-and-order-organized-crime",
    "Criminal Intent: Toronto": "criminal-intent-toronto",
    "Deadline": "deadline",
    "New York Undercover": "new-york-undercover",
}

# A few aliases in case the workbook has shorter show names in some rows.
SHOW_ALIASES = {
    "SVU": "Law & Order: Special Victims Unit",
    "Law & Order: SVU": "Law & Order: Special Victims Unit",
    "Criminal Intent": "Law & Order: Criminal Intent",
    "Organized Crime": "Law & Order: Organized Crime",
    "Trial by Jury": "Law & Order: Trial by Jury",
    "Law & Order UK": "Law & Order: UK",
    "Law & Order LA": "Law & Order: LA",
}


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


def fetch_all_watched_shows(cfg: dict, token: dict) -> Dict[str, Set[Tuple[int, int]]]:
    """
    Fetch watched episodes for all shows in one call.

    Trakt no longer supports /shows/{slug}/watched, which returns HTTP 405.
    The correct authenticated endpoint is /sync/watched/shows.
    It returns every watched show with seasons/episodes. We then map those
    results back to the show names used in the workbook.
    """
    r = trakt_get(cfg, token, "/sync/watched/shows")
    data = r.json()

    watched_by_show: Dict[str, Set[Tuple[int, int]]] = {show: set() for show in SHOW_SLUGS}
    slug_to_workbook_show = {slug: show for show, slug in SHOW_SLUGS.items()}

    # Extra fallback by normalized title in case a Trakt slug differs slightly.
    title_to_workbook_show = {show.lower(): show for show in SHOW_SLUGS}
    title_to_workbook_show.update({alias.lower(): canonical for alias, canonical in SHOW_ALIASES.items()})

    for item in data:
        show_info = item.get("show", {}) or {}
        ids = show_info.get("ids", {}) or {}
        trakt_slug = ids.get("slug")
        trakt_title = str(show_info.get("title") or "").strip()

        workbook_show = None
        if trakt_slug in slug_to_workbook_show:
            workbook_show = slug_to_workbook_show[trakt_slug]
        elif trakt_title.lower() in title_to_workbook_show:
            workbook_show = title_to_workbook_show[trakt_title.lower()]

        if not workbook_show:
            continue

        for season in item.get("seasons", []) or []:
            s_num = season.get("number")
            if not isinstance(s_num, int):
                continue
            for ep in season.get("episodes", []) or []:
                e_num = ep.get("number")
                if isinstance(e_num, int):
                    watched_by_show[workbook_show].add((s_num, e_num))

    return watched_by_show

def normalize_show(show: str) -> str:
    show = str(show or "").strip()
    return SHOW_ALIASES.get(show, show)


def run_once() -> None:
    cfg = load_config()
    token = get_token(cfg)

    if not WORKBOOK_PATH.exists():
        raise SystemExit(f"Workbook not found: {WORKBOOK_PATH}")

    print("Reading watched history from Trakt...")
    try:
        watched_by_show = fetch_all_watched_shows(cfg, token)
    except requests.HTTPError as exc:
        raise SystemExit(f"Could not fetch Trakt watched history: {exc}")

    for workbook_show in SHOW_SLUGS:
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
    app_status = {"version": 2, "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "statuses": {}}
    for row in range(2, ws.max_row + 1):
        order = ws.cell(row=row, column=1).value
        show = ws.cell(row=row, column=show_col).value
        season = ws.cell(row=row, column=season_col).value
        episode = ws.cell(row=row, column=episode_col).value
        status = ws.cell(row=row, column=status_col).value or "Not Started"
        ep_id = f"{show}|{season}|{episode}|{order}"
        app_status["statuses"][ep_id] = status
    Path("law_order_watch_status_from_trakt.json").write_text(json.dumps(app_status, indent=2), encoding="utf-8")
    APP_STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    APP_STATUS_PATH.write_text(json.dumps(app_status, indent=2), encoding="utf-8")

    print(f"\nDone. Matched {marked_watched}/{total} guide rows as watched.")
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
