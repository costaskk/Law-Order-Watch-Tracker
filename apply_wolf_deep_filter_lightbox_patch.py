#!/usr/bin/env python3
"""Wolf Universe deep UI fix.

Run from project root.
Fixes:
- Correct Core / Connected / Adjacent / Complete filtering using show-level config.
- Ensures scope runtime loads before app.js, so the main app receives the scoped guide.
- Show chips/dropdowns only use shows that actually have episodes in the active scope.
- Adjacent-only returns archive/adjacent shows only, not an empty list.
- Adds click-to-enlarge lightbox for img tags and background artwork.
- Keeps episode numbers/artwork visible on mobile.
- Adds safe local debug counts in data/wolf_scope_debug.json.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path('.')
APP = ROOT / 'law_order_tracker_app'
DATA = APP / 'data'
INDEX = APP / 'index.html'
ROOT_INDEX = ROOT / 'index.html'
STYLES = APP / 'styles.css'
SHOWS = ROOT / 'wolf_universe_shows.json'
SCOPE_CONFIG = DATA / 'wolf_scope_config.js'
RUNTIME_JS = DATA / 'wolf_scope_runtime.js'
DEBUG_JSON = DATA / 'wolf_scope_debug.json'


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))


def js_string(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)


def build_scope_config() -> Dict[str, Any]:
    cfg = read_json(SHOWS)
    show_meta: Dict[str, Dict[str, Any]] = {}
    for section in ('shows', 'movies'):
        for item in cfg.get(section, []) or []:
            show = item.get('show')
            if not show:
                continue
            scope = item.get('scope') or ('connected' if item.get('alwaysShow') else 'complete' if item.get('optional') else 'core')
            optional = bool(item.get('optional', False))
            always = bool(item.get('alwaysShow', False))
            # Strict category definitions for UI filtering.
            category = 'core'
            if scope == 'connected' or (always and optional):
                category = 'connected'
            if scope in ('adjacent', 'complete') and optional and not always:
                category = 'adjacent'
            if item.get('franchise') in ('Crossover Adjacent', 'Wolf Archive', 'Wolf Adjacent') and optional and not always:
                category = 'adjacent'
            show_meta[show] = {
                'show': show,
                'scope': scope,
                'category': category,
                'optional': optional,
                'alwaysShow': always,
                'franchise': item.get('franchise') or '',
                'connection': item.get('connection') or '',
                'slug': item.get('slug') or '',
                'imdb': item.get('imdb') or '',
            }
    return {
        'generatedBy': 'apply_wolf_deep_filter_lightbox_patch.py',
        'scopes': cfg.get('scopes') or {
            'core': 'Core Wolf Universe',
            'connected': 'Core + crossover / important adjacent',
            'adjacent': 'Adjacent only',
            'complete': 'Complete Dick Wolf archive'
        },
        'aliases': cfg.get('aliases') or {},
        'shows': show_meta,
    }


RUNTIME = r'''// Wolf Universe deep runtime: strict scopes, show-aware filters, mobile badges, artwork lightbox.
(function(){
  const scopeConfig = window.WOLF_SCOPE_CONFIG || { shows: {}, scopes: {} };
  const metaByShow = scopeConfig.shows || {};
  const scopeLabels = Object.assign({
    core: 'Core Wolf Universe',
    connected: 'Core + crossover / important adjacent',
    adjacent: 'Adjacent only',
    complete: 'Complete Dick Wolf archive'
  }, scopeConfig.scopes || {});
  const VALID_SCOPES = new Set(Object.keys(scopeLabels));
  const originalEpisodes = Array.isArray(window.LAW_ORDER_EPISODES) ? window.LAW_ORDER_EPISODES.slice() : [];
  window.WOLF_ALL_EPISODES = originalEpisodes;

  function b(v){ return v === true || v === 'true' || v === 1 || v === '1'; }
  function n(v){ return Number(v) || 0; }
  function text(v){ return String(v || '').trim(); }
  function lower(v){ return text(v).toLowerCase(); }
  function meta(ep){ return metaByShow[ep.show] || {}; }
  function isMovie(ep){ return b(ep.isMovie); }
  function isSpecial(ep){ return b(ep.isSpecial) || n(ep.season) === 0; }
  function epCategory(ep){
    const m = meta(ep);
    if (m.category) return m.category;
    const f = lower(ep.franchise);
    const scope = lower(ep.scope);
    if (scope === 'core' || ['law & order','one chicago','fbi'].includes(ep.franchise)) return 'core';
    if (scope === 'connected' || b(ep.alwaysShow) || b(m.alwaysShow)) return 'connected';
    if (scope === 'adjacent' || scope === 'complete' || b(ep.optional) || b(m.optional) || f.includes('adjacent') || f.includes('archive')) return 'adjacent';
    return 'core';
  }
  function keepForScope(ep, scope){
    const cat = epCategory(ep);
    if (scope === 'complete') return true;
    if (scope === 'adjacent') return cat === 'adjacent';
    if (scope === 'connected') return cat === 'core' || cat === 'connected';
    return cat === 'core';
  }
  function getScope(){
    const saved = localStorage.getItem('wolfGuideScope') || 'connected';
    return VALID_SCOPES.has(saved) ? saved : 'connected';
  }
  function applyScope(){
    const scope = getScope();
    window.WOLF_GUIDE_SCOPE = scope;
    window.LAW_ORDER_EPISODES = originalEpisodes.filter(ep => keepForScope(ep, scope));
  }
  applyScope();

  function statusOf(ep){ return lower(ep.status || ep.watchStatus || ep.userStatus); }
  function isWatched(ep){ const s = statusOf(ep); return s === 'watched' || s === 'completed' || s === 'done' || s.includes('watched'); }
  function epNum(ep){
    if (isMovie(ep)) return 'MOVIE';
    const s = n(ep.season), e = n(ep.episode);
    if (isSpecial(ep)) return `S00E${String(e).padStart(2,'0')}`;
    return `S${String(s).padStart(2,'0')}E${String(e).padStart(2,'0')}`;
  }
  function esc(s){ return String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function scopedRows(){ return window.LAW_ORDER_EPISODES || []; }

  window.setWolfGuideScope = function(next){
    if (!VALID_SCOPES.has(next)) next = 'connected';
    localStorage.setItem('wolfGuideScope', next);
    location.reload();
  };

  function showStats(rows){
    const map = new Map();
    for (const ep of rows) {
      const show = ep.show || 'Unknown';
      if (!map.has(show)) map.set(show, { show, total: 0, watched: 0, category: epCategory(ep), franchise: ep.franchise || meta(ep).franchise || '' });
      const s = map.get(show);
      s.total++;
      if (isWatched(ep)) s.watched++;
    }
    return Array.from(map.values()).filter(x => x.total > 0).sort((a,b) => a.show.localeCompare(b.show));
  }

  function addScopeBar(){
    if (document.getElementById('wolfScopeBar')) return;
    const bar = document.createElement('section');
    bar.id = 'wolfScopeBar';
    bar.className = 'wolf-scope-bar';
    bar.innerHTML = `<div class="wolf-scope-main"><label for="wolfScopeSelect">Guide scope</label><select id="wolfScopeSelect"></select><span class="wolf-scope-count"></span></div><div id="wolfSeriesProgress" class="wolf-series-progress"></div>`;
    const host = document.querySelector('main') || document.body;
    host.insertBefore(bar, host.firstChild);
    const select = bar.querySelector('#wolfScopeSelect');
    select.innerHTML = Object.entries(scopeLabels).map(([k,v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    select.value = window.WOLF_GUIDE_SCOPE;
    select.addEventListener('change', e => window.setWolfGuideScope(e.target.value));
  }

  function activeDomFilteredRows(){
    // Use app state when exposed, otherwise scoped rows. Avoid trying to infer show list from stale DOM if no cards rendered yet.
    const cards = Array.from(document.querySelectorAll('.episode-card,.epCard,.episode,.guide-row,.row-card,[data-show]')).filter(el => el.offsetParent !== null && !el.closest('#wolfScopeBar'));
    if (!cards.length) return scopedRows();
    const hay = cards.map(el => (el.textContent || '').toLowerCase()).join('\n');
    const matched = scopedRows().filter(ep => {
      const title = lower(ep.title), show = lower(ep.show), code = lower(ep.code || epNum(ep));
      let score = 0;
      if (show && hay.includes(show)) score++;
      if (title && title.length > 3 && hay.includes(title.substring(0, Math.min(30, title.length)))) score += 2;
      if (code && hay.includes(code)) score++;
      return score > 0;
    });
    return matched.length ? matched : scopedRows();
  }

  function updateNativeShowDropdowns(){
    const shows = showStats(scopedRows()).map(s => s.show);
    for (const sel of document.querySelectorAll('select')) {
      const txt = (sel.getAttribute('aria-label') || sel.previousElementSibling?.textContent || sel.id || '').toLowerCase();
      if (!txt.includes('show') && !Array.from(sel.options).some(o => o.textContent.includes('Law & Order') || o.textContent.includes('Chicago') || o.textContent === 'FBI')) continue;
      if (sel.id === 'wolfScopeSelect') continue;
      const current = sel.value;
      const first = Array.from(sel.options).find(o => /all shows/i.test(o.textContent))?.outerHTML || '<option value="">All shows</option>';
      sel.innerHTML = first + shows.map(show => `<option value="${esc(show)}">${esc(show)}</option>`).join('');
      if (shows.includes(current)) sel.value = current;
    }
  }

  window.updateWolfSeriesProgress = function(){
    const count = document.querySelector('#wolfScopeBar .wolf-scope-count');
    if (count) count.textContent = `${scopeLabels[window.WOLF_GUIDE_SCOPE] || window.WOLF_GUIDE_SCOPE} • ${scopedRows().length} of ${originalEpisodes.length} entries`;
    const wrap = document.getElementById('wolfSeriesProgress');
    if (!wrap) return;
    const stats = showStats(activeDomFilteredRows());
    wrap.innerHTML = stats.length ? stats.map(s => {
      const pct = s.total ? Math.round((s.watched / s.total) * 100) : 0;
      return `<button class="wolf-show-chip wolf-cat-${esc(s.category)}" data-show="${esc(s.show)}" title="${esc(s.show)}: ${s.watched}/${s.total} watched"><span class="wolf-show-name">${esc(s.show)}</span><span class="wolf-show-count">${s.watched}/${s.total}</span><span class="wolf-show-bar"><i style="width:${pct}%"></i></span></button>`;
    }).join('') : '<div class="wolf-empty-scope">No series with episodes match this scope/filter.</div>';
    updateNativeShowDropdowns();
  };

  function cardEp(card){
    const hay = lower(card.textContent || '');
    let best = null, score = 0;
    for (const ep of scopedRows()) {
      let sc = 0;
      if (lower(ep.show) && hay.includes(lower(ep.show))) sc += 2;
      if (lower(ep.title) && hay.includes(lower(ep.title))) sc += 4;
      if (lower(ep.code || epNum(ep)) && hay.includes(lower(ep.code || epNum(ep)))) sc += 3;
      if (hay.includes(`season ${n(ep.season)}`) && hay.includes(`episode ${n(ep.episode)}`)) sc += 3;
      if (sc > score) { score = sc; best = ep; }
    }
    return score >= 4 ? best : null;
  }

  function mobileBadges(){
    const cards = Array.from(document.querySelectorAll('.episode-card,.epCard,.episode,.guide-row,.row-card,.card')).filter(el => !el.closest('#wolfScopeBar'));
    for (const card of cards) {
      if (card.querySelector('.wolf-mobile-epnum')) continue;
      const ep = cardEp(card);
      if (!ep) continue;
      const badge = document.createElement('span');
      badge.className = 'wolf-mobile-epnum';
      badge.textContent = epNum(ep);
      const target = card.querySelector('.title,h2,h3,h4,.episode-title,.epTitle') || card.firstElementChild || card;
      target.insertAdjacentElement('afterbegin', badge);
    }
  }

  function extractBgUrl(el){
    const bg = getComputedStyle(el).backgroundImage || '';
    const m = bg.match(/url\(["']?(.*?)["']?\)/);
    return m ? m[1] : '';
  }

  function installLightbox(){
    if (document.getElementById('wolfImageLightbox')) return;
    const box = document.createElement('div');
    box.id = 'wolfImageLightbox';
    box.className = 'wolf-lightbox';
    box.innerHTML = '<button class="wolf-lightbox-close" aria-label="Close">×</button><img alt="Artwork preview"><div class="wolf-lightbox-caption"></div>';
    document.body.appendChild(box);
    const close = () => box.classList.remove('open');
    box.addEventListener('click', e => { if (e.target === box) close(); });
    box.querySelector('.wolf-lightbox-close').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.addEventListener('click', e => {
      const el = e.target.closest('img,.epArt,.poster,.hero,.card,.episode-card,.epCard,.guide-row,.row-card');
      if (!el || el.closest('#wolfImageLightbox') || el.closest('button,a,select,input,label')) return;
      let src = '';
      let caption = '';
      if (el.tagName === 'IMG') { src = el.currentSrc || el.src; caption = el.alt || ''; }
      if (!src) {
        const img = el.querySelector && el.querySelector('img');
        if (img) { src = img.currentSrc || img.src; caption = img.alt || ''; }
      }
      if (!src) { src = extractBgUrl(el); caption = (el.textContent || '').trim().slice(0, 120); }
      if (!src || src.startsWith('data:image/svg+xml')) return;
      e.preventDefault();
      box.querySelector('img').src = src;
      box.querySelector('.wolf-lightbox-caption').textContent = caption;
      box.classList.add('open');
    }, true);
  }

  function enhance(){
    updateWolfSeriesProgress();
    mobileBadges();
  }

  function writeDebug(){
    try {
      window.WOLF_SCOPE_DEBUG = {
        scope: window.WOLF_GUIDE_SCOPE,
        totalAll: originalEpisodes.length,
        totalScoped: scopedRows().length,
        showCount: showStats(scopedRows()).length,
        categoryCounts: originalEpisodes.reduce((a, ep) => { const c = epCategory(ep); a[c] = (a[c] || 0) + 1; return a; }, {})
      };
      console.info('Wolf scope debug', window.WOLF_SCOPE_DEBUG);
    } catch(e) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    addScopeBar();
    installLightbox();
    enhance();
    writeDebug();
    const mo = new MutationObserver(() => { clearTimeout(window.__wolfEnhanceTimer); window.__wolfEnhanceTimer = setTimeout(enhance, 100); });
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('input', () => setTimeout(enhance, 80), true);
    document.addEventListener('change', () => setTimeout(enhance, 80), true);
    document.addEventListener('click', () => setTimeout(enhance, 160), true);
    setTimeout(enhance, 400); setTimeout(enhance, 1200); setTimeout(enhance, 2500);
  });
})();
'''

CSS = r'''/* Wolf Universe deep mobile/filter/lightbox patch */
.wolf-scope-bar{margin:1rem auto;padding:1rem;border:1px solid rgba(148,163,184,.28);border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.74));box-shadow:0 18px 55px rgba(0,0,0,.22);max-width:1280px}.wolf-scope-main{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap}.wolf-scope-main label{font-weight:900;color:#e5e7eb}.wolf-scope-main select{background:#16243a;color:#f8fafc;border:1px solid rgba(96,165,250,.35);border-radius:14px;padding:.72rem 1rem;font-weight:850}.wolf-scope-count{color:#bfdbfe;font-weight:800}.wolf-series-progress{display:flex;gap:.55rem;overflow-x:auto;padding:.8rem .1rem .15rem;scrollbar-width:thin}.wolf-show-chip{flex:0 0 auto;min-width:178px;text-align:left;border-radius:999px;border:1px solid rgba(148,163,184,.28);background:linear-gradient(180deg,#172338,#111827);color:#fff;padding:.62rem .85rem;cursor:pointer;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}.wolf-show-chip:hover{transform:translateY(-2px);box-shadow:0 14px 35px rgba(0,0,0,.26);border-color:rgba(255,255,255,.38)}.wolf-show-chip .wolf-show-name{display:block;font-weight:1000;font-size:.82rem;max-width:190px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wolf-show-chip .wolf-show-count{display:block;font-size:.75rem;color:#bfdbfe;margin-top:.12rem}.wolf-show-bar{display:block;height:5px;border-radius:999px;background:rgba(30,64,175,.38);overflow:hidden;margin-top:.34rem}.wolf-show-bar i{display:block;height:100%;background:linear-gradient(90deg,#22c55e,#60a5fa);border-radius:inherit}.wolf-cat-adjacent .wolf-show-bar i{background:linear-gradient(90deg,#f59e0b,#f97316)}.wolf-cat-connected .wolf-show-bar i{background:linear-gradient(90deg,#a855f7,#60a5fa)}.wolf-empty-scope{padding:.8rem 1rem;border-radius:14px;background:rgba(250,204,21,.12);border:1px solid rgba(250,204,21,.28);color:#fde68a;font-weight:900}.wolf-mobile-epnum{display:inline-flex!important;margin-right:.45rem;margin-bottom:.22rem;padding:.22rem .46rem;border-radius:999px;background:rgba(96,165,250,.20);border:1px solid rgba(96,165,250,.38);color:#dbeafe;font-weight:1000;font-size:.74rem;letter-spacing:.03em;vertical-align:middle;white-space:nowrap}.episode-number,.episodeNumber,.ep-number,.epNumber,.episode-code,.ep-code,.code,.seasonEpisode,.season-episode,[class*="episode-number"],[class*="EpisodeNumber"]{display:inline-flex!important;visibility:visible!important;opacity:1!important}.episode-card,.epCard,.episode,.guide-row,.row-card,.card{transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease,filter .18s ease}.episode-card:hover,.epCard:hover,.episode:hover,.guide-row:hover,.row-card:hover,.card:hover{transform:translateY(-3px);box-shadow:0 20px 56px rgba(0,0,0,.32);border-color:rgba(255,255,255,.30);filter:saturate(1.08)}.epArt,img.epArt,.poster,img.poster,.hero img,.card img,[style*="background-image"]{cursor:zoom-in;transition:transform .22s ease,filter .22s ease,opacity .22s ease}.epArt:hover,img.epArt:hover,.poster:hover,img.poster:hover,.hero img:hover,.card img:hover{transform:scale(1.035);filter:saturate(1.12) contrast(1.04)}.wolf-lightbox{position:fixed;inset:0;z-index:99999;background:rgba(2,6,23,.90);display:none;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(8px)}.wolf-lightbox.open{display:flex}.wolf-lightbox img{max-width:min(1200px,94vw);max-height:82vh;border-radius:20px;box-shadow:0 35px 90px rgba(0,0,0,.65);object-fit:contain;background:#020617}.wolf-lightbox-close{position:absolute;top:18px;right:22px;width:46px;height:46px;border-radius:999px;border:1px solid rgba(255,255,255,.28);background:rgba(15,23,42,.9);color:#fff;font-size:32px;line-height:1;cursor:pointer}.wolf-lightbox-caption{position:absolute;bottom:18px;left:24px;right:24px;text-align:center;color:#e5e7eb;font-weight:900;text-shadow:0 2px 8px #000}@media (max-width:720px){.wolf-scope-bar{margin:.75rem 0;border-radius:16px;padding:.8rem}.wolf-scope-main{align-items:stretch}.wolf-scope-main select{width:100%}.wolf-series-progress{display:flex!important}.wolf-show-chip{min-width:155px}.epArt,img.epArt,.poster,img.poster,.card img,.hero img{display:block!important;visibility:visible!important;opacity:1!important;max-width:128px!important;min-width:82px!important;min-height:72px!important;height:auto!important;object-fit:cover!important}.episode-card,.epCard,.guide-row,.row-card,.card{gap:.75rem}.wolf-mobile-epnum{display:inline-flex!important;font-size:.72rem;margin-bottom:.22rem}.wolf-lightbox{padding:12px}.wolf-lightbox img{max-width:96vw;max-height:78vh;border-radius:14px}}
'''


def patch_index(path: Path) -> None:
    if not path.exists():
        return
    txt = path.read_text(encoding='utf-8')
    txt = txt.replace('Law & Order Master Watch Tracker', 'Wolf Universe Watch Tracker')
    txt = txt.replace('L&amp;O', 'WOLF').replace('>L&O<', '>WOLF<')
    # Remove duplicate old scope runtime/config tags.
    txt = re.sub(r'\s*<script src="data/wolf_scope_config\.js"></script>', '', txt)
    txt = re.sub(r'\s*<script src="data/wolf_scope_runtime\.js"></script>', '', txt)
    # Ensure wolf_artwork is loaded before themes/episodes/app if possible.
    if 'data/wolf_artwork.js' not in txt:
        txt = txt.replace('<script src="data/show_themes.js"></script>', '<script src="data/wolf_artwork.js"></script><script src="data/show_themes.js"></script>')
    # Place scope config + runtime immediately after episodes.js and before app.js.
    if '<script src="data/episodes.js"></script>' in txt:
        txt = txt.replace('<script src="data/episodes.js"></script>', '<script src="data/episodes.js"></script><script src="data/wolf_scope_config.js"></script><script src="data/wolf_scope_runtime.js"></script>')
    else:
        # Fallback: before app.js.
        txt = txt.replace('<script src="app.js"></script>', '<script src="data/wolf_scope_config.js"></script><script src="data/wolf_scope_runtime.js"></script><script src="app.js"></script>')
    path.write_text(txt, encoding='utf-8')


def patch_styles() -> None:
    STYLES.parent.mkdir(parents=True, exist_ok=True)
    s = STYLES.read_text(encoding='utf-8') if STYLES.exists() else ''
    marker = '/* Wolf Universe deep mobile/filter/lightbox patch */'
    if marker in s:
        s = s[:s.find(marker)].rstrip() + '\n'
    STYLES.write_text(s.rstrip() + '\n\n' + CSS + '\n', encoding='utf-8')


def main() -> None:
    if not SHOWS.exists():
        raise SystemExit('Missing wolf_universe_shows.json in project root.')
    DATA.mkdir(parents=True, exist_ok=True)
    cfg = build_scope_config()
    SCOPE_CONFIG.write_text('window.WOLF_SCOPE_CONFIG = ' + js_string(cfg) + ';\n', encoding='utf-8')
    RUNTIME_JS.write_text(RUNTIME, encoding='utf-8')
    patch_styles()
    patch_index(INDEX)
    patch_index(ROOT_INDEX)
    DEBUG_JSON.write_text(json.dumps({
        'note': 'Runtime writes live counts to console as window.WOLF_SCOPE_DEBUG',
        'configuredShows': len(cfg['shows']),
        'categories': {k: sum(1 for s in cfg['shows'].values() if s.get('category') == k) for k in ['core','connected','adjacent']},
    }, indent=2), encoding='utf-8')
    print('Applied Wolf deep filter/lightbox/mobile patch.')
    print('Wrote:', SCOPE_CONFIG)
    print('Wrote:', RUNTIME_JS)


if __name__ == '__main__':
    main()
