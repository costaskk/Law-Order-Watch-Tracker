#!/usr/bin/env python3
from __future__ import annotations
import json, re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'law_order_tracker_app' / 'data'
ASSETS = ROOT / 'law_order_tracker_app' / 'assets'


def load_js(path: Path, variable: str):
    text = path.read_text(encoding='utf-8')
    match = re.search(rf'window\.{re.escape(variable)}\s*=\s*([\[\{{].*[\]\}}])\s*;?\s*$', text, re.S)
    if not match:
        raise AssertionError(f'Could not parse {variable} from {path}')
    return json.loads(match.group(1))


def fail(message: str) -> int:
    print(f'ERROR: {message}')
    return 1


def main() -> int:
    errors = 0
    episodes = load_js(DATA / 'episodes.js', 'LAW_ORDER_EPISODES')
    ids = [str(ep.get('id')) for ep in episodes]
    combos = [(ep.get('show'), ep.get('season'), ep.get('episode'), bool(ep.get('isMovie'))) for ep in episodes]
    shows = {ep.get('show') for ep in episodes}

    if len(ids) != len(set(ids)): errors += fail('Duplicate episode ids found')
    if len(combos) != len(set(combos)): errors += fail('Duplicate show/season/episode rows found')
    if any(ep.get('show') == 'CIA' or '1992' in str(ep.get('show')) for ep in episodes):
        errors += fail('Excluded 1992 CIA series is present')
    if not any(ep.get('show') == 'CIA (2026)' for ep in episodes): errors += fail('CIA (2026) is missing')
    if any(not ep.get('scope') for ep in episodes): errors += fail('One or more guide rows have no explicit scope')

    web = json.loads((DATA / 'episodes.json').read_text(encoding='utf-8'))
    if len(web) != len(episodes): errors += fail('episodes.json is out of sync with episodes.js')
    if web != episodes: errors += fail('episodes.json content differs from canonical episodes.js')


    api_guide_path = ROOT / 'api' / '_guide_index.js'
    if not api_guide_path.exists():
        errors += fail('api/_guide_index.js is missing')
    else:
        api_text = api_guide_path.read_text(encoding='utf-8')
        api_match = re.search(r'export const GUIDE_EPISODES\s*=\s*(\[.*\]);\s*export default', api_text, re.S)
        if not api_match:
            errors += fail('Could not parse api/_guide_index.js')
        else:
            api_guide = json.loads(api_match.group(1))
            if len(api_guide) != len(episodes):
                errors += fail('api/_guide_index.js is out of sync with episodes.js')
            elif [str(ep.get('id')) for ep in api_guide] != ids:
                errors += fail('api/_guide_index.js episode ids differ from episodes.js')

    cast_path = DATA / 'wolf_cast_index.json'
    art_path = DATA / 'wolf_episode_artwork.json'
    if not cast_path.exists(): errors += fail('wolf_cast_index.json is missing')
    if not art_path.exists(): errors += fail('wolf_episode_artwork.json is missing')
    if cast_path.exists():
        cast = json.loads(cast_path.read_text(encoding='utf-8'))
        if cast.get('format') != 3: errors += fail('Compact cast index format 3 was not generated')

    base_art = load_js(DATA / 'wolf_artwork_base.js', 'WOLF_ARTWORK')
    missing_show_art = sorted(show for show in shows if show not in (base_art.get('shows') or {}))
    if missing_show_art: errors += fail(f'Missing main artwork for: {", ".join(missing_show_art)}')
    if (ASSETS / 'CIA_1992.svg').exists(): errors += fail('Obsolete CIA_1992.svg asset is still present')

    shared = json.loads((DATA / 'watched_status.json').read_text(encoding='utf-8'))
    scanned = int((shared.get('summary') or {}).get('guideRowsScanned') or 0)
    if scanned and scanned != len(episodes): errors += fail('Shared watched status was built against an older guide')

    scopes = Counter(ep.get('scope') for ep in episodes)
    print(f'Guide entries: {len(episodes)}')
    print(f'Shows: {len(shows)}')
    print(f'Scopes: {dict(scopes)}')
    print(f'Episodes with ratings: {sum(bool(ep.get("ratings")) for ep in episodes)}')
    print(f'Missing summaries: {sum(not ep.get("overview") for ep in episodes)}')
    print(f'Missing air dates: {sum(not ep.get("airDate") for ep in episodes)}')
    print(f'Episode artwork rows: {len(json.loads(art_path.read_text(encoding="utf-8"))) if art_path.exists() else 0}')
    if errors: return 1
    print('Project data audit passed.')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
