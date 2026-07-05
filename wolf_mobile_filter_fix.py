#!/usr/bin/env python3
"""Wolf Universe UI mobile/filter/artwork patch.

Run from the project root. Safe to run repeatedly.
Fixes:
- Adds Core / Connected / Adjacent only / Complete scope switch.
- Adjacent-only no longer returns empty when adjacent rows exist.
- Series progress chips are rebuilt only for shows currently visible in the active scope/filter.
- Mobile keeps artwork and visible episode numbers.
- Click artwork to open a larger lightbox.
- Preserves existing app logic; works as a runtime layer.
"""
from pathlib import Path
import re

APP = Path('law_order_tracker_app')
DATA = APP / 'data'
INDEX = APP / 'index.html'
ROOT_INDEX = Path('index.html')
STYLES = APP / 'styles.css'

RUNTIME = r'''// Wolf Universe runtime patch: scope filters, mobile episode numbers, progress chips, artwork lightbox.
(function(){
  const VALID_SCOPES = new Set(['core','connected','adjacent','complete']);
  const scopeLabels = {
    core: 'Core Wolf Universe',
    connected: 'Core + crossover / important adjacent',
    adjacent: 'Adjacent only',
    complete: 'Complete Dick Wolf archive'
  };

  const all = Array.isArray(window.LAW_ORDER_EPISODES) ? window.LAW_ORDER_EPISODES.slice() : [];
  window.WOLF_ALL_EPISODES = all;

  function bool(v){ return v === true || v === 'true' || v === 1 || v === '1'; }
  function lower(v){ return String(v || '').toLowerCase(); }
  function isCore(ep){ return ep.scope === 'core' || (!bool(ep.optional) && (ep.franchise === 'Law & Order' || ep.franchise === 'One Chicago' || ep.franchise === 'FBI')); }
  function isConnected(ep){ return isCore(ep) || bool(ep.alwaysShow) || ep.scope === 'connected'; }
  function isAdjacent(ep){
    const f = lower(ep.franchise);
    return ep.scope === 'adjacent' || ep.scope === 'complete' || bool(ep.optional) || f.includes('adjacent') || f.includes('archive');
  }
  function keepForScope(ep, scope){
    if (scope === 'complete') return true;
    if (scope === 'adjacent') return isAdjacent(ep) && !isCore(ep) && !bool(ep.alwaysShow);
    if (scope === 'connected') return isConnected(ep);
    return isCore(ep);
  }
  function getScope(){
    const saved = localStorage.getItem('wolfGuideScope') || 'connected';
    return VALID_SCOPES.has(saved) ? saved : 'connected';
  }
  window.WOLF_GUIDE_SCOPE = getScope();
  window.LAW_ORDER_EPISODES = all.filter(ep => keepForScope(ep, window.WOLF_GUIDE_SCOPE));

  window.setWolfGuideScope = function(next){
    if (!VALID_SCOPES.has(next)) next = 'connected';
    localStorage.setItem('wolfGuideScope', next);
    location.reload();
  };

  function isWatched(ep){
    const s = lower(ep.status || ep.watchStatus);
    return s === 'watched' || s === 'completed' || s === 'done' || s.includes('watched');
  }
  function epNum(ep){
    if (ep.isMovie) return 'MOVIE';
    const s = Number(ep.season)||0, e = Number(ep.episode)||0;
    if (ep.isSpecial || s === 0) return `S00E${String(e).padStart(2,'0')}`;
    return `S${String(s).padStart(2,'0')}E${String(e).padStart(2,'0')}`;
  }
  function scopedRows(){ return window.LAW_ORDER_EPISODES || []; }
  function statsForRows(rows){
    const map = new Map();
    for (const ep of rows) {
      const show = ep.show || 'Unknown';
      if (!map.has(show)) map.set(show, {show, total:0, watched:0, franchise: ep.franchise || '', scope: ep.scope || ''});
      const st = map.get(show);
      st.total += 1;
      if (isWatched(ep)) st.watched += 1;
    }
    return Array.from(map.values()).filter(x => x.total > 0).sort((a,b) => a.show.localeCompare(b.show));
  }

  function addScopeBar(){
    if (document.getElementById('wolfScopeBar')) return;
    const bar = document.createElement('section');
    bar.id = 'wolfScopeBar';
    bar.className = 'wolf-scope-bar';
    bar.innerHTML = `
      <div class="wolf-scope-main">
        <label for="wolfScopeSelect">Guide scope</label>
        <select id="wolfScopeSelect" aria-label="Guide scope">
          <option value="core">Core Wolf Universe</option>
          <option value="connected">Core + crossover / important adjacent</option>
          <option value="adjacent">Adjacent only</option>
          <option value="complete">Complete Dick Wolf archive</option>
        </select>
        <span class="wolf-scope-count"></span>
      </div>
      <div id="wolfSeriesProgress" class="wolf-series-progress" aria-label="Series progress"></div>`;
    const target = document.querySelector('main') || document.body;
    target.insertBefore(bar, target.firstChild);
    const select = bar.querySelector('#wolfScopeSelect');
    select.value = window.WOLF_GUIDE_SCOPE;
    select.addEventListener('change', e => window.setWolfGuideScope(e.target.value));
    updateSeriesProgress();
  }

  function visibleEpisodeRows(){
    // Prefer actual visible DOM cards when the app's search/show filters are active.
    const cards = Array.from(document.querySelectorAll('.episode-card,.epCard,.episode,.guide-row,.row-card,[data-episode-id],[data-show]'))
      .filter(el => el.offsetParent !== null && !el.closest('#wolfScopeBar'));
    if (!cards.length) return scopedRows();
    const visibleText = cards.map(el => el.textContent || '').join('\n').toLowerCase();
    const rows = scopedRows().filter(ep => {
      const title = lower(ep.title);
      const show = lower(ep.show);
      return (title && visibleText.includes(title.slice(0, Math.min(24, title.length)))) || (show && visibleText.includes(show));
    });
    return rows.length ? rows : scopedRows();
  }

  window.updateWolfSeriesProgress = function updateSeriesProgress(){
    const count = document.querySelector('#wolfScopeBar .wolf-scope-count');
    if (count) count.textContent = `${scopeLabels[window.WOLF_GUIDE_SCOPE]} • ${scopedRows().length} of ${all.length} entries`;
    const wrap = document.getElementById('wolfSeriesProgress');
    if (!wrap) return;
    const stats = statsForRows(visibleEpisodeRows());
    wrap.innerHTML = stats.map(s => {
      const pct = s.total ? Math.round((s.watched/s.total)*100) : 0;
      return `<button class="wolf-show-chip" title="${escapeAttr(s.show)}: ${s.watched}/${s.total} watched" data-show="${escapeAttr(s.show)}">
        <span class="wolf-show-name">${escapeHtml(s.show)}</span>
        <span class="wolf-show-count">${s.watched}/${s.total}</span>
        <span class="wolf-show-bar"><i style="width:${pct}%"></i></span>
      </button>`;
    }).join('') || `<div class="wolf-empty-scope">No series with episodes match this scope/filter.</div>`;
  };

  function escapeHtml(s){ return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function escapeAttr(s){ return escapeHtml(s).replace(/'/g, '&#39;'); }

  function findEpForCard(card){
    const text = lower(card.textContent || '');
    let best = null, score = 0;
    for (const ep of scopedRows()) {
      let sc = 0;
      const show = lower(ep.show), title = lower(ep.title), code = lower(ep.code || epNum(ep));
      if (show && text.includes(show)) sc += 2;
      if (title && text.includes(title)) sc += 4;
      if (code && text.includes(code)) sc += 3;
      if (text.includes(`season ${Number(ep.season)||0}`) && text.includes(`episode ${Number(ep.episode)||0}`)) sc += 3;
      if (sc > score) { score = sc; best = ep; }
    }
    return score >= 4 ? best : null;
  }

  function injectMobileEpisodeNumbers(){
    const cards = Array.from(document.querySelectorAll('.episode-card,.epCard,.episode,.guide-row,.row-card,.card'))
      .filter(el => !el.closest('#wolfScopeBar') && !el.classList.contains('wolf-show-chip'));
    for (const card of cards) {
      if (card.querySelector('.wolf-mobile-epnum')) continue;
      const ep = findEpForCard(card);
      if (!ep) continue;
      const badge = document.createElement('span');
      badge.className = 'wolf-mobile-epnum';
      badge.textContent = epNum(ep);
      const target = card.querySelector('.title,h2,h3,h4,.episode-title,.epTitle') || card.firstElementChild || card;
      target.insertAdjacentElement('afterbegin', badge);
    }
  }

  function installLightbox(){
    if (document.getElementById('wolfImageLightbox')) return;
    const box = document.createElement('div');
    box.id = 'wolfImageLightbox';
    box.className = 'wolf-lightbox';
    box.innerHTML = `<button class="wolf-lightbox-close" aria-label="Close image preview">×</button><img alt="Artwork preview"><div class="wolf-lightbox-caption"></div>`;
    document.body.appendChild(box);
    function close(){ box.classList.remove('open'); }
    box.addEventListener('click', e => { if (e.target === box) close(); });
    box.querySelector('.wolf-lightbox-close').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.addEventListener('click', e => {
      const img = e.target.closest('img');
      if (!img || img.closest('#wolfImageLightbox')) return;
      const src = img.currentSrc || img.src;
      if (!src) return;
      const ok = img.classList.contains('epArt') || img.classList.contains('poster') || img.closest('.episode-card,.epCard,.episode,.guide-row,.row-card,.card,.hero');
      if (!ok) return;
      e.preventDefault();
      box.querySelector('img').src = src;
      box.querySelector('.wolf-lightbox-caption').textContent = img.alt || '';
      box.classList.add('open');
    }, true);
  }

  function refreshEnhancements(){
    updateWolfSeriesProgress();
    injectMobileEpisodeNumbers();
  }

  document.addEventListener('DOMContentLoaded', function(){
    addScopeBar();
    installLightbox();
    refreshEnhancements();
    setTimeout(refreshEnhancements, 400);
    setTimeout(refreshEnhancements, 1200);
    setTimeout(refreshEnhancements, 2500);
    document.addEventListener('input', () => setTimeout(refreshEnhancements, 80), true);
    document.addEventListener('change', () => setTimeout(refreshEnhancements, 80), true);
    document.addEventListener('click', () => setTimeout(refreshEnhancements, 160), true);
  });
})();
'''

