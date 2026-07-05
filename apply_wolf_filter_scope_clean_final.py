#!/usr/bin/env python3
from pathlib import Path
import json, re, shutil

ROOT = Path('.')
APP = ROOT/'law_order_tracker_app/app.js'
HTML = ROOT/'law_order_tracker_app/index.html'
CSS = ROOT/'law_order_tracker_app/styles.css'
EPISODES = ROOT/'law_order_tracker_app/data/episodes.js'
SHOWS = ROOT/'wolf_universe_shows.json'
CATALOG = ROOT/'wolf_universe_catalog_update.py'

for p in [APP, HTML, CSS, EPISODES]:
    if not p.exists():
        raise SystemExit(f'Missing required file: {p}')

BACKUP_DIR = ROOT/'_wolf_patch_backups'
BACKUP_DIR.mkdir(exist_ok=True)
for p in [APP, HTML, CSS, EPISODES, SHOWS, CATALOG]:
    if p.exists():
        shutil.copy2(p, BACKUP_DIR/(p.name+'.bak'))

def read(p): return p.read_text(encoding='utf-8')
def write(p,s): p.write_text(s, encoding='utf-8')

# -------------------------------------------------------------------
# 1) Clean previous runtime patches that created duplicate scope/show UI.
# -------------------------------------------------------------------
js = read(APP)
js = re.sub(r"\n?/\* WOLF_[A-Z0-9_]+ \*/\s*\(function[\s\S]*?\n\}\)\(\);\s*", "\n", js)
js = re.sub(r"\n?/\* WOLF_[A-Z0-9_]+_V\d+ \*/\s*\(function[\s\S]*?\n\}\)\(\);\s*", "\n", js)

# -------------------------------------------------------------------
# 2) Replace normalizeEpisodes so metadata is preserved.
# -------------------------------------------------------------------
new_normalize = r'''function normalizeEpisodes() {
  episodes = episodes
    .filter(Boolean)
    .map((raw, index) => {
      const ep = { ...raw };
      ep.id = ep.id || `${ep.show || 'unknown'}-${ep.season || 0}-${ep.episode || index + 1}`;
      ep.order = Number(ep.order) || index + 1;
      ep.show = ep.show || 'Unknown Show';
      ep.season = ep.season ?? '';
      ep.episode = ep.episode ?? '';
      ep.isSpecial = Boolean(ep.isSpecial || Number(ep.season) === 0);
      ep.isMovie = Boolean(ep.isMovie);
      ep.code = ep.code || buildCode(ep);
      ep.title = ep.title || '';
      ep.airDate = ep.airDate || ep.air_date || '';
      ep.notes = ep.notes || '';
      ep.franchise = ep.franchise || ep.era || '';
      ep.era = ep.era || ep.franchise || '';
      ep.sourceWatch = ep.sourceWatch || ep.source_watch || '';
      ep.optional = Boolean(ep.optional);
      ep.alwaysShow = Boolean(ep.alwaysShow);
      ep.connection = ep.connection || '';
      ep.guideScope = ep.guideScope || ep.scope || '';
      return ep;
    })
    .sort((a, b) => a.order - b.order);
}'''
js = re.sub(r"function normalizeEpisodes\(\) \{[\s\S]*?\n\}\n\nfunction buildCode", new_normalize + "\n\nfunction buildCode", js)

# -------------------------------------------------------------------
# 3) Replace buildCode to avoid fake S00E00 badges on non-episode UI.
# -------------------------------------------------------------------
new_buildcode = r'''function buildCode(ep) {
  if (ep.isMovie) return 'MOVIE';
  const sNum = Number(ep.season);
  const eNum = Number(ep.episode);
  if (!Number.isFinite(sNum) || !Number.isFinite(eNum) || eNum <= 0) return '';
  if (sNum === 0 || ep.isSpecial) return `S00E${String(eNum).padStart(2, '0')}`;
  return `${String(sNum).padStart(2, '0')}.${String(eNum).padStart(2, '0')}`;
}'''
js = re.sub(r"function buildCode\(ep\) \{[\s\S]*?\n\}\n\nfunction initOptions", new_buildcode + "\n\nfunction initOptions", js)

