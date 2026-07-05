#!/usr/bin/env python3
from pathlib import Path

ROOT = Path.cwd()
APP_DIR = ROOT / 'law_order_tracker_app'
INDEX = APP_DIR / 'index.html'
STYLES = APP_DIR / 'styles.css'
PATCH_JS = APP_DIR / 'wolf_v32_ui_cast_patch.js'

PATCH_JS_CONTENT = r"""
'use strict';
/* Wolf Universe v3.2 UI patch
   - chronological show chips
   - aligned chip titles/year/counts
   - actor filter from TMDB cast metadata
   - rich episode detail modal
   - image lightbox above episode modal
*/
(function wolfV32Patch(){
  const has = id => !!document.getElementById(id);
  const q = sel => document.querySelector(sel);

  function v32Esc(value){
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function v32EpKey(ep){
    return `${ep.show}|${Number(ep.season)||0}|${Number(ep.episode)||0}`;
  }

  function v32Image(ep){
    if (typeof episodeArtwork === 'function') return episodeArtwork(ep);
    return typeof artwork === 'function' ? artwork(ep.show) : '';
  }

  function v32ShowArt(show, type='backdrop'){
    const art = ((window.WOLF_ARTWORK || {}).shows || {})[show] || {};
    if (type === 'poster') return art.poster || art.backdrop || art.logo || (typeof artwork === 'function' ? artwork(show) : '');
    return art.backdrop || art.poster || art.logo || (typeof artwork === 'function' ? artwork(show) : '');
  }

  function v32SeasonArt(ep){
    const s = Number(ep.season)||0;
    const art = ((window.WOLF_ARTWORK || {}).seasons || {})[`${ep.show}|${s}`] || {};
    return art.poster || art.backdrop || '';
  }

  function v32EpisodeMeta(ep){
    return (((window.WOLF_ARTWORK || {}).episodes || {})[v32EpKey(ep)] || {});
  }

  function v32NamesFromList(list){
    if (!Array.isArray(list)) return [];
    return list.map(x => {
      if (typeof x === 'string') return x;
      return x?.name || x?.actor || x?.person?.name || x?.character || '';
    }).filter(Boolean);
  }

  window.getEpisodeActors = function getEpisodeActors(ep){
    const meta = v32EpisodeMeta(ep);
    const names = [
      ...v32NamesFromList(ep.cast),
      ...v32NamesFromList(ep.actors),
      ...v32NamesFromList(ep.guestCast),
      ...v32NamesFromList(ep.guestStars),
      ...v32NamesFromList(meta.cast),
      ...v32NamesFromList(meta.guest_stars),
      ...v32NamesFromList(meta.guestStars)
    ];
    return [...new Set(names.map(n => String(n).trim()).filter(Boolean))];
  };

  function v32FirstDate(show){
    const source = Array.isArray(window.LAW_ORDER_EPISODES) ? window.LAW_ORDER_EPISODES : (typeof episodes !== 'undefined' ? episodes : []);
    let best = '9999-12-31';
    for (const ep of source) {
      if (ep && ep.show === show && ep.airDate && ep.airDate < best) best = ep.airDate;
    }
    return best;
  }

  function v32Year(show){
    const d = v32FirstDate(show);
    return /^\d{4}/.test(d) ? d.slice(0,4) : '';
  }

  function v32SortShowEntries(entries){
    return [...entries].sort((a,b) => {
      const da = v32FirstDate(a[0]);
      const db = v32FirstDate(b[0]);
      if (da !== db) return da.localeCompare(db);
      return String(a[0]).localeCompare(String(b[0]), undefined, {numeric:true, sensitivity:'base'});
    });
  }

  function v32ChipHtml(show, rec, klass='showChip'){
    const color = rec.color || (typeof theme === 'function' ? theme(show).primary : '#b91c1c');
    const year = v32Year(show);
    return `<button class="${klass}" data-show="${v32Esc(show)}" style="--showColor:${v32Esc(color)}">
      <span class="dot" style="background:${v32Esc(color)}"></span>
      <span class="chipText"><strong>${v32Esc(show)}</strong><small>${year ? `${v32Esc(year)} · ` : ''}${rec.watched}/${rec.total}</small></span>
    </button>`;
  }

  function v32BuildShowMap(source){
    const byShow = new Map();
    for (const ep of source || []) {
      if (!ep || !ep.show) continue;
      if (!byShow.has(ep.show)) byShow.set(ep.show, { total:0, watched:0, color: (typeof theme === 'function' ? theme(ep.show).primary : '#b91c1c') });
      const rec = byShow.get(ep.show);
      rec.total += 1;
      if (typeof getStatus === 'function' && getStatus(ep) === 'Watched') rec.watched += 1;
    }
    return byShow;
  }

  const oldRenderShowStrip = window.renderShowStrip;
  window.renderShowStrip = function renderShowStripV32(values = (typeof getFilterValues === 'function' ? getFilterValues() : {})){
    const strip = document.getElementById('showStrip');
    if (!strip) return oldRenderShowStrip && oldRenderShowStrip(values);
    const base = (typeof scopedEpisodes !== 'undefined' ? scopedEpisodes : []);
    const railSource = base.filter(ep => typeof matchesNonShowFilters === 'function' ? matchesNonShowFilters(ep, values) : true);
    const entries = v32SortShowEntries(v32BuildShowMap(railSource).entries());
    if (!entries.length) {
      strip.innerHTML = '<span class="showStripEmpty">No shows available in this scope/filter.</span>';
      return;
    }
    strip.innerHTML = entries.map(([show, rec]) => v32ChipHtml(show, rec, 'showChip')).join('');
    strip.querySelectorAll('.showChip').forEach(button => {
      button.addEventListener('click', () => {
        const showFilter = document.getElementById('showFilter');
        if (showFilter) showFilter.value = button.dataset.show;
        if (typeof refreshDynamicFilters === 'function') refreshDynamicFilters({ keepShow:true, keepSeason:false, keepFranchise:true });
        if (typeof render === 'function') render();
        window.scrollTo({ top:0, behavior:'smooth' });
      });
    });
  };

  const oldRenderScopeSummary = window.renderScopeSummary;
  window.renderScopeSummary = function renderScopeSummaryV32(){
    const el = document.getElementById('scopeSummary');
    if (!el) return oldRenderScopeSummary && oldRenderScopeSummary();
    const scope = typeof getGuideScope === 'function' ? getGuideScope() : 'connected';
    const label = (typeof GUIDE_SCOPES !== 'undefined' && GUIDE_SCOPES[scope]) ? GUIDE_SCOPES[scope] : 'Guide Scope';
    const base = (typeof scopedEpisodes !== 'undefined' ? scopedEpisodes : []);
    const entries = v32SortShowEntries(v32BuildShowMap(base).entries());
    el.innerHTML = `<div class="scopeHeader"><div><strong>${v32Esc(label)}</strong><span>${base.length}/${(typeof episodes !== 'undefined' ? episodes.length : base.length)} entries · ${entries.length} shows · sorted by first air date</span></div></div>
      <div class="scopeMiniRail">${entries.map(([show, rec]) => v32ChipHtml(show, rec, 'scopeMiniChip')).join('')}</div>`;
    el.querySelectorAll('.scopeMiniChip').forEach(button => {
      button.addEventListener('click', () => {
        const sf = document.getElementById('showFilter');
        if (sf) sf.value = button.dataset.show;
        if (typeof refreshDynamicFilters === 'function') refreshDynamicFilters({ keepShow:true, keepSeason:false, keepFranchise:true });
        if (typeof render === 'function') render();
      });
    });
  };

  function v32EnsureActorFilter(){
    if (document.getElementById('actorFilter')) return;
    const controls = document.querySelector('.controls');
    if (!controls) return;
    const select = document.createElement('select');
    select.id = 'actorFilter';
    select.innerHTML = '<option value="">All actors</option>';
    const status = document.getElementById('statusFilter');
    controls.insertBefore(select, status || null);
    select.addEventListener('input', () => typeof render === 'function' && render());
    select.addEventListener('change', () => typeof render === 'function' && render());
  }

  function v32UpdateActorOptions(){
    v32EnsureActorFilter();
    const actorFilter = document.getElementById('actorFilter');
    if (!actorFilter) return;
    const prev = actorFilter.value || '';
    const base = (typeof scopedEpisodes !== 'undefined' ? scopedEpisodes : []);
    const values = typeof getFilterValues === 'function' ? getFilterValues() : {};
    const actorCounts = new Map();
    for (const ep of base) {
      if (values.show && ep.show !== values.show) continue;
      if (values.franchise && String(ep.franchise || ep.era) !== values.franchise) continue;
      if (values.season && String(ep.season) !== String(values.season)) continue;
      for (const name of window.getEpisodeActors(ep)) actorCounts.set(name, (actorCounts.get(name)||0)+1);
    }
    const actors = [...actorCounts.entries()].sort((a,b) => a[0].localeCompare(b[0], undefined, {sensitivity:'base'}));
    actorFilter.innerHTML = '';
    actorFilter.add(new Option(actors.length ? 'All actors' : 'No actor data yet', ''));
    actors.forEach(([name, count]) => actorFilter.add(new Option(`${name} (${count})`, name)));
    if (prev && actors.some(([name]) => name === prev)) actorFilter.value = prev;
  }

  const oldRefreshDynamicFilters = window.refreshDynamicFilters;
  if (typeof oldRefreshDynamicFilters === 'function') {
    window.refreshDynamicFilters = function refreshDynamicFiltersV32(opts){
      oldRefreshDynamicFilters(opts);
      v32UpdateActorOptions();
    };
  }

  const oldMatches = window.matches;
  if (typeof oldMatches === 'function') {
    window.matches = function matchesV32(ep){
      if (!oldMatches(ep)) return false;
      const actor = document.getElementById('actorFilter')?.value || '';
      if (actor && !window.getEpisodeActors(ep).includes(actor)) return false;
      return true;
    };
  }

  function v32CrewNames(meta, jobWords){
    const crew = Array.isArray(meta.crew) ? meta.crew : [];
    const found = crew.filter(c => jobWords.some(w => String(c.job||'').toLowerCase().includes(w))).map(c => c.name).filter(Boolean);
    return [...new Set(found)];
  }

  window.openEpisodeDetails = function openEpisodeDetails(ep){
    if (!ep) return;
    let overlay = document.getElementById('episodeDetailOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'episodeDetailOverlay';
      overlay.className = 'episodeDetailOverlay';
      document.body.appendChild(overlay);
    }
    const meta = v32EpisodeMeta(ep);
    const img = v32Image(ep);
    const seasonImg = v32SeasonArt(ep);
    const showImg = v32ShowArt(ep.show, 'poster');
    const actors = window.getEpisodeActors(ep).slice(0, 24);
    const directors = v32CrewNames(meta, ['director']);
    const writers = v32CrewNames(meta, ['writer', 'teleplay', 'story']);
    const overview = ep.overview || meta.overview || 'No episode summary available yet.';
    const st = typeof getStatus === 'function' ? getStatus(ep) : 'Not Started';
    const statusBtns = ['Not Started','Watching','Watched','Skipped'].map(s => `<button class="${st===s?'active':''}" data-detail-status="${v32Esc(s)}">${s.replace('Not Started','Todo')}</button>`).join('');
    overlay.innerHTML = `<div class="episodeDetailDialog" style="--showColor:${v32Esc((typeof theme==='function'?theme(ep.show).primary:'#b91c1c'))}">
      <button class="episodeDetailClose" type="button" aria-label="Close">×</button>
      <div class="episodeDetailHero">
        <img class="episodeDetailMainImage js-v32-lightbox" src="${v32Esc(img)}" data-lightbox-src="${v32Esc(img)}" alt="${v32Esc(ep.title || ep.show)}">
        <div class="episodeDetailText">
          <span class="detailKicker">${v32Esc(ep.franchise || ep.era || 'Wolf Universe')}</span>
          <h2>${v32Esc(ep.show)} ${v32Esc(ep.code || '')}${ep.title ? ' — '+v32Esc(ep.title) : ''}</h2>
          <div class="detailMeta"><span>${v32Esc(ep.airDate || 'No air date')}</span><span>${typeof episodeLabel==='function'?v32Esc(episodeLabel(ep)):`Season ${v32Esc(ep.season)} Episode ${v32Esc(ep.episode)}`}</span><span>${v32Esc(st)}</span></div>
          <p>${v32Esc(overview)}</p>
          ${ep.connection || ep.notes ? `<div class="detailConnection">${v32Esc(ep.connection || ep.notes)}</div>` : ''}
          <div class="detailStatusBtns">${statusBtns}</div>
        </div>
      </div>
      <div class="detailGrid">
        <section><h3>Cast</h3>${actors.length ? `<div class="actorPills">${actors.map(a=>`<button data-actor-name="${v32Esc(a)}">${v32Esc(a)}</button>`).join('')}</div>` : '<p class="muted">No cast data fetched yet. Run wolf_fetch_episode_cast.py.</p>'}</section>
        <section><h3>Crew</h3><p>${directors.length ? `<strong>Director:</strong> ${v32Esc(directors.join(', '))}<br>` : ''}${writers.length ? `<strong>Writer:</strong> ${v32Esc(writers.join(', '))}` : '<span class="muted">No crew data yet.</span>'}</p></section>
        <section><h3>Artwork</h3><div class="detailArtRow">${[img, seasonImg, showImg].filter(Boolean).map((src,i)=>`<img class="js-v32-lightbox" src="${v32Esc(src)}" data-lightbox-src="${v32Esc(src)}" alt="Artwork ${i+1}">`).join('')}</div></section>
      </div>
    </div>`;
    overlay.classList.add('show');
    overlay.querySelector('.episodeDetailClose').addEventListener('click', () => overlay.classList.remove('show'));
    overlay.addEventListener('click', ev => { if (ev.target === overlay) overlay.classList.remove('show'); }, {once:true});
    overlay.querySelectorAll('[data-detail-status]').forEach(btn => btn.addEventListener('click', ev => {
      ev.stopPropagation();
      if (typeof setStatus === 'function') setStatus(ep, btn.dataset.detailStatus);
      overlay.classList.remove('show');
    }));
    overlay.querySelectorAll('[data-actor-name]').forEach(btn => btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const actorFilter = document.getElementById('actorFilter');
      if (actorFilter) actorFilter.value = btn.dataset.actorName;
      overlay.classList.remove('show');
      if (typeof render === 'function') render();
    }));
  };

  function v32BindDetails(){
    const list = document.getElementById('episodeList');
    if (list && !list.dataset.v32DetailsBound) {
      list.dataset.v32DetailsBound = '1';
      list.addEventListener('click', ev => {
        const img = ev.target.closest('.js-lightbox-img, .js-v32-lightbox, .epArt');
        if (img) {
          ev.stopPropagation();
          const src = img.dataset.lightboxSrc || img.src;
          if (typeof openImageLightbox === 'function') openImageLightbox(src, img.dataset.lightboxTitle || 'Artwork');
          return;
        }
        if (ev.target.closest('button')) return;
        const card = ev.target.closest('.ep');
        if (!card) return;
        const order = String(card.id || '').replace(/^ep-/, '').replace(/_/g, '');
        const ep = (typeof current !== 'undefined' ? current : []).find(x => String(x.order) === order) || (typeof episodes !== 'undefined' ? episodes : []).find(x => String(x.order) === order);
        if (ep) window.openEpisodeDetails(ep);
      });
    }
    const lb = document.getElementById('lightboxOverlay');
    if (lb) lb.addEventListener('click', ev => { if (ev.target === lb && typeof closeLightbox === 'function') closeLightbox(); });
  }

  const oldRender = window.render;
  if (typeof oldRender === 'function') {
    window.render = function renderV32(){
      v32UpdateActorOptions();
      oldRender();
      v32BindDetails();
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    v32EnsureActorFilter();
    v32UpdateActorOptions();
    v32BindDetails();
  });
})();
"""

