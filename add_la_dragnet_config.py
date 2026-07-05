#!/usr/bin/env python3
"""
Safely add L.A. Dragnet (2003) as a separate Dick Wolf adjacent show.

Run from project root:
  python add_la_dragnet_config.py
"""
from pathlib import Path
import json

path = Path("wolf_universe_shows.json")
if not path.exists():
    raise SystemExit("wolf_universe_shows.json was not found in this folder.")

data = json.loads(path.read_text(encoding="utf-8"))
shows = data.setdefault("shows", [])

entry = {
    "show": "L.A. Dragnet",
    "slug": "l-a-dragnet",
    "alt_slugs": ["la-dragnet", "dragnet-2003", "dragnet"],
    "imdb": "tt0319987",
    "franchise": "Wolf Adjacent",
    "scope": "adjacent",
    "optional": True,
    "alwaysShow": False,
    "connection": "2003 Dick Wolf-created Dragnet revival; kept separate from the 1950s Dragnet."
}

# Remove accidental duplicate entries for the same show.
shows[:] = [s for s in shows if s.get("show") != "L.A. Dragnet"]
shows.append(entry)

# Mark the existing Dragnet as the archive/1950s show if present, without renaming user data.
for show in shows:
    if show.get("show") == "Dragnet":
        show.setdefault("franchise", "Wolf Adjacent")
        show.setdefault("scope", "adjacent")
        show.setdefault("optional", True)
        show.setdefault("connection", "Classic Dragnet archive entry; kept separate from L.A. Dragnet (2003).")

path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("Updated wolf_universe_shows.json with separate L.A. Dragnet (2003).")