# -------------------------------------------------------------------
# 4) Add scope/franchise helpers before initOptions.
# -------------------------------------------------------------------
helpers = r'''
const WOLF_SCOPE_KEY = 'wolf_tracker_scope_v2';
const SCOPE_OPTIONS = [
  ['core', 'Core Wolf Universe'],
  ['connected', 'Core + Crossover Relevant'],
  ['adjacent', 'Adjacent / Archive Only'],
  ['complete', 'Complete Wolf Universe']
];

function themeForShow(show) {
  return themes[show] || {};
}

function truthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function showMeta(show) {
  const fromTheme = themeForShow(show) || {};
  const sample = episodes.find(e => e.show === show) || {};
  return { ...fromTheme, ...sample };
}

function showScope(show) {
  const meta = showMeta(show);
  const franchise = normText(meta.franchise || meta.era || '');
  const connection = normText(meta.connection || '');
  const guideScope = normText(meta.guideScope || meta.scope || '');
  const optional = truthy(meta.optional) || franchise.includes('adjacent') || franchise.includes('archive') || guideScope.includes('adjacent');
  const always = truthy(meta.alwaysShow) || truthy(meta.crossoverRelevant) || connection.includes('crossover') || connection.includes('direct') || connection.includes('canon') || guideScope.includes('connected');

  if (franchise.includes('law') || franchise.includes('chicago') || franchise === 'fbi' || franchise.includes('fbi universe')) return 'core';
  if (always) return 'connected';
  if (optional) return 'adjacent';
  return 'connected';
}

function getScopeFilter() {
  const el = document.getElementById('scopeFilter');
  const value = el?.value || localStorage.getItem(WOLF_SCOPE_KEY) || 'connected';
  return ['core', 'connected', 'adjacent', 'complete'].includes(value) ? value : 'connected';
}

function scopeLabel(value) {
  return (SCOPE_OPTIONS.find(([v]) => v === value) || SCOPE_OPTIONS[1])[1];
}

function passesScope(ep, scope = getScopeFilter()) {
  const s = showScope(ep.show);
  if (scope === 'complete') return true;
  if (scope === 'adjacent') return s === 'adjacent';
  if (scope === 'core') return s === 'core';
  return s === 'core' || s === 'connected';
}

function scopedEpisodes() {
  const scope = getScopeFilter();
  return episodes.filter(ep => passesScope(ep, scope));
}

function selectedFranchise() {
  return document.getElementById('franchiseFilter')?.value || '';
}

function episodesForShowLists() {
  const franchise = selectedFranchise();
  return scopedEpisodes().filter(ep => !franchise || String(ep.franchise || ep.era || '') === franchise);
}

function showEpisodeLabel(ep) {
  if (ep.isMovie) return 'Movie / special';
  if (Number(ep.season) === 0 || ep.isSpecial) return `Special ${ep.episode}`;
  return `Season ${ep.season}, Episode ${ep.episode}`;
}
'''
if 'const WOLF_SCOPE_KEY' not in js:
    js = js.replace('\nfunction initOptions() {', '\n' + helpers + '\nfunction initOptions() {')

# -------------------------------------------------------------------
# 5) Replace initOptions, updateSeasonOptions, matches, render, renderNext, epCard, refreshShowStripCounts.
# -------------------------------------------------------------------
new_init = r'''function initOptions() {
  normalizeEpisodes();
  ensureScopeControl();

  const franchiseFilter = document.getElementById('franchiseFilter');
  const showFilter = document.getElementById('showFilter');
  const bulkShow = document.getElementById('bulkShow');
  const strip = document.getElementById('showStrip');

  if (franchiseFilter) {
    const oldFranchise = franchiseFilter.value;
    const franchises = [...new Set(episodes.map(e => e.franchise || e.era).filter(Boolean))].sort();
    franchiseFilter.innerHTML = '<option value="">All franchises</option>';
    franchises.forEach(f => franchiseFilter.add(new Option(f, f)));
    if (franchises.includes(oldFranchise)) franchiseFilter.value = oldFranchise;
  }

  rebuildShowControls();
  updateSeasonOptions();
}'''
js = re.sub(r"function initOptions\(\) \{[\s\S]*?\n\}\n\nfunction updateSeasonOptions", new_init + "\n\nfunction updateSeasonOptions", js)

