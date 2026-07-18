#!/usr/bin/env python3
"""Create a secret-free release ZIP from the current project."""
from __future__ import annotations
import argparse, shutil, tempfile, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_DIRS = {'.git', '__pycache__', '_wolf_patch_backups', '.vercel', 'node_modules', 'legacy', 'archive', 'outputs'}
EXCLUDED_FILES = {'.env', '.env.local', 'trakt_config.json', 'trakt_token.json', 'README.txt', 'FIRST_TIME_GITHUB_PUSH_EXACT_COMMANDS.txt', 'GITHUB_VERCEL_EXACT_STEPS.txt', 'PUSH_TO_GITHUB_EXACT_STEPS.txt', 'WEBSITE_TRIGGER_TRAKT_SYNC_SETUP.txt', 'wolf_v32_ui_cast_patch.js', 'account_config.js', 'wolf_scope_config.js', 'wolf_scope_runtime.js'}
EXCLUDED_SUFFIXES = {'.pyc', '.bak'}
CANONICAL_WORKBOOK = 'Wolf_Universe_Professional_Watch_Tracker_v4.xlsx'


def include(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    if any(part in EXCLUDED_DIRS for part in rel.parts): return False
    if path.name in EXCLUDED_FILES: return False
    if path.suffix in EXCLUDED_SUFFIXES: return False
    if path.suffix == '.xlsx' and path.name != CANONICAL_WORKBOOK: return False
    if rel.parts and rel.parts[0] == 'docs' and path.name not in {'DEPLOYMENT.md', 'SUPABASE.md', 'DATA_MAINTENANCE.md', 'CATALOGUE_AUDIT_V4.md', 'TRAKT_LISTS.md'}: return False
    if path.name.startswith('README_') and path.suffix == '.txt': return False
    if path.name.startswith('apply_') and path.suffix == '.py' and path.name != 'apply_v4_catalog_and_roles.py': return False
    if path.name in {'wolf_mobile_filter_fix.py', 'add_la_dragnet_config.py'}: return False
    if str(rel).replace('\\', '/') in {
        'law_order_tracker_app/data/tmdb_cache.json',
        'law_order_tracker_app/data/wolf_cast_index.js',
        'law_order_tracker_app/data/wolf_artwork.js',
        'law_order_tracker_app/data/episodes.js.bak'
    }: return False
    if path.name.endswith('_debug.json') or path.name.endswith('_changes.csv'): return False
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default=str(ROOT.parent / 'Wolf_Universe_Watch_Tracker_RELEASE.zip'))
    args = parser.parse_args()
    output = Path(args.output).resolve()
    with tempfile.TemporaryDirectory() as td:
        stage = Path(td) / ROOT.name
        for source in ROOT.rglob('*'):
            if not source.is_file() or not include(source): continue
            dest = stage / source.relative_to(ROOT)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, dest)
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for file in stage.rglob('*'):
                if file.is_file(): archive.write(file, file.relative_to(stage.parent))
    print(output)

if __name__ == '__main__': main()
