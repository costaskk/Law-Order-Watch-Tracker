'use strict';

/*
  Wolf Universe Watch Tracker - stable v2 UI
  Goals:
  - one Guide Scope selector only
  - consistent counts from one scoped episode source
  - async/in-place filtering without page reload
  - responsive show rail that only shows shows available in the active scope/filter
  - image click lightbox
  - safe fallbacks for incomplete metadata
*/

const STORE_KEY = 'law_order_tracker_status_v4';
const LEGACY_STORE_KEYS = ['law_order_tracker_status_v3', 'law_order_tracker_status_v2', 'law_order_tracker_status'];
const THEME_KEY = 'law_order_tracker_theme';
const AUTOSYNC_KEY = 'law_order_auto_sync';
const SCOPE_KEY = 'wolf_tracker_scope_v2';
const PAGE_SIZE = 250;

let episodes = Array.isArray(window.LAW_ORDER_EPISODES) ? window.LAW_ORDER_EPISODES : [];
const themes = window.SHOW_THEMES || {};
const artworkMeta = window.WOLF_ARTWORK || { shows: {}, seasons: {}, episodes: {} };
const castIndexMeta = window.WOLF_CAST_INDEX || { actors: {}, byEpisode: {} };

let statusMap = loadStatusMap();
let current = [];
let scopedEpisodes = [];
let renderedCount = 0;
let deferredInstallPrompt = null;
let autoTimer = null;
let actorIndex = new Map();
let renderQueued = false;

const GUIDE_SCOPES = {
  core: 'Core Wolf Universe',
  connected: 'Core + Crossover Relevant',
  adjacent: 'Adjacent / Archive Only',
  complete: 'Complete Dick Wolf Universe'
};

const CORE_SHOWS = new Set([
  'Law & Order',
  'Law & Order: Special Victims Unit',
  'Law & Order: Criminal Intent',
  'Law & Order: Trial by Jury',
  'Law & Order: Organized Crime',
  'Law & Order: LA',
  'Law & Order: UK',
  'Law & Order True Crime',
  'Law & Order Toronto: Criminal Intent',
  'Chicago Fire',
  'Chicago P.D.',
  'Chicago Med',
  'Chicago Justice',
  'FBI',
  'FBI: Most Wanted',
  'FBI: International',
  'CIA (2026)'
]);

const CONNECTED_SHOWS = new Set([
  'Homicide: Life on the Street',
  'Homicide: The Movie',
  'New York Undercover',
  'Deadline',
  'Conviction',
  'In Plain Sight',
  'Exiled: A Law & Order Movie'
]);

const ADJACENT_SHOWS = new Set([
  'Crime & Punishment',
  'Mann & Machine',
  'Players',
  'New York News',
  'Arrest & Trial',
  'Dragnet',
  'Dragnet (1950s)',
  'L.A. Dragnet',
  'Cold Justice',
  'Blood & Money',
  'LA Fire & Rescue',
  'On Call',
  'Swift Justice',
  'South Beach',
  'D.C.',
  'Feds',
  'Gideon Oliver',
  'Christine Cromwell',
  'Nasty Boys'
]);

const SHOW_NAME_ALIASES = {
  [normText('Law & Order: SVU')]: normText('Law & Order: Special Victims Unit'),
  [normText('Law Order SVU')]: normText('Law & Order: Special Victims Unit'),
  [normText('SVU')]: normText('Law & Order: Special Victims Unit'),
  [normText('Criminal Intent')]: normText('Law & Order: Criminal Intent'),
  [normText('Law Order Criminal Intent')]: normText('Law & Order: Criminal Intent'),
  [normText('Organized Crime')]: normText('Law & Order: Organized Crime'),
  [normText('Trial by Jury')]: normText('Law & Order: Trial by Jury'),
  [normText('Law Order UK')]: normText('Law & Order: UK'),
  [normText('Law Order LA')]: normText('Law & Order: LA'),
  [normText('True Crime')]: normText('Law & Order True Crime'),
  [normText('NY Undercover')]: normText('New York Undercover'),
  [normText('Chicago PD')]: normText('Chicago P.D.'),
  [normText('Chicago P D')]: normText('Chicago P.D.')
};

let episodeByExactId = new Map();
let episodesByNoOrderKey = new Map();

function loadStatusMap() {
  try {
    const currentRaw = localStorage.getItem(STORE_KEY);
    if (currentRaw) return JSON.parse(currentRaw) || {};
    for (const key of LEGACY_STORE_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) || {};
        localStorage.setItem(STORE_KEY, JSON.stringify(parsed));
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Could not read local status storage:', err);
  }
  return {};
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(statusMap));
}

function normText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.trunc(n)) : String(value ?? '').trim();
}

function normShow(value) {
  const n = normText(value);
  return SHOW_NAME_ALIASES[n] || n;
}

function episodeKey(ep) {
  return `${normShow(ep.show)}|${normNum(ep.season)}|${normNum(ep.episode)}`;
}

function rebuildEpisodeIndexes() {
  episodeByExactId = new Map(episodes.map(ep => [String(ep.id), ep]));
  episodesByNoOrderKey = episodes.reduce((map, ep) => {
    const key = episodeKey(ep);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(ep);
    return map;
  }, new Map());
}

function normalizeStatus(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (['watched', 'complete', 'completed', 'yes', 'true', '1'].includes(v)) return 'Watched';
  if (['watching', 'in progress', 'started'].includes(v)) return 'Watching';
  if (['skipped', 'skip'].includes(v)) return 'Skipped';
  if (['not started', 'todo', 'unwatched', 'false', '0', ''].includes(v)) return 'Not Started';
  return ['Not Started', 'Watching', 'Watched', 'Skipped'].includes(value) ? value : null;
}

function statusFromMap(ep) {
  return statusMap[ep.id] || statusMap[episodeKey(ep)] || null;
}

function getStatus(ep) {
  return statusFromMap(ep) || ep.status || 'Not Started';
}

function setStatus(ep, status, silent = false) {
  const previous = getStatus(ep);
  statusMap[ep.id] = status;
  statusMap[episodeKey(ep)] = status;
  save();
  render();
  if (!silent && previous !== status) showToast('Status updated', `${ep.show} ${ep.code} is now ${status}.`, 'success');
}

