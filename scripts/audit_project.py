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

    by_show = Counter(ep.get('show') for ep in episodes)
    expected_counts = {
        'Blood & Money': 10,
        'South Beach': 7,
        'The Invisible Man': 1,
        'Exiled: A Law & Order Movie': 1,
        'Homicide: The Movie': 1,
    }
    for show, expected in expected_counts.items():
        if by_show.get(show) != expected:
            errors += fail(f'{show} has {by_show.get(show, 0)} rows; expected {expected}')
    if 'Dragnet' in shows: errors += fail('Unrelated 1951 Dragnet is present; only L.A. Dragnet belongs in this archive')
    if 'L.A. Dragnet' not in shows: errors += fail('The correct 2003 L.A. Dragnet revival is missing')

    false_match_ids = {3693, 9586, 4305, 4711}
    false_match_imdb = {'tt0043194', 'tt0081833', 'tt0460677', 'tt0220238'}
    for ep in episodes:
        show_ids = ep.get('showTraktIds') or {}
        if show_ids.get('trakt') in false_match_ids or show_ids.get('imdb') in false_match_imdb:
            errors += fail(f'Known false catalogue match remains on {ep.get("show")}')
            break

    supplied_imdb = {
        'Law & Order': 'tt0098844',
        'Law & Order: Special Victims Unit': 'tt0203259',
        'Law & Order: Organized Crime': 'tt12677870',
        'Law & Order: Criminal Intent': 'tt0275140',
        'Law & Order: Trial by Jury': 'tt0406429',
        'Law & Order: LA': 'tt1657081',
        'Law & Order True Crime': 'tt6110318',
        'Exiled: A Law & Order Movie': 'tt0164023',
        'Chicago Fire': 'tt2261391',
        'Chicago P.D.': 'tt2805096',
        'Chicago Med': 'tt4655480',
        'Chicago Justice': 'tt5640060',
        'FBI': 'tt7491982',
        'FBI: Most Wanted': 'tt9742936',
        'FBI: International': 'tt14449470',
    }
    supplied_fandom = {
        'Law & Order', 'New York Undercover', 'Exiled: A Law & Order Movie',
        'Law & Order: Special Victims Unit', 'Deadline', 'Law & Order: Criminal Intent',
        'Law & Order: Trial by Jury', 'Conviction', 'Law & Order: LA', 'Chicago Fire',
        'Chicago P.D.', 'Chicago Med', 'Chicago Justice', 'FBI', 'FBI: Most Wanted',
        'Law & Order: Organized Crime', 'FBI: International', 'Law & Order Toronto: Criminal Intent',
        'CIA (2026)',
    }
    missing_supplied = sorted((set(supplied_imdb) | supplied_fandom) - shows)
    if missing_supplied: errors += fail(f'Supplied source titles missing: {", ".join(missing_supplied)}')
    for show, expected_imdb in supplied_imdb.items():
        observed = {
            str(value).lower()
            for ep in episodes if ep.get('show') == show
            for value in ((ep.get('showTraktIds') or {}).get('imdb'), (ep.get('traktIds') or {}).get('imdb'))
            if value
        }
        if expected_imdb not in observed:
            errors += fail(f'{show} does not carry supplied IMDb id {expected_imdb}; found {sorted(observed) or "none"}')
    if any(
        'tt0169421' in {
            str((ep.get('showTraktIds') or {}).get('imdb') or '').lower(),
            str((ep.get('traktIds') or {}).get('imdb') or '').lower(),
        }
        for ep in episodes
    ):
        errors += fail('Unrelated tt0169421 identifier remains in the canonical guide')
    exiled = next((ep for ep in episodes if ep.get('show') == 'Exiled: A Law & Order Movie'), None)
    if not exiled or int(exiled.get('runtime') or 0) != 84:
        errors += fail('Exiled runtime is not the supplied IMDb runtime of 84 minutes')

    role_rows = [ep for ep in episodes if ep.get('relationships')]
    curated_roles = [role for ep in role_rows for role in ep.get('relationships', []) if role.get('curated')]
    if len(role_rows) < 75: errors += fail('Too few episode role annotations were generated')
    if len(curated_roles) < 70: errors += fail('Too few curated crossover/role annotations were generated')
    for role in (role for ep in role_rows for role in ep.get('relationships', [])):
        if not role.get('type') or not role.get('label') or not role.get('role'):
            errors += fail('An episode role is missing type, label, or narrative role')
            break

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
            else:
                expected_api = []
                optional_api_keys = (
                    'titleShow', 'traktIds', 'showTraktIds', 'traktSlug', 'showSlug',
                    'isMovie', 'isSpecial', 'airDate', 'order', 'scope', 'franchise', 'unaired',
                )
                for ep in episodes:
                    row = {
                        'id': str(ep.get('id') or ''), 'show': ep.get('show') or '',
                        'season': ep.get('season'), 'episode': ep.get('episode'),
                    }
                    for key in optional_api_keys:
                        if ep.get(key): row[key] = ep[key]
                    expected_api.append(row)
                if api_guide != expected_api:
                    errors += fail('api/_guide_index.js content differs from canonical episodes.js')

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
    print(f'Episode role rows: {len(role_rows)} ({len(curated_roles)} curated tags)')
    if errors: return 1
    print('Project data audit passed.')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
