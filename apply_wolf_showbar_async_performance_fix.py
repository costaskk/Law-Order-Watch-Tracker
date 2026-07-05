#!/usr/bin/env python3
from pathlib import Path
import re

APP = Path('law_order_tracker_app/app.js')
CSS = Path('law_order_tracker_app/styles.css')
HTML = Path('law_order_tracker_app/index.html')

if not APP.exists():
    raise SystemExit('Missing law_order_tracker_app/app.js')

js = APP.read_text(encoding='utf-8')

# 1) Remove bad injected extra filters if present: duplicate all-shows selects / scope selects are normalized by runtime patch below.
# 2) Add one safe runtime patch at end of app.js. It does not depend on exact old function names.
MARK = '/* WOLF_ASYNC_SHOWBAR_PERFORMANCE_FIX_V1 */'
if MARK not in js:
    js += r'''

/* WOLF_ASYNC_SHOWBAR_PERFORMANCE_FIX_V1 */
(function wolfAsyncShowbarPerformanceFix(){
  'use strict';

  const root = document;
  const LS_SCOPE = 'wolfGuideScope';
  const validScopes = new Set(['core','connected','adjacent','complete']);

  function q(sel, base=document){ return base.querySelector(sel); }
  function qa(sel, base=document){ return Array.from(base.querySelectorAll(sel)); }
  function text(el){ return (el && el.textContent || '').trim(); }
  function norm(s){ return String(s || '').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim(); }

  function episodeList(){ return window.LAW_ORDER_EPISODES || window.WOLF_EPISODES || []; }
  function watchedSet(){
    const s = window.watchedIds || window.watchedSet || window.WATCHED_SET;
    if (s instanceof Set) return s;
    return new Set();
  }
  function getShowTheme(show){ return (window.SHOW_THEMES || {})[show] || {}; }
  function getScope(){
    const fromSelect = q('[data-wolf-scope], #wolfScopeFilter, select[name="wolfScope"]');
    const v = fromSelect && fromSelect.value ? fromSelect.value : localStorage.getItem(LS_SCOPE) || 'connected';
    return validScopes.has(v) ? v : 'connected';
  }
  function showScope(show){
    const t = getShowTheme(show);
    const franchise = String(t.franchise || '').toLowerCase();
    const connection = String(t.connection || '').toLowerCase();
    const optional = !!t.optional || franchise.includes('adjacent') || franchise.includes('archive');
    const always = !!t.alwaysShow || !!t.crossoverRelevant || connection.includes('crossover') || connection.includes('direct') || connection.includes('canonical');
    if (franchise.includes('law') || franchise.includes('chicago') || franchise === 'fbi' || franchise.includes('fbi universe') || always) return 'connected';
    if (optional) return 'adjacent';
    return 'core';
  }
  function passesScope(ep, scope){
    const ss = showScope(ep.show);
    if (scope === 'complete') return true;
    if (scope === 'adjacent') return ss === 'adjacent';
    if (scope === 'connected') return ss === 'core' || ss === 'connected';
    return ss === 'core' || ss === 'connected';
  }
  function statusKey(ep){
    if (!ep) return '';
    return ep.id || `${ep.show}|${Number(ep.season)||0}|${Number(ep.episode)||0}|${ep.title||''}`;
  }
  function isWatched(ep){
    if (!ep) return false;
    if (String(ep.status || '').toLowerCase() === 'watched') return true;
    const ws = watchedSet();
    const k = statusKey(ep);
    return ws.has(k) || ws.has(String(k)) || ws.has(`${ep.show}|${Number(ep.season)||0}|${Number(ep.episode)||0}`);
  }

  function visibleEpisodes(){
    const scope = getScope();
    const hideWatched = !!(q('#hideWatched, input[name="hideWatched"], [data-hide-watched]') || {}).checked;
    const showFilter = q('#showFilter, select[name="showFilter"], [data-show-filter]');
    const seasonFilter = q('#seasonFilter, select[name="seasonFilter"], [data-season-filter]');
    const queryInput = q('#searchInput, input[type="search"], [data-search]');
    const showVal = showFilter ? showFilter.value : '';
    const seasonVal = seasonFilter ? seasonFilter.value : '';
    const search = norm(queryInput ? queryInput.value : '');
    return episodeList().filter(ep => {
      if (!passesScope(ep, scope)) return false;
      if (hideWatched && isWatched(ep)) return false;
      if (showVal && !/^all/i.test(showVal) && ep.show !== showVal) return false;
      if (seasonVal && !/^all/i.test(seasonVal) && String(ep.season) !== String(seasonVal).replace(/^season\s*/i,'')) return false;
      if (search) {
        const hay = norm(`${ep.show} ${ep.title} ${ep.notes||''} ${ep.overview||''} ${ep.franchise||''}`);
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }

  function removeDuplicateFilterControls(){
    const bars = qa('.filters, .filterBar, .toolbar, .controls, [data-filter-bar]');
    const allSelects = qa('select').filter(s => /all shows/i.test(text(s.options && s.options[0] ? s.options[0] : s)) || /show/i.test(s.id + s.name + (s.dataset && JSON.stringify(s.dataset) || '')));
    const seenRole = new Set();
    for (const sel of allSelects) {
      const role = sel.id || sel.name || sel.getAttribute('data-role') || (sel.dataset && Object.keys(sel.dataset).join(',')) || 'unknown';
      const options = qa('option', sel).map(o => o.textContent).join('|');
      const key = role + '::' + options.slice(0,100);
      if (seenRole.has(key)) {
        const wrap = sel.closest('.filterField,.selectWrap,.field') || sel;
        wrap.remove();
      } else {
        seenRole.add(key);
      }
    }
  }

  function ensureScopeDropdown(){
    let scope = q('#wolfScopeFilter, [data-wolf-scope]');
    if (!scope) {
      const filterBar = q('.filters, .filterBar, .toolbar, .controls, [data-filter-bar]') || q('main') || document.body;
      scope = document.createElement('select');
      scope.id = 'wolfScopeFilter';
      scope.setAttribute('data-wolf-scope','1');
      scope.className = 'wolfScopeFilter';
      filterBar.appendChild(scope);
    }
    const old = scope.value || localStorage.getItem(LS_SCOPE) || 'connected';
    scope.innerHTML = `
      <option value="core">Core Wolf Universe</option>
      <option value="connected">Core + Crossover Relevant</option>
      <option value="adjacent">Adjacent / Archive Only</option>
      <option value="complete">Complete Wolf Universe</option>`;
    scope.value = validScopes.has(old) ? old : 'connected';
    scope.addEventListener('change', () => {
      localStorage.setItem(LS_SCOPE, scope.value);
      requestAnimationFrame(refreshAsync);
    }, {passive:true});
  }

  function refreshShowChips(){
    const bar = q('.showRail, .showChips, .seriesRail, .progressRail, [data-show-rail]');
    if (!bar) return;
    const eps = visibleEpisodes();
    const byShow = new Map();
    const watched = new Map();
    for (const ep of eps) {
      byShow.set(ep.show, (byShow.get(ep.show)||0)+1);
      if (isWatched(ep)) watched.set(ep.show, (watched.get(ep.show)||0)+1);
    }
    const existing = qa('button, .showChip, .chip, [data-show]', bar);
    if (!existing.length || byShow.size !== existing.length) {
      bar.innerHTML = '';
      for (const [show,total] of Array.from(byShow.entries()).sort((a,b)=>a[0].localeCompare(b[0]))) {
        const t = getShowTheme(show);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'showChip wolfShowChip';
        btn.dataset.show = show;
        btn.innerHTML = `<span class="dot"></span><span class="label"></span><span class="count"></span>`;
        btn.querySelector('.label').textContent = show;
        btn.querySelector('.count').textContent = `${watched.get(show)||0}/${total}`;
        if (t.primary) btn.style.setProperty('--chip-color', t.primary);
        btn.addEventListener('click', () => {
          const sf = q('#showFilter, select[name="showFilter"], [data-show-filter]');
          if (sf) { sf.value = show; sf.dispatchEvent(new Event('change', {bubbles:true})); }
        });
        bar.appendChild(btn);
      }
    } else {
      existing.forEach(el => {
        const show = el.dataset.show || text(el).replace(/\s+\d+\/\d+.*/, '').trim();
        const total = byShow.get(show);
        if (!total) return el.remove();
        const count = el.querySelector('.count') || el;
        if (count) count.textContent = `${watched.get(show)||0}/${total}`;
      });
    }
  }

  function refreshShowDropdowns(){
    const eps = visibleEpisodes();
    const shows = Array.from(new Set(eps.map(e => e.show))).sort();
    const showSelects = qa('#showFilter, select[name="showFilter"], [data-show-filter]').filter(Boolean);
    for (const sel of showSelects) {
      const old = sel.value;
      sel.innerHTML = '<option value="">All shows</option>' + shows.map(s => `<option value="${s.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">${s}</option>`).join('');
      if (shows.includes(old)) sel.value = old;
    }
  }

  function stripBadBadges(){
    qa('.badge,.pill,.meta,.tag').forEach(el => {
      const t = text(el);
      if (/^S0+E0+$/.test(t) || /^S0+E\d+/.test(t) && /Tip|Auto|Export|Season Manager/i.test(text(el.closest('section,.card,.panel')||{}))) el.remove();
    });
  }

  let refreshTimer = 0;
  function refreshAsync(){
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      removeDuplicateFilterControls();
      ensureScopeDropdown();
      refreshShowDropdowns();
      refreshShowChips();
      stripBadBadges();
      document.dispatchEvent(new CustomEvent('wolf:scope-filter-changed', {detail:{scope:getScope()}}));
    }, 0);
  }

  function enableLightbox(){
    if (q('#wolfLightbox')) return;
    const lb = document.createElement('div');
    lb.id = 'wolfLightbox';
    lb.className = 'wolfLightbox';
    lb.innerHTML = '<button class="wolfLightboxClose" aria-label="Close">×</button><img alt="Artwork"><div class="wolfLightboxCaption"></div>';
    document.body.appendChild(lb);
    lb.addEventListener('click', e => { if (e.target === lb || e.target.classList.contains('wolfLightboxClose')) lb.classList.remove('open'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.classList.remove('open'); });
    document.addEventListener('click', e => {
      const img = e.target.closest('img.epArt, .hero img, .nextCard img, img[src*="image.tmdb"], img[src*="assets/"]');
      if (!img) return;
      const src = img.currentSrc || img.src;
      if (!src) return;
      lb.querySelector('img').src = src;
      lb.querySelector('.wolfLightboxCaption').textContent = img.alt || '';
      lb.classList.add('open');
    });
  }

  function bindInstantFilters(){
    document.addEventListener('change', e => {
      if (e.target.matches('select,input[type="checkbox"]')) requestAnimationFrame(refreshAsync);
    }, true);
    document.addEventListener('input', e => {
      if (e.target.matches('input[type="search"], input[data-search]')) requestAnimationFrame(refreshAsync);
    }, true);
  }

  document.addEventListener('DOMContentLoaded', () => {
    enableLightbox();
    ensureScopeDropdown();
    bindInstantFilters();
    refreshAsync();
    setTimeout(refreshAsync, 600);
    setTimeout(refreshAsync, 2000);
  });
  window.wolfRefreshFilters = refreshAsync;
})();
'''
APP.write_text(js, encoding='utf-8')