new_update_seasons = r'''function ensureScopeControl() {
  let scope = document.getElementById('scopeFilter');
  if (!scope) {
    const status = document.getElementById('statusFilter');
    scope = document.createElement('select');
    scope.id = 'scopeFilter';
    scope.title = 'Guide scope';
    if (status?.parentNode) status.parentNode.insertBefore(scope, status);
  }
  const currentScope = scope.value || localStorage.getItem(WOLF_SCOPE_KEY) || 'connected';
  scope.innerHTML = SCOPE_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  scope.value = SCOPE_OPTIONS.some(([value]) => value === currentScope) ? currentScope : 'connected';
}

function rebuildShowControls() {
  const showFilter = document.getElementById('showFilter');
  const bulkShow = document.getElementById('bulkShow');
  const strip = document.getElementById('showStrip');
  const oldShow = showFilter?.value || '';
  const oldBulkShow = bulkShow?.value || '';
  const source = episodesForShowLists();
  const shows = [...new Set(source.map(e => e.show).filter(Boolean))].sort();

  if (showFilter) {
    showFilter.innerHTML = '<option value="">All shows</option>';
    shows.forEach(show => showFilter.add(new Option(show, show)));
    if (shows.includes(oldShow)) showFilter.value = oldShow;
  }

  if (bulkShow) {
    bulkShow.innerHTML = '';
    shows.forEach(show => bulkShow.add(new Option(show, show)));
    if (shows.includes(oldBulkShow)) bulkShow.value = oldBulkShow;
  }

  if (strip) {
    strip.innerHTML = '';
    shows.forEach(show => {
      const showRows = source.filter(e => e.show === show);
      const watched = showRows.filter(e => getStatus(e) === 'Watched').length;
      const total = showRows.length;
      if (!total) return;
      const t = theme(show);
      const button = document.createElement('button');
      button.className = 'showChip';
      button.dataset.show = show;
      button.style.setProperty('--showColor', t.primary || '#b91c1c');
      button.innerHTML = `<span class="dot" style="background:${esc(t.primary || '#b91c1c')}"></span><span>${esc(show)}</span><small>${watched}/${total}</small>`;
      button.addEventListener('click', () => {
        showFilter.value = show;
        updateSeasonOptions();
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      strip.appendChild(button);
    });
  }
}

function updateSeasonOptions() {
  const show = document.getElementById('showFilter')?.value || '';
  const seasonFilter = document.getElementById('seasonFilter');
  if (seasonFilter) {
    const oldSeason = seasonFilter.value;
    seasonFilter.innerHTML = '<option value="">All seasons</option>';
    uniqueSeasons(episodesForShowLists().filter(e => !show || e.show === show))
      .forEach(season => seasonFilter.add(new Option(Number(season) === 0 ? 'Specials / Season 0' : `Season ${season}`, season)));
    if ([...seasonFilter.options].some(o => o.value === oldSeason)) seasonFilter.value = oldSeason;
  }

  const bulkShow = document.getElementById('bulkShow')?.value || '';
  const bulkSeason = document.getElementById('bulkSeason');
  if (bulkSeason) {
    bulkSeason.innerHTML = '';
    uniqueSeasons(episodesForShowLists().filter(e => e.show === bulkShow))
      .forEach(season => bulkSeason.add(new Option(Number(season) === 0 ? 'Specials / Season 0' : `Season ${season}`, season)));
  }
}'''
js = re.sub(r"function updateSeasonOptions\(\) \{[\s\S]*?\n\}\n\nfunction uniqueSeasons", new_update_seasons + "\n\nfunction uniqueSeasons", js)

