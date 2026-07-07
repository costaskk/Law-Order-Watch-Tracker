#!/usr/bin/env python3
"""
Populate episode ratings in law_order_tracker_app/data/episodes.js.

Supported sources:
- OMDb: IMDb rating, Rotten Tomatoes score, Metacritic score when OMDB_API_KEY is set.
- Trakt: episode rating/votes when TRAKT_CLIENT_ID is set. This does not require a user token for public episode ratings.

Usage:
  set OMDB_API_KEY=your_key
  set TRAKT_CLIENT_ID=your_trakt_client_id
  python wolf_fetch_episode_ratings.py --limit 200 --write

Without --write it runs as a dry run.
"""
import argparse, json, os, re, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EPISODES_JS = ROOT / 'law_order_tracker_app' / 'data' / 'episodes.js'
CACHE_PATH = ROOT / 'law_order_tracker_app' / 'data' / 'ratings_cache.json'


def load_episodes():
    text = EPISODES_JS.read_text(encoding='utf-8')
    m = re.search(r'window\.LAW_ORDER_EPISODES\s*=\s*(\[.*\])\s*;?\s*$', text, re.S)
    if not m:
        raise SystemExit('Could not parse episodes.js')
    return json.loads(m.group(1))


def save_episodes(eps):
    EPISODES_JS.write_text('window.LAW_ORDER_EPISODES = ' + json.dumps(eps, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')


def read_cache():
    if CACHE_PATH.exists():
        try:
            return json.loads(CACHE_PATH.read_text(encoding='utf-8'))
        except Exception:
            return {}
    return {}


def write_cache(cache):
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True), encoding='utf-8')


def get_json(url, headers=None, timeout=20):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode('utf-8'))


def imdb_id(ep):
    ids = ep.get('traktIds') or ep.get('ids') or {}
    val = ids.get('imdb') or ep.get('imdb') or ep.get('imdbId')
    return val if val and str(val).startswith('tt') else ''


def fetch_omdb(ttid, cache, api_key):
    key = f'omdb:{ttid}'
    if key in cache:
        return cache[key]
    if not api_key or not ttid:
        return {}
    url = 'https://www.omdbapi.com/?' + urllib.parse.urlencode({'apikey': api_key, 'i': ttid, 'plot': 'short'})
    data = get_json(url, {'User-Agent': 'Wolf-Universe-Watch-Tracker/1.0'})
    if data.get('Response') == 'False':
        cache[key] = {}
    else:
        ratings = {'omdbRatings': data.get('Ratings') or []}
        if data.get('imdbRating') and data.get('imdbRating') != 'N/A': ratings['imdb'] = data['imdbRating']
        if data.get('Metascore') and data.get('Metascore') != 'N/A': ratings['metacritic'] = data['Metascore']
        for item in data.get('Ratings') or []:
            if item.get('Source') == 'Rotten Tomatoes': ratings['rottenTomatoes'] = item.get('Value')
        cache[key] = ratings
    time.sleep(0.12)
    return cache[key]


def fetch_trakt_rating(ep, cache, client_id):
    trakt_id = (ep.get('traktIds') or {}).get('trakt')
    if not client_id or not trakt_id:
        return {}
    key = f'trakt-rating:{trakt_id}'
    if key in cache:
        return cache[key]
    url = f'https://api.trakt.tv/episodes/{trakt_id}/ratings'
    try:
        data = get_json(url, {
            'User-Agent': 'Wolf-Universe-Watch-Tracker/1.0',
            'trakt-api-version': '2',
            'trakt-api-key': client_id,
            'Content-Type': 'application/json'
        })
        cache[key] = {'trakt': data.get('rating'), 'traktVotes': data.get('votes')}
    except Exception as e:
        cache[key] = {'error': str(e)}
    time.sleep(0.12)
    return cache[key]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='maximum episodes to update; 0 means all')
    ap.add_argument('--show', default='', help='only update one show')
    ap.add_argument('--write', action='store_true', help='write episodes.js; default is dry-run')
    args = ap.parse_args()

    omdb_key = os.environ.get('OMDB_API_KEY', '').strip()
    trakt_client_id = os.environ.get('TRAKT_CLIENT_ID', '').strip()
    eps = load_episodes()
    cache = read_cache()
    changed = 0
    checked = 0

    for ep in eps:
        if args.show and ep.get('show') != args.show:
            continue
        if args.limit and checked >= args.limit:
            break
        checked += 1
        ratings = dict(ep.get('ratings') or {})
        before = json.dumps(ratings, sort_keys=True)
        ratings.update(fetch_omdb(imdb_id(ep), cache, omdb_key))
        ratings.update(fetch_trakt_rating(ep, cache, trakt_client_id))
        ratings = {k: v for k, v in ratings.items() if v not in ('', None, [], {}) and k != 'error'}
        if json.dumps(ratings, sort_keys=True) != before:
            ep['ratings'] = ratings
            changed += 1
            print(f"updated {ep.get('show')} {ep.get('code')} {ep.get('title')} -> {ratings}")

    write_cache(cache)
    print(f"checked={checked} changed={changed} write={args.write}")
    if args.write and changed:
        save_episodes(eps)

if __name__ == '__main__':
    main()
