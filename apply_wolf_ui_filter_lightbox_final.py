#!/usr/bin/env python3
"""
Final Wolf Universe UI repair patch.
Run from project root:
  python apply_wolf_ui_filter_lightbox_final.py

Fixes:
- removes previous bad duplicate scope/filter runtime behavior
- restores correct Core / Connected / Adjacent / Complete scope separation
- prevents native season/status selects from being overwritten with show lists
- hides bad S00E00/mobile badges injected by older patches
- keeps real episode numbers/titles visible on mobile
- adds reliable click-to-enlarge lightbox for artwork/images
- adds show progress chips that only include shows with episodes in the active scope
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict

ROOT = Path('.')
APP = ROOT / 'law_order_tracker_app'
DATA = APP / 'data'
INDEX = APP / 'index.html'
ROOT_INDEX = ROOT / 'index.html'
STYLES = APP / 'styles.css'
SHOWS = ROOT / 'wolf_universe_shows.json'
SCOPE_CONFIG = DATA / 'wolf_scope_config.js'
RUNTIME_JS = DATA / 'wolf_scope_runtime.js'

DEFAULT_SCOPES = {
    'core': 'Core Wolf Universe',
    'connected': 'Core + crossover relevant',
    'adjacent': 'Adjacent only',
    'complete': 'Complete Wolf Universe',
}

CORE_FRANCHISES = {'Law & Order', 'One Chicago', 'FBI', 'FBI Universe'}
ADJ_FRANCHISES = {'Crossover Adjacent', 'Wolf Adjacent', 'Wolf Archive', 'Wolf Documentary'}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))


def classify(item: Dict[str, Any]) -> str:
    explicit = str(item.get('scope') or '').strip().lower()
    if explicit in {'core', 'connected', 'adjacent'}:
        return explicit
    if bool(item.get('alwaysShow')) and bool(item.get('optional')):
        return 'connected'
    franchise = str(item.get('franchise') or '').strip()
    if bool(item.get('optional')) and franchise in ADJ_FRANCHISES:
        return 'adjacent'
    if bool(item.get('optional')) and not bool(item.get('alwaysShow')):
        return 'adjacent'
    if franchise in CORE_FRANCHISES or not bool(item.get('optional')):
        return 'core'
    return 'adjacent'


def build_config() -> Dict[str, Any]:
    if not SHOWS.exists():
        raise SystemExit('Missing wolf_universe_shows.json in project root.')
    raw = read_json(SHOWS)
    shows: Dict[str, Dict[str, Any]] = {}
    for section in ('shows', 'movies'):
        for item in raw.get(section, []) or []:
            show = item.get('show')
            if not show:
                continue
            cat = classify(item)
            shows[show] = {
                'show': show,
                'category': cat,
                'scope': cat,
                'optional': bool(item.get('optional')),
                'alwaysShow': bool(item.get('alwaysShow')),
                'franchise': item.get('franchise') or '',
                'connection': item.get('connection') or '',
                'slug': item.get('slug') or '',
                'imdb': item.get('imdb') or '',
            }
    return {
        'generatedBy': 'apply_wolf_ui_filter_lightbox_final.py',
        'scopes': raw.get('scopes') or DEFAULT_SCOPES,
        'shows': shows,
    }

RUNTIME = r'''// Final Wolf Universe UI runtime: clean scopes, no duplicate filter corruption, artwork lightbox.
(function(){
  const cfg = window.WOLF_SCOPE_CONFIG || { scopes: {}, shows: {} };
  const metaByShow = cfg.shows || {};
  const scopeLabels = Object.assign({
    core: 'Core Wolf Universe',
    connected: 'Core + crossover relevant',
    adjacent: 'Adjacent only',
    complete: 'Complete Wolf Universe'
  }, cfg.scopes || {});
  const allowedScopes = ['core','connected','adjacent','complete'];
  const allEpisodes = Array.isArray(window.LAW_ORDER_EPISODES) ? window.LAW_ORDER_EPISODES.slice() : [];
  window.WOLF_ALL_EPISODES = allEpisodes;

  const bool = v => v === true || v === 1 || v === 'true' || v === '1';
  const num = v => Number(v) || 0;
  const norm = v => String(v || '').trim().toLowerCase();
  const esc = s => String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function meta(ep){ return metaByShow[ep.show] || {}; }
  function category(ep){
    const m = meta(ep);
    if (m.category) return m.category;
    const f = norm(ep.franchise);
    if (bool(ep.optional) || f.includes('adjacent') || f.includes('archive') || f.includes('documentary')) return 'adjacent';
    if (bool(ep.alwaysShow)) return 'connected';
    return 'core';
  }
  function keep(ep, scope){
    const c = category(ep);
    if (scope === 'complete') return true;
    if (scope === 'adjacent') return c === 'adjacent';
    if (scope === 'connected') return c === 'core' || c === 'connected';
    return c === 'core';
  }
  function getScope(){
    const s = localStorage.getItem('wolfGuideScope') || 'connected';
    return allowedScopes.includes(s) ? s : 'connected';
  }
  function applyScope(){
    const s = getScope();
    window.WOLF_GUIDE_SCOPE = s;
    window.LAW_ORDER_EPISODES = allEpisodes.filter(ep => keep(ep, s));
  }
  applyScope();

  function isWatched(ep){
    const s = norm(ep.status || ep.watchStatus || ep.userStatus);
    return s === 'watched' || s === 'completed' || s === 'done' || s.includes('watched');
  }
  function isMovie(ep){ return bool(ep.isMovie); }
  function isSpecial(ep){ return bool(ep.isSpecial) || num(ep.season) === 0; }
  function epCode(ep){
    if (isMovie(ep)) return 'MOVIE';
    const s = num(ep.season), e = num(ep.episode);
    if (s === 0 || isSpecial(ep)) return e > 0 ? `S00E${String(e).padStart(2,'0')}` : '';
    if (s > 0 && e > 0) return `S${String(s).padStart(2,'0')}E${String(e).padStart(2,'0')}`;
    return '';
  }
  function scopedRows(){ return window.LAW_ORDER_EPISODES || []; }
  function stats(rows){
    const m = new Map();
    for (const ep of rows) {
      const show = ep.show || 'Unknown';
      if (!m.has(show)) m.set(show, {show,total:0,watched:0,category:category(ep),franchise:ep.franchise || meta(ep).franchise || ''});
      const row = m.get(show); row.total++; if (isWatched(ep)) row.watched++;
    }
    return Array.from(m.values()).filter(x => x.total > 0).sort((a,b)=>a.show.localeCompare(b.show));
  }

  window.setWolfGuideScope = function(scope){
    if (!allowedScopes.includes(scope)) scope = 'connected';
    localStorage.setItem('wolfGuideScope', scope);
    location.reload();
  };

  function removeBadOldBits(){
    document.querySelectorAll('.wolf-mobile-epnum').forEach(el => el.remove());
    const bars = Array.from(document.querySelectorAll('#wolfScopeBar'));
    bars.slice(1).forEach(b => b.remove());
  }

  function scopeBar(){
    removeBadOldBits();
    let bar = document.getElementById('wolfScopeBar');
    if (!bar) {
      bar = document.createElement('section');
      bar.id = 'wolfScopeBar';
      bar.className = 'wolf-scope-bar';
      bar.innerHTML = `<div class="wolf-scope-head"><div><strong>Guide scope</strong><span class="wolf-scope-count"></span></div><select id="wolfScopeSelect" aria-label="Guide scope"></select></div><div id="wolfSeriesProgress" class="wolf-series-progress"></div>`;
      const main = document.querySelector('main') || document.body;
      const afterHeader = main.querySelector('.hero,.stats,.dashboard,.summary') || main.firstElementChild;
      main.insertBefore(bar, afterHeader || main.firstChild);
    }
    const sel = bar.querySelector('#wolfScopeSelect');
    if (sel && !sel.dataset.ready) {
      sel.innerHTML = allowedScopes.map(k => `<option value="${esc(k)}">${esc(scopeLabels[k] || k)}</option>`).join('');
      sel.value = window.WOLF_GUIDE_SCOPE;
      sel.addEventListener('change', e => window.setWolfGuideScope(e.target.value));
      sel.dataset.ready = '1';
    }
  }

  function repairNativeFilters(){
    // Previous patch accidentally changed every select into a show select. Repair obvious controls by their position.
    const rows = Array.from(document.querySelectorAll('section,div,form')).filter(el => {
      const sels = el.querySelectorAll('select');
      const inp = el.querySelector('input[type="search"],input[placeholder*="Search"],input[placeholder*="search"]');
      return inp && sels.length >= 2 && !el.closest('#wolfScopeBar');
    });
    const row = rows[0];
    if (!row || row.dataset.wolfFilterRepaired) return;
    const selects = Array.from(row.querySelectorAll('select')).filter(s => s.id !== 'wolfScopeSelect');
    const showNames = stats(scopedRows()).map(s => s.show);
    const franchises = Array.from(new Set(scopedRows().map(e => e.franchise || meta(e).franchise || '').filter(Boolean))).sort();
    const seasons = Array.from(new Set(scopedRows().map(e => num(e.season)).filter(n => n >= 0))).sort((a,b)=>a-b);
    function setOptions(sel, label, values, fmt){
      const cur = sel.value;
      sel.innerHTML = `<option value="">${esc(label)}</option>` + values.map(v => `<option value="${esc(v)}">${esc(fmt ? fmt(v) : v)}</option>`).join('');
      if (values.map(String).includes(String(cur))) sel.value = cur;
    }
    if (selects[0]) { setOptions(selects[0], 'All shows', showNames); selects[0].dataset.wolfRole = 'show'; }
    if (selects.length >= 4) {
      if (selects[1]) { setOptions(selects[1], 'All franchises', franchises); selects[1].dataset.wolfRole = 'franchise'; }
      if (selects[2]) { setOptions(selects[2], 'All seasons', seasons, v => Number(v) === 0 ? 'Specials / Season 0' : `Season ${v}`); selects[2].dataset.wolfRole = 'season'; }
      if (selects[3]) { setOptions(selects[3], 'Guide scope', allowedScopes, v => scopeLabels[v] || v); selects[3].value = window.WOLF_GUIDE_SCOPE; selects[3].dataset.wolfRole = 'scope'; selects[3].addEventListener('change', e => window.setWolfGuideScope(e.target.value)); }
    } else if (selects.length >= 3) {
      if (selects[1]) { setOptions(selects[1], 'All seasons', seasons, v => Number(v) === 0 ? 'Specials / Season 0' : `Season ${v}`); selects[1].dataset.wolfRole = 'season'; }
      if (selects[2]) { setOptions(selects[2], 'Guide scope', allowedScopes, v => scopeLabels[v] || v); selects[2].value = window.WOLF_GUIDE_SCOPE; selects[2].dataset.wolfRole = 'scope'; selects[2].addEventListener('change', e => window.setWolfGuideScope(e.target.value)); }
    }
    row.dataset.wolfFilterRepaired = '1';
  }

  function updateSeriesChips(){
    const count = document.querySelector('#wolfScopeBar .wolf-scope-count');
    if (count) count.textContent = ` ${scopedRows().length}/${allEpisodes.length} entries`;
    const wrap = document.getElementById('wolfSeriesProgress');
    if (!wrap) return;
    const s = stats(scopedRows());
    wrap.innerHTML = s.length ? s.map(x => {
      const pct = x.total ? Math.round((x.watched/x.total)*100) : 0;
      return `<button type="button" class="wolf-show-chip wolf-${esc(x.category)}" title="${esc(x.show)} • ${x.watched}/${x.total}"><span>${esc(x.show)}</span><b>${x.watched}/${x.total}</b><i><em style="width:${pct}%"></em></i></button>`;
    }).join('') : `<div class="wolf-empty-scope">No shows with episodes in this scope.</div>`;
  }

  function lightbox(){
    if (document.getElementById('wolfImageLightbox')) return;
    const box = document.createElement('div');
    box.id = 'wolfImageLightbox';
    box.className = 'wolf-lightbox';
    box.innerHTML = '<button type="button" class="wolf-lightbox-close" aria-label="Close">×</button><img alt="Artwork"><div class="wolf-lightbox-caption"></div>';
    document.body.appendChild(box);
    const close = () => box.classList.remove('open');
    box.querySelector('button').addEventListener('click', close);
    box.addEventListener('click', e => { if (e.target === box) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    function bgUrl(el){ const bg = getComputedStyle(el).backgroundImage || ''; const m = bg.match(/url\(["']?(.*?)["']?\)/); return m ? m[1] : ''; }
    document.addEventListener('click', e => {
      const target = e.target.closest('img,.epArt,.poster,.artwork,.hero-card,.episode-card,.epCard,.row-card,.guide-row');
      if (!target || target.closest('#wolfImageLightbox') || target.closest('button,a,select,input,label')) return;
      let img = target.tagName === 'IMG' ? target : target.querySelector && target.querySelector('img');
      let src = img ? (img.currentSrc || img.src) : bgUrl(target);
      if (!src || src.startsWith('data:image/svg+xml')) return;
      e.preventDefault();
      box.querySelector('img').src = src;
      box.querySelector('.wolf-lightbox-caption').textContent = (img && img.alt) || (target.textContent || '').trim().slice(0,160);
      box.classList.add('open');
    }, true);
  }

  function enhance(){
    removeBadOldBits();
    scopeBar();
    repairNativeFilters();
    updateSeriesChips();
    lightbox();
  }

  document.addEventListener('DOMContentLoaded', () => {
    enhance();
    const mo = new MutationObserver(() => { clearTimeout(window.__wolfFinalUiTimer); window.__wolfFinalUiTimer = setTimeout(enhance, 120); });
    mo.observe(document.body, { childList:true, subtree:true });
    setTimeout(enhance, 500); setTimeout(enhance, 1500);
  });
})();
'''

CSS = r'''/* Wolf Universe final UI cleanup: filters, mobile numbers, artwork lightbox */
.wolf-mobile-epnum{display:none!important}.wolf-scope-bar{max-width:1280px;margin:1rem auto;padding:1rem;border:1px solid rgba(148,163,184,.25);border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.95),rgba(15,23,42,.78));box-shadow:0 18px 55px rgba(0,0,0,.24)}.wolf-scope-head{display:flex;align-items:center;justify-content:space-between;gap:.8rem;flex-wrap:wrap}.wolf-scope-head strong{display:block;font-weight:1000;color:#f8fafc}.wolf-scope-count{margin-left:.4rem;color:#bfdbfe;font-weight:800}.wolf-scope-head select{min-width:260px;border-radius:14px;border:1px solid rgba(96,165,250,.36);background:#14213a;color:#fff;padding:.72rem 1rem;font-weight:900}.wolf-series-progress{display:flex;gap:.55rem;overflow-x:auto;padding:.85rem .05rem .1rem;scrollbar-width:thin}.wolf-show-chip{flex:0 0 auto;min-width:180px;border-radius:999px;border:1px solid rgba(148,163,184,.28);background:linear-gradient(180deg,#172338,#101827);color:#fff;text-align:left;padding:.62rem .86rem;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}.wolf-show-chip:hover{transform:translateY(-2px);box-shadow:0 14px 34px rgba(0,0,0,.28);border-color:rgba(255,255,255,.38)}.wolf-show-chip span{display:block;font-size:.82rem;font-weight:1000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wolf-show-chip b{display:block;margin-top:.08rem;color:#bfdbfe;font-size:.75rem}.wolf-show-chip i{display:block;height:5px;margin-top:.34rem;background:rgba(30,64,175,.38);border-radius:999px;overflow:hidden}.wolf-show-chip em{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#22c55e,#60a5fa)}.wolf-show-chip.wolf-adjacent em{background:linear-gradient(90deg,#f59e0b,#f97316)}.wolf-show-chip.wolf-connected em{background:linear-gradient(90deg,#a855f7,#60a5fa)}.wolf-empty-scope{padding:.8rem 1rem;border-radius:14px;background:rgba(250,204,21,.12);border:1px solid rgba(250,204,21,.28);color:#fde68a;font-weight:900}.episode-number,.episodeNumber,.ep-number,.epNumber,.episode-code,.ep-code,.code,.seasonEpisode,.season-episode,[class*="episode-number"],[class*="EpisodeNumber"]{display:inline-flex!important;visibility:visible!important;opacity:1!important}.episode-card,.epCard,.episode,.guide-row,.row-card,.card{transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease,filter .18s ease}.episode-card:hover,.epCard:hover,.episode:hover,.guide-row:hover,.row-card:hover,.card:hover{transform:translateY(-3px);box-shadow:0 20px 56px rgba(0,0,0,.30);border-color:rgba(255,255,255,.28);filter:saturate(1.06)}.epArt,img.epArt,.poster,img.poster,.artwork,img.artwork,.hero img,.card img{cursor:zoom-in;transition:transform .2s ease,filter .2s ease}.epArt:hover,img.epArt:hover,.poster:hover,img.poster:hover,.artwork:hover,img.artwork:hover,.hero img:hover,.card img:hover{transform:scale(1.035);filter:saturate(1.12) contrast(1.04)}.wolf-lightbox{position:fixed;inset:0;z-index:99999;background:rgba(2,6,23,.90);display:none;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(8px)}.wolf-lightbox.open{display:flex}.wolf-lightbox img{max-width:min(1200px,94vw);max-height:82vh;border-radius:20px;box-shadow:0 35px 90px rgba(0,0,0,.65);object-fit:contain;background:#020617}.wolf-lightbox-close{position:absolute;top:18px;right:22px;width:46px;height:46px;border-radius:999px;border:1px solid rgba(255,255,255,.28);background:rgba(15,23,42,.9);color:#fff;font-size:32px;line-height:1;cursor:pointer}.wolf-lightbox-caption{position:absolute;bottom:18px;left:24px;right:24px;text-align:center;color:#e5e7eb;font-weight:900;text-shadow:0 2px 8px #000}@media(max-width:760px){.wolf-scope-bar{margin:.75rem 0;border-radius:16px;padding:.82rem}.wolf-scope-head{align-items:stretch}.wolf-scope-head select{width:100%;min-width:0}.wolf-series-progress{display:flex!important}.wolf-show-chip{min-width:154px}.epArt,img.epArt,.poster,img.poster,.artwork,img.artwork,.card img,.hero img{display:block!important;visibility:visible!important;opacity:1!important;max-width:132px!important;min-width:82px!important;min-height:72px!important;height:auto!important;object-fit:cover!important}.episode-card,.epCard,.guide-row,.row-card,.card{gap:.75rem}.wolf-lightbox{padding:12px}.wolf-lightbox img{max-width:96vw;max-height:78vh;border-radius:14px}}
'''


def patch_index(path: Path) -> None:
    if not path.exists():
        return
    txt = path.read_text(encoding='utf-8')
    txt = re.sub(r'\s*<script src="data/wolf_scope_config\.js"></script>', '', txt)
    txt = re.sub(r'\s*<script src="data/wolf_scope_runtime\.js"></script>', '', txt)
    if 'data/wolf_artwork.js' not in txt and '<script src="data/show_themes.js"></script>' in txt:
        txt = txt.replace('<script src="data/show_themes.js"></script>', '<script src="data/wolf_artwork.js"></script><script src="data/show_themes.js"></script>')
    if '<script src="data/episodes.js"></script>' in txt:
        txt = txt.replace('<script src="data/episodes.js"></script>', '<script src="data/episodes.js"></script><script src="data/wolf_scope_config.js"></script><script src="data/wolf_scope_runtime.js"></script>')
    elif '<script src="app.js"></script>' in txt:
        txt = txt.replace('<script src="app.js"></script>', '<script src="data/wolf_scope_config.js"></script><script src="data/wolf_scope_runtime.js"></script><script src="app.js"></script>')
    txt = txt.replace('Law & Order Master Watch Tracker','Wolf Universe Watch Tracker')
    txt = txt.replace('L&amp;O','WOLF').replace('>L&O<','>WOLF<')
    path.write_text(txt, encoding='utf-8')


def patch_css() -> None:
    STYLES.parent.mkdir(parents=True, exist_ok=True)
    old = STYLES.read_text(encoding='utf-8') if STYLES.exists() else ''
    old = re.sub(r'/\* Wolf Universe .*?(?:filter|lightbox).*?\*/.*?(?=/\* Wolf Universe |\Z)', '', old, flags=re.S|re.I).rstrip()
    STYLES.write_text(old + '\n\n' + CSS + '\n', encoding='utf-8')


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    cfg = build_config()
    SCOPE_CONFIG.write_text('window.WOLF_SCOPE_CONFIG = ' + json.dumps(cfg, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
    RUNTIME_JS.write_text(RUNTIME, encoding='utf-8')
    patch_index(INDEX)
    patch_index(ROOT_INDEX)
    patch_css()
    print('Applied final Wolf UI filter/lightbox cleanup.')
    print('Categories:', {c: sum(1 for s in cfg['shows'].values() if s['category']==c) for c in ['core','connected','adjacent']})
    print('Wrote', SCOPE_CONFIG)
    print('Wrote', RUNTIME_JS)

if __name__ == '__main__':
    main()