CSS = r'''
/* Wolf Universe mobile/filter/artwork patch */
.wolf-scope-bar{display:flex;flex-direction:column;gap:.85rem;margin:1rem 0;padding:.95rem 1rem;border:1px solid rgba(255,255,255,.14);border-radius:18px;background:linear-gradient(135deg,rgba(185,28,28,.22),rgba(29,78,216,.14));box-shadow:0 14px 40px rgba(0,0,0,.22)}
.wolf-scope-main{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}.wolf-scope-bar label{font-weight:900;letter-spacing:.03em;text-transform:uppercase;font-size:.78rem;opacity:.92}.wolf-scope-bar select{background:#0f172a;color:#fff;border:1px solid rgba(255,255,255,.22);border-radius:12px;padding:.55rem .75rem;font-weight:800}.wolf-scope-count{opacity:.84;font-size:.9rem}.wolf-empty-scope{opacity:.8;padding:.5rem .2rem;font-weight:800}
.wolf-series-progress{display:flex!important;gap:.6rem;overflow-x:auto;padding:.25rem .05rem .35rem;scrollbar-width:thin}.wolf-show-chip{min-width:160px;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:rgba(15,23,42,.72);color:#fff;text-align:left;padding:.55rem .65rem;box-shadow:0 8px 24px rgba(0,0,0,.18)}.wolf-show-name{display:block;font-size:.78rem;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wolf-show-count{display:block!important;font-size:.78rem;opacity:.94;margin-top:.18rem;font-weight:900}.wolf-show-bar{display:block;height:5px;background:rgba(255,255,255,.12);border-radius:999px;overflow:hidden;margin-top:.4rem}.wolf-show-bar i{display:block;height:100%;background:linear-gradient(90deg,#ef4444,#60a5fa);border-radius:999px}
.wolf-mobile-epnum{display:inline-flex!important;align-items:center;justify-content:center;margin-right:.45rem;padding:.16rem .42rem;border-radius:999px;background:rgba(96,165,250,.20);border:1px solid rgba(96,165,250,.35);color:#dbeafe;font-weight:1000;font-size:.74rem;letter-spacing:.03em;vertical-align:middle;white-space:nowrap}.episode-number,.episodeNumber,.ep-number,.epNumber,.episode-code,.ep-code,.code,.seasonEpisode,.season-episode,[class*="episode-number"],[class*="EpisodeNumber"]{display:inline-flex!important;visibility:visible!important;opacity:1!important}.episode-card,.epCard,.episode,.guide-row,.row-card,.card{transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease,filter .18s ease}.episode-card:hover,.epCard:hover,.episode:hover,.guide-row:hover,.row-card:hover,.card:hover{transform:translateY(-3px);box-shadow:0 20px 56px rgba(0,0,0,.32);border-color:rgba(255,255,255,.30);filter:saturate(1.08)}
.epArt,img.epArt,.poster,img.poster,.hero img,.card img{cursor:zoom-in;transition:transform .22s ease,filter .22s ease,opacity .22s ease}.epArt:hover,img.epArt:hover,.poster:hover,img.poster:hover,.hero img:hover,.card img:hover{transform:scale(1.035);filter:saturate(1.12) contrast(1.04)}
.wolf-lightbox{position:fixed;inset:0;z-index:99999;background:rgba(2,6,23,.88);display:none;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(8px)}.wolf-lightbox.open{display:flex}.wolf-lightbox img{max-width:min(1100px,94vw);max-height:82vh;border-radius:20px;box-shadow:0 35px 90px rgba(0,0,0,.65);object-fit:contain;background:#020617}.wolf-lightbox-close{position:absolute;top:18px;right:22px;width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.28);background:rgba(15,23,42,.85);color:#fff;font-size:30px;line-height:1;cursor:pointer}.wolf-lightbox-caption{position:absolute;bottom:18px;left:24px;right:24px;text-align:center;color:#e5e7eb;font-weight:800;text-shadow:0 2px 8px #000}
@media (max-width:720px){.wolf-scope-bar{margin:.75rem 0;border-radius:16px;padding:.8rem}.wolf-scope-main{align-items:stretch}.wolf-scope-bar select{width:100%}.wolf-series-progress{display:flex!important}.wolf-show-chip{min-width:145px}.epArt,img.epArt,.poster,img.poster,.card img,.hero img{display:block!important;visibility:visible!important;opacity:1!important;max-width:118px!important;min-width:82px!important;min-height:70px!important;height:auto!important;object-fit:cover!important}.episode-card,.epCard,.guide-row,.row-card,.card{gap:.75rem}.wolf-mobile-epnum{display:inline-flex!important;font-size:.7rem;margin-bottom:.18rem}.wolf-lightbox{padding:12px}.wolf-lightbox img{max-width:96vw;max-height:78vh;border-radius:14px}}
'''

