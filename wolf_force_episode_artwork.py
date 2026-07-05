#!/usr/bin/env python3
"""Force-refresh TMDB episode stills into law_order_tracker_app/data/wolf_artwork.js.

Examples:
  python wolf_force_episode_artwork.py --show "Law & Order"
  python wolf_force_episode_artwork.py --all

Reads TMDB_API_KEY from the environment or .env.local.
"""
import argparse, json, os, re, time
from pathlib import Path
import requests

EPISODES_JS = Path('law_order_tracker_app/data/episodes.js')
ARTWORK_JS = Path('law_order_tracker_app/data/wolf_artwork.js')
TMDB_BASE = 'https://api.themoviedb.org/3'
IMG_BASE = 'https://image.tmdb.org/t/p/w780'

KNOWN_TMDB = {
    'Law & Order': 549,
    'Law & Order: Special Victims Unit': 2734,
    'Law & Order: Criminal Intent': 4601,
    'Law & Order: Organized Crime': 106158,
    'Chicago Fire': 44006,
    'Chicago P.D.': 58841,
    'Chicago Med': 62650,
    'FBI': 80748,
}

def load_env_key():
    key = os.environ.get('TMDB_API_KEY', '').strip()
    if key:
        return key
    env = Path('.env.local')
    if env.exists():
        for line in env.read_text(encoding='utf-8', errors='ignore').splitlines():
            if line.strip().startswith('TMDB_API_KEY='):
                return line.split('=', 1)[1].strip().strip('"\'')
    raise SystemExit('Missing TMDB_API_KEY. Set it in PowerShell or .env.local')

def js_json(path, start_token):
    txt = path.read_text(encoding='utf-8')
    start = txt.find(start_token)
    if start >= 0:
        txt = txt[start + len(start_token):]
    a = txt.find('[') if '[' in txt[:50] else txt.find('{')
    b = max(txt.rfind(']'), txt.rfind('}'))
    return json.loads(txt[a:b+1])

def load_episodes():
    txt = EPISODES_JS.read_text(encoding='utf-8')
    a, b = txt.find('['), txt.rfind(']')
    return json.loads(txt[a:b+1])

def load_artwork():
    if not ARTWORK_JS.exists():
        return {'shows': {}, 'seasons': {}, 'episodes': {}}
    txt = ARTWORK_JS.read_text(encoding='utf-8')
    a, b = txt.find('{'), txt.rfind('}')
    return json.loads(txt[a:b+1])

def save_artwork(data):
    ARTWORK_JS.parent.mkdir(parents=True, exist_ok=True)
    ARTWORK_JS.write_text('window.WOLF_ARTWORK = ' + json.dumps(data, indent=2, ensure_ascii=False) + ';\n', encoding='utf-8')

def get(api_key, path):
    r = requests.get(TMDB_BASE + path, params={'api_key': api_key}, timeout=30)
    if r.status_code == 404:
        return None
    if r.status_code == 429:
        time.sleep(3)
        r = requests.get(TMDB_BASE + path, params={'api_key': api_key}, timeout=30)
    r.raise_for_status()
    time.sleep(0.035)
    return r.json()

def tmdb_id_for(ep):
    ids = ep.get('showTraktIds') or {}
    if ids.get('tmdb'):
        return ids['tmdb']
    return KNOWN_TMDB.get(ep.get('show'))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--show', default='', help='Only refresh this show')
    ap.add_argument('--all', action='store_true', help='Refresh all shows with TMDB ids')
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()
    if not args.show and not args.all:
        raise SystemExit('Use --show "Law & Order" or --all')
    api_key = load_env_key()
    episodes = load_episodes()
    art = load_artwork()
    art.setdefault('shows', {})
    art.setdefault('seasons', {})
    art.setdefault('episodes', {})
    checked = saved = missing = 0
    for ep in episodes:
        if args.show and ep.get('show') != args.show:
            continue
        if ep.get('isMovie') or int(ep.get('season') or 0) <= 0 or int(ep.get('episode') or 0) <= 0:
            continue
        tmdb = tmdb_id_for(ep)
        if not tmdb:
            continue
        key = f"{ep.get('show')}|{int(ep.get('season') or 0)}|{int(ep.get('episode') or 0)}"
        checked += 1
        try:
            data = get(api_key, f"/tv/{tmdb}/season/{int(ep.get('season'))}/episode/{int(ep.get('episode'))}")
            still = (data or {}).get('still_path')
            if still:
                art['episodes'][key] = {'still': IMG_BASE + still}
                saved += 1
            else:
                missing += 1
        except Exception as exc:
            print(f"WARN {key}: {exc}")
        if checked % 50 == 0:
            print(f"checked {checked}, saved {saved}, missing {missing}")
        if args.limit and checked >= args.limit:
            break
    art['episodeStillLastForced'] = {'show': args.show or 'ALL', 'checked': checked, 'saved': saved, 'missing': missing}
    save_artwork(art)
    print(f"Done. checked={checked} saved={saved} missing={missing}")
    print(f"Updated {ARTWORK_JS}")

if __name__ == '__main__':
    main()