CSS_APPEND = r"""

/* Wolf Universe v3.2 cast/detail/alignment refinements */
.showChip,.scopeMiniChip{align-items:center;min-width:178px;max-width:310px;text-align:left;padding:9px 14px}
.showChip .chipText,.scopeMiniChip .chipText{display:flex;flex-direction:column;min-width:0;line-height:1.1;gap:3px}
.showChip .chipText strong,.scopeMiniChip .chipText strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px;letter-spacing:-.01em}
.showChip .chipText small,.scopeMiniChip .chipText small{display:block;color:var(--muted);font-size:12px;white-space:nowrap}
.showChip .dot,.scopeMiniChip .dot{flex:0 0 auto}
#actorFilter{min-width:180px}
.lightboxOverlay{z-index:260 !important}.lightboxClose{width:58px!important;height:58px!important;font-size:34px!important;right:14px!important;top:14px!important;background:rgba(5,10,20,.78)!important}
.episodeDetailOverlay{position:fixed;inset:0;z-index:220;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.72);backdrop-filter:blur(11px)}
.episodeDetailOverlay.show{display:flex}.episodeDetailDialog{width:min(1180px,96vw);max-height:92vh;overflow:auto;background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.025)),var(--panel);border:1px solid color-mix(in srgb,var(--showColor,var(--brand)) 45%,var(--border));border-radius:28px;box-shadow:0 40px 120px rgba(0,0,0,.55);position:relative}.episodeDetailClose{position:sticky;float:right;top:12px;right:12px;z-index:5;width:56px;height:56px;border-radius:999px;font-size:34px;padding:0;background:rgba(0,0,0,.62);color:white}.episodeDetailHero{display:grid;grid-template-columns:minmax(320px,1.1fr) minmax(320px,.9fr);gap:22px;padding:22px}.episodeDetailMainImage{width:100%;height:420px;object-fit:cover;border-radius:22px;border:1px solid color-mix(in srgb,var(--showColor) 45%,var(--border));box-shadow:0 24px 70px rgba(0,0,0,.45);cursor:zoom-in;background:var(--panel2)}.episodeDetailText h2{font-size:clamp(26px,3vw,44px);line-height:1.02;margin:8px 0 12px;letter-spacing:-.04em}.detailKicker{color:var(--muted);text-transform:uppercase;font-size:12px;font-weight:800;letter-spacing:.12em}.detailMeta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}.detailMeta span{border:1px solid var(--border);background:rgba(255,255,255,.04);border-radius:999px;padding:6px 10px;color:var(--muted);font-size:13px}.episodeDetailText p{color:var(--muted);line-height:1.55;font-size:15px}.detailConnection{border-left:4px solid var(--warn);background:rgba(246,173,61,.08);padding:10px 12px;border-radius:12px;color:#fde68a;margin:12px 0}.detailStatusBtns{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}.detailStatusBtns button.active{background:var(--showColor);border-color:transparent;color:white}.detailGrid{display:grid;grid-template-columns:1.15fr .85fr 1fr;gap:16px;padding:0 22px 22px}.detailGrid section{background:rgba(255,255,255,.035);border:1px solid var(--border);border-radius:20px;padding:16px}.detailGrid h3{margin:0 0 10px}.actorPills{display:flex;flex-wrap:wrap;gap:8px}.actorPills button{padding:7px 10px;border-radius:999px;font-size:13px}.detailArtRow{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.detailArtRow img{width:100%;height:118px;object-fit:cover;border-radius:14px;border:1px solid var(--border);cursor:zoom-in}.muted{color:var(--muted)}
@media(max-width:900px){.episodeDetailHero{grid-template-columns:1fr}.episodeDetailMainImage{height:280px}.detailGrid{grid-template-columns:1fr}.detailStatusBtns{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.showChip,.scopeMiniChip{min-width:150px}.episodeDetailOverlay{padding:8px}.episodeDetailDialog{border-radius:20px}.episodeDetailHero,.detailGrid{padding:14px}.episodeDetailMainImage{height:220px}.episodeDetailText h2{font-size:25px}.lightboxClose,.episodeDetailClose{width:50px!important;height:50px!important;font-size:30px!important}}
"""