new_matches = r'''function matches(ep) {
  const q = document.getElementById('searchBox').value.toLowerCase().trim();
  const show = document.getElementById('showFilter').value;
  const franchise = document.getElementById('franchiseFilter')?.value || '';
  const season = document.getElementById('seasonFilter').value;
  const statusFilter = document.getElementById('statusFilter').value;
  const hideWatched = document.getElementById('hideWatched').checked;
  const st = getStatus(ep);

  if (!passesScope(ep)) return false;
  if (franchise && String(ep.franchise || ep.era || '') !== franchise) return false;
  if (show && ep.show !== show) return false;
  if (season && String(ep.season) !== String(season)) return false;
  if (q) {
    const haystack = `${ep.title} ${ep.show} ${ep.notes} ${ep.code} ${ep.airDate} ${ep.overview || ''} ${ep.connection || ''} ${ep.franchise || ''}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (statusFilter === 'unwatched' && st === 'Watched') return false;
  if (statusFilter === 'watched' && st !== 'Watched') return false;
  if (statusFilter === 'watching' && st !== 'Watching') return false;
  if (statusFilter === 'skipped' && st !== 'Skipped') return false;
  if (hideWatched && statusFilter !== 'watched' && st === 'Watched') return false;
  return true;
}'''
js = re.sub(r"function matches\(ep\) \{[\s\S]*?\n\}\n\nfunction render", new_matches + "\n\nfunction render", js)

new_render = r'''function render() {
  const scoped = scopedEpisodes();
  const total = scoped.length;
  const watched = scoped.filter(e => getStatus(e) === 'Watched').length;
  const percent = pct(watched, total);

  setText('totalCount', total);
  setText('watchedCount', watched);
  setText('remainingCount', total - watched);
  setText('progressPct', `${percent}%`);
  document.getElementById('progressBar').style.width = `${percent}%`;

  const next = scoped.find(e => getStatus(e) !== 'Watched');
  renderNext(next);

  current = episodes.filter(matches);
  renderedCount = Math.min(PAGE_SIZE, current.length);
  renderList();
  refreshShowStripCounts();
}'''
js = re.sub(r"function render\(\) \{[\s\S]*?\n\}\n\nfunction setText", new_render + "\n\nfunction setText", js)

js = js.replace("nextMeta.innerHTML = `<span class=\"metaPill\">#${esc(next.order)}</span><span class=\"metaPill\">${esc(next.airDate || 'No air date')}</span><span class=\"metaPill\">Season ${esc(next.season)}, Episode ${esc(next.episode)}</span>`;", "nextMeta.innerHTML = `<span class=\"metaPill\">#${esc(next.order)}</span><span class=\"metaPill\">${esc(next.airDate || 'No air date')}</span><span class=\"metaPill\">${esc(showEpisodeLabel(next))}</span>`;")

new_epcard = r'''function epCard(ep) {
  const st = getStatus(ep);
  const statuses = ['Not Started', 'Watching', 'Watched', 'Skipped'];
  const t = theme(ep.show);
  const accent = esc(t.primary || '#b91c1c');
  const title = ep.title ? ` — ${esc(ep.title)}` : '';
  const source = ep.sourceWatch ? `<span class="pill">Watch #${esc(ep.sourceWatch)}</span>` : '';
  const notes = ep.notes ? `<div class="crossover">${esc(ep.notes)}</div>` : '';
  const overview = ep.overview ? `<p class="epOverview">${esc(ep.overview)}</p>` : '';
  const connection = ep.connection ? `<span class="pill crossoverPill">${esc(ep.connection)}</span>` : '';

  return `
    <article class="ep ${st === 'Watched' ? 'watched' : ''}" style="--showColor:${accent}" id="ep-${safeId(ep.order)}">
      <div class="order">#${esc(ep.order)}</div>
      <img class="epArt" src="${esc(episodeArtwork(ep))}" alt="${esc(ep.show)} ${esc(ep.code)} artwork" loading="lazy" onerror="this.src=artwork(ep.show)">
      <div class="epMain">
        <h3>${esc(ep.show)} ${esc(ep.code)}${title}</h3>
        <div class="meta">${esc(ep.airDate || 'No date')} • ${esc(showEpisodeLabel(ep))} • <strong>${esc(st)}</strong></div>
        <span class="pill">${esc(ep.franchise || ep.era || 'Guide')}</span>${source}${connection}${notes}${overview}
      </div>
      <div class="statusBtns">
        ${statuses.map(status => `<button class="${st === status ? 'active' : ''}" data-id="${encodeURIComponent(ep.id)}" data-status="${esc(status)}">${status.replace('Not Started', 'Todo')}</button>`).join('')}
      </div>
    </article>`;
}'''
js = re.sub(r"function epCard\(ep\) \{[\s\S]*?\n\}\n\nfunction setStatusById", new_epcard + "\n\nfunction setStatusById", js)

