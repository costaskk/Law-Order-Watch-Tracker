#!/usr/bin/env python3
"""
Sync Trakt watched status into the Law & Order tracker.

Important behavior:
- Trakt is additive by default: watched episodes from Trakt are marked Watched.
- Existing website/local watched statuses are preserved, so a Trakt sync returning 0
  for a show will NOT wipe your manual progress.
- Use --authoritative if you explicitly want Trakt to overwrite/reset local status.
- Use --import-status path/to/law_order_watch_status.json to restore an exported site status file.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import warnings
from pathlib import Path
from typing import Dict, Set, Tuple, Any

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
ROOT_STATUS_PATH = Path("law_order_watch_status_from_trakt.json")

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
    "In Plain Sight": "in-plain-sight",
}

SHOW_ALIASES = {
    "SVU": "Law & Order: Special Victims Unit",
    "Law & Order: SVU": "Law & Order: Special Victims Unit",
    "Law & Order Special Victims Unit": "Law & Order: Special Victims Unit",
    "Criminal Intent": "Law & Order: Criminal Intent",
    "Law & Order CI": "Law & Order: Criminal Intent",
    "Organized Crime": "Law & Order: Organized Crime",
    "Trial by Jury": "Law & Order: Trial by Jury",
    "Law & Order Trial by Jury": "Law & Order: Trial by Jury",
    "True Crime": "Law & Order True Crime",
    "Law & Order: True Crime": "Law & Order True Crime",
    "Law & Order UK": "Law & Order: UK",
    "Law & Order LA": "Law & Order: LA",
    "NY Undercover": "New York Undercover",
    "N.Y. Undercover": "New York Undercover",
    "Law & Order Toronto: Criminal Intent": "Criminal Intent: Toronto",
    "Law & Order: Toronto Criminal Intent": "Criminal Intent: Toronto",
    "Law & Order: Criminal Intent Toronto": "Criminal Intent: Toronto",
}


def canonical_show(show: Any) -> str:
    value = str(show or "").strip()
    return SHOW_ALIASES.get(value, value)


def norm_show(show: Any) -> str:
    value = canonical_show(show)
    value = value.lower().replace("&", "and")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def row_key(show: Any, season: Any, episode: Any) -> Tuple[str, int, int] | None:
    try:
        return (norm_show(show), int(season), int(episode))
    except Exception:
        return None


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise SystemExit("Missing trakt_config.json")
    cfg = load_json(CONFIG_PATH)
    if not cfg.get("client_id") or not cfg.get("client_secret"):
        raise SystemExit("trakt_config.json must contain client_id and client_secret")
    return cfg


def headers(cfg: dict, token: str | None = None) -> dict:
    h = {"Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": cfg["client_id"]}
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
            headers=headers(cfg), timeout=30,
        )
        if rr.status_code == 200:
            token = rr.json()
            token["created_at_local"] = int(time.time())
            save_token(token)
            print("Authorized successfully.\n")
            return token
        if rr.status_code in (400, 404):
            continue
        if rr.status_code == 418:
            raise SystemExit("Authorization denied in Trakt")
        rr.raise_for_status()
    raise SystemExit("Timed out waiting for Trakt authorization")


def get_token(cfg: dict) -> dict:
    token = load_json(TOKEN_PATH)
    if token:
        created = int(token.get("created_at", token.get("created_at_local", 0)) or 0)
        expires = int(token.get("expires_in", 0) or 0)
        if created and expires and time.time() > created + expires - 300:
            return refresh_token(cfg, token)
        return token
    return device_auth(cfg)


def trakt_get(cfg: dict, token: dict, path: str):
    r = requests.get(f"{BASE_URL}{path}", headers=headers(cfg, token["access_token"]), timeout=60)
    if r.status_code == 401:
        token = refresh_token(cfg, token)
        r = requests.get(f"{BASE_URL}{path}", headers=headers(cfg, token["access_token"]), timeout=60)
    r.raise_for_status()
    return r


def fetch_account(cfg: dict, token: dict) -> dict:
    try:
        return trakt_get(cfg, token, "/users/settings").json().get("user", {})
    except Exception as exc:
        return {"error": str(exc)}


def fetch_trakt_watched(cfg: dict, token: dict, debug: dict) -> Set[Tuple[str, int, int]]:
    watched: Set[Tuple[str, int, int]] = set()
    show_counts = {name: 0 for name in SHOW_SLUGS}
    candidate = []

    # Main endpoint.
    data = trakt_get(cfg, token, "/sync/watched/shows?extended=full").json()
    debug["traktWatchedShowCount"] = len(data) if isinstance(data, list) else 0
    slug_to_show = {slug: show for show, slug in SHOW_SLUGS.items()}
    title_to_show = {norm_show(show): show for show in SHOW_SLUGS}
    title_to_show.update({norm_show(alias): canonical for alias, canonical in SHOW_ALIASES.items()})

    for item in data if isinstance(data, list) else []:
        info = item.get("show", {}) or {}
        ids = info.get("ids", {}) or {}
        slug = ids.get("slug")
        title = str(info.get("title") or "").strip()
        workbook_show = slug_to_show.get(slug) or title_to_show.get(norm_show(title))
        if not workbook_show:
            continue
        count = 0
        for season in item.get("seasons", []) or []:
            s_num = season.get("number")
            if not isinstance(s_num, int):
                continue
            for ep in season.get("episodes", []) or []:
                e_num = ep.get("number")
                if isinstance(e_num, int):
                    watched.add((norm_show(workbook_show), s_num, e_num))
                    count += 1
        show_counts[workbook_show] += count
        candidate.append({"title": title, "slug": slug, "matchedAs": workbook_show, "watchedEpisodes": count})

    # Fallback: per-show history endpoint. This catches accounts where the watched summary returns the show but no episodes.
    fallback = []
    for show, slug in SHOW_SLUGS.items():
        try:
            hist = trakt_get(cfg, token, f"/sync/history/shows/{slug}?limit=100000").json()
            added = 0
            for item in hist if isinstance(hist, list) else []:
                ep = item.get("episode", {}) or {}
                season = ep.get("season")
                number = ep.get("number")
                if isinstance(season, int) and isinstance(number, int):
                    before = len(watched)
                    watched.add((norm_show(show), season, number))
                    if len(watched) > before:
                        added += 1
            fallback.append({"show": show, "slug": slug, "episodesFound": added})
        except Exception as exc:
            fallback.append({"show": show, "slug": slug, "error": str(exc)})

    debug["candidateShowsSeen"] = candidate[:30]
    debug["matchedShows"] = show_counts
    debug["fallbackHistoryChecks"] = fallback
    debug["totalTraktEpisodeKeys"] = len(watched)
    return watched


def watched_keys_from_status_payload(payload: dict) -> Set[Tuple[str, int, int]]:
    keys: Set[Tuple[str, int, int]] = set()
    for item in payload.get("episodes", []) or []:
        if str(item.get("status", "")).lower() == "watched":
            k = row_key(item.get("show"), item.get("season"), item.get("episode"))
            if k:
                keys.add(k)
    statuses = payload.get("statuses", {}) if isinstance(payload.get("statuses", {}), dict) else {}
    for raw_id, status in statuses.items():
        if str(status).lower() != "watched":
            continue
        parts = str(raw_id).split("|")
        if len(parts) >= 3:
            k = row_key(parts[0], parts[1], parts[2])
            if k:
                keys.add(k)
    return keys


def build_status_from_workbook(ws, cols, watched_keys: Set[Tuple[str, int, int]]) -> dict:
    show_col, season_col, episode_col, status_col = cols["show"], cols["season"], cols["episode"], cols["status"]
    app_status = {"version": 6, "source": "trakt+local-merge", "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "statuses": {}, "episodes": []}
    for row in range(2, ws.max_row + 1):
        order = ws.cell(row=row, column=1).value
        show = ws.cell(row=row, column=show_col).value
        season = ws.cell(row=row, column=season_col).value
        episode = ws.cell(row=row, column=episode_col).value
        k = row_key(show, season, episode)
        status = "Watched" if k in watched_keys else "Not Started"
        ep_id = f"{show}|{season}|{episode}|{order}"
        app_status["statuses"][ep_id] = status
        if k:
            app_status["episodes"].append({"show": str(show or "").strip(), "season": int(season), "episode": int(episode), "status": status})
    return app_status


def run_once(args) -> None:
    cfg = load_config()
    token = get_token(cfg)
    if not WORKBOOK_PATH.exists():
        raise SystemExit(f"Workbook not found: {WORKBOOK_PATH}")

    debug = {"fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "mode": "authoritative" if args.authoritative else "merge-preserve-local"}
    debug["account"] = fetch_account(cfg, token)

    print("Reading watched history from Trakt...")
    trakt_watched = fetch_trakt_watched(cfg, token, debug)

    existing_watched: Set[Tuple[str, int, int]] = set()
    import_sources = []
    if not args.authoritative:
        for path in [APP_STATUS_PATH, ROOT_STATUS_PATH] + [Path(x) for x in (args.import_status or [])]:
            payload = load_json(path)
            if payload:
                keys = watched_keys_from_status_payload(payload)
                existing_watched |= keys
                import_sources.append({"path": str(path), "watchedKeys": len(keys)})

    final_watched = set(trakt_watched)
    if not args.authoritative:
        final_watched |= existing_watched

    print(f"  Trakt watched keys: {len(trakt_watched)}")
    print(f"  Preserved/imported local watched keys: {len(existing_watched)}")
    print(f"  Final watched keys to write: {len(final_watched)}")

    wb = load_workbook(WORKBOOK_PATH)
    ws = wb["Chronological Guide"]
    header = [cell.value for cell in ws[1]]
    cols = {
        "status": header.index("Status") + 1,
        "show": header.index("Show") + 1,
        "season": header.index("Season") + 1,
        "episode": header.index("Episode") + 1,
    }

    total = 0
    marked = 0
    for row in range(2, ws.max_row + 1):
        k = row_key(ws.cell(row=row, column=cols["show"]).value, ws.cell(row=row, column=cols["season"]).value, ws.cell(row=row, column=cols["episode"]).value)
        if not k:
            continue
        total += 1
        if k in final_watched:
            ws.cell(row=row, column=cols["status"]).value = "Watched"
            marked += 1
        else:
            ws.cell(row=row, column=cols["status"]).value = "Not Started"

    wb.save(OUTPUT_PATH)
    app_status = build_status_from_workbook(ws, cols, final_watched)
    APP_STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    APP_STATUS_PATH.write_text(json.dumps(app_status, indent=2), encoding="utf-8")
    ROOT_STATUS_PATH.write_text(json.dumps(app_status, indent=2), encoding="utf-8")

    debug.update({
        "importSources": import_sources,
        "existingLocalWatchedKeys": len(existing_watched),
        "finalWatchedKeys": len(final_watched),
        "workbookRowsChecked": total,
        "workbookRowsMarkedWatched": marked,
        "statusJsonPath": str(APP_STATUS_PATH),
        "outputWorkbookPath": str(OUTPUT_PATH),
        "sampleWatchedStatusRows": [x for x, v in list(app_status["statuses"].items()) if v == "Watched"][:25],
    })
    APP_DEBUG_PATH.write_text(json.dumps(debug, indent=2), encoding="utf-8")

    print(f"\nDone. Marked {marked}/{total} guide rows as watched.")
    print(f"Saved: {OUTPUT_PATH}")
    print(f"Debug: {APP_DEBUG_PATH}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Trakt watched status to Excel and the mobile web app.")
    parser.add_argument("--loop", action="store_true", help="Keep scanning Trakt automatically.")
    parser.add_argument("--minutes", type=int, default=15, help="Minutes between automatic scans when --loop is used.")
    parser.add_argument("--authoritative", action="store_true", help="Let Trakt overwrite/reset local watched statuses. Default preserves local watched status.")
    parser.add_argument("--import-status", action="append", help="Import/merge a website status export JSON, e.g. law_order_watch_status.json")
    args = parser.parse_args()
    if not args.loop:
        run_once(args)
        return
    while True:
        run_once(args)
        print(f"Sleeping {args.minutes} minutes before next scan...\n")
        time.sleep(max(5, args.minutes) * 60)


if __name__ == "__main__":
    main()
