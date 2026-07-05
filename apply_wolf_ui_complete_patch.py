#!/usr/bin/env python3
"""Apply UI upgrades for the Wolf Universe tracker.

Adds/refreshes:
- Core / Connected / Complete guide scope filter.
- Series progress strip that remains visible on mobile.
- Click-to-enlarge artwork lightbox for show/season/episode images.
- Stronger hover effects and mobile artwork overrides.
- Ensures wolf_artwork.js is loaded before episodes/app code.

Safe to run repeatedly from the project root.
"""
from pathlib import Path

APP_DIR = Path('law_order_tracker_app')
DATA_DIR = APP_DIR / 'data'
INDEX = APP_DIR / 'index.html'
STYLES = APP_DIR / 'styles.css'
ROOT_INDEX = Path('index.html')

SCOPE_JS = r'''// Wolf Universe runtime helpers: scope filter, progress strip, image lightbox.
(function(){
  const valid = new Set(['core','connected','complete']);
  const saved = localStorage.getItem('wolfGuideScope') || 'connected';
  const scope = valid.has(saved) ? saved : 'connected';
  const all = Array.isArray(window.LAW_ORDER_EPISODES) ? window.LAW_ORDER_EPISODES : [];
  window.WOLF_ALL_EPISODES = all;
  window.WOLF_GUIDE_SCOPE = scope;

  function keep(ep){
    if (scope === 'complete') return true;
    if (scope === 'connected') return !ep.optional || ep.alwaysShow || ep.scope === 'core' || ep.scope === 'connected';
    return ep.scope === 'core' || (!ep.optional && ep.alwaysShow && ep.scope !== 'complete');
  }

  window.LAW_ORDER_EPISODES = all.filter(keep);

  window.setWolfGuideScope = function(next){
    if (!valid.has(next)) next = 'connected';
    localStorage.setItem('wolfGuideScope', next);
    location.reload();
  };

  function isWatched(ep){
    const s = String(ep.status || ep.watchStatus || '').toLowerCase();
    return s.includes('watch') || s === 'completed' || s === 'done';
  }

  function byShowStats(){
    const rows = window.LAW_ORDER_EPISODES || [];
    const map = new Map();
    for (const ep of rows) {
      const show = ep.show || 'Unknown';
      if (!map.has(show)) map.set(show, {show, total:0, watched:0, franchise: ep.franchise || '', scope: ep.scope || ''});
      const stat = map.get(show);
      stat.total += 1;
      if (isWatched(ep)) stat.watched += 1;
    }
    return Array.from(map.values()).sort((a,b) => a.show.localeCompare(b.show));
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
          <option value="connected">Core + important adjacent</option>
          <option value="complete">Complete Dick Wolf archive</option>
        </select>
        <span class="wolf-scope-count">Showing ${window.LAW_ORDER_EPISODES.length} of ${all.length} entries</span>
      </div>
      <div id="wolfSeriesProgress" class="wolf-series-progress" aria-label="Series progress"></div>`;
    const target = document.querySelector('main') || document.body;
    target.insertBefore(bar, target.firstChild);
    const sel = bar.querySelector('#wolfScopeSelect');
    sel.value = scope;
    sel.addEventListener('change', e => window.setWolfGuideScope(e.target.value));
    updateSeriesProgress();
  }

  window.updateWolfSeriesProgress = function updateSeriesProgress(){
    const wrap = document.getElementById('wolfSeriesProgress');
    if (!wrap) return;
    const stats = byShowStats();
    wrap.innerHTML = stats.map(s => {
      const pct = s.total ? Math.round((s.watched / s.total) * 100) : 0;
      return `<button class="wolf-show-chip" title="${s.show}: ${s.watched}/${s.total} watched" data-show="${s.show.replace(/"/g,'&quot;')}">
        <span class="wolf-show-name">${s.show}</span>
        <span class="wolf-show-count">${s.watched}/${s.total}</span>
        <span class="wolf-show-bar"><i style="width:${pct}%"></i></span>
      </button>`;
    }).join('');
  };

  function installLightbox(){
    if (document.getElementById('wolfImageLightbox')) return;
    const box = document.createElement('div');
    box.id = 'wolfImageLightbox';
    box.className = 'wolf-lightbox';
    box.innerHTML = `<button class="wolf-lightbox-close" aria-label="Close image preview">×</button><img alt="Artwork preview"><div class="wolf-lightbox-caption"></div>`;
    document.body.appendChild(box);
    const close = () => box.classList.remove('open');
    box.addEventListener('click', e => { if (e.target === box) close(); });
    box.querySelector('.wolf-lightbox-close').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    document.addEventListener('click', e => {
      const img = e.target.closest('img');
      if (!img) return;
      const src = img.currentSrc || img.src;
      if (!src) return;
      if (!img.closest('.episode-card,.epCard,.episode,.guide-row,.row-card,.card,.hero,.poster,.epArt') && !img.classList.contains('epArt') && !img.classList.contains('poster')) return;
      e.preventDefault();
      box.querySelector('img').src = src;
      box.querySelector('.wolf-lightbox-caption').textContent = img.alt || '';
      box.classList.add('open');
    }, true);
  }

  document.addEventListener('DOMContentLoaded', function(){
    addScopeBar();
    installLightbox();
    setTimeout(updateSeriesProgress, 500);
    setTimeout(updateSeriesProgress, 2000);
  });
})();
'''