# patch bulk to respect scope/franchise
js = js.replace("const targets = episodes.filter(ep => ep.show === show && (scope === 'show' || String(ep.season) === String(season)));", "const targets = episodes.filter(ep => passesScope(ep) && (!selectedFranchise() || String(ep.franchise || ep.era || '') === selectedFranchise()) && ep.show === show && (scope === 'show' || String(ep.season) === String(season)));")

new_refresh = r'''function refreshShowStripCounts() {
  const source = episodesForShowLists();
  document.querySelectorAll('.showChip').forEach(button => {
    const show = button.dataset.show;
    const showRows = source.filter(e => e.show === show);
    const total = showRows.length;
    if (!total) return button.remove();
    const watched = showRows.filter(e => getStatus(e) === 'Watched').length;
    const small = button.querySelector('small');
    if (small) small.textContent = `${watched}/${total}`;
  });
}'''
js = re.sub(r"function refreshShowStripCounts\(\) \{[\s\S]*?\n\}\n\nfunction bindEvents", new_refresh + "\n\nfunction bindEvents", js)

# bind events include franchise/scope and rebuild show controls on scope/franchise changes
js = js.replace("['searchBox', 'showFilter', 'seasonFilter', 'statusFilter', 'hideWatched'].forEach(id => {", "['searchBox', 'showFilter', 'franchiseFilter', 'seasonFilter', 'statusFilter', 'scopeFilter', 'hideWatched'].forEach(id => {")
js = js.replace("if (id === 'showFilter') updateSeasonOptions();\n      render();", "if (id === 'scopeFilter') localStorage.setItem(WOLF_SCOPE_KEY, el.value);\n      if (id === 'scopeFilter' || id === 'franchiseFilter') rebuildShowControls();\n      if (id === 'showFilter' || id === 'scopeFilter' || id === 'franchiseFilter') updateSeasonOptions();\n      render();")
js = js.replace("if (id === 'showFilter') updateSeasonOptions();\n      render();", "if (id === 'scopeFilter') localStorage.setItem(WOLF_SCOPE_KEY, el.value);\n      if (id === 'scopeFilter' || id === 'franchiseFilter') rebuildShowControls();\n      if (id === 'showFilter' || id === 'scopeFilter' || id === 'franchiseFilter') updateSeasonOptions();\n      render();")
# reset filters reset scope to connected and franchise empty
js = js.replace("document.getElementById('showFilter').value = '';\n    document.getElementById('seasonFilter').value = '';", "document.getElementById('showFilter').value = '';\n    if (document.getElementById('franchiseFilter')) document.getElementById('franchiseFilter').value = '';\n    if (document.getElementById('scopeFilter')) { document.getElementById('scopeFilter').value = 'connected'; localStorage.setItem(WOLF_SCOPE_KEY, 'connected'); }\n    document.getElementById('seasonFilter').value = '';")
js = js.replace("updateSeasonOptions();\n    render();", "rebuildShowControls();\n    updateSeasonOptions();\n    render();", 1)

# Add lightbox if not present
lightbox = r'''
function initArtworkLightbox() {
  if (document.getElementById('wolfLightbox')) return;
  const lb = document.createElement('div');
  lb.id = 'wolfLightbox';
  lb.className = 'wolfLightbox';
  lb.innerHTML = '<button class="wolfLightboxClose" aria-label="Close">×</button><img alt="Artwork"><div class="wolfLightboxCaption"></div>';
  document.body.appendChild(lb);
  const close = () => lb.classList.remove('open');
  lb.addEventListener('click', event => { if (event.target === lb || event.target.classList.contains('wolfLightboxClose')) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  document.addEventListener('click', event => {
    const img = event.target.closest('img.epArt, img.poster');
    if (!img) return;
    const src = img.currentSrc || img.src;
    if (!src) return;
    lb.querySelector('img').src = src;
    lb.querySelector('.wolfLightboxCaption').textContent = img.alt || '';
    lb.classList.add('open');
  });
}
'''
if 'function initArtworkLightbox()' not in js:
    js = js.replace('\nfunction bindEvents() {', '\n' + lightbox + '\nfunction bindEvents() {')
