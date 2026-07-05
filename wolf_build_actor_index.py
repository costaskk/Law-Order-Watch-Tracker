#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, os, re, time
from pathlib import Path
from typing import Any, Dict, Optional
import requests

EPISODES_JS = Path('law_order_tracker_app/data/episodes.js')
ARTWORK_JS = Path('law_order_tracker_app/data/wolf_artwork.js')
CAST_JS = Path('law_order_tracker_app/data/wolf_cast_index.js')
TMDB_BASE = 'https://api.themoviedb.org/3'
TIMEOUT = 30
SLEEP = 0.04


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


def norm(value: Any) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', str(value or '').lower().replace('&', 'and')).strip()


def img(path: Optional[str], size: str = 'w185') -> str:
    return f'https://image.tmdb.org/t/p/{size}{path}' if path else ''


def tmdb_get(api_key: str, path: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    params = dict(params or {})
    params['api_key'] = api_key
    r = requests.get(TMDB_BASE + path, params=params, timeout=TIMEOUT)
    if r.status_code == 404:
        return None
    if r.status_code == 429:
        wait = int(r.headers.get('Retry-After', '2'))
        print(f'Rate limited; sleeping {wait}s')
        time.sleep(wait)
        r = requests.get(TMDB_BASE + path, params=params, timeout=TIMEOUT)
    r.raise_for_status()
    time.sleep(SLEEP)
    return r.json()


def episode_key(ep: Dict[str, Any]) -> str:
    return f"{ep.get('show')}|{int(ep.get('season') or 0)}|{int(ep.get('episode') or 0)}"


def get_show_tmdb_map(episodes: list[Dict[str, Any]], artwork: Dict[str, Any]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for ep in episodes:
        show = ep.get('show')
        if not show:
            continue
        tmdb = (ep.get('showTraktIds') or {}).get('tmdb')
        if tmdb:
            out[show] = int(tmdb)
    for show, art in (artwork.get('shows') or {}).items():
        tmdb = (art or {}).get('tmdb')
        if tmdb:
            out.setdefault(show, int(tmdb))
    return out


def add_actor(actor_index: Dict[str, Any], name: str, show: str, count: int, character: str = '', profile: str = '') -> None:
    if not name or count <= 0:
        return
    k = norm(name)
    if not k:
        return
    rec = actor_index.setdefault(k, {'name': name, 'count': 0, 'shows': {}, 'characters': [], 'profile': ''})
    rec['count'] = int(rec.get('count') or 0) + int(count)
    rec['shows'][show] = int(rec['shows'].get(show, 0)) + int(count)
    if character and character not in rec['characters']:
        rec['characters'].append(character)
    if profile and not rec.get('profile'):
        rec['profile'] = profile


def main() -> None:
    ap = argparse.ArgumentParser(description='Build actor index ordered by total credited episode appearances using TMDB aggregate credits.')
    ap.add_argument('--min-episodes', type=int, default=10, help='Only keep actors with at least this many credited appearances. Default: 10')
    ap.add_argument('--episode-credits', action='store_true', help='Also fetch exact episode credits into byEpisode. Slower, but gives precise episode filtering.')
    ap.add_argument('--episode-limit', type=int, default=0, help='Limit exact episode credit checks. 0 = all when --episode-credits is used.')
    ap.add_argument('--show', default='', help='Only process one show, e.g. "Law & Order"')
    args = ap.parse_args()

    load_env_file()
    api_key = os.environ.get('TMDB_API_KEY', '').strip()
    if not api_key:
        raise SystemExit('Missing TMDB_API_KEY. Add it to .env.local or set $env:TMDB_API_KEY.')

    episodes = parse_js_var(EPISODES_JS, 'LAW_ORDER_EPISODES', [])
    artwork = parse_js_var(ARTWORK_JS, 'WOLF_ARTWORK', {'shows': {}, 'seasons': {}, 'episodes': {}})
    show_tmdb = get_show_tmdb_map(episodes, artwork)
    if args.show:
        show_tmdb = {k: v for k, v in show_tmdb.items() if k == args.show}

    actor_index: Dict[str, Any] = {}
    by_episode = {}

    print(f'Building aggregate actor index for {len(show_tmdb)} shows...')
    for i, (show, tmdb_id) in enumerate(sorted(show_tmdb.items()), 1):
        print(f'[{i}/{len(show_tmdb)}] {show} TMDB {tmdb_id}')
        try:
            credits = tmdb_get(api_key, f'/tv/{tmdb_id}/aggregate_credits') or {}
        except Exception as exc:
            print(f'  WARNING aggregate credits failed: {exc}')
            continue
        added = 0
        for person in credits.get('cast') or []:
            name = person.get('name')
            profile = img(person.get('profile_path'), 'w185')
            # TMDB aggregate credits stores per-character role records with episode_count.
            total_for_show = 0
            characters = []
            for role in person.get('roles') or []:
                c = int(role.get('episode_count') or 0)
                total_for_show += c
                if role.get('character'):
                    characters.append(role.get('character'))
            if not total_for_show:
                total_for_show = int(person.get('total_episode_count') or 0)
            if total_for_show >= 1:
                add_actor(actor_index, name, show, total_for_show, ' / '.join(characters[:3]), profile)
                added += 1
        print(f'  actors found: {added}')

    # Keep only regular/meaningful actors and sort by count descending in the JS payload.
    actor_index = {k: v for k, v in actor_index.items() if int(v.get('count') or 0) >= args.min_episodes}

    if args.episode_credits:
        candidates = []
        for ep in episodes:
            if args.show and ep.get('show') != args.show:
                continue
            if ep.get('isMovie'):
                continue
            s, e = int(ep.get('season') or 0), int(ep.get('episode') or 0)
            if s <= 0 or e <= 0:
                continue
            tmdb_id = show_tmdb.get(ep.get('show'))
            if not tmdb_id:
                continue
            candidates.append((ep, tmdb_id, s, e))
        if args.episode_limit:
            candidates = candidates[:args.episode_limit]
        print(f'Fetching exact episode credits for {len(candidates)} episodes...')
        for idx, (ep, tmdb_id, s, e) in enumerate(candidates, 1):
            try:
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
                if cast:
                    by_episode[episode_key(ep)] = cast[:40]
            except Exception as exc:
                pass
            if idx % 50 == 0:
                print(f'  exact episode credits checked: {idx}/{len(candidates)}')

    ordered = dict(sorted(actor_index.items(), key=lambda kv: (-int(kv[1].get('count') or 0), kv[1].get('name',''))))
    payload = {
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'minEpisodes': args.min_episodes,
        'actorCount': len(ordered),
        'actors': ordered,
        'byEpisode': by_episode,
        'note': 'Actor counts are ordered by total credited TMDB aggregate TV episode appearances across shows in the tracker. Use --episode-credits for exact per-episode cast filtering.'
    }
    CAST_JS.parent.mkdir(parents=True, exist_ok=True)
    CAST_JS.write_text('window.WOLF_CAST_INDEX = ' + json.dumps(payload, indent=2, ensure_ascii=False) + ';\n', encoding='utf-8')
    print(f'Done. Regular actors kept: {len(ordered)}')
    print(f'Updated: {CAST_JS}')

if __name__ == '__main__':
    main()