if not INDEX.exists() or not STYLES.exists():
    raise SystemExit('Run this from the project root. Expected law_order_tracker_app/index.html and styles.css')

PATCH_JS.write_text(PATCH_JS_CONTENT.strip() + '\n', encoding='utf-8')

html = INDEX.read_text(encoding='utf-8')
if 'id="actorFilter"' not in html:
    html = html.replace('<select id="statusFilter">', '<select id="actorFilter"><option value="">All actors</option></select>\n    <select id="statusFilter">')
if 'id="lightboxOverlay"' not in html:
    html = html.replace('<div id="modalOverlay" class="modalOverlay" role="dialog" aria-modal="true"></div>', '<div id="modalOverlay" class="modalOverlay" role="dialog" aria-modal="true"></div>\n  <div id="lightboxOverlay" class="lightboxOverlay" aria-modal="true"></div>')
if 'wolf_v32_ui_cast_patch.js' not in html:
    html = html.replace('<script src="app.js"></script>', '<script src="app.js"></script><script src="wolf_v32_ui_cast_patch.js"></script>')
INDEX.write_text(html, encoding='utf-8')

css = STYLES.read_text(encoding='utf-8')
if 'Wolf Universe v3.2 cast/detail/alignment refinements' not in css:
    css += CSS_APPEND
STYLES.write_text(css, encoding='utf-8')

print('Applied Wolf v3.2 UI/cast patch:')
print(' - added actor filter if missing')
print(' - added wolf_v32_ui_cast_patch.js')
print(' - added episode detail modal + cast UI + bigger lightbox close button')
print(' - aligned show chips and sorted them by first air date')