# CSS improvements
if CSS.exists():
    css = CSS.read_text(encoding='utf-8')
else:
    css = ''
if 'WOLF_ASYNC_SHOWBAR_PERFORMANCE_FIX_V1' not in css:
    css += r'''

/* WOLF_ASYNC_SHOWBAR_PERFORMANCE_FIX_V1 */
.showChip,.wolfShowChip{transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease;background:linear-gradient(135deg,rgba(15,23,42,.96),rgba(30,41,59,.88));border:1px solid rgba(148,163,184,.25);border-radius:999px;padding:.55rem .85rem;color:#f8fafc;display:inline-flex;align-items:center;gap:.45rem;white-space:nowrap;cursor:pointer}
.showChip:hover,.wolfShowChip:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(0,0,0,.28);border-color:var(--chip-color,#ef4444)}
.showChip .dot,.wolfShowChip .dot{width:.65rem;height:.65rem;border-radius:50%;background:var(--chip-color,#ef4444);box-shadow:0 0 18px var(--chip-color,#ef4444)}
.showChip .count,.wolfShowChip .count{opacity:.78;font-size:.86em}
.wolfScopeFilter{min-width:220px}
img.epArt,.nextCard img,.hero img,img[src*="image.tmdb"],img[src*="assets/"]{cursor:zoom-in;transition:transform .18s ease,filter .18s ease,box-shadow .18s ease}
img.epArt:hover,.nextCard img:hover,.hero img:hover,img[src*="image.tmdb"]:hover,img[src*="assets/"]:hover{transform:scale(1.025);filter:saturate(1.08) contrast(1.04);box-shadow:0 18px 45px rgba(0,0,0,.32)}
.wolfLightbox{position:fixed;inset:0;z-index:99999;background:rgba(2,6,23,.86);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;padding:24px}
.wolfLightbox.open{display:flex}
.wolfLightbox img{max-width:min(96vw,1200px);max-height:82vh;border-radius:18px;box-shadow:0 30px 100px rgba(0,0,0,.65);object-fit:contain;background:#020617}
.wolfLightboxClose{position:fixed;top:18px;right:22px;border:1px solid rgba(255,255,255,.25);background:rgba(15,23,42,.9);color:#fff;border-radius:999px;font-size:36px;line-height:1;width:54px;height:54px;cursor:pointer}
.wolfLightboxCaption{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);color:#e2e8f0;background:rgba(15,23,42,.82);border:1px solid rgba(148,163,184,.25);padding:10px 16px;border-radius:999px;max-width:90vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:700px){.showChip,.wolfShowChip{font-size:.88rem;padding:.45rem .65rem}.wolfScopeFilter{min-width:100%}.filters,.filterBar,.toolbar,.controls{gap:.55rem}.epCard .num,.episodeNumber,.orderBadge{display:inline-flex!important;visibility:visible!important}.wolfLightbox{padding:10px}.wolfLightbox img{max-width:96vw;max-height:78vh}}
'''
    CSS.write_text(css, encoding='utf-8')

print('Applied Wolf async showbar/performance/lightbox cleanup patch.')
