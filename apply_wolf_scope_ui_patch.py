#!/usr/bin/env python3
"""
Patch the tracker UI to support Wolf Universe guide scope filtering.
Adds a Guide Scope selector:
- Core + crossover-relevant: hides optional adjacent-only shows
- Complete Wolf Universe: shows everything
- Adjacent only: shows optional adjacent-only rows

Run from project root:
  python apply_wolf_scope_ui_patch.py
"""
from pathlib import Path
import re

APP = Path('law_order_tracker_app/app.js')
HTML = Path('law_order_tracker_app/index.html')


def patch_html() -> bool:
    if not HTML.exists():
        print(f'Missing {HTML}')
        return False
    txt = HTML.read_text(encoding='utf-8')
    if 'id="scopeFilter"' not in txt:
        txt = txt.replace(
            '<select id="showFilter"><option value="">All shows</option></select>',
            '<select id="showFilter"><option value="">All shows</option></select>\n'
            '    <select id="scopeFilter" title="Guide scope">\n'
            '      <option value="core">Core + crossover-relevant</option>\n'
            '      <option value="complete">Complete Wolf Universe</option>\n'
            '      <option value="adjacent">Adjacent only</option>\n'
            '    </select>'
        )
    HTML.write_text(txt, encoding='utf-8')
    print(f'Patched {HTML}')
    return True


def patch_app() -> bool:
    if not APP.exists():
        print(f'Missing {APP}')
        return False
    txt = APP.read_text(encoding='utf-8')

    # Add scope metadata to normalized episodes.
    if 'universeScope: ep.universeScope' not in txt:
        txt = txt.replace(
            "sourceWatch: ep.sourceWatch || ep.source_watch || ''",
            "sourceWatch: ep.sourceWatch || ep.source_watch || '',\n"
            "      franchise: ep.franchise || '',\n"
            "      optional: Boolean(ep.optional),\n"
            "      alwaysShow: Boolean(ep.alwaysShow),\n"
            "      connection: ep.connection || '',\n"
            "      universeScope: ep.universeScope || (ep.optional && !ep.alwaysShow ? 'adjacent' : 'core'),\n"
            "      isSpecial: Boolean(ep.isSpecial),\n"
            "      isMovie: Boolean(ep.isMovie)"
        )

    # Add helper after uniqueSeasons.
    if 'function scopeMatches(ep)' not in txt:
        txt = txt.replace(
            "function uniqueSeasons(items) {\n  return [...new Set(items.map(e => e.season).filter(v => v !== '' && v !== null && v !== undefined))]\n    .sort((a, b) => Number(a) - Number(b));\n}\n",
            "function uniqueSeasons(items) {\n  return [...new Set(items.map(e => e.season).filter(v => v !== '' && v !== null && v !== undefined))]\n    .sort((a, b) => Number(a) - Number(b));\n}\n\n"
            "function currentScope() {\n  return document.getElementById('scopeFilter')?.value || 'core';\n}\n\n"
            "function scopeMatches(ep) {\n  const scope = currentScope();\n  const isAdjacentOnly = Boolean(ep.optional) && !Boolean(ep.alwaysShow);\n  if (scope === 'complete') return true;\n  if (scope === 'adjacent') return isAdjacentOnly;\n  return !isAdjacentOnly;\n}\n"
        )

    # Scope-aware show and season dropdowns.
    txt = txt.replace(
        "const shows = [...new Set(episodes.map(e => e.show).filter(Boolean))];",
        "const shows = [...new Set(episodes.filter(scopeMatches).map(e => e.show).filter(Boolean))];"
    )
    txt = txt.replace(
        "episodes.filter(e => e.show === show && getStatus(e) === 'Watched').length",
        "episodes.filter(e => scopeMatches(e) && e.show === show && getStatus(e) === 'Watched').length"
    )
    txt = txt.replace(
        "episodes.filter(e => e.show === show).length",
        "episodes.filter(e => scopeMatches(e) && e.show === show).length"
    )
    txt = txt.replace(
        "uniqueSeasons(episodes.filter(e => !show || e.show === show))",
        "uniqueSeasons(episodes.filter(e => scopeMatches(e) && (!show || e.show === show)))"
    )
    txt = txt.replace(
        "uniqueSeasons(episodes.filter(e => e.show === bulkShow))",
        "uniqueSeasons(episodes.filter(e => scopeMatches(e) && e.show === bulkShow))"
    )

    # Add scope check in matches.
    if "if (!scopeMatches(ep)) return false;" not in txt:
        txt = txt.replace(
            "const st = getStatus(ep);\n\n  if (show && ep.show !== show) return false;",
            "const st = getStatus(ep);\n\n  if (!scopeMatches(ep)) return false;\n  if (show && ep.show !== show) return false;"
        )

    # Scope-aware dashboard totals/next.
    txt = txt.replace(
        "const total = episodes.length;\n  const watched = episodes.filter(e => getStatus(e) === 'Watched').length;",
        "const scopedEpisodes = episodes.filter(scopeMatches);\n  const total = scopedEpisodes.length;\n  const watched = scopedEpisodes.filter(e => getStatus(e) === 'Watched').length;"
    )
    txt = txt.replace(
        "const next = episodes.find(e => getStatus(e) !== 'Watched');",
        "const next = scopedEpisodes.find(e => getStatus(e) !== 'Watched');"
    )

    # Make search include connection/franchise.
    txt = txt.replace(
        "const haystack = `${ep.title} ${ep.show} ${ep.notes} ${ep.code} ${ep.airDate}`.toLowerCase();",
        "const haystack = `${ep.title} ${ep.show} ${ep.franchise || ''} ${ep.connection || ''} ${ep.notes} ${ep.code} ${ep.airDate}`.toLowerCase();"
    )

    # Add connection/special badges in episode cards if this exact template exists.
    txt = txt.replace(
        "<div class=\"meta\">${esc(ep.airDate || 'No date')} • Season ${esc(ep.season)} Episode ${esc(ep.episode)} • ${esc(st)}</div>",
        "<div class=\"meta\">${esc(ep.airDate || 'No date')} • ${ep.isMovie ? 'Movie / Special' : `Season ${esc(ep.season)} Episode ${esc(ep.episode)}`} • ${esc(st)}${ep.isSpecial ? ' • Special' : ''}${ep.optional && !ep.alwaysShow ? ' • Adjacent' : ''}</div>"
    )
    txt = txt.replace(
        "${ep.notes ? `<div class=\"crossover\">${esc(ep.notes)}</div>` : ''}",
        "${ep.connection ? `<div class=\"crossover\">${esc(ep.connection)}</div>` : (ep.notes ? `<div class=\"crossover\">${esc(ep.notes)}</div>` : '')}"
    )

    # Ensure scope changes refresh the dropdowns/render. Works even if your init listener block differs.
    if "scopeFilter')?.addEventListener('change'" not in txt:
        marker = "document.getElementById('resetFilters')?.addEventListener('click'"
        if marker in txt:
            txt = txt.replace(marker, "document.getElementById('scopeFilter')?.addEventListener('change', () => { initOptions(); updateSeasonOptions(); render(); });\n" + marker)
        else:
            txt += "\n\ndocument.getElementById('scopeFilter')?.addEventListener('change', () => { initOptions(); updateSeasonOptions(); render(); });\n"

    APP.write_text(txt, encoding='utf-8')
    print(f'Patched {APP}')
    return True


if __name__ == '__main__':
    ok = patch_html() and patch_app()
    if ok:
        print('Done. Commit law_order_tracker_app/index.html and law_order_tracker_app/app.js after testing.')