CSS = r'''
/* Wolf Universe UI complete upgrades */
.wolf-scope-bar{display:flex;flex-direction:column;gap:.85rem;margin:1rem 0;padding:.95rem 1rem;border:1px solid rgba(255,255,255,.14);border-radius:18px;background:linear-gradient(135deg,rgba(185,28,28,.22),rgba(29,78,216,.14));box-shadow:0 14px 40px rgba(0,0,0,.22)}
.wolf-scope-main{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}.wolf-scope-bar label{font-weight:900;letter-spacing:.03em;text-transform:uppercase;font-size:.78rem;opacity:.92}.wolf-scope-bar select{background:#0f172a;color:#fff;border:1px solid rgba(255,255,255,.22);border-radius:12px;padding:.55rem .75rem;font-weight:800}.wolf-scope-count{opacity:.84;font-size:.9rem}
.wolf-series-progress{display:flex;gap:.6rem;overflow-x:auto;padding:.25rem .05rem .35rem;scrollbar-width:thin}.wolf-show-chip{min-width:160px;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:rgba(15,23,42,.72);color:#fff;text-align:left;padding:.55rem .65rem;box-shadow:0 8px 24px rgba(0,0,0,.18)}.wolf-show-name{display:block;font-size:.78rem;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wolf-show-count{display:block;font-size:.78rem;opacity:.86;margin-top:.18rem}.wolf-show-bar{display:block;height:5px;background:rgba(255,255,255,.12);border-radius:999px;overflow:hidden;margin-top:.4rem}.wolf-show-bar i{display:block;height:100%;background:linear-gradient(90deg,#ef4444,#60a5fa);border-radius:999px}
.episode-card,.epCard,.episode,.guide-row,.row-card,.card{transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease,filter .18s ease}.episode-card:hover,.epCard:hover,.episode:hover,.guide-row:hover,.row-card:hover,.card:hover{transform:translateY(-3px);box-shadow:0 20px 56px rgba(0,0,0,.32);border-color:rgba(255,255,255,.30);filter:saturate(1.08)}
.epArt,img.epArt,.poster,img.poster,.hero img,.card img{cursor:zoom-in;transition:transform .22s ease,filter .22s ease,opacity .22s ease}.epArt:hover,img.epArt:hover,.poster:hover,img.poster:hover,.hero img:hover,.card img:hover{transform:scale(1.035);filter:saturate(1.12) contrast(1.04)}
.wolf-lightbox{position:fixed;inset:0;z-index:99999;background:rgba(2,6,23,.88);display:none;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(8px)}.wolf-lightbox.open{display:flex}.wolf-lightbox img{max-width:min(1100px,94vw);max-height:82vh;border-radius:20px;box-shadow:0 35px 90px rgba(0,0,0,.65);object-fit:contain;background:#020617}.wolf-lightbox-close{position:absolute;top:18px;right:22px;width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.28);background:rgba(15,23,42,.85);color:#fff;font-size:30px;line-height:1;cursor:pointer}.wolf-lightbox-caption{position:absolute;bottom:18px;left:24px;right:24px;text-align:center;color:#e5e7eb;font-weight:800;text-shadow:0 2px 8px #000}.connection,.crossover-note,.episode-meta,.notes{line-height:1.45}.badge-special,.specialBadge{background:linear-gradient(135deg,#f59e0b,#b45309)!important;color:#111!important;font-weight:900}
@media (max-width:720px){.wolf-scope-bar{margin:.75rem 0;border-radius:16px;padding:.8rem}.wolf-scope-main{align-items:stretch}.wolf-scope-bar select{width:100%}.wolf-series-progress{display:flex!important}.wolf-show-chip{min-width:142px}.epArt,img.epArt,.poster,img.poster,.card img{display:block!important;visibility:visible!important;opacity:1!important;max-width:112px!important;min-width:82px!important;height:auto!important}.episode-card,.epCard,.guide-row,.row-card{gap:.75rem}.wolf-lightbox{padding:12px}.wolf-lightbox img{max-width:96vw;max-height:78vh;border-radius:14px}}
'''

def patch_index(path: Path) -> None:
    if not path.exists():
        return
    txt = path.read_text(encoding='utf-8')
    txt = txt.replace('Law & Order Master Watch Tracker', 'Wolf Universe Watch Tracker')
    txt = txt.replace('L&amp;O', 'WOLF').replace('>L&O<', '>WOLF<')
    if 'data/wolf_artwork.js' not in txt:
        txt = txt.replace('<script src="data/show_themes.js"></script><script src="data/episodes.js"></script>', '<script src="data/show_themes.js"></script><script src="data/wolf_artwork.js"></script><script src="data/episodes.js"></script>')
    if 'data/wolf_scope_runtime.js' not in txt:
        txt = txt.replace('<script src="data/episodes.js"></script>', '<script src="data/episodes.js"></script><script src="data/wolf_scope_runtime.js"></script>')
    path.write_text(txt, encoding='utf-8')

DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / 'wolf_scope_runtime.js').write_text(SCOPE_JS, encoding='utf-8')
if STYLES.exists():
    s = STYLES.read_text(encoding='utf-8')
    marker = '/* Wolf Universe UI complete upgrades */'
    if marker in s:
        s = s[:s.find(marker)].rstrip() + '\n'
    STYLES.write_text(s + '\n' + CSS + '\n', encoding='utf-8')
patch_index(INDEX)
patch_index(ROOT_INDEX)
print('Applied Wolf Universe complete UI patch: scope, progress, mobile artwork, image lightbox.')