function pct(n, d) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function safeId(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function theme(show) {
  return themes[show] || {
    primary: '#b91c1c',
    secondary: '#111827',
    accent: '#f8fafc',
    abbr: 'WOLF',
    image: ''
  };
}

function artwork(show) {
  const art = (artworkMeta.shows || {})[show] || {};
  if (art.backdrop || art.poster || art.logo) return art.backdrop || art.poster || art.logo;
  const t = theme(show);
  if (t.image) return t.image;
  const abbr = encodeURIComponent(t.abbr || String(show || 'WOLF').slice(0, 4));
  const color = encodeURIComponent((t.primary || '#b91c1c').replace('#',''));
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='520'%3E%3Crect width='900' height='520' fill='%23${color}'/%3E%3Ctext x='50%25' y='52%25' text-anchor='middle' dominant-baseline='middle' font-family='Arial' font-size='96' font-weight='900' fill='white'%3E${abbr}%3C/text%3E%3C/svg%3E`;
}

function episodeArtwork(ep) {
  const key = `${ep.show}|${Number(ep.season) || 0}|${Number(ep.episode) || 0}`;
  const epArt = (artworkMeta.episodes || {})[key] || {};
  if (epArt.still || epArt.backdrop || epArt.image) return epArt.still || epArt.backdrop || epArt.image;

  const seasonArt = (artworkMeta.seasons || {})[`${ep.show}|${Number(ep.season) || 0}`] || {};
  if (seasonArt.poster || seasonArt.backdrop) return seasonArt.poster || seasonArt.backdrop;

  return artwork(ep.show);
}

function setImageSafe(img, src, fallbackShow = 'Law & Order') {
  if (!img) return;
  img.onerror = () => { img.onerror = null; img.src = artwork(fallbackShow); };
  img.src = src || artwork(fallbackShow);
  img.style.display = '';
}

function showToast(title, message = '', type = 'info', timeout = 4200) {
  const host = document.getElementById('toastHost');
  if (!host) return;
  const colors = { success: '#28c76f', error: '#ef4444', warning: '#f6ad3d', danger: '#ef4444', info: '#60a5fa' };
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.setProperty('--toastColor', colors[type] || colors.info);
  toast.innerHTML = `<strong>${esc(title)}</strong>${message ? `<p>${esc(message)}</p>` : ''}`;
  host.appendChild(toast);
  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    window.setTimeout(() => toast.remove(), 220);
  }, timeout);
}

function showModal({ title, message, type = 'info', confirmText = 'OK', cancelText = '', danger = false } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modalOverlay');
    if (!overlay) return resolve(true);

    const colors = { success: '#28c76f', error: '#ef4444', warning: '#f6ad3d', danger: '#ef4444', info: '#60a5fa' };
    const icon = type === 'success' ? '✓' : type === 'error' || type === 'danger' || type === 'warning' ? '!' : 'i';
    overlay.innerHTML = `
      <div class="modal" style="--modalColor:${colors[type] || colors.info}">
        <div class="modalIcon">${icon}</div>
        <h2>${esc(title || 'Confirm')}</h2>
        <p>${esc(message || '')}</p>
        <div class="modalActions">
          ${cancelText ? `<button id="modalCancel" class="ghost">${esc(cancelText)}</button>` : ''}
          <button id="modalOk" class="${danger ? 'primary danger' : 'primary'}">${esc(confirmText)}</button>
        </div>
      </div>`;
    overlay.classList.add('show');

    const close = result => {
      overlay.classList.remove('show');
      overlay.innerHTML = '';
      resolve(result);
    };
    overlay.querySelector('#modalOk').addEventListener('click', () => close(true));
    const cancel = overlay.querySelector('#modalCancel');
    if (cancel) cancel.addEventListener('click', () => close(false));

    overlay.addEventListener('click', function outside(ev) {
      if (ev.target === overlay) {
        overlay.removeEventListener('click', outside);
        close(false);
      }
    });
  });
}

function openImageLightbox(src, title = '', subtitle = '') {
  if (!src) return;
  const overlay = document.getElementById('lightboxOverlay');
  if (!overlay) return;
  overlay.innerHTML = `
    <div class="lightboxDialog">
      <button class="lightboxClose" type="button" aria-label="Close image">×</button>
      <img src="${esc(src)}" alt="${esc(title || 'Artwork')}">
      <div class="lightboxCaption">
        <strong>${esc(title || 'Artwork')}</strong>
        ${subtitle ? `<span>${esc(subtitle)}</span>` : ''}
      </div>
    </div>`;
  overlay.classList.add('show');
  overlay.querySelector('.lightboxClose').addEventListener('click', closeLightbox);
}

function closeLightbox() {
  const overlay = document.getElementById('lightboxOverlay');
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.innerHTML = '';
}

function buildCode(ep) {
  const s = Number(ep.season);
  const e = Number(ep.episode);
  if (ep.isMovie) return 'MOVIE';
  if (Number.isFinite(s) && s === 0) return `S00.${String(e || 0).padStart(2, '0')}`;
  if (Number.isFinite(s) && Number.isFinite(e)) return `${String(s).padStart(2, '0')}.${String(e).padStart(2, '0')}`;
  return ep.code || '??';
}

function inferEpisodeScope(ep) {
  if (ep.scope) return ep.scope;
  if (ep.guideScope) return ep.guideScope;
  if (ep.alwaysShow || ep.connection) return 'connected';

  const show = ep.show || '';
  const franchise = String(ep.franchise || ep.era || '').toLowerCase();

  if (CORE_SHOWS.has(show)) return 'core';
  if (CONNECTED_SHOWS.has(show)) return 'connected';
  if (ADJACENT_SHOWS.has(show)) return 'adjacent';

  if (franchise.includes('adjacent') || franchise.includes('archive')) return 'adjacent';
  if (franchise.includes('special')) return 'connected';
  if (franchise.includes('law') || franchise.includes('chicago') || franchise.includes('fbi')) return 'core';

  return ep.optional ? 'adjacent' : 'connected';
}


function getEpisodeCast(ep) {
  const keys = [
    `${ep.show}|${Number(ep.season) || 0}|${Number(ep.episode) || 0}`,
    `${ep.show}|${ep.season}|${ep.episode}`,
    String(ep.id || '')
  ];
  const sources = [];
  if (Array.isArray(ep.cast)) sources.push(ep.cast);
  if (Array.isArray(ep.actors)) sources.push(ep.actors);
  if (Array.isArray(ep.guestStars)) sources.push(ep.guestStars);
  if (Array.isArray(ep.guest_stars)) sources.push(ep.guest_stars);
  if (Array.isArray(ep.credits)) sources.push(ep.credits);
  const meta = artworkMeta || {};
  for (const containerName of ['cast', 'episodeCast', 'credits', 'episodeCredits']) {
    const container = meta[containerName] || {};
    for (const key of keys) {
      if (Array.isArray(container[key])) sources.push(container[key]);
      else if (container[key] && Array.isArray(container[key].cast)) sources.push(container[key].cast);
    }
  }
  const byEpisode = castIndexMeta.byEpisode || {};
  for (const key of keys) {
    if (Array.isArray(byEpisode[key])) sources.push(byEpisode[key]);
    else if (byEpisode[key] && Array.isArray(byEpisode[key].cast)) sources.push(byEpisode[key].cast);
  }
  const seen = new Set();
  const out = [];
  for (const arr of sources) {
    for (const raw of arr) {
      const name = typeof raw === 'string' ? raw : (raw.name || raw.actor || raw.person?.name || raw.character?.name || '');
      if (!name) continue;
      const key = normText(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const character = typeof raw === 'object' ? (raw.character || raw.role || raw.characters?.[0] || '') : '';
      const profile = typeof raw === 'object' ? (raw.profile || raw.profile_path || raw.image || raw.headshot || '') : '';
      out.push({ name, character, profile });
    }
  }
  return out;
}

function rebuildActorIndex() {
  actorIndex = new Map();

  // Preferred source: generated aggregate TMDB cast index. This makes the actor
  // dropdown useful even before every single episode credit has been fetched.
  const indexedActors = castIndexMeta.actors || {};
  Object.entries(indexedActors).forEach(([key, actor]) => {
    if (!key || !actor || !actor.name) return;
    const shows = new Set();
    if (Array.isArray(actor.shows)) {
      actor.shows.forEach(item => {
        if (typeof item === 'string') shows.add(item);
        else if (item && item.show) shows.add(item.show);
      });
    } else if (actor.shows && typeof actor.shows === 'object') {
      Object.keys(actor.shows).forEach(show => shows.add(show));
    }
    actorIndex.set(key, {
      name: actor.name,
      count: Number(actor.count || actor.episodes || 0),
      shows,
      profile: actor.profile || '',
      characters: actor.characters || [],
      fromAggregateIndex: true
    });
  });

  // Merge exact episode-level cast when available. For actors already in the
  // aggregate index, keep the aggregate count so ordering remains by total
  // credited episode appearances instead of by how many rows we happened to fetch.
  for (const ep of episodes) {
    const cast = getEpisodeCast(ep);
    for (const actor of cast) {
      const key = normText(actor.name);
      if (!key) continue;
      if (!actorIndex.has(key)) actorIndex.set(key, { name: actor.name, count: 0, shows: new Set() });
      const rec = actorIndex.get(key);
      if (!rec.fromAggregateIndex) rec.count += 1;
      rec.shows.add(ep.show);
      if (!rec.profile && actor.profile) rec.profile = actor.profile;
      if (actor.character) {
        rec.characters = rec.characters || [];
        if (!rec.characters.includes(actor.character)) rec.characters.push(actor.character);
      }
    }
  }
}

function actorDisplay(rec) {
  return `${rec.name} (${rec.count})`;
}

function showFirstDate(show, source = scopedEpisodes) {
  let best = '';
  for (const ep of source) {
    if (ep.show !== show || !ep.airDate) continue;
    if (!best || ep.airDate < best) best = ep.airDate;
  }
  return best || '9999-12-31';
}

function showYear(show, source = scopedEpisodes) {
  const d = showFirstDate(show, source);
  return /^\d{4}/.test(d) ? d.slice(0, 4) : '';
}

function showSortEntries(entries, source = scopedEpisodes) {
  return entries.sort((a, b) => {
    const da = showFirstDate(a[0], source);
    const db = showFirstDate(b[0], source);
    if (da !== db) return da.localeCompare(db);
    return a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' });
  });
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function showArtworkGallery(ep) {
  const showArt = (artworkMeta.shows || {})[ep.show] || {};
  const seasonArt = (artworkMeta.seasons || {})[`${ep.show}|${Number(ep.season) || 0}`] || {};
  const epSrc = episodeArtwork(ep);
  const items = [
    { label: 'Episode', src: epSrc },
    { label: 'Season', src: seasonArt.poster || seasonArt.backdrop || '' },
    { label: 'Show', src: showArt.poster || showArt.backdrop || showArt.logo || artwork(ep.show) }
  ].filter(item => item.src);
  return items.map(item => `
    <button class="detailArtTile js-lightbox-img" data-lightbox-src="${esc(item.src)}" data-lightbox-title="${esc(ep.show)} ${esc(item.label)} artwork" type="button">
      <img src="${esc(item.src)}" alt="${esc(item.label)} artwork" loading="lazy">
      <span>${esc(item.label)}</span>
    </button>`).join('');
}

function openEpisodeDetail(ep) {
  const overlay = document.getElementById('episodeModalOverlay');
  if (!overlay) return;
  if (values.actor) {
    const castKeys = getEpisodeCast(ep).map(actor => normText(actor.name));
    if (!castKeys.includes(values.actor)) {
      const rec = actorIndex.get(values.actor);
      const showMatch = rec && rec.shows && rec.shows.has(ep.show);
      if (!showMatch) return false;
    }
  }
  const st = getStatus(ep);
  const t = theme(ep.show);
  const cast = getEpisodeCast(ep);
  const castHtml = cast.length ? cast.slice(0, 24).map(actor => `
    <span class="castPill"><strong>${esc(actor.name)}</strong>${actor.character ? `<small>${esc(actor.character)}</small>` : ''}</span>`).join('') : '<p class="mutedText">No cast data for this episode yet. Run the cast/artwork fetcher to populate actor data.</p>';
  overlay.innerHTML = `
    <div class="episodeDetail" style="--showColor:${esc(t.primary)}">
      <button class="episodeDetailClose" type="button" aria-label="Close episode details">×</button>
      <div class="episodeDetailHero">
        <img class="episodeDetailBackdrop js-lightbox-img" src="${esc(episodeArtwork(ep))}" data-lightbox-src="${esc(episodeArtwork(ep))}" data-lightbox-title="${esc(ep.show)} ${esc(ep.code)}${ep.title ? ' — ' + esc(ep.title) : ''}" alt="${esc(ep.show)} artwork">
        <div class="episodeDetailInfo">
          <span class="detailKicker">${esc(ep.franchise || ep.era || 'Wolf Universe')} • ${esc(ep.scope || 'guide')}</span>
          <h2>${esc(ep.show)} ${esc(ep.code)}${ep.title ? ` — ${esc(ep.title)}` : ''}</h2>
          <div class="heroMeta"><span class="metaPill">${esc(ep.airDate || 'No date')}</span><span class="metaPill">${esc(episodeLabel(ep))}</span><span class="metaPill">${esc(st)}</span></div>
          ${(ep.connection || ep.notes) ? `<div class="crossover">${esc(ep.connection || ep.notes)}</div>` : ''}
          ${ep.overview ? `<p class="detailOverview">${esc(ep.overview)}</p>` : '<p class="detailOverview mutedText">No summary available yet.</p>'}
        </div>
      </div>
      <div class="detailGrid">
        <section><h3>Artwork</h3><div class="detailArtGrid">${showArtworkGallery(ep)}</div></section>
        <section><h3>Cast</h3><div class="castGrid">${castHtml}</div></section>
      </div>
    </div>`;
  overlay.classList.add('show');
  overlay.querySelector('.episodeDetailClose')?.addEventListener('click', closeEpisodeDetail);
}

function closeEpisodeDetail() {
  const overlay = document.getElementById('episodeModalOverlay');
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.innerHTML = '';
}

function normalizeEpisodes() {
  episodes = episodes
    .filter(Boolean)
    .map((ep, index) => {
      const normalized = {
        ...ep,
        id: ep.id || `${ep.show || 'unknown'}-${ep.season ?? 0}-${ep.episode ?? index + 1}`,
        order: Number(ep.order) || index + 1,
        show: ep.show || 'Unknown Show',
        season: ep.season ?? '',
        episode: ep.episode ?? '',
        code: ep.code || buildCode(ep),
        title: ep.title || '',
        airDate: ep.airDate || ep.air_date || '',
        notes: ep.notes || '',
        era: ep.era || ep.franchise || '',
        franchise: ep.franchise || ep.era || 'Wolf Universe',
        sourceWatch: ep.sourceWatch || ep.source_watch || '',
        overview: ep.overview || '',
        connection: ep.connection || '',
        isSpecial: Boolean(ep.isSpecial || Number(ep.season) === 0),
        isMovie: Boolean(ep.isMovie)
      };
      normalized.scope = inferEpisodeScope(normalized);
      return normalized;
    })
    .sort((a, b) => {
      const ad = a.airDate || '9999-12-31';
      const bd = b.airDate || '9999-12-31';
      if (ad !== bd) return ad.localeCompare(bd);
      return (Number(a.order) || 0) - (Number(b.order) || 0);
    });

  episodes.forEach((ep, idx) => {
    ep.order = idx + 1;
  });

  rebuildEpisodeIndexes();
  rebuildActorIndex();
}

function getGuideScope() {
  const el = document.getElementById('scopeFilter');
  return el?.value || localStorage.getItem(SCOPE_KEY) || 'connected';
}

function setGuideScope(value) {
  const scope = GUIDE_SCOPES[value] ? value : 'connected';
  localStorage.setItem(SCOPE_KEY, scope);
  const el = document.getElementById('scopeFilter');
  if (el) el.value = scope;
}

function inScope(ep, scope = getGuideScope()) {
  const s = ep.scope || inferEpisodeScope(ep);
  if (scope === 'core') return s === 'core';
  if (scope === 'connected') return s === 'core' || s === 'connected';
  if (scope === 'adjacent') return s === 'adjacent';
  return true;
}

function getBaseScopedEpisodes() {
  const scope = getGuideScope();
  return episodes.filter(ep => inScope(ep, scope));
}

function getFilterValues() {
  return {
    search: (document.getElementById('searchBox')?.value || '').toLowerCase().trim(),
    show: document.getElementById('showFilter')?.value || '',
    franchise: document.getElementById('franchiseFilter')?.value || '',
    actor: document.getElementById('actorFilter')?.value || '',
    season: document.getElementById('seasonFilter')?.value || '',
    status: document.getElementById('statusFilter')?.value || 'unwatched',
    hideWatched: Boolean(document.getElementById('hideWatched')?.checked)
  };
}

function matchesNonShowFilters(ep, values = getFilterValues()) {
  if (values.franchise && String(ep.franchise || ep.era) !== values.franchise) return false;
  if (values.season && String(ep.season) !== String(values.season)) return false;
  if (values.search) {
    const haystack = `${ep.title} ${ep.show} ${ep.notes} ${ep.code} ${ep.airDate} ${ep.overview} ${ep.connection}`.toLowerCase();
    if (!haystack.includes(values.search)) return false;
  }
  const st = getStatus(ep);
  if (values.status === 'unwatched' && st === 'Watched') return false;
  if (values.status === 'watched' && st !== 'Watched') return false;
  if (values.status === 'watching' && st !== 'Watching') return false;
  if (values.status === 'skipped' && st !== 'Skipped') return false;
  if (values.hideWatched && values.status !== 'watched' && st === 'Watched') return false;
  return true;
}

function matches(ep) {
  const values = getFilterValues();
  if (values.show && ep.show !== values.show) return false;
  return matchesNonShowFilters(ep, values);
}

function uniqueValues(items, getter) {
  return [...new Set(items.map(getter).filter(v => v !== '' && v !== null && v !== undefined))]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
}

function uniqueSeasons(items) {
  return uniqueValues(items, ep => ep.season).sort((a, b) => Number(a) - Number(b));
}

function fillSelect(select, values, placeholder, currentValue = '') {
  if (!select) return;
  select.innerHTML = '';
  select.add(new Option(placeholder, ''));
  values.forEach(v => select.add(new Option(String(v), String(v))));
  if (currentValue && values.map(String).includes(String(currentValue))) select.value = currentValue;
}

function initOptions() {
  normalizeEpisodes();

  const scopeFilter = document.getElementById('scopeFilter');
  if (scopeFilter) {
    scopeFilter.innerHTML = '';
    Object.entries(GUIDE_SCOPES).forEach(([key, label]) => scopeFilter.add(new Option(label, key)));
    setGuideScope(localStorage.getItem(SCOPE_KEY) || 'connected');
  }

  refreshDynamicFilters();
}

function refreshDynamicFilters({ keepShow = true, keepSeason = true, keepFranchise = true, keepActor = true } = {}) {
  scopedEpisodes = getBaseScopedEpisodes();

  const showFilter = document.getElementById('showFilter');
  const franchiseFilter = document.getElementById('franchiseFilter');
  const seasonFilter = document.getElementById('seasonFilter');
  const actorFilter = document.getElementById('actorFilter');
  const bulkShow = document.getElementById('bulkShow');
  const bulkSeason = document.getElementById('bulkSeason');

  const prevShow = keepShow ? showFilter?.value || '' : '';
  const prevSeason = keepSeason ? seasonFilter?.value || '' : '';
  const prevFranchise = keepFranchise ? franchiseFilter?.value || '' : '';
  const prevActor = keepActor ? actorFilter?.value || '' : '';

  const franchises = uniqueValues(scopedEpisodes, ep => ep.franchise || ep.era || 'Wolf Universe');
  fillSelect(franchiseFilter, franchises, 'All franchises', prevFranchise);

  const afterFranchise = scopedEpisodes.filter(ep => !franchiseFilter?.value || String(ep.franchise || ep.era) === franchiseFilter.value);
  const shows = uniqueValues(afterFranchise, ep => ep.show);
  fillSelect(showFilter, shows, 'All shows', prevShow);

  const afterShow = afterFranchise.filter(ep => !showFilter?.value || ep.show === showFilter.value);
  fillSelect(seasonFilter, uniqueSeasons(afterShow), 'All seasons', prevSeason);

  if (actorFilter) {
    const actorOptions = [...actorIndex.entries()]
      .map(([key, rec]) => ({ key, ...rec }))
      .filter(rec => rec.count >= 10)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(rec => ({ value: rec.key, label: actorDisplay(rec) }));
    actorFilter.innerHTML = '';
    actorFilter.add(new Option(actorOptions.length ? 'All regular actors' : 'No actor data yet', ''));
    actorOptions.forEach(rec => actorFilter.add(new Option(rec.label, rec.value)));
    if (prevActor && actorOptions.some(rec => rec.value === prevActor)) actorFilter.value = prevActor;
  }

  if (bulkShow) {
    const bulkPrev = bulkShow.value;
    bulkShow.innerHTML = '';
    shows.forEach(show => bulkShow.add(new Option(show, show)));
    if (bulkPrev && shows.includes(bulkPrev)) bulkShow.value = bulkPrev;
  }

  if (bulkSeason) {
    const bulkSelectedShow = bulkShow?.value || shows[0] || '';
    const seasons = uniqueSeasons(scopedEpisodes.filter(ep => ep.show === bulkSelectedShow));
    bulkSeason.innerHTML = '';
    seasons.forEach(season => bulkSeason.add(new Option(`Season ${season}`, season)));
  }
}

function render() {
  scopedEpisodes = getBaseScopedEpisodes();
  const values = getFilterValues();
  const total = scopedEpisodes.length;
  const watched = scopedEpisodes.filter(e => getStatus(e) === 'Watched').length;
  const percent = pct(watched, total);

  setText('totalCount', total);
  setText('watchedCount', watched);
  setText('remainingCount', total - watched);
  setText('progressPct', `${percent}%`);
  const bar = document.getElementById('progressBar');
  if (bar) bar.style.width = `${percent}%`;

  const next = scopedEpisodes.find(e => getStatus(e) !== 'Watched');
  renderNext(next);

  current = scopedEpisodes.filter(matches);
  renderedCount = Math.min(PAGE_SIZE, current.length);
  renderShowStrip(values);
  renderScopeSummary();
  renderList();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderNext(next) {
  const nextTitle = document.getElementById('nextTitle');
  const nextMeta = document.getElementById('nextMeta');
  const nextNotes = document.getElementById('nextNotes');
  const heroCard = document.getElementById('heroCard');
  const poster = document.getElementById('nextPoster');

  if (!next) {
    nextTitle.textContent = 'Everything is watched';
    nextMeta.innerHTML = '<span class="metaPill">Your Wolf Universe tracker is complete for this scope.</span>';
    nextNotes.textContent = '';
    setImageSafe(poster, artwork('Law & Order'), 'Law & Order');
    return;
  }

  const t = theme(next.show);
  nextTitle.textContent = `${next.show} ${next.code}${next.title ? ' — ' + next.title : ''}`;
  nextMeta.innerHTML = `<span class="metaPill">#${esc(next.order)}</span><span class="metaPill">${esc(next.airDate || 'No air date')}</span><span class="metaPill">${episodeLabel(next)}</span>`;
  nextNotes.textContent = next.connection || next.notes || next.overview || '';
  heroCard.style.setProperty('--showColor', t.primary);
  const src = episodeArtwork(next);
  setImageSafe(poster, src, next.show);
  poster.dataset.lightboxSrc = src;
  poster.dataset.lightboxTitle = `${next.show} ${next.code}${next.title ? ' — ' + next.title : ''}`;
}

function episodeLabel(ep) {
  if (ep.isMovie) return 'Movie / Special';
  if (Number(ep.season) === 0 || ep.isSpecial) return `Special ${ep.episode}`;
  return `Season ${ep.season}, Episode ${ep.episode}`;
}

function renderShowStrip(values = getFilterValues()) {
  const strip = document.getElementById('showStrip');
  if (!strip) return;

  // Show rail uses the active scope/search/franchise/season/actor, but counts all statuses so watched totals remain visible.
  const railValues = { ...values, show: '', status: 'all', hideWatched: false };
  const railSource = scopedEpisodes.filter(ep => {
    if (railValues.franchise && String(ep.franchise || ep.era) !== railValues.franchise) return false;
    if (railValues.season && String(ep.season) !== String(railValues.season)) return false;
    if (railValues.actor) {
      const castKeys = getEpisodeCast(ep).map(actor => normText(actor.name));
      if (!castKeys.includes(railValues.actor)) return false;
    }
    if (railValues.search) {
      const haystack = `${ep.title} ${ep.show} ${ep.notes} ${ep.code} ${ep.airDate} ${ep.overview} ${ep.connection}`.toLowerCase();
      if (!haystack.includes(railValues.search)) return false;
    }
    return true;
  });
  const byShow = new Map();
  for (const ep of railSource) {
    if (!byShow.has(ep.show)) byShow.set(ep.show, { total: 0, watched: 0, color: theme(ep.show).primary });
    const rec = byShow.get(ep.show);
    rec.total += 1;
    if (getStatus(ep) === 'Watched') rec.watched += 1;
  }

  const entries = showSortEntries([...byShow.entries()], scopedEpisodes);
  if (!entries.length) {
    strip.innerHTML = '<span class="showStripEmpty">No shows available in this scope/filter.</span>';
    return;
  }

  strip.innerHTML = entries.map(([show, rec]) => `
    <button class="showChip" data-show="${esc(show)}" style="--showColor:${esc(rec.color)}">
      <span class="dot" style="background:${esc(rec.color)}"></span>
      <span class="showChipTitle">${esc(show)}</span>
      <small><b>${esc(showYear(show, scopedEpisodes))}</b> · ${rec.watched}/${rec.total}</small>
    </button>`).join('');

  strip.querySelectorAll('.showChip').forEach(button => {
    button.addEventListener('click', () => {
      const showFilter = document.getElementById('showFilter');
      showFilter.value = button.dataset.show;
      refreshDynamicFilters({ keepShow: true, keepSeason: false, keepFranchise: true, keepActor: true });
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function renderScopeSummary() {
  const el = document.getElementById('scopeSummary');
  if (!el) return;

  const scope = getGuideScope();
  const byShow = new Map();
  for (const ep of scopedEpisodes) {
    if (!byShow.has(ep.show)) byShow.set(ep.show, { total: 0, watched: 0, color: theme(ep.show).primary });
    const rec = byShow.get(ep.show);
    rec.total += 1;
    if (getStatus(ep) === 'Watched') rec.watched += 1;
  }

  const entries = showSortEntries([...byShow.entries()], scopedEpisodes);
  el.innerHTML = `
    <div class="scopeHeader">
      <div><strong>${esc(GUIDE_SCOPES[scope])}</strong><span>${scopedEpisodes.length}/${episodes.length} entries</span></div>
    </div>
    <div class="scopeMiniRail">
      ${entries.map(([show, rec]) => `
        <button class="scopeMiniChip" data-show="${esc(show)}" style="--showColor:${esc(rec.color)}">
          <span>${esc(show)}</span>
          <small>${esc(showYear(show, scopedEpisodes))} · ${rec.watched}/${rec.total}</small>
        </button>`).join('')}
    </div>`;

  el.querySelectorAll('.scopeMiniChip').forEach(button => {
    button.addEventListener('click', () => {
      document.getElementById('showFilter').value = button.dataset.show;
      refreshDynamicFilters({ keepShow: true, keepSeason: false, keepFranchise: true, keepActor: true });
      render();
    });
  });
}

function renderList() {
  const list = document.getElementById('episodeList');
  if (!list) return;

  if (!current.length) {
    list.innerHTML = '<div class="card emptyState"><h2>No episodes match these filters</h2><p>Try another guide scope, clear search, or disable Hide watched.</p></div>';
    return;
  }

  const rows = current.slice(0, renderedCount).map(epCard).join('');
  const more = current.length > renderedCount
    ? `<button class="loadMore" id="loadMoreBtn">Load ${Math.min(PAGE_SIZE, current.length - renderedCount)} more (${current.length - renderedCount} remaining)</button>`
    : '';
  list.innerHTML = rows + more;

  const loadMore = document.getElementById('loadMoreBtn');
  if (loadMore) {
    loadMore.addEventListener('click', () => {
      renderedCount = Math.min(renderedCount + PAGE_SIZE, current.length);
      renderList();
    });
  }
}

function epCard(ep) {
  const st = getStatus(ep);
  const statuses = ['Not Started', 'Watching', 'Watched', 'Skipped'];
  const t = theme(ep.show);
  const accent = esc(t.primary);
  const title = ep.title ? ` — ${esc(ep.title)}` : '';
  const source = ep.sourceWatch ? `<span class="pill">Watch #${esc(ep.sourceWatch)}</span>` : '';
  const notesText = ep.connection || ep.notes || '';
  const notes = notesText ? `<div class="crossover">${esc(notesText)}</div>` : '';
  const scopePill = ep.scope ? `<span class="pill">${esc(GUIDE_SCOPES[ep.scope] || ep.scope)}</span>` : '';
  const imgSrc = episodeArtwork(ep);

  return `
    <article class="ep ${st === 'Watched' ? 'watched' : ''}" style="--showColor:${accent}" id="ep-${safeId(ep.order)}" data-episode-id="${esc(ep.id)}">
      <div class="order">#${esc(ep.order)}</div>
      <img class="epArt js-lightbox-img" src="${esc(imgSrc)}" data-lightbox-src="${esc(imgSrc)}" data-lightbox-title="${esc(ep.show)} ${esc(ep.code)}${title}" alt="${esc(ep.show)} artwork" loading="lazy" onerror="this.src='${esc(artwork(ep.show))}'">
      <div class="epMain">
        <h3>${esc(ep.show)} ${esc(ep.code)}${title}</h3>
        <div class="meta">${esc(ep.airDate || 'No date')} • ${esc(episodeLabel(ep))} • <strong>${esc(st)}</strong></div>
        <span class="pill">${esc(ep.franchise || ep.era || 'Wolf Universe')}</span>${scopePill}${source}${notes}
        ${ep.overview ? `<p class="overview">${esc(ep.overview)}</p>` : ''}
      </div>
      <div class="statusBtns">
        ${statuses.map(status => `<button class="${st === status ? 'active' : ''}" data-id="${encodeURIComponent(ep.id)}" data-status="${esc(status)}">${status.replace('Not Started', 'Todo')}</button>`).join('')}
      </div>
    </article>`;
}

function setStatusById(encodedId, status) {
  const ep = episodes.find(e => encodeURIComponent(e.id) === encodedId);
  if (ep) setStatus(ep, status);
}

async function markBulk(scope, status) {
  const show = document.getElementById('bulkShow').value;
  const season = document.getElementById('bulkSeason').value;
  const targets = scopedEpisodes.filter(ep => ep.show === show && (scope === 'show' || String(ep.season) === String(season)));
  const label = scope === 'show' ? `${show}` : `${show} Season ${season}`;
  const ok = await showModal({
    title: status === 'Watched' ? 'Mark as watched?' : 'Mark as unwatched?',
    message: `${label}: this will update ${targets.length} entries to ${status === 'Watched' ? 'Watched' : 'Not Started'}.`,
    type: status === 'Watched' ? 'success' : 'warning',
    confirmText: status === 'Watched' ? 'Yes, update' : 'Yes, reset',
    cancelText: 'Cancel',
    danger: status !== 'Watched'
  });
  if (!ok) return;

  let changed = 0;
  targets.forEach(ep => {
    if (statusMap[ep.id] !== status) changed++;
    statusMap[ep.id] = status;
    statusMap[episodeKey(ep)] = status;
  });
  save();
  render();
  setText('syncStatus', `${changed} episode statuses updated.`);
  showToast('Bulk update complete', `${changed} entries updated for ${label}.`, 'success');
}

function exportJson() {
  const payload = {
    version: 4,
    exportedAt: new Date().toISOString(),
    statuses: statusMap
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'wolf_universe_watch_status.json');
  showToast('Export ready', 'Status JSON downloaded.', 'success');
}

function exportCsv() {
  const rows = [['Order', 'Scope', 'Status', 'Air Date', 'Show', 'Franchise', 'Season', 'Episode', 'Code', 'Title', 'Notes', 'Overview']];
  current.forEach(ep => rows.push([ep.order, ep.scope, getStatus(ep), ep.airDate, ep.show, ep.franchise, ep.season, ep.episode, ep.code, ep.title, ep.notes || ep.connection, ep.overview]));
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'wolf_universe_current_view.csv');
  showToast('Export ready', 'Current view CSV downloaded.', 'success');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importStatusPayload(payload, source = 'import') {
  const incoming = payload.statuses || payload || {};
  let changed = 0;
  let matched = 0;

  function applyToEpisode(ep, status) {
    if (!ep || !status) return;
    matched++;
    if (statusMap[ep.id] !== status) {
      statusMap[ep.id] = status;
      changed++;
    }
    const noOrder = episodeKey(ep);
    if (statusMap[noOrder] !== status) statusMap[noOrder] = status;
  }

  if (Array.isArray(payload.episodes)) {
    for (const item of payload.episodes) {
      const status = normalizeStatus(item.status);
      const key = `${normShow(item.show)}|${normNum(item.season)}|${normNum(item.episode)}`;
      const eps = episodesByNoOrderKey.get(key) || [];
      eps.forEach(ep => applyToEpisode(ep, status));
    }
  }

  for (const [rawId, rawValue] of Object.entries(incoming)) {
    const status = normalizeStatus(rawValue);
    if (!status) continue;

    const exact = episodeByExactId.get(String(rawId));
    if (exact) {
      applyToEpisode(exact, status);
      continue;
    }

    const parts = String(rawId).split('|');
    if (parts.length >= 3) {
      const key = `${normShow(parts[0])}|${normNum(parts[1])}|${normNum(parts[2])}`;
      const eps = episodesByNoOrderKey.get(key) || [];
      if (eps.length) {
        eps.forEach(ep => applyToEpisode(ep, status));
        continue;
      }
    }

    if (statusMap[rawId] !== status) {
      statusMap[rawId] = status;
      changed++;
    }
  }

  if (changed) save();
  render();
  setText('syncStatus', `${source}: ${changed} status changes applied, ${matched} guide rows matched at ${new Date().toLocaleTimeString()}.`);
  showToast(source, `${changed} changes applied. ${matched} guide rows matched.`, changed ? 'success' : 'info');
}

async function fetchHostedStatus() {
  if (window.location.protocol === 'file:') {
    setText('syncStatus', 'Auto-sync needs a local server, GitHub Pages, or Vercel. For local testing run the local server and use Pull latest.');
    return;
  }

  try {
    const statusUrl = new URL('data/watched_status.json?ts=' + Date.now(), window.location.href);
    const response = await fetch(statusUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`status file returned HTTP ${response.status}`);
    await importStatusPayload(await response.json(), 'Auto-sync');
  } catch (err) {
    setText('syncStatus', `Auto-sync checked: ${err.message}. Run the Python sync script or upload watched_status.json to data/.`);
    showToast('Sync warning', err.message, 'warning');
  }
}

async function triggerCloudSync() {
  if (window.location.protocol === 'file:') {
    await showModal({
      title: 'Cloud sync unavailable locally',
      message: 'Open this through local_tracker_server.py or Vercel. The static file view cannot run sync.',
      type: 'warning',
      confirmText: 'OK'
    });
    return;
  }

  const ok = await showModal({
    title: 'Sync with Trakt now?',
    message: 'This starts the local/Vercel sync endpoint. Wait for it to finish, then Pull latest if needed.',
    type: 'info',
    confirmText: 'Start sync',
    cancelText: 'Cancel'
  });
  if (!ok) return;

  const btn = document.getElementById('syncNowBtn');
  const previousText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Syncing…';
  }
  setText('syncStatus', 'Starting Trakt sync…');

  try {
    const response = await fetch('/api/trigger-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'wolf-universe-tracker', ts: Date.now() })
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    setText('syncStatus', payload.message || 'Sync started. Pull latest after it finishes.');
    showToast('Sync started', payload.message || 'Trakt sync is running.', 'success');
    window.setTimeout(fetchHostedStatus, 5000);
    window.setTimeout(fetchHostedStatus, 20000);
    window.setTimeout(fetchHostedStatus, 60000);
  } catch (err) {
    setText('syncStatus', `Cloud sync failed: ${err.message}`);
    showToast('Cloud sync failed', err.message, 'danger');
    await showModal({
      title: 'Could not start sync',
      message: `${err.message}`,
      type: 'danger',
      confirmText: 'OK'
    });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = previousText || 'Sync with Trakt';
    }
  }
}

function setAutoSync(enabled) {
  localStorage.setItem(AUTOSYNC_KEY, enabled ? '1' : '0');
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
  if (enabled) {
    fetchHostedStatus();
    autoTimer = setInterval(fetchHostedStatus, 5 * 60 * 1000);
  }
}

function bindEvents() {
  ['searchBox', 'showFilter', 'franchiseFilter', 'actorFilter', 'seasonFilter', 'statusFilter', 'hideWatched', 'scopeFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const handler = () => {
      if (id === 'scopeFilter') {
        setGuideScope(el.value);
        refreshDynamicFilters({ keepShow: false, keepSeason: false, keepFranchise: false, keepActor: true });
      } else if (id === 'franchiseFilter') {
        refreshDynamicFilters({ keepShow: false, keepSeason: false, keepFranchise: true, keepActor: true });
      } else if (id === 'showFilter') {
        refreshDynamicFilters({ keepShow: true, keepSeason: false, keepFranchise: true, keepActor: true });
      }
      scheduleRender();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });

  const list = document.getElementById('episodeList');
  if (list) {
    list.addEventListener('click', event => {
      const image = event.target.closest('.js-lightbox-img');
      if (image) {
        openImageLightbox(image.dataset.lightboxSrc || image.src, image.dataset.lightboxTitle || image.alt || 'Artwork');
        return;
      }
      const button = event.target.closest('button[data-id][data-status]');
      if (button) {
        setStatusById(button.dataset.id, button.dataset.status);
        return;
      }
      const card = event.target.closest('.ep[data-episode-id]');
      if (card) {
        const ep = episodes.find(item => String(item.id) === card.dataset.episodeId);
        if (ep) openEpisodeDetail(ep);
      }
    });
  }

  const nextPoster = document.getElementById('nextPoster');
  if (nextPoster) {
    nextPoster.addEventListener('click', () => openImageLightbox(nextPoster.dataset.lightboxSrc || nextPoster.src, nextPoster.dataset.lightboxTitle || 'Artwork'));
  }

  const episodeOverlay = document.getElementById('episodeModalOverlay');
  if (episodeOverlay) {
    episodeOverlay.addEventListener('click', ev => {
      const image = ev.target.closest('.js-lightbox-img');
      if (image) {
        openImageLightbox(image.dataset.lightboxSrc || image.src, image.dataset.lightboxTitle || image.alt || 'Artwork');
        return;
      }
      if (ev.target === episodeOverlay) closeEpisodeDetail();
    });
  }

  const lightbox = document.getElementById('lightboxOverlay');
  if (lightbox) {
    lightbox.addEventListener('click', ev => {
      if (ev.target === lightbox) closeLightbox();
    });
  }
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { closeLightbox(); closeEpisodeDetail(); }
  });

  const bulkShow = document.getElementById('bulkShow');
  if (bulkShow) {
    bulkShow.addEventListener('change', () => refreshDynamicFilters({ keepShow: true, keepSeason: false, keepFranchise: true }));
  }
  document.getElementById('markSeasonWatched')?.addEventListener('click', () => markBulk('season', 'Watched'));
  document.getElementById('markSeasonUnwatched')?.addEventListener('click', () => markBulk('season', 'Not Started'));
  document.getElementById('markShowWatched')?.addEventListener('click', () => markBulk('show', 'Watched'));

  document.getElementById('markNextWatched')?.addEventListener('click', async () => {
    const next = scopedEpisodes.find(e => getStatus(e) !== 'Watched');
    if (!next) return showToast('Nothing to mark', 'All entries are already watched in this scope.', 'info');
    const ok = await showModal({
      title: 'Mark next entry watched?',
      message: `${next.show} ${next.code}${next.title ? ' — ' + next.title : ''}`,
      type: 'success',
      confirmText: 'Mark watched',
      cancelText: 'Cancel'
    });
    if (ok) setStatus(next, 'Watched');
  });

  const jump = () => {
    const next = scopedEpisodes.find(e => getStatus(e) !== 'Watched');
    if (!next) return;
    document.getElementById('statusFilter').value = 'unwatched';
    document.getElementById('hideWatched').checked = true;
    render();
    setTimeout(() => document.getElementById(`ep-${safeId(next.order)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  document.getElementById('jumpNext')?.addEventListener('click', jump);
  document.getElementById('bottomNext')?.addEventListener('click', jump);

  document.getElementById('syncNowBtn')?.addEventListener('click', triggerCloudSync);
  document.getElementById('pullStatusBtn')?.addEventListener('click', fetchHostedStatus);
  document.getElementById('exportJson')?.addEventListener('click', exportJson);
  document.getElementById('exportCsv')?.addEventListener('click', exportCsv);

  document.getElementById('resetFilters')?.addEventListener('click', () => {
    document.getElementById('searchBox').value = '';
    document.getElementById('showFilter').value = '';
    document.getElementById('franchiseFilter').value = '';
    if (document.getElementById('actorFilter')) document.getElementById('actorFilter').value = '';
    document.getElementById('seasonFilter').value = '';
    document.getElementById('statusFilter').value = 'unwatched';
    document.getElementById('hideWatched').checked = true;
    refreshDynamicFilters({ keepShow: false, keepSeason: false, keepFranchise: false, keepActor: true });
    render();
    showToast('Filters reset', 'Showing unwatched entries again.', 'info');
  });

  document.querySelectorAll('.bottomNav button[data-status]').forEach(button => {
    button.addEventListener('click', () => {
      document.getElementById('statusFilter').value = button.dataset.status;
      document.getElementById('hideWatched').checked = button.dataset.status !== 'watched';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  document.getElementById('themeBtn')?.addEventListener('click', () => {
    document.body.classList.toggle('light');
    localStorage.setItem(THEME_KEY, document.body.classList.contains('light') ? 'light' : 'dark');
  });

  document.getElementById('importJson')?.addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await importStatusPayload(JSON.parse(await file.text()), 'Manual import');
    } catch (err) {
      showModal({ title: 'Import failed', message: err.message, type: 'error', confirmText: 'OK' });
    } finally {
      event.target.value = '';
    }
  });

  document.getElementById('installBtn')?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt = null;
    } else {
      showModal({ title: 'Install app', message: 'On mobile, open the browser menu and choose Add to Home Screen / Install app.', type: 'info', confirmText: 'OK' });
    }
  });

  const autoSync = document.getElementById('autoSync');
  if (autoSync) {
    autoSync.checked = localStorage.getItem(AUTOSYNC_KEY) !== '0';
    autoSync.addEventListener('change', event => setAutoSync(event.target.checked));
    setAutoSync(autoSync.checked);
  }
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem(THEME_KEY) === 'light') document.body.classList.add('light');
  if (!episodes.length) {
    setText('syncStatus', 'Episode data did not load. Make sure data/episodes.js is next to index.html.');
  }
  initOptions();
  bindEvents();
  render();
});
