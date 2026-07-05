#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, os, re, time
from pathlib import Path
from typing import Any, Dict, List, Optional
import requests

EPISODES_JS = Path('law_order_tracker_app/data/episodes.js')
ARTWORK_JS = Path('law_order_tracker_app/data/wolf_artwork.js')
TMDB_BASE = 'https://api.themoviedb.org/3'
TIMEOUT = 30


def load_env_file() -> None:
    env = Path('.env.local')
    if not env.exists():
        return
    for line in env.read_text(encoding='utf-8', errors='ignore').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def parse_js_var(path: Path, var_name: str, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    txt = path.read_text(encoding='utf-8')
    marker = f'window.{var_name}'
    pos = txt.find(marker)
    if pos < 0:
        return fallback
    eq = txt.find('=', pos)
    if eq < 0:
        return fallback
    body = txt[eq + 1:].strip()
    if body.endswith(';'):
        body = body[:-1]
    return json.loads(body)


def write_artwork(data: Dict[str, Any]) -> None:
    ARTWORK_JS.parent.mkdir(parents=True, exist_ok=True)
    ARTWORK_JS.write_text('window.WOLF_ARTWORK = ' + json.dumps(data, indent=2, ensure_ascii=False) + ';\n', encoding='utf-8')


def tmdb_get(api_key: str, path: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    params = dict(params or {})
    params['api_key'] = api_key
    r = requests.get(TMDB_BASE + path, params=params, timeout=TIMEOUT)
    if r.status_code == 404:
        return None
    if r.status_code == 429:
        wait = int(r.headers.get('Retry-After', '2'))
        time.sleep(wait)
        r = requests.get(TMDB_BASE + path, params=params, timeout=TIMEOUT)
    r.raise_for_status()
    time.sleep(0.035)
    return r.json()


def img(path: Optional[str], size: str='w780') -> str:
    return f'https://image.tmdb.org/t/p/{size}{path}' if path else ''


def key(ep: Dict[str, Any]) -> str:
    return f"{ep.get('show')}|{int(ep.get('season') or 0)}|{int(ep.get('episode') or 0)}"


def main() -> None:
    ap = argparse.ArgumentParser(description='Fetch TMDB episode stills, summaries, cast, and crew into wolf_artwork.js')
    ap.add_argument('--show', default='', help='Only fetch one show, e.g. "Law & Order"')
    ap.add_argument('--limit', type=int, default=0, help='Max episodes to check. 0 = all')
    ap.add_argument('--force', action='store_true', help='Re-fetch even if a row already has cast/still metadata')
    ap.add_argument('--missing-only', action='store_true', help='Only fetch rows missing still/cast')
    args = ap.parse_args()

    load_env_file()
    api_key = os.environ.get('TMDB_API_KEY', '').strip()
    if not api_key:
        raise SystemExit('Missing TMDB_API_KEY. Add it to .env.local or set $env:TMDB_API_KEY.')

    episodes = parse_js_var(EPISODES_JS, 'LAW_ORDER_EPISODES', [])
    artwork = parse_js_var(ARTWORK_JS, 'WOLF_ARTWORK', {'shows': {}, 'seasons': {}, 'episodes': {}})
    artwork.setdefault('shows', {})
    artwork.setdefault('seasons', {})
    artwork.setdefault('episodes', {})

    candidates = []
    for ep in episodes:
        if args.show and ep.get('show') != args.show:
            continue
        if ep.get('isMovie'):
            continue
        s, e = int(ep.get('season') or 0), int(ep.get('episode') or 0)
        if s <= 0 or e <= 0:
            continue
        tmdb_id = (ep.get('showTraktIds') or {}).get('tmdb') or (artwork.get('shows', {}).get(ep.get('show'), {}) or {}).get('tmdb')
        if not tmdb_id:
            continue
        meta = artwork['episodes'].get(key(ep), {})
        if args.missing_only and (meta.get('still') and (meta.get('cast') or meta.get('guest_stars'))):
            continue
        if not args.force and meta.get('cast') and meta.get('still'):
            continue
        candidates.append((ep, int(tmdb_id), s, e))

    if args.limit:
        candidates = candidates[:args.limit]

    print(f'Episode metadata candidates: {len(candidates)}')
    checked = updated = no_still = errors = 0

    for ep, tmdb_id, s, e in candidates:
        k = key(ep)
        try:
            details = tmdb_get(api_key, f'/tv/{tmdb_id}/season/{s}/episode/{e}') or {}
            credits = tmdb_get(api_key, f'/tv/{tmdb_id}/season/{s}/episode/{e}/credits') or {}
            cast = []
            for person in (credits.get('guest_stars') or []) + (credits.get('cast') or []):
                name = person.get('name')
                if not name:
                    continue
                row = {'name': name}
                if person.get('character'):
                    row['character'] = person.get('character')
                if person.get('profile_path'):
                    row['profile'] = img(person.get('profile_path'), 'w185')
                if row not in cast:
                    cast.append(row)
            crew = []
            for person in credits.get('crew') or []:
                if person.get('name') and person.get('job'):
                    row = {'name': person.get('name'), 'job': person.get('job')}
                    if row not in crew:
                        crew.append(row)
            old = artwork['episodes'].get(k, {})
            new = dict(old)
            if details.get('still_path'):
                new['still'] = img(details.get('still_path'), 'w780')
            else:
                no_still += 1
                new['checkedNoStill'] = True
            if details.get('overview'):
                new['overview'] = details.get('overview')
            if details.get('vote_average') is not None:
                new['tmdbVote'] = details.get('vote_average')
            if details.get('runtime'):
                new['runtime'] = details.get('runtime')
            if cast:
                new['cast'] = cast[:30]
                new['guest_stars'] = cast[:30]
            if crew:
                new['crew'] = crew[:30]
            artwork['episodes'][k] = new
            updated += 1
        except Exception as exc:
            errors += 1
            artwork['episodes'].setdefault(k, {})['castFetchError'] = str(exc)
        checked += 1
        if checked % 50 == 0:
            print(f'  checked {checked}/{len(candidates)}; updated {updated}; no still {no_still}; errors {errors}')

    artwork['episodeCastFetch'] = {
        'checked': checked,
        'updated': updated,
        'noStill': no_still,
        'errors': errors,
        'show': args.show or 'all'
    }
    write_artwork(artwork)
    print(f'Done. checked={checked}, updated={updated}, noStill={no_still}, errors={errors}')
    print(f'Updated: {ARTWORK_JS}')

if __name__ == '__main__':
    main()
