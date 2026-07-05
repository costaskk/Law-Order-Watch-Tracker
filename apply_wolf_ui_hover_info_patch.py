#!/usr/bin/env python3
"""Patch the tracker UI with Wolf Universe scope filters, richer episode info, hover effects, and artwork fallbacks.
Run from the project root: python apply_wolf_ui_hover_info_patch.py
"""
from pathlib import Path
import re

APP = Path('law_order_tracker_app/app.js')
CSS = Path('law_order_tracker_app/styles.css')
HTML = Path('law_order_tracker_app/index.html')


def patch_css():
    CSS.parent.mkdir(parents=True, exist_ok=True)
    txt = CSS.read_text(encoding='utf-8') if CSS.exists() else ''
    block = r'''

/* Wolf Universe polish: hover, cards, scope chips, richer metadata */
.epCard, .episode-card, .guideRow, .rowCard, .episodeRow, .card {
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease;
}
.epCard:hover, .episode-card:hover, .guideRow:hover, .rowCard:hover, .episodeRow:hover, .card:hover {
  transform: translateY(-2px);
  box-shadow: 0 18px 45px rgba(0,0,0,.35);
  border-color: rgba(255,255,255,.22) !important;
}
.epArt, .poster, .heroPoster, .showArtwork, .episodeArtwork, img {
  transition: transform .22s ease, filter .22s ease, opacity .22s ease;
}
.epCard:hover .epArt, .episode-card:hover .epArt, .guideRow:hover .epArt, .rowCard:hover .epArt {
  transform: scale(1.035);
  filter: contrast(1.08) saturate(1.08);
}
.wolfScopeBar {
  display: flex;
  gap: .55rem;
  flex-wrap: wrap;
  align-items: center;
  margin: .75rem 0 1rem;
}
.wolfScopeBtn {
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.06);
  color: var(--text, #f8fafc);
  border-radius: 999px;
  padding: .48rem .78rem;
  font-weight: 700;
  cursor: pointer;
}
.wolfScopeBtn.active, .wolfScopeBtn:hover {
  background: rgba(239,68,68,.22);
  border-color: rgba(239,68,68,.55);
}
.wolfMeta, .episodeMetaExtra {
  display: flex;
  flex-wrap: wrap;
  gap: .35rem .45rem;
  margin-top: .45rem;
  font-size: .78rem;
  opacity: .92;
}
.wolfPill {
  display: inline-flex;
  align-items: center;
  gap: .25rem;
  border: 1px solid rgba(255,255,255,.13);
  background: rgba(255,255,255,.06);
  border-radius: 999px;
  padding: .16rem .46rem;
}
.wolfConnection {
  margin-top: .45rem;
  color: #fde68a;
  font-size: .82rem;
  line-height: 1.35;
}
.wolfOverview {
  margin-top: .5rem;
  font-size: .86rem;
  line-height: 1.45;
  color: rgba(255,255,255,.78);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
'''
    if 'Wolf Universe polish' not in txt:
        txt += block
        CSS.write_text(txt, encoding='utf-8')


def patch_html():
    if not HTML.exists():
        return
    txt = HTML.read_text(encoding='utf-8')
    if 'data/wolf_artwork.js' not in txt:
        txt = txt.replace('data/show_themes.js"></script><script src="data/episodes.js', 'data/show_themes.js"></script><script src="data/wolf_artwork.js"></script><script src="data/episodes.js')
        txt = txt.replace('data/show_themes.js"></script>\n<script src="data/episodes.js', 'data/show_themes.js"></script>\n<script src="data/wolf_artwork.js"></script>\n<script src="data/episodes.js')
    txt = txt.replace('Law & Order Master Watch Tracker', 'Wolf Universe Watch Tracker')
    txt = txt.replace('Chronological guide • Trakt sync • mobile-friendly app', 'Law & Order • One Chicago • FBI • crossovers • specials')
    HTML.write_text(txt, encoding='utf-8')


