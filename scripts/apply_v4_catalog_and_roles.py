#!/usr/bin/env python3
"""Apply the verified v4 catalogue corrections and episode-role metadata.

This is deliberately deterministic and makes no network requests.  It repairs
known same-title catalogue collisions, collapses movie duplicates left by the
old updater, and records curated crossover/backdoor-pilot relationships.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "law_order_tracker_app" / "data"
EPISODES_JS = DATA / "episodes.js"
ARTWORK_JS = DATA / "wolf_artwork.js"
ARTWORK_BASE_JS = DATA / "wolf_artwork_base.js"
THEMES_JS = DATA / "show_themes.js"
REPORT = DATA / "v4_catalog_audit.json"

FANDOM_CROSSOVERS = "https://one-chicago-fbi.fandom.com/wiki/Crossovers_and_Milestones"
FANDOM_UNIVERSE = "https://one-chicago-fbi.fandom.com/wiki/Wolf_Universe"
LO_GIMME_SHELTER = "https://lawandorder.fandom.com/wiki/Gimme_Shelter"
NBC_2025 = "https://www.nbc.com/nbc-insider/what-time-does-the-law-order-crossover-event-start-april-17-2025"
NBC_2026 = "https://www.nbc.com/nbc-insider/is-law-order-svu-new-tonight-january-8-2026"


def parse_assignment(path: Path, variable: str):
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"window\.{re.escape(variable)}\s*=\s*([\[\{{].*[\]\}}])\s*;?\s*$", text, re.S)
    if not match:
        raise RuntimeError(f"Could not parse {variable} from {path}")
    return json.loads(match.group(1))


def write_assignment(path: Path, variable: str, value) -> None:
    path.write_text(
        f"window.{variable} = " + json.dumps(value, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )


def code_for(row: dict) -> str:
    if row.get("isMovie"):
        return "MOVIE"
    season, episode = int(row.get("season") or 0), int(row.get("episode") or 0)
    return f"S00.{episode:02d}" if season == 0 or row.get("isSpecial") else f"{season:02d}.{episode:02d}"


def stable_id(row: dict) -> str:
    kind = "movie" if row.get("isMovie") else "special" if row.get("isSpecial") or int(row.get("season") or 0) == 0 else "episode"
    trakt = (row.get("traktIds") or {}).get("trakt")
    base = f"{row['show']}|{int(row.get('season') or 0)}|{int(row.get('episode') or 0)}|{kind}"
    return f"{base}|{trakt}" if trakt else base


def catalogue_row(
    *, show: str, title: str, date: str, episode: int, franchise: str,
    scope: str, connection: str, overview: str, show_ids: dict,
    episode_ids: dict | None = None, runtime: int | None = None,
    network: str = "", movie: bool = False, source: str = "", **extra,
) -> dict:
    row = {
        "show": show,
        "franchise": franchise,
        "season": 0 if movie else 1,
        "episode": episode,
        "title": title,
        "airDate": date,
        "notes": "",
        "era": franchise,
        "sourceTab": "Verified v4 catalogue",
        "sourceWatch": source,
        "status": "Not Started",
        "isSpecial": movie,
        "isMovie": movie,
        "traktSlug": show_ids.get("slug", ""),
        "traktFirstAired": date,
        "overview": overview,
        "traktIds": episode_ids or {},
        "showTraktIds": show_ids,
        "network": network,
        "runtime": runtime,
        "country": "us",
        "language": "en",
        "optional": scope not in {"core", "connected"},
        "alwaysShow": scope in {"core", "connected"},
        "connection": connection,
        "universeScope": scope,
        "scope": scope,
        "guideScope": scope,
        "enabled": True,
        **extra,
    }
    row["code"] = code_for(row)
    row["id"] = stable_id(row)
    return row


def corrected_rows() -> list[dict]:
    rows: list[dict] = []
    blood_titles = [
        "An Unexpected Link to Robert Durst",
        "The Millionaire's Defense",
        "A Missing Mogul",
        "A College Kingpin's Greed",
        "High Society Schemers",
        "The Case of the Menendez Brothers Today",
        "The Hitman's Tale",
        "Inventing a Rockefeller",
        "The Business of Divorce",
        "A Casino Tycoon's Hidden Treasure",
    ]
    blood_trakt = [7351987, 7362449, 7362467, 7399635, 7399640]
    blood_dates = [
        "2023-03-11", "2023-03-18", "2023-03-25", "2023-04-01", "2023-04-08",
        "2023-04-15", "2023-04-22", "2023-04-29", "2023-05-06", "2023-05-13",
    ]
    blood_ids = {"trakt": 202727, "slug": "blood-money-2023", "imdb": "tt26746481"}
    oxygen = "https://www.oxygen.com/blood-money/season-1/episode-5/high-society-schemers"
    for number, (title, date) in enumerate(zip(blood_titles, blood_dates), 1):
        episode_ids = {"trakt": blood_trakt[number - 1]} if number <= len(blood_trakt) else {}
        rows.append(catalogue_row(
            show="Blood & Money", title=title, date=date, episode=number,
            franchise="Wolf Archive", scope="complete",
            connection="2023 Wolf Entertainment true-crime series created by Dick Wolf; the unrelated 1981 series is excluded.",
            overview=f"A true-crime investigation into the case featured in “{title},” following the detectives and prosecutors who traced money, motive and evidence.",
            show_ids=blood_ids, episode_ids=episode_ids, runtime=44, network="Oxygen", source=oxygen,
        ))

    south = [
        ("Diamond in the Rough", "1993-06-06"),
        ("Pirates of the Caribbean", "1993-06-08"),
        ("Stake Out", "1993-06-15"),
        ("Skin and Bones", "1993-06-29"),
        ("Wild Thing", "1993-07-11"),
        ("I Witness", "1993-08-12"),
        ("School for Scandal", ""),
    ]
    south_ids = {"trakt": 12429, "slug": "south-beach-1993", "imdb": "tt0106141"}
    tv_guide = "https://www.tvguide.com/tvshows/south-beach/episodes-season-1/1030084708/"
    for number, (title, date) in enumerate(south, 1):
        unaired = number == 7
        rows.append(catalogue_row(
            show="South Beach", title=title, date=date, episode=number,
            franchise="Wolf Archive", scope="complete",
            connection="1993 Dick Wolf/Bob DeLaurentis crime drama; the unrelated 2006 UPN series is excluded.",
            overview="Crime drama following two former thieves working for a private investigator in South Beach, Miami.",
            show_ids=south_ids, runtime=60, network="NBC", source=tv_guide,
            unaired=unaired,
            sortDate="1993-08-19" if unaired else date,
            airDateStatus="Produced but unaired; TV Guide catalogues August 19, 1993." if unaired else "broadcast",
        ))

    rows.append(catalogue_row(
        show="The Invisible Man", title="The Invisible Man", date="1998-06-01", episode=1,
        franchise="Wolf Specials", scope="complete",
        connection="1998 Dick Wolf-produced television movie / unaired pilot; the unrelated 2000 series is excluded.",
        overview="A government agent becomes invisible after an experimental accident and is drawn into a covert case.",
        show_ids={"trakt": 1228600, "slug": "the-invisible-man-1998", "imdb": "tt0275427"},
        episode_ids={"trakt": 1228600, "imdb": "tt0275427"}, runtime=45, movie=True,
        source="https://variety.com/1998/voices/columns/wolf-s-disappearing-act-two-hour-sein-off-1117467116/",
        unaired=True, airDateStatus="Catalogue release date; produced as an unaired pilot / television movie.",
    ))

    rows.append(catalogue_row(
        show="Exiled: A Law & Order Movie", title="Exiled: A Law & Order Movie", date="1998-11-08", episode=1,
        franchise="Wolf Specials", scope="connected",
        connection="Direct Law & Order television movie continuing Mike Logan's story.",
        overview="Former Manhattan detective Mike Logan investigates a murder while trying to earn his way back from exile on Staten Island.",
        show_ids={"slug": "exiled", "imdb": "tt0164023"},
        episode_ids={"imdb": "tt0164023"}, runtime=84, network="NBC", movie=True,
        source="https://www.imdb.com/title/tt0164023/",
    ))
    rows.append(catalogue_row(
        show="Homicide: The Movie", title="Homicide: The Movie", date="2000-02-13", episode=1,
        franchise="Wolf Specials", scope="connected",
        connection="Feature-length continuation and finale for Homicide: Life on the Street; part of the John Munch timeline.",
        overview="The Baltimore homicide unit reunites after former lieutenant Al Giardello is shot while running for mayor.",
        show_ids={"trakt": 19764, "slug": "homicide-the-movie-2000", "imdb": "tt0226771"},
        episode_ids={"trakt": 19764, "imdb": "tt0226771"}, runtime=100, network="NBC", movie=True,
        source="https://www.imdb.com/title/tt0226771/",
    ))
    return rows


# event, type, human label, narrative role, source, ordered episode keys
EVENTS = [
    ("Charm City / For God and Country", "crossover", "Crossover", "Two-part Law & Order / Homicide story.", FANDOM_CROSSOVERS, [("Law & Order", 6, 13), ("Homicide: Life on the Street", 4, 12)]),
    ("Baby, It's You", "crossover", "Crossover", "Two-part Law & Order / Homicide story.", FANDOM_CROSSOVERS, [("Law & Order", 8, 6), ("Homicide: Life on the Street", 6, 5)]),
    ("Sideshow", "crossover", "Crossover", "Two-part Law & Order / Homicide story.", FANDOM_CROSSOVERS, [("Law & Order", 9, 14), ("Homicide: Life on the Street", 7, 15)]),
    ("Chicago P.D. launch", "backdoor_pilot", "Backdoor pilot", "Introduces the Chicago P.D. spinoff team and launch story.", FANDOM_CROSSOVERS, [("Chicago Fire", 1, 23)]),
    ("Comic Perversion / Conventions", "crossover", "Crossover", "Two-part SVU / Chicago P.D. case.", FANDOM_CROSSOVERS, [("Law & Order: Special Victims Unit", 15, 15), ("Chicago P.D.", 1, 6)]),
    ("A Dark Day / 8:30 PM", "crossover", "Crossover", "Two-part Chicago Fire / Chicago P.D. story.", FANDOM_CROSSOVERS, [("Chicago Fire", 2, 20), ("Chicago P.D.", 1, 12)]),
    ("Nobody Touches Anything", "crossover", "Crossover", "Three-part Chicago Fire / SVU / Chicago P.D. case.", FANDOM_CROSSOVERS, [("Chicago Fire", 3, 7), ("Law & Order: Special Victims Unit", 16, 7), ("Chicago P.D.", 2, 7)]),
    ("Three Bells", "crossover", "Crossover", "Two-part Chicago Fire / Chicago P.D. story.", FANDOM_CROSSOVERS, [("Chicago Fire", 3, 13), ("Chicago P.D.", 2, 13)]),
    ("Chicago Med launch", "backdoor_pilot", "Backdoor pilot", "Introduces the hospital and principal characters who launch Chicago Med.", FANDOM_CROSSOVERS, [("Chicago Fire", 3, 19)]),
    ("We Called Her Jellybean", "crossover", "Crossover", "Three-part Chicago Fire / Chicago P.D. / SVU case.", FANDOM_CROSSOVERS, [("Chicago Fire", 3, 21), ("Chicago P.D.", 2, 20), ("Law & Order: Special Victims Unit", 16, 20)]),
    ("The Beating Heart", "crossover", "Crossover", "Three-part Chicago Fire / Chicago Med / Chicago P.D. story.", FANDOM_CROSSOVERS, [("Chicago Fire", 4, 10), ("Chicago Med", 1, 5), ("Chicago P.D.", 3, 10)]),
    ("Gregory Williams Yates manhunt", "crossover", "Crossover", "Two-part SVU / Chicago P.D. pursuit.", FANDOM_CROSSOVERS, [("Law & Order: Special Victims Unit", 17, 14), ("Chicago P.D.", 3, 14)]),
    ("Chicago Justice launch", "backdoor_pilot", "Backdoor pilot", "Launches the Chicago Justice legal spinoff.", FANDOM_CROSSOVERS, [("Chicago P.D.", 3, 21)]),
    ("Some Make It, Some Don't", "crossover", "Crossover", "Two-part Chicago Fire / Chicago P.D. story.", FANDOM_CROSSOVERS, [("Chicago Fire", 5, 9), ("Chicago P.D.", 4, 9)]),
    ("Deathtrap", "crossover", "Crossover", "Three-part Chicago Fire / Chicago P.D. / Chicago Justice story.", FANDOM_CROSSOVERS, [("Chicago Fire", 5, 15), ("Chicago P.D.", 4, 16), ("Chicago Justice", 1, 1)]),
    ("SVU legal bridge", "character_bridge", "Character bridge", "Law & Order: SVU character crossover into Chicago Justice.", FANDOM_CROSSOVERS, [("Chicago Justice", 1, 2)]),
    ("Profiles / Hiding Not Seeking", "crossover", "Crossover", "Two-part Chicago P.D. / Chicago Fire story.", FANDOM_CROSSOVERS, [("Chicago P.D.", 5, 16), ("Chicago Fire", 6, 13)]),
    ("Going to War", "crossover", "Crossover", "Three-part Chicago Fire / Chicago Med / Chicago P.D. story.", FANDOM_CROSSOVERS, [("Chicago Fire", 7, 2), ("Chicago Med", 4, 2), ("Chicago P.D.", 6, 2)]),
    ("What I Saw / Good Men", "crossover", "Crossover", "Two-part Chicago Fire / Chicago P.D. story.", FANDOM_CROSSOVERS, [("Chicago Fire", 7, 15), ("Chicago P.D.", 6, 15)]),
    ("FBI: Most Wanted launch", "backdoor_pilot", "Backdoor pilot", "Introduces the Fugitive Task Force before FBI: Most Wanted.", FANDOM_CROSSOVERS, [("FBI", 1, 18)]),
    ("Infection", "crossover", "Crossover", "Three-part One Chicago crossover.", FANDOM_CROSSOVERS, [("Chicago Fire", 8, 4), ("Chicago Med", 5, 4), ("Chicago P.D.", 7, 4)]),
    ("Off the Grid / Burden of Truth", "crossover", "Crossover", "Two-part Chicago Fire / Chicago P.D. story.", FANDOM_CROSSOVERS, [("Chicago Fire", 8, 15), ("Chicago P.D.", 7, 15)]),
    ("American Dreams / Reveille", "crossover", "Crossover", "Two-part FBI / FBI: Most Wanted case.", FANDOM_CROSSOVERS, [("FBI", 2, 18), ("FBI: Most Wanted", 1, 9)]),
    ("Chicago P.D. agent exchange", "character_bridge", "Character bridge", "Chicago P.D.'s Hailey Upton joins the FBI team for this case.", FANDOM_CROSSOVERS, [("FBI", 2, 19)]),
    ("FBI global crossover launch", "crossover", "Crossover", "Three-part FBI / Most Wanted / International event and International launch.", FANDOM_CROSSOVERS, [("FBI", 4, 1), ("FBI: Most Wanted", 3, 1), ("FBI: International", 1, 1)]),
    ("Imminent Threat", "crossover", "Crossover", "Three-part FBI franchise crossover.", FANDOM_CROSSOVERS, [("FBI: International", 2, 16), ("FBI", 5, 17), ("FBI: Most Wanted", 4, 16)]),
    ("In the Trenches", "crossover", "Crossover", "Three-part One Chicago crossover.", FANDOM_CROSSOVERS, [("Chicago Fire", 13, 11), ("Chicago Med", 10, 11), ("Chicago P.D.", 12, 11)]),
    ("Reckoning", "crossover", "Crossover", "Three-part One Chicago crossover.", FANDOM_CROSSOVERS, [("Chicago Fire", 14, 13), ("Chicago Med", 11, 13), ("Chicago P.D.", 13, 13)]),
    ("Return of the Prodigal Son", "crossover", "Crossover", "Two-part SVU / Organized Crime launch crossover.", FANDOM_CROSSOVERS, [("Law & Order: Special Victims Unit", 22, 9), ("Law & Order: Organized Crime", 1, 1)]),
    ("Gimme Shelter", "crossover", "Crossover", "Three-part Organized Crime / SVU / Law & Order premiere event.", LO_GIMME_SHELTER, [("Law & Order: Organized Crime", 3, 1), ("Law & Order: Special Victims Unit", 24, 1), ("Law & Order", 22, 1)]),
    ("Shadowërk", "crossover", "Crossover", "Four-part SVU / Organized Crime season-ending event.", FANDOM_CROSSOVERS, [("Law & Order: Special Victims Unit", 24, 21), ("Law & Order: Organized Crime", 3, 21), ("Law & Order: Special Victims Unit", 24, 22), ("Law & Order: Organized Crime", 3, 22)]),
    ("Play with Fire", "crossover", "Crossover", "Two-part Law & Order / SVU case.", NBC_2025, [("Law & Order", 24, 19), ("Law & Order: Special Victims Unit", 26, 19)]),
    ("Snowflakes / Purity", "crossover", "Crossover", "Two-part Law & Order / SVU case.", NBC_2026, [("Law & Order", 25, 9), ("Law & Order: Special Victims Unit", 27, 9)]),
    ("Mike Logan continuation", "continuation", "Series continuation", "Feature-length continuation of Mike Logan's Law & Order storyline.", FANDOM_UNIVERSE, [("Exiled: A Law & Order Movie", 0, 1)]),
    ("Homicide finale", "continuation", "Series finale", "Feature-length continuation and conclusion of Homicide: Life on the Street.", FANDOM_UNIVERSE, [("Homicide: The Movie", 0, 1)]),
    ("Unproduced-series pilot", "backdoor_pilot", "Unaired pilot", "Produced as a television movie / pilot for a series that was not ordered.", "https://variety.com/1998/voices/columns/wolf-s-disappearing-act-two-hour-sein-off-1117467116/", [("The Invisible Man", 0, 1)]),
    ("Produced but unaired", "unaired", "Unaired episode", "Produced seventh episode; not part of the original broadcast run.", "https://app.trakt.tv/shows/south-beach-1993", [("South Beach", 1, 7)]),
]


def add_roles(episodes: list[dict]) -> tuple[int, list[str]]:
    by_key = {(row["show"], int(row.get("season") or 0), int(row.get("episode") or 0)): row for row in episodes}
    for row in episodes:
        row.pop("relationship", None)
        row["relationships"] = []

    missing: list[str] = []
    curated = 0
    for event, kind, label, role, source, keys in EVENTS:
        resolved = [by_key.get(key) for key in keys]
        if any(row is None for row in resolved):
            missing.extend(" | ".join(map(str, key)) for key, row in zip(keys, resolved) if row is None)
            continue
        total = len(keys)
        for index, row in enumerate(resolved, 1):
            related = []
            for key, other in zip(keys, resolved):
                if other is row:
                    continue
                related.append({"show": key[0], "season": key[1], "episode": key[2], "title": other.get("title", "")})
            row["relationships"].append({
                "type": kind,
                "label": label,
                "event": event,
                "part": index if total > 1 else None,
                "totalParts": total if total > 1 else None,
                "role": role,
                "related": related,
                "source": source,
                "curated": True,
            })
            curated += 1

    roman = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5}
    for row in episodes:
        if any(item.get("type") == "crossover" for item in row["relationships"]):
            continue
        match = re.search(r"\s+\(([IV]+)\)$", row.get("title") or "")
        if not match or match.group(1) not in roman:
            continue
        row["relationships"].append({
            "type": "story_arc",
            "label": "Multi-episode arc",
            "event": re.sub(r"\s+\([IV]+\)$", "", row.get("title") or ""),
            "part": roman[match.group(1)],
            "totalParts": None,
            "role": "Part-number notation identifies this as an installment in a multi-episode story.",
            "related": [],
            "source": "Canonical episode title notation; editorial inference.",
            "curated": False,
        })

    for row in episodes:
        if not row["relationships"]:
            row.pop("relationships")
    return curated, missing


def update_visual_metadata() -> None:
    # Source checkouts can contain the large raw artwork index, while clean
    # release archives intentionally retain only the optimized base index.
    # Keep this maintenance script safely re-runnable in either form.
    artwork_path = ARTWORK_JS if ARTWORK_JS.exists() else ARTWORK_BASE_JS
    if not artwork_path.exists():
        raise RuntimeError("Neither wolf_artwork.js nor wolf_artwork_base.js exists")
    artwork = parse_assignment(artwork_path, "WOLF_ARTWORK")
    shows = artwork.setdefault("shows", {})
    shows.pop("Dragnet", None)
    shows["Blood & Money"] = {"poster": "./assets/Blood_Money.svg", "backdrop": "./assets/Blood_Money.svg", "year": 2023}
    shows["South Beach"] = {"poster": "./assets/South_Beach.svg", "backdrop": "./assets/South_Beach.svg", "year": 1993}
    shows["The Invisible Man"] = {"poster": "./assets/The_Invisible_Man.svg", "backdrop": "./assets/The_Invisible_Man.svg", "year": 1998}
    shows["Exiled: A Law & Order Movie"] = {"poster": "./assets/Exiled_A_Law_Order_Movie.svg", "backdrop": "./assets/Exiled_A_Law_Order_Movie.svg", "year": 1998}
    shows["Homicide: The Movie"] = {"poster": "./assets/Homicide_The_Movie.svg", "backdrop": "./assets/Homicide_The_Movie.svg", "year": 2000}
    affected = ("Dragnet|", "Blood & Money|", "South Beach|", "The Invisible Man|")
    for section in ("seasons", "episodes"):
        artwork[section] = {key: value for key, value in (artwork.get(section) or {}).items() if not key.startswith(affected)}
    write_assignment(artwork_path, "WOLF_ARTWORK", artwork)

    themes = parse_assignment(THEMES_JS, "SHOW_THEMES")
    themes.pop("Dragnet", None)
    for show, image, abbr, color in [
        ("Blood & Money", "./assets/Blood_Money.svg", "B&M", "#9f1239"),
        ("South Beach", "./assets/South_Beach.svg", "SB93", "#0369a1"),
        ("The Invisible Man", "./assets/The_Invisible_Man.svg", "TIM98", "#4f46e5"),
    ]:
        themes.setdefault(show, {}).update({"primary": color, "secondary": "#07111f", "accent": "#e2e8f0", "abbr": abbr, "image": image, "franchise": "Wolf Archive", "optional": True, "alwaysShow": False})
    write_assignment(THEMES_JS, "SHOW_THEMES", themes)


def main() -> None:
    original = parse_assignment(EPISODES_JS, "LAW_ORDER_EPISODES")
    previous_report = json.loads(REPORT.read_text(encoding="utf-8")) if REPORT.exists() else {}
    replaced_names = {"Dragnet", "Blood & Money", "South Beach", "The Invisible Man", "Exiled: A Law & Order Movie", "Homicide: The Movie"}
    episodes = [row for row in original if row.get("show") not in replaced_names]
    episodes.extend(corrected_rows())

    curated, missing_roles = add_roles(episodes)
    episodes.sort(key=lambda row: (
        row.get("sortDate") or row.get("airDate") or "9999-12-31",
        bool(row.get("isSpecial") or int(row.get("season") or 0) == 0),
        int(row.get("season") or 0), int(row.get("episode") or 0), row.get("show") or "",
    ))
    for number, row in enumerate(episodes, 1):
        row["order"] = number
        row["code"] = code_for(row)
        row["id"] = stable_id(row)

    combos = [(row["show"], row.get("season"), row.get("episode"), bool(row.get("isMovie"))) for row in episodes]
    ids = [row["id"] for row in episodes]
    if len(combos) != len(set(combos)) or len(ids) != len(set(ids)):
        raise RuntimeError("v4 transformation produced duplicate guide identities")
    if missing_roles:
        raise RuntimeError("Curated role targets are missing: " + ", ".join(missing_roles))

    write_assignment(EPISODES_JS, "LAW_ORDER_EPISODES", episodes)
    update_visual_metadata()

    supplied_imdb = {
        "Law & Order", "Law & Order: Special Victims Unit", "Law & Order: Organized Crime",
        "Law & Order: Criminal Intent", "Law & Order: Trial by Jury", "Law & Order: LA",
        "Law & Order True Crime", "Exiled: A Law & Order Movie", "Chicago Fire", "Chicago P.D.",
        "Chicago Med", "Chicago Justice", "FBI", "FBI: Most Wanted", "FBI: International",
    }
    supplied_fandom = {
        "Law & Order", "New York Undercover", "Exiled: A Law & Order Movie",
        "Law & Order: Special Victims Unit", "Deadline", "Law & Order: Criminal Intent",
        "Law & Order: Trial by Jury", "Conviction", "Law & Order: LA", "Chicago Fire",
        "Chicago P.D.", "Chicago Med", "Chicago Justice", "FBI", "FBI: Most Wanted",
        "Law & Order: Organized Crime", "FBI: International", "Law & Order Toronto: Criminal Intent",
        "CIA (2026)",
    }
    present = {row["show"] for row in episodes}
    report = {
        "version": "20260718-v4.0.1",
        "originalRows": max(len(original), int(previous_report.get("originalRows") or 0)),
        "finalRows": len(episodes),
        "removedRows": max(
            len(original) - len([row for row in original if row.get("show") not in replaced_names]),
            int(previous_report.get("removedRows") or 0),
        ),
        "correctedRowsAdded": len(corrected_rows()),
        "shows": len(present),
        "relationshipRows": sum(bool(row.get("relationships")) for row in episodes),
        "relationshipTags": sum(len(row.get("relationships") or []) for row in episodes),
        "curatedRelationshipTags": curated,
        "relationshipTypes": Counter(item["type"] for row in episodes for item in row.get("relationships") or []),
        "suppliedIMDbMissing": sorted(supplied_imdb - present),
        "suppliedFandomMissing": sorted(supplied_fandom - present),
        "excludedFalseMatches": [
            "Dragnet (1951; unrelated — L.A. Dragnet 2003 remains)",
            "Blood & Money (1981; replaced by 2023 Dick Wolf series)",
            "South Beach (2006; replaced by 1993 Dick Wolf series)",
            "The Invisible Man (2000; replaced by 1998 Dick Wolf television movie/pilot)",
        ],
        "sources": {
            "imdbList": "https://www.imdb.com/list/ls563325462/",
            "wolfUniverse": FANDOM_UNIVERSE,
            "crossovers": FANDOM_CROSSOVERS,
        },
    }
    report["relationshipTypes"] = dict(report["relationshipTypes"])
    REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