js = js.replace("bindEvents();\n  render();", "bindEvents();\n  initArtworkLightbox();\n  render();")
write(APP, js)

# -------------------------------------------------------------------
# 6) Clean/rewrite controls HTML to one clean row; no duplicate scope dropdowns.
# -------------------------------------------------------------------
html = read(HTML)
controls = r'''<section class="controls card">
    <input id="searchBox" placeholder="Search title, show, notes…" autocomplete="off">
    <select id="showFilter"><option value="">All shows</option></select>
    <select id="franchiseFilter"><option value="">All franchises</option></select>
    <select id="seasonFilter"><option value="">All seasons</option></select>
    <select id="scopeFilter" title="Guide scope"><option value="connected">Core + Crossover Relevant</option></select>
    <select id="statusFilter"><option value="unwatched">Only unwatched</option><option value="all">Show all</option><option value="watched">Only watched</option><option value="watching">Watching</option><option value="skipped">Skipped</option></select>
    <label class="toggle"><input type="checkbox" id="hideWatched" checked> Hide watched</label>
  </section>'''
html = re.sub(r'<section class="controls card">[\s\S]*?</section>', controls, html)
# Remove any previous extra guide scope panels inserted by bad patches
html = re.sub(r'\n?\s*<section[^>]*(?:wolfScope|guideScope|scopePanel)[^>]*>[\s\S]*?</section>', '', html, flags=re.I)
if 'data/wolf_artwork.js' not in html:
    html = html.replace('<script src="data/show_themes.js"></script><script src="data/episodes.js"></script>', '<script src="data/show_themes.js"></script><script src="data/wolf_artwork.js"></script><script src="data/episodes.js"></script>')
write(HTML, html)

# -------------------------------------------------------------------
# 7) CSS cleanup/improvements.
# -------------------------------------------------------------------
css = read(CSS) if CSS.exists() else ''
css = re.sub(r'/\* WOLF_[A-Z0-9_]+[\s\S]*?\*/[\s\S]*?(?=/\* WOLF_|$)', '', css)
css += r'''

/* WOLF_UI_SCOPE_CLEAN_FINAL */
.controls.card{display:grid!important;grid-template-columns:minmax(240px,1.45fr) minmax(170px,.9fr) minmax(150px,.75fr) minmax(140px,.65fr) minmax(230px,1fr) minmax(160px,.75fr) auto;gap:10px;align-items:center}
#scopeFilter{min-width:220px}.showStrip{display:flex!important;gap:10px;overflow:auto;padding-bottom:8px;scrollbar-color:var(--border) transparent}.showChip{transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}.showChip:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(0,0,0,.28);border-color:var(--showColor,var(--brand))}.showChip small{display:inline!important}.epOverview{margin:.55rem 0 0;color:var(--muted);font-size:13px;line-height:1.42;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.crossoverPill{border-color:rgba(250,204,21,.45);color:#fde68a}.epArt,.poster{cursor:zoom-in;transition:transform .18s ease,filter .18s ease,box-shadow .18s ease}.epArt:hover,.poster:hover{transform:scale(1.035);filter:saturate(1.08) contrast(1.04);box-shadow:0 18px 45px rgba(0,0,0,.35)}.wolfLightbox{position:fixed;inset:0;z-index:99999;background:rgba(2,6,23,.88);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;padding:24px}.wolfLightbox.open{display:flex}.wolfLightbox img{max-width:min(96vw,1280px);max-height:84vh;border-radius:18px;box-shadow:0 30px 110px rgba(0,0,0,.7);object-fit:contain;background:#020617}.wolfLightboxClose{position:fixed;top:18px;right:22px;border:1px solid rgba(255,255,255,.25);background:rgba(15,23,42,.92);color:#fff;border-radius:999px;font-size:36px;line-height:1;width:54px;height:54px;cursor:pointer}.wolfLightboxCaption{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);color:#e2e8f0;background:rgba(15,23,42,.86);border:1px solid rgba(148,163,184,.25);padding:10px 16px;border-radius:999px;max-width:90vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:1100px){.controls.card{grid-template-columns:1fr 1fr 1fr}.controls.card .toggle{grid-column:1/-1}.dashboard{grid-template-columns:1fr 1fr 1fr}.hero{grid-column:1/-1}}
@media(max-width:760px){.controls.card{grid-template-columns:1fr!important}.ep{grid-template-columns:52px 96px 1fr!important}.epArt{display:block!important;width:96px!important;height:66px!important}.order{display:grid!important}.showChip small{display:inline!important}.hero{grid-template-columns:1fr!important}.poster{display:block!important}.stat{min-height:110px!important}}
@media(max-width:480px){.ep{grid-template-columns:42px 76px 1fr!important;gap:8px!important}.epArt{width:76px!important;height:56px!important}.ep h3{font-size:15px}.meta{font-size:12px}.order{font-size:13px;padding:9px 5px}.showStrip{margin-left:-4px;margin-right:-4px}.showChip{font-size:13px;padding:8px 10px}.statusBtns{grid-column:1/-1}.wolfLightbox{padding:10px}.wolfLightbox img{max-width:96vw;max-height:78vh}}
'''
write(CSS, css)