def patch_app():
    if not APP.exists():
        print('app.js not found; CSS/HTML patched only.')
        return
    txt = APP.read_text(encoding='utf-8')
    if 'const artworkMeta = window.WOLF_ARTWORK' not in txt:
        txt = txt.replace('const themes = window.SHOW_THEMES || {};', 'const themes = window.SHOW_THEMES || {};\nconst artworkMeta = window.WOLF_ARTWORK || { shows: {}, seasons: {}, episodes: {} };')
    helper = r'''

function wolfScope() {
  return localStorage.getItem('wolfGuideScope') || 'core';
}
function setWolfScope(scope) {
  localStorage.setItem('wolfGuideScope', scope || 'core');
  if (typeof render === 'function') render();
  if (typeof renderEpisodes === 'function') renderEpisodes();
}
function shouldShowByWolfScope(ep) {
  const scope = wolfScope();
  if (scope === 'complete') return true;
  if (scope === 'adjacent') return !ep.optional || ep.alwaysShow || ep.franchise === 'Crossover Adjacent';
  return !ep.optional || ep.alwaysShow;
}
function wolfInfoHtml(ep) {
  const pills = [];
  if (ep.franchise) pills.push(`<span class="wolfPill">${esc(ep.franchise)}</span>`);
  if (ep.isSpecial || Number(ep.season) === 0) pills.push(`<span class="wolfPill">Special</span>`);
  if (ep.isMovie) pills.push(`<span class="wolfPill">Movie</span>`);
  if (ep.optional && !ep.alwaysShow) pills.push(`<span class="wolfPill">Adjacent</span>`);
  if (ep.runtime) pills.push(`<span class="wolfPill">${esc(ep.runtime)} min</span>`);
  const conn = ep.connection ? `<div class="wolfConnection">↳ ${esc(ep.connection)}</div>` : '';
  const overview = ep.overview ? `<div class="wolfOverview">${esc(ep.overview)}</div>` : '';
  return `<div class="wolfMeta">${pills.join('')}</div>${conn}${overview}`;
}
function artwork(show) {
  const art = (artworkMeta.shows || {})[show] || {};
  if (art.backdrop || art.poster) return art.backdrop || art.poster;
  const t = theme(show);
  if (t.image) return t.image;
  const abbr = encodeURIComponent(t.abbr || String(show || 'WOLF').slice(0, 4));
  const color = encodeURIComponent((t.primary || '#b91c1c').replace('#',''));
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='520'%3E%3Crect width='900' height='520' fill='%23${color}'/%3E%3Ctext x='50%25' y='52%25' text-anchor='middle' dominant-baseline='middle' font-family='Arial' font-size='96' font-weight='900' fill='white'%3E${abbr}%3C/text%3E%3C/svg%3E`;
}
function episodeArtwork(ep) {
  const key = `${ep.show}|${Number(ep.season)||0}|${Number(ep.episode)||0}`;
  const art = (artworkMeta.episodes || {})[key] || {};
  const seasonArt = (artworkMeta.seasons || {})[`${ep.show}|${Number(ep.season)||0}`] || {};
  return art.still || seasonArt.poster || artwork(ep.show);
}
'''
    if 'function wolfScope()' not in txt:
        # avoid duplicate artwork function problem: if existing artwork is present, helper still overrides later if inserted before render funcs? Better append; function declaration wins last.
        txt += helper
    # Non-invasive: add scope filter to any global filtering named filteredEpisodes if present.
    txt = txt.replace('return episodes.filter(ep =>', 'return episodes.filter(ep => shouldShowByWolfScope(ep) &&') if 'return episodes.filter(ep =>' in txt and 'shouldShowByWolfScope(ep) &&' not in txt else txt
    # Try to swap episode artwork calls.
    txt = txt.replace('artwork(ep.show)', 'episodeArtwork(ep)')
    txt = txt.replace('artwork(next.show)', 'episodeArtwork(next)')
    # Do not replace inside the artwork function itself after append; correct accidental recursion.
    txt = txt.replace('function episodeArtwork(ep) {\n  const key = `${ep.show}|${Number(ep.season)||0}|${Number(ep.episode)||0}`;\n  const art = (artworkMeta.episodes || {})[key] || {};\n  const seasonArt = (artworkMeta.seasons || {})[`${ep.show}|${Number(ep.season)||0}`] || {};\n  return art.still || seasonArt.poster || episodeArtwork(show);\n}', 'function episodeArtwork(ep) {\n  const key = `${ep.show}|${Number(ep.season)||0}|${Number(ep.episode)||0}`;\n  const art = (artworkMeta.episodes || {})[key] || {};\n  const seasonArt = (artworkMeta.seasons || {})[`${ep.show}|${Number(ep.season)||0}`] || {};\n  return art.still || seasonArt.poster || artwork(ep.show);\n}')
    APP.write_text(txt, encoding='utf-8')


patch_css()
patch_html()
patch_app()
print('Wolf UI hover/info patch applied.')
