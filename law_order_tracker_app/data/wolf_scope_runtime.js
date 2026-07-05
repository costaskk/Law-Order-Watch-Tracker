// Final Wolf Universe UI runtime: clean scopes, no duplicate filter corruption, artwork lightbox.
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