def patch_index(path: Path):
    if not path.exists(): return
    txt = path.read_text(encoding='utf-8')
    txt = txt.replace('Law & Order Master Watch Tracker', 'Wolf Universe Watch Tracker')
    txt = txt.replace('L&amp;O', 'WOLF').replace('>L&O<', '>WOLF<')
    if 'data/wolf_artwork.js' not in txt:
        txt = txt.replace('<script src="data/show_themes.js"></script><script src="data/episodes.js"></script>', '<script src="data/show_themes.js"></script><script src="data/wolf_artwork.js"></script><script src="data/episodes.js"></script>')
    if 'data/wolf_scope_runtime.js' not in txt:
        txt = txt.replace('<script src="data/episodes.js"></script>', '<script src="data/episodes.js"></script><script src="data/wolf_scope_runtime.js"></script>')
    path.write_text(txt, encoding='utf-8')

DATA.mkdir(parents=True, exist_ok=True)
(DATA/'wolf_scope_runtime.js').write_text(RUNTIME, encoding='utf-8')
if STYLES.exists():
    s = STYLES.read_text(encoding='utf-8')
    marker = '/* Wolf Universe mobile/filter/artwork patch */'
    if marker in s:
        s = s[:s.find(marker)].rstrip() + '\n'
    STYLES.write_text(s + '\n' + CSS + '\n', encoding='utf-8')
patch_index(INDEX)
patch_index(ROOT_INDEX)
print('Applied Wolf mobile/filter/artwork patch.')