# -------------------------------------------------------------------
# 8) Add scope metadata to existing episodes.js immediately from wolf_universe_shows.json.
# -------------------------------------------------------------------
try:
    if SHOWS.exists():
        shows_cfg = json.loads(SHOWS.read_text(encoding='utf-8'))
        cfg_items = (shows_cfg.get('shows') or []) + (shows_cfg.get('movies') or [])
        by_show = {item.get('show'): item for item in cfg_items if item.get('show')}
        txt = read(EPISODES)
        start, end = txt.find('['), txt.rfind(']')
        arr = json.loads(txt[start:end+1])
        changed = 0
        for ep in arr:
            item = by_show.get(ep.get('show'))
            if not item: continue
            for field in ['franchise','optional','alwaysShow','connection','guideScope']:
                val = item.get(field)
                if val not in (None, '') and ep.get(field) != val:
                    ep[field] = val
                    changed += 1
        if changed:
            write(EPISODES, txt[:start] + json.dumps(arr, indent=2, ensure_ascii=False) + txt[end+1:])
            print(f'Updated episode scope metadata on {changed} fields.')
except Exception as exc:
    print(f'WARNING: Could not update episode metadata: {exc}')

# -------------------------------------------------------------------
# 9) Patch catalog updater so future rows keep optional/alwaysShow/connection/scope.
# -------------------------------------------------------------------
if CATALOG.exists():
    cat = read(CATALOG)
    if '"optional": bool(item.get("optional"))' not in cat:
        cat = cat.replace('"language": show.get("language") or ""', '"language": show.get("language") or "",\n                "optional": bool(item.get("optional")),\n                "alwaysShow": bool(item.get("alwaysShow")),\n                "connection": item.get("connection") or "",\n                "guideScope": item.get("guideScope") or item.get("scope") or ("adjacent" if item.get("optional") and not item.get("alwaysShow") else "connected")')
        cat = cat.replace('"language": movie.get("language") or ""', '"language": movie.get("language") or "",\n        "optional": bool(item.get("optional")),\n        "alwaysShow": bool(item.get("alwaysShow")),\n        "connection": item.get("connection") or "",\n        "guideScope": item.get("guideScope") or item.get("scope") or ("adjacent" if item.get("optional") and not item.get("alwaysShow") else "connected")')
    # ensure update loop preserves metadata if found
    old_loop = '"title", "overview", "traktSlug", "traktFirstAired", "traktIds", "showTraktIds", "franchise", "network", "runtime", "country", "language", "isSpecial"'
    new_loop = '"title", "overview", "traktSlug", "traktFirstAired", "traktIds", "showTraktIds", "franchise", "network", "runtime", "country", "language", "isSpecial", "optional", "alwaysShow", "connection", "guideScope"'
    cat = cat.replace(old_loop, new_loop)
    write(CATALOG, cat)

print('Applied final Wolf UI scope/filter cleanup.')
print('Backups saved in _wolf_patch_backups/.')
