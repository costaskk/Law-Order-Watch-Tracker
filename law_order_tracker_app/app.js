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
const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour; avoids scroll-disrupting constant refreshes
const PERSONAL_AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour Trakt/Supabase background sync

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
let actorDetailShowCache = new Map();
let episodeCastCache = new Map();
let episodeCastKeyCache = new Map();
let actorEpisodeCreditsCache = new Map();
let renderQueued = false;
let renderQueuedPreserveScroll = false;
let syncPollTimer = null;
let syncPollDeadline = 0;
let syncPollStartedAt = 0;
let syncBaselineSignature = '';
let lastHostedStatusSignature = '';
let lastHostedStatusFetchedAt = 0;

let traktUser = null;
let traktStatusLoadInProgress = false;
let currentNextEpisode = null;
let personalAutoSyncTimer = null;
let personalSyncInProgress = false;

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
  // Supabase/Trakt imports should normally be plain strings, but older
  // debug/status payloads may contain objects like { status: 'Watched' }.
  // Normalize those too so the UI never ignores a valid watched value.
  if (value && typeof value === 'object') {
    value = value.status ?? value.value ?? value.state ?? value.progress ?? value.watch_status ?? '';
  }
  const v = String(value ?? '').trim().toLowerCase();
  if (['watched', 'complete', 'completed', 'yes', 'true', '1'].includes(v)) return 'Watched';
  if (['watching', 'in progress', 'started'].includes(v)) return 'Watching';
  if (['skipped', 'skip'].includes(v)) return 'Skipped';
  if (['not started', 'todo', 'unwatched', 'false', '0', ''].includes(v)) return 'Not Started';
  return ['Not Started', 'Watching', 'Watched', 'Skipped'].includes(value) ? value : null;
}

function statusRank(status) {
  return ({ 'Watched': 4, 'Watching': 3, 'Skipped': 2, 'Not Started': 1 })[normalizeStatus(status)] || 0;
}

function statusFromMap(ep) {
  const byId = normalizeStatus(statusMap[ep.id]);
  const byKey = normalizeStatus(statusMap[episodeKey(ep)]);

  // Prefer the strongest imported status. This fixes the remaining double-click
  // symptom when an old local exact-id value such as "Not Started" shadows the
  // freshly imported no-order key "Watched" from Supabase/Trakt.
  if (byId && byKey) return statusRank(byKey) > statusRank(byId) ? byKey : byId;
  return byId || byKey || null;
}

function getStatus(ep) {
  return statusFromMap(ep) || normalizeStatus(ep.status) || 'Not Started';
}

function setStatus(ep, status, silent = false) {
  const previous = getStatus(ep);
  statusMap[ep.id] = status;
  statusMap[episodeKey(ep)] = status;
  save();
  renderPreservingScroll();
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
  const cacheId = String(ep?.id || `${ep?.show || ''}|${ep?.season || ''}|${ep?.episode || ''}`);
  if (episodeCastCache.has(cacheId)) return episodeCastCache.get(cacheId);
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
  episodeCastCache.set(cacheId, out);
  return out;
}

function episodeCastKeys(ep) {
  const cacheId = String(ep?.id || `${ep?.show || ''}|${ep?.season || ''}|${ep?.episode || ''}`);
  if (episodeCastKeyCache.has(cacheId)) return episodeCastKeyCache.get(cacheId);
  const keys = getEpisodeCast(ep).map(actor => normText(actor.name)).filter(Boolean);
  episodeCastKeyCache.set(cacheId, keys);
  return keys;
}


function actorProfileImage(actorOrName) {
  const name = typeof actorOrName === 'string' ? actorOrName : actorOrName?.name;
  const direct = typeof actorOrName === 'object' ? (actorOrName.profile || actorOrName.profile_path || actorOrName.image || actorOrName.headshot || '') : '';
  const rec = actorIndex.get(normText(name)) || null;
  let src = direct || rec?.profile || '';
  if (!src) return '';
  src = String(src).trim();
  if (!src) return '';
  if (src.startsWith('//')) return `https:${src}`;
  if (/^https?:\/\//i.test(src) || src.startsWith('data:')) return src;
  if (src.startsWith('/')) return `https://image.tmdb.org/t/p/w185${src}`;
  return src;
}

function actorEpisodeCredits(actorKey) {
  if (!actorKey) return [];
  if (actorEpisodeCreditsCache.has(actorKey)) return actorEpisodeCreditsCache.get(actorKey);
  const credits = episodes.filter(ep => episodeCastKeys(ep).includes(actorKey));
  actorEpisodeCreditsCache.set(actorKey, credits);
  return credits;
}

function actorCreditCount(actorName) {
  const key = normText(actorName);
  const aggregate = Number(actorIndex.get(key)?.count || 0);
  if (aggregate) return aggregate;
  const cached = actorEpisodeCreditsCache.get(key);
  return Array.isArray(cached) ? cached.length : 0;
}

function castPillHtml(actor) {
  const key = normText(actor.name);
  const profile = actorProfileImage(actor);
  const cachedCredits = actorEpisodeCreditsCache.get(key);
  const exactCount = Array.isArray(cachedCredits) ? cachedCredits.length : 0;
  const count = actorCreditCount(actor.name);
  const rec = actorIndex.get(key);
  const showCount = rec?.shows instanceof Set ? rec.shows.size : 0;
  const subtitle = actor.character || 'Cast member';
  const countLabel = exactCount
    ? `${exactCount} loaded episode${exactCount === 1 ? '' : 's'}`
    : (count ? `${count} credited episode${count === 1 ? '' : 's'}` : 'Filter appearances');
  const detailLabel = showCount ? `${countLabel} • ${showCount} show${showCount === 1 ? '' : 's'}` : countLabel;
  return `
    <button class="castPill" type="button" data-actor-key="${esc(key)}" data-actor-name="${esc(actor.name)}" data-actor-profile="${esc(profile)}" title="Show episodes featuring ${esc(actor.name)}">
      <span class="castPillName">${esc(actor.name)}</span>
      ${subtitle ? `<small>${esc(subtitle)}</small>` : ''}
      <em>${esc(detailLabel)}</em>
    </button>`;
}

let actorPortraitFloatingEl = null;

function ensureActorPortraitFloating() {
  if (actorPortraitFloatingEl && document.body.contains(actorPortraitFloatingEl)) return actorPortraitFloatingEl;
  actorPortraitFloatingEl = document.createElement('div');
  actorPortraitFloatingEl.className = 'actorPortraitFloating';
  actorPortraitFloatingEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(actorPortraitFloatingEl);
  return actorPortraitFloatingEl;
}

function hideActorPortraitFloating() {
  if (!actorPortraitFloatingEl) return;
  actorPortraitFloatingEl.classList.remove('show');
  actorPortraitFloatingEl.innerHTML = '';
}

function positionActorPortraitFloating(anchor) {
  if (!actorPortraitFloatingEl || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const width = 136;
  const height = 190;
  const margin = 14;
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  let top = rect.top - height - 12;
  if (top < margin) top = Math.min(window.innerHeight - height - margin, rect.bottom + 12);
  actorPortraitFloatingEl.style.left = `${left}px`;
  actorPortraitFloatingEl.style.top = `${top}px`;
}

function showActorPortraitFloating(button) {
  const src = button?.dataset?.actorProfile || '';
  if (!src) return hideActorPortraitFloating();
  const name = button.dataset.actorName || 'Actor';
  const el = ensureActorPortraitFloating();
  el.innerHTML = `<img src="${esc(src)}" alt="${esc(name)} portrait"><span>${esc(name)}</span>`;
  positionActorPortraitFloating(button);
  requestAnimationFrame(() => el.classList.add('show'));
}

function selectActorFromDetail(actorName) {
  const key = normText(actorName);
  if (!key) return;
  closeEpisodeDetail();

  const actorFilter = document.getElementById('actorFilter');
  if (actorFilter) {
    let option = [...actorFilter.options].find(opt => opt.value === key);
    if (!option) {
      const rec = actorIndex.get(key) || { name: actorName, count: actorCreditCount(actorName) };
      option = new Option(actorDisplay(rec), key);
      actorFilter.add(option, actorFilter.options.length > 1 ? actorFilter.options[1] : null);
    }
    actorFilter.value = key;
  }

  const showFilter = document.getElementById('showFilter');
  const seasonFilter = document.getElementById('seasonFilter');
  const statusFilter = document.getElementById('statusFilter');
  const hideWatched = document.getElementById('hideWatched');
  if (showFilter) showFilter.value = '';
  if (seasonFilter) seasonFilter.value = '';
  if (statusFilter) statusFilter.value = 'all';
  if (hideWatched) hideWatched.checked = false;

  refreshDynamicFilters({ keepShow: false, keepSeason: false, keepFranchise: true, keepActor: true });
  if (actorFilter) {
    if (![...actorFilter.options].some(opt => opt.value === key)) {
      const rec = actorIndex.get(key) || { name: actorName, count: actorCreditCount(actorName) };
      actorFilter.add(new Option(actorDisplay(rec), key), actorFilter.options.length > 1 ? actorFilter.options[1] : null);
    }
    actorFilter.value = key;
  }
  renderPreservingScroll();
  const count = actorCreditCount(actorName);
  setText('syncStatus', `Actor filter active: ${actorName}${count ? ` • ${count} credited episode${count === 1 ? '' : 's'}` : ''}.`);
  showToast('Actor filter applied', `Showing episodes featuring ${actorName}.`, 'info');
  requestAnimationFrame(() => {
    const target = document.getElementById('episodeList') || document.querySelector('.controls');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function actorHasExactCreditsInShow(actorKey, show) {
  if (!actorKey || !show) return false;
  const cacheKey = `${actorKey}|${show}`;
  if (actorDetailShowCache.has(cacheKey)) return actorDetailShowCache.get(cacheKey);
  const found = episodes.some(ep => ep.show === show && episodeCastKeys(ep).includes(actorKey));
  actorDetailShowCache.set(cacheKey, found);
  return found;
}

function actorMatchesEpisode(ep, actorKey) {
  if (!actorKey) return true;
  const castKeys = episodeCastKeys(ep);
  if (castKeys.includes(actorKey)) return true;

  const rec = actorIndex.get(actorKey);
  if (!rec || !rec.shows || !rec.shows.has(ep.show)) return false;

  // Fallback for aggregate-only actor data: if this actor has no exact episode
  // credits loaded for this show yet, show that show's rows instead of an empty view.
  if (!actorHasExactCreditsInShow(actorKey, ep.show)) return true;
  return false;
}

function rebuildActorIndex() {
  actorIndex = new Map();
  actorDetailShowCache = new Map();
  episodeCastCache = new Map();
  episodeCastKeyCache = new Map();
  actorEpisodeCreditsCache = new Map();

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

function scheduleRender(preserveScroll = false) {
  renderQueuedPreserveScroll = renderQueuedPreserveScroll || Boolean(preserveScroll);
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    const shouldPreserve = renderQueuedPreserveScroll;
    renderQueued = false;
    renderQueuedPreserveScroll = false;
    if (shouldPreserve) renderPreservingScroll();
    else render();
  });
}

function renderPreservingScroll() {
  const x = window.scrollX || window.pageXOffset || 0;
  const y = window.scrollY || window.pageYOffset || 0;
  render();
  requestAnimationFrame(() => window.scrollTo(x, y));
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
  const values = getFilterValues();
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
  const castHtml = cast.length ? cast.slice(0, 36).map(actor => castPillHtml(actor)).join('') : '<p class="mutedText">No cast data for this episode yet. Run the cast/artwork fetcher to populate actor data.</p>';
  overlay.innerHTML = `
    <div class="episodeDetail" style="--showColor:${esc(t.primary)}">
      <button class="episodeDetailClose" type="button" aria-label="Close episode details">×</button>
      <div class="episodeDetailHero">
        <img class="episodeDetailBackdrop js-lightbox-img" src="${esc(episodeArtwork(ep))}" data-lightbox-src="${esc(episodeArtwork(ep))}" data-lightbox-title="${esc(ep.show)} ${esc(ep.code)}${ep.title ? ' — ' + esc(ep.title) : ''}" alt="${esc(ep.show)} artwork">
        <div class="episodeDetailInfo">
          <span class="detailKicker">${esc(ep.franchise || ep.era || 'Wolf Universe')} • ${esc(ep.scope || 'guide')}</span>
          <h2>${esc(ep.show)} ${esc(ep.code)}${ep.title ? ` — ${esc(ep.title)}` : ''}</h2>
          <div class="heroMeta"><span class="metaPill">${esc(ep.airDate || 'No date')}</span><span class="metaPill">${esc(episodeLabel(ep))}</span><span class="metaPill">${esc(st)}</span></div>
          ${ratingsHtml(ep, 'detailRatings')}
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
  document.body.classList.add('episode-modal-open');
  const detail = overlay.querySelector('.episodeDetail');
  if (detail) {
    detail.addEventListener('scroll', hideActorPortraitFloating, { passive: true });
    detail.addEventListener('wheel', ev => ev.stopPropagation(), { passive: true });
    detail.addEventListener('touchmove', ev => ev.stopPropagation(), { passive: true });
  }
  const castGrid = overlay.querySelector('.castGrid');
  if (castGrid) {
    castGrid.addEventListener('scroll', hideActorPortraitFloating, { passive: true });
    castGrid.addEventListener('wheel', ev => ev.stopPropagation(), { passive: true });
    castGrid.addEventListener('touchmove', ev => ev.stopPropagation(), { passive: true });
  }
  overlay.querySelector('.episodeDetailClose')?.addEventListener('click', closeEpisodeDetail);
}

function closeEpisodeDetail() {
  hideActorPortraitFloating();
  document.body.classList.remove('episode-modal-open');
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
  if (values.actor && !actorMatchesEpisode(ep, values.actor)) return false;
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

  current = scopedEpisodes.filter(matches);
  renderedCount = Math.min(PAGE_SIZE, current.length);
  setText('currentViewCount', current.length);
  setText('progressDetail', `${watched}/${total} watched • ${total - watched} remaining • ${current.length} entries in current view`);

  // The hero should follow the active view. If the user filters by show,
  // actor, season, search, scope, or status, show the next unwatched item
  // from that filtered result set instead of from the whole scope.
  const next = current.find(e => getStatus(e) !== 'Watched');
  renderNext(next);

  renderShowStrip(values);
  renderScopeSummary();
  renderList();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}


function normalizeRatingValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '';
  return String(value).trim();
}

function getEpisodeRatings(ep = {}) {
  const ratings = [];
  const source = ep.ratings && typeof ep.ratings === 'object' ? ep.ratings : {};
  const add = (label, value, suffix = '') => {
    value = normalizeRatingValue(value);
    if (!value || value === 'N/A') return;
    ratings.push({ label, value: suffix && !String(value).includes(suffix) ? `${value}${suffix}` : value });
  };

  add('IMDb', source.imdb || source.imdbRating || ep.imdbRating || ep.imdb_rating);
  add('RT', source.rottenTomatoes || source.rotten_tomatoes || source.tomatoes || ep.rottenTomatoes || ep.rotten_tomatoes, '%');
  add('Metacritic', source.metacritic || ep.metacritic);
  add('Trakt', source.trakt || source.traktRating || ep.traktRating || ep.trakt_rating);
  add('TMDB', source.tmdb || source.tmdbRating || ep.tmdbRating || ep.voteAverage || ep.vote_average);
  add('TVDB', source.tvdb || source.tvdbRating || ep.tvdbRating);

  // OMDb stores ratings as an array such as [{Source:'Internet Movie Database', Value:'8.0/10'}]
  const arr = Array.isArray(source.omdbRatings) ? source.omdbRatings : (Array.isArray(ep.omdbRatings) ? ep.omdbRatings : []);
  arr.forEach(item => {
    const src = String(item.Source || item.source || '').toLowerCase();
    const val = item.Value || item.value;
    if (src.includes('internet movie database')) add('IMDb', val);
    else if (src.includes('rotten tomatoes')) add('RT', val);
    else if (src.includes('metacritic')) add('Metacritic', val);
  });

  const seen = new Set();
  return ratings.filter(item => {
    const key = `${item.label}|${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function ratingsHtml(ep, className = 'ratingRow') {
  const ratings = getEpisodeRatings(ep);
  if (!ratings.length) return '';
  return `<div class="${className}">${ratings.map(r => `<span class="ratingPill"><strong>${esc(r.label)}</strong> ${esc(r.value)}</span>`).join('')}</div>`;
}

function renderNext(next) {
  currentNextEpisode = next || null;
  const nextTitle = document.getElementById('nextTitle');
  const nextMeta = document.getElementById('nextMeta');
  const nextNotes = document.getElementById('nextNotes');
  const heroCard = document.getElementById('heroCard');
  const poster = document.getElementById('nextPoster');

  if (!next) {
    if (heroCard) heroCard.dataset.episodeId = '';
    nextTitle.textContent = 'Everything is watched';
    nextMeta.innerHTML = '<span class="metaPill">Your Wolf Universe tracker is complete for this scope.</span>';
    nextNotes.textContent = '';
    setImageSafe(poster, artwork('Law & Order'), 'Law & Order');
    return;
  }

  const t = theme(next.show);
  if (heroCard) heroCard.dataset.episodeId = String(next.id || '');
  nextTitle.textContent = `${next.show} ${next.code}${next.title ? ' — ' + next.title : ''}`;
  nextMeta.innerHTML = `<span class="metaPill">#${esc(next.order)}</span><span class="metaPill">${esc(next.airDate || 'No air date')}</span><span class="metaPill">${episodeLabel(next)}</span>${ratingsHtml(next, 'heroRatings')}`;
  nextNotes.textContent = next.overview || next.connection || next.notes || 'Open details for the full episode card, artwork, cast, and ratings.';
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
    if (railValues.actor && !actorMatchesEpisode(ep, railValues.actor)) return false;
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
      renderPreservingScroll();
    });
  });
}

function renderScopeSummary() {
  const el = document.getElementById('scopeSummary');
  if (!el) return;

  const scope = getGuideScope();
  const values = getFilterValues();
  const summaryValues = { ...values, show: '', status: 'all', hideWatched: false };
  const summarySource = scopedEpisodes.filter(ep => {
    if (summaryValues.franchise && String(ep.franchise || ep.era) !== summaryValues.franchise) return false;
    if (summaryValues.season && String(ep.season) !== String(summaryValues.season)) return false;
    if (summaryValues.actor && !actorMatchesEpisode(ep, summaryValues.actor)) return false;
    if (summaryValues.search) {
      const haystack = `${ep.title} ${ep.show} ${ep.notes} ${ep.code} ${ep.airDate} ${ep.overview} ${ep.connection}`.toLowerCase();
      if (!haystack.includes(summaryValues.search)) return false;
    }
    return true;
  });
  const byShow = new Map();
  for (const ep of summarySource) {
    if (!byShow.has(ep.show)) byShow.set(ep.show, { total: 0, watched: 0, color: theme(ep.show).primary });
    const rec = byShow.get(ep.show);
    rec.total += 1;
    if (getStatus(ep) === 'Watched') rec.watched += 1;
  }

  const entries = showSortEntries([...byShow.entries()], scopedEpisodes);
  el.innerHTML = `
    <div class="scopeHeader">
      <div><strong>${esc(GUIDE_SCOPES[scope])}</strong><span>${summarySource.length}/${episodes.length} entries</span></div>
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
      renderPreservingScroll();
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
  const statuses = ['Not Started', 'Watching', 'Watched'];
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
        ${ratingsHtml(ep)}
        <span class="pill">${esc(ep.franchise || ep.era || 'Wolf Universe')}</span>${scopePill}${source}${notes}
        ${ep.overview ? `<p class="overview">${esc(ep.overview)}</p>` : ''}
      </div>
      <div class="statusBtns">
        ${statuses.map(status => `<button class="${st === status ? 'active' : ''}" data-id="${encodeURIComponent(ep.id)}" data-status="${esc(status)}">${status === 'Not Started' ? '○ Unwatched' : status === 'Watching' ? '▶ Watching' : '✓ Watched'}</button>`).join('')}
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
  renderPreservingScroll();
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

function getWatchedCountFromMap(map = statusMap) {
  return episodes.reduce((total, ep) => {
    const byId = normalizeStatus(map[ep.id]);
    const byKey = normalizeStatus(map[episodeKey(ep)]);
    const chosen = byId && byKey ? (statusRank(byKey) > statusRank(byId) ? byKey : byId) : (byId || byKey || normalizeStatus(ep.status));
    return total + (chosen === 'Watched' ? 1 : 0);
  }, 0);
}

function statusSignatureFromPayload(payload) {
  const incoming = payload?.statuses || payload || {};
  const pieces = [];
  if (Array.isArray(payload?.episodes)) {
    for (const item of payload.episodes) {
      const status = normalizeStatus(item.status);
      if (!status) continue;
      pieces.push(`${normShow(item.show)}|${normNum(item.season)}|${normNum(item.episode)}=${status}`);
    }
  }
  for (const [key, value] of Object.entries(incoming)) {
    const status = normalizeStatus(value);
    if (!status) continue;
    pieces.push(`${key}=${status}`);
  }
  pieces.sort();
  return `${pieces.length}:${pieces.join('¦')}`;
}

function getCurrentStatusSignature() {
  const pieces = [];
  for (const [key, value] of Object.entries(statusMap)) {
    const status = normalizeStatus(value);
    if (!status) continue;
    pieces.push(`${key}=${status}`);
  }
  pieces.sort();
  return `${pieces.length}:${pieces.join('¦')}`;
}


function isServerMode() {
  return window.location.protocol !== 'file:';
}

function isLocalHost() {
  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname) || window.location.hostname.endsWith('.local');
}

function ensureTraktAccountPanel() {
  if (document.getElementById('traktAccountPanel')) return;
  const topActions = document.querySelector('.topActions') || document.querySelector('.topbar');
  if (!topActions) return;
  const panel = document.createElement('div');
  panel.id = 'traktAccountPanel';
  panel.className = 'traktAccountPanel accountMenuWrap';
  panel.innerHTML = `
    <button id="traktAccountToggle" class="accountMenuButton" type="button" aria-haspopup="true" aria-expanded="false">
      <span class="accountAvatarFallback" id="traktAccountFallback">T</span>
      <img id="traktAccountAvatar" class="traktAccountAvatar" alt="Trakt avatar" hidden>
      <span class="accountMenuText"><strong id="traktAccountTitle">Trakt</strong><small id="traktAccountText">Checking…</small></span>
      <span class="accountChevron">⌄</span>
    </button>
    <div id="traktAccountDropdown" class="accountDropdown" hidden>
      <div class="accountDropdownHead">
        <span class="accountAvatarFallback accountAvatarLarge" id="traktDropdownFallback">T</span>
        <img id="traktDropdownAvatar" class="traktDropdownAvatar" alt="Trakt avatar" hidden>
        <div><strong id="traktDropdownTitle">Trakt account</strong><small id="traktDropdownText">Not connected</small></div>
      </div>
      <div class="accountDropdownActions">
        <button id="traktProfileBtn" type="button">👤 Profile</button>
        <button id="traktStatsBtn" type="button">📊 Statistics</button>
        <button id="traktDropdownSyncBtn" type="button">↻ Sync now</button>
        <button id="traktLoginBtn" type="button">🔗 Login / Reconnect</button>
        <label class="accountToggle"><span>Hourly auto-sync</span><input type="checkbox" id="autoSync" checked></label>
        <button id="traktResetLocalBtn" type="button">🧹 Reset local progress</button>
        <button id="traktDisconnectBtn" type="button" class="danger">⛓ Disconnect Trakt</button>
        <button id="traktLogoutBtn" type="button" class="danger">🚪 Logout</button>
      </div>
    </div>`;
  topActions.appendChild(panel);

  const dropdown = panel.querySelector('#traktAccountDropdown');
  const toggle = panel.querySelector('#traktAccountToggle');
  const close = () => { dropdown.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  const open = () => { dropdown.hidden = false; toggle.setAttribute('aria-expanded', 'true'); };
  toggle.addEventListener('click', ev => {
    ev.preventDefault();
    dropdown.hidden ? open() : close();
  });
  document.addEventListener('click', ev => {
    if (!panel.contains(ev.target)) close();
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') close();
  });
  panel.addEventListener('click', ev => {
    const target = ev.target.closest('button');
    if (!target) return;
    if (target.id === 'traktLoginBtn') { ev.preventDefault(); close(); loginWithTrakt(); }
    if (target.id === 'traktResetLocalBtn') { ev.preventDefault(); close(); resetLoggedOutProgress(true); }
    if (target.id === 'traktProfileBtn') { ev.preventDefault(); showTraktProfile(); }
    if (target.id === 'traktStatsBtn') { ev.preventDefault(); showTraktStats(); }
    if (target.id === 'traktDropdownSyncBtn') { ev.preventDefault(); close(); triggerCloudSync(); }
    if (target.id === 'traktDisconnectBtn') { ev.preventDefault(); close(); disconnectTraktUser(); }
    if (target.id === 'traktLogoutBtn') { ev.preventDefault(); close(); logoutTraktUser(); }
  });
}

function setAvatarElements(src, username = 'Trakt') {
  const initial = String(username || 'T').slice(0, 1).toUpperCase();
  const pairs = [
    [document.getElementById('traktAccountFallback'), document.getElementById('traktAccountAvatar')],
    [document.getElementById('traktDropdownFallback'), document.getElementById('traktDropdownAvatar')]
  ];

  pairs.forEach(([fallback, img]) => {
    if (fallback) {
      fallback.textContent = initial;
      fallback.hidden = Boolean(src);
    }
    if (!img) return;

    img.onload = null;
    img.onerror = null;

    if (src) {
      img.hidden = false;
      img.src = src;
      img.onload = () => {
        img.hidden = false;
        if (fallback) fallback.hidden = true;
      };
      img.onerror = () => {
        img.hidden = true;
        img.removeAttribute('src');
        if (fallback) fallback.hidden = false;
      };
    } else {
      img.hidden = true;
      img.removeAttribute('src');
      if (fallback) fallback.hidden = false;
    }
  });
}

async function loadTraktProfileSilently() {
  if (!isServerMode() || !traktUser?.authenticated || traktUser.avatar) return;
  try {
    const response = await fetch('/api/me/profile/?ts=' + Date.now(), { cache: 'no-store', credentials: 'include' });
    const profile = await response.json().catch(() => ({}));
    if (!response.ok || profile.ok === false) return;
    const user = profile.user || {};
    const stats = profile.stats || {};
    traktUser = {
      ...traktUser,
      username: user.username || traktUser.username || '',
      avatar: user.avatar || traktUser.avatar || '',
      profile: user,
      updated_at: stats.updated_at || traktUser.updated_at || null
    };
    updateTraktAccountPanel();
  } catch (_) {
    // Avatar/profile enrichment is optional; do not disturb startup or sync.
  }
}

function updateTraktAccountPanel() {
  ensureTraktAccountPanel();
  const title = document.getElementById('traktAccountTitle');
  const text = document.getElementById('traktAccountText');
  const dropTitle = document.getElementById('traktDropdownTitle');
  const dropText = document.getElementById('traktDropdownText');
  const login = document.getElementById('traktLoginBtn');
  const reset = document.getElementById('traktResetLocalBtn');
  const logout = document.getElementById('traktLogoutBtn');
  const profile = document.getElementById('traktProfileBtn');
  const stats = document.getElementById('traktStatsBtn');
  const disconnect = document.getElementById('traktDisconnectBtn');
  const sync = document.getElementById('traktDropdownSyncBtn');
  if (!title || !text) return;

  if (traktUser?.authenticated) {
    const username = traktUser.username || 'connected';
    const avatar = traktUser.avatar || traktUser.profile?.avatar || '';
    title.textContent = username;
    text.textContent = traktUser.updated_at ? `Synced ${new Date(traktUser.updated_at).toLocaleDateString()}` : 'Connected';
    if (dropTitle) dropTitle.textContent = `Trakt: ${username}`;
    if (dropText) dropText.textContent = traktUser.updated_at ? `Last sync ${new Date(traktUser.updated_at).toLocaleString()}` : 'Personal Supabase sync active';
    setAvatarElements(avatar, username);
    if (login) login.textContent = '🔁 Reconnect Trakt';
    if (reset) reset.hidden = true;
    if (profile) profile.hidden = false;
    if (stats) stats.hidden = false;
    if (disconnect) disconnect.hidden = false;
    if (sync) sync.hidden = false;
    if (logout) logout.hidden = false;
  } else if (!isServerMode()) {
    title.textContent = 'Local';
    text.textContent = 'File mode';
    if (dropTitle) dropTitle.textContent = 'Local file mode';
    if (dropText) dropText.textContent = 'Open through local_tracker_server.py or Vercel to use Trakt login.';
    setAvatarElements('', 'L');
    if (login) login.textContent = '🔗 Login with Trakt';
    if (reset) reset.hidden = false;
    if (profile) profile.hidden = true;
    if (stats) stats.hidden = true;
    if (disconnect) disconnect.hidden = true;
    if (sync) sync.hidden = true;
    if (logout) logout.hidden = true;
  } else {
    title.textContent = 'Trakt';
    text.textContent = 'Login';
    if (dropTitle) dropTitle.textContent = 'Trakt account';
    if (dropText) dropText.textContent = 'Login with Trakt to sync your own watched progress.';
    setAvatarElements('', 'T');
    if (login) login.textContent = '🔗 Login with Trakt';
    if (reset) reset.hidden = false;
    if (profile) profile.hidden = true;
    if (stats) stats.hidden = true;
    if (disconnect) disconnect.hidden = true;
    if (sync) sync.hidden = true;
    if (logout) logout.hidden = true;
  }
}

async function loadTraktUser({ pullStatus = true, quiet = false } = {}) {
  ensureTraktAccountPanel();
  if (!isServerMode()) {
    traktUser = { authenticated: false };
    updateTraktAccountPanel();
    return traktUser;
  }
  try {
    const response = await fetch('/api/me/status?ts=' + Date.now(), { cache: 'no-store', credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    traktUser = payload.authenticated ? { ...payload, avatar: payload.avatar || payload.user?.avatar || payload.profile?.avatar || '' } : { authenticated: false };
    updateTraktAccountPanel();
    if (payload.authenticated) {
      loadTraktProfileSilently();
    }
    if (payload.authenticated && pullStatus && (payload.statuses || payload.episodes)) {
      await importStatusPayload(payload, 'Personal Supabase status', { suppressToast: quiet, silentNoChange: quiet });
    }
    startPersonalAutoSync();
    return traktUser;
  } catch (err) {
    traktUser = { authenticated: false };
    updateTraktAccountPanel();
    if (!quiet) setText('syncStatus', `Could not check Trakt login: ${err.message}`);
    return traktUser;
  }
}

function loginWithTrakt() {
  if (!isServerMode()) {
    showModal({
      title: 'Open through a server first',
      message: 'Trakt login needs a server route. Use local_tracker_server.py for local fallback sync, or deploy on Vercel for personal Trakt login.',
      type: 'warning',
      confirmText: 'OK'
    });
    return;
  }
  window.location.href = '/api/auth/trakt/start';
}

async function resetLoggedOutProgress(ask = true) {
  if (traktUser?.authenticated) {
    showToast('Logout first', 'Local reset is only available when no Trakt account is connected.', 'warning');
    return false;
  }
  if (ask) {
    const ok = await showModal({
      title: 'Reset local progress?',
      message: 'This clears watched status stored in this browser only. It will not delete any Trakt or Supabase account data.',
      type: 'warning',
      confirmText: 'Reset local progress',
      cancelText: 'Cancel',
      danger: true
    });
    if (!ok) return false;
  }
  [STORE_KEY, ...LEGACY_STORE_KEYS].forEach(key => {
    try { localStorage.removeItem(key); } catch (_) {}
  });
  statusMap = {};
  render();
  setText('syncStatus', 'Logged-out local progress was reset. Login with Trakt to load personal progress.');
  showToast('Progress reset', 'Local logged-out progress cleared.', 'success');
  return true;
}


async function showTraktProfile() {
  if (!traktUser?.authenticated) {
    await loadTraktUser({ pullStatus: false, quiet: true });
  }
  if (!traktUser?.authenticated) {
    showToast('Not connected', 'Login with Trakt first.', 'warning');
    return;
  }

  const btn = document.getElementById('traktProfileBtn');
  const previous = btn?.innerHTML || '👤 Profile';
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  try {
    const response = await fetch('/api/me/profile/?ts=' + Date.now(), { cache: 'no-store', credentials: 'include' });
    const profile = await response.json().catch(() => ({}));
    if (!response.ok || profile.ok === false) throw new Error(profile.error || `HTTP ${response.status}`);
    const user = profile.user || {};
    const stats = profile.stats || {};
    traktUser = {
      ...traktUser,
      authenticated: true,
      username: user.username || traktUser.username || '',
      avatar: user.avatar || traktUser.avatar || '',
      profile: user,
      updated_at: stats.updated_at || traktUser.updated_at || null
    };
    updateTraktAccountPanel();
    openTraktProfileModal(user, stats);
  } catch (err) {
    showToast('Profile unavailable', err.message || String(err), 'warning');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = previous; }
  }
}

function showTraktStats() {
  const total = scopedEpisodes.length || episodes.length;
  const watched = scopedEpisodes.filter(ep => getStatus(ep) === 'Watched').length;
  const allWatched = getWatchedCountFromMap();
  const remaining = Math.max(0, total - watched);
  const percent = pct(watched, total);
  const view = current.length || 0;
  const username = traktUser?.username || 'Trakt user';
  const overlay = document.getElementById('modalOverlay');
  if (!overlay) return;
  overlay.innerHTML = `
    <div class="modal traktProfileModal" style="--modalColor:#60a5fa">
      <div class="traktProfileHeader">
        <div class="traktProfileAvatar fallback">📊</div>
        <div><p class="label">Statistics</p><h2>${esc(username)}</h2><p class="mutedText">Current guide scope and active filters</p></div>
      </div>
      <div class="traktProfileGrid">
        <div><span>Progress</span><strong>${esc(percent)}%</strong></div>
        <div><span>Watched in scope</span><strong>${esc(watched)}</strong></div>
        <div><span>Remaining in scope</span><strong>${esc(remaining)}</strong></div>
        <div><span>Current view</span><strong>${esc(view)}</strong></div>
        <div><span>Total scope rows</span><strong>${esc(total)}</strong></div>
        <div><span>All watched rows</span><strong>${esc(allWatched)}</strong></div>
      </div>
      <div class="modalActions"><button id="modalOk" class="primary">Close</button></div>
    </div>`;
  overlay.classList.add('show');
  const close = () => { overlay.classList.remove('show'); overlay.innerHTML = ''; };
  overlay.querySelector('#modalOk')?.addEventListener('click', close);
  overlay.addEventListener('click', function outside(ev) {
    if (ev.target === overlay) { overlay.removeEventListener('click', outside); close(); }
  });
}

function openTraktProfileModal(user = {}, stats = {}) {
  const overlay = document.getElementById('modalOverlay');
  if (!overlay) return;
  const username = user.username || traktUser?.username || 'connected';
  const avatar = user.avatar || traktUser?.avatar || '';
  const initial = esc(String(username || 'T').slice(0, 1).toUpperCase());
  const joined = user.joined_at ? new Date(user.joined_at).toLocaleDateString() : 'Unknown';
  const synced = stats.updated_at ? new Date(stats.updated_at).toLocaleString() : 'Never';
  const location = user.location || 'Not public';
  const about = user.about || '';
  overlay.innerHTML = `
    <div class="modal traktProfileModal" style="--modalColor:#ef4444">
      <div class="traktProfileHeader">
        <div class="traktProfileAvatarWrap">
          ${avatar ? `<img class="traktProfileAvatar" src="${esc(avatar)}" alt="${esc(username)} avatar">` : `<div class="traktProfileAvatar fallback">${initial}</div>`}
        </div>
        <div>
          <p class="label">Trakt profile</p>
          <h2>${esc(username)}</h2>
          <p class="mutedText">${esc(user.name || 'No public name')} ${user.vip ? '• VIP' : ''}</p>
        </div>
      </div>
      <div class="traktProfileGrid">
        <div><span>Watched entries</span><strong>${esc(stats.watched_count || 0)}</strong></div>
        <div><span>Matched rows</span><strong>${esc(stats.matched || 0)}</strong></div>
        <div><span>Status keys</span><strong>${esc(stats.status_count || 0)}</strong></div>
        <div><span>Last sync</span><strong>${esc(synced)}</strong></div>
      </div>
      <div class="traktProfileMeta">
        <p><strong>Joined:</strong> ${esc(joined)}</p>
        <p><strong>Location:</strong> ${esc(location)}</p>
        ${about ? `<p><strong>About:</strong> ${esc(about)}</p>` : ''}
      </div>
      <div class="modalActions">
        <button id="modalOk" class="primary">Close</button>
      </div>
    </div>`;
  overlay.classList.add('show');
  const close = () => { overlay.classList.remove('show'); overlay.innerHTML = ''; };
  overlay.querySelector('#modalOk')?.addEventListener('click', close);
  overlay.addEventListener('click', function outside(ev) {
    if (ev.target === overlay) {
      overlay.removeEventListener('click', outside);
      close();
    }
  });
}

async function disconnectTraktUser() {
  const ok = await showModal({
    title: 'Disconnect Trakt?',
    message: 'This logs this browser out and revokes the stored Trakt token for this app when Trakt allows it. Your Trakt account and Supabase progress are not deleted.',
    type: 'warning',
    confirmText: 'Disconnect',
    cancelText: 'Cancel',
    danger: true
  });
  if (!ok) return;
  try {
    await fetch('/api/auth/trakt/revoke', { method: 'POST', credentials: 'include' });
  } catch (_) {}
  traktUser = { authenticated: false };
  updateTraktAccountPanel();
  await resetLoggedOutProgress(false);
  showToast('Trakt disconnected', 'Session and local browser progress were cleared.', 'info');
}

async function logoutTraktUser() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (_) {}
  traktUser = { authenticated: false };
  updateTraktAccountPanel();
  await resetLoggedOutProgress(false);
  showToast('Logged out', 'Personal Trakt session removed and local progress cleared from this browser.', 'info');
}

async function fetchPersonalSupabaseStatus(options = {}) {
  if (!isServerMode()) return { ok: false, error: 'file-mode' };
  if (traktStatusLoadInProgress) return { ok: false, error: 'already-loading' };
  traktStatusLoadInProgress = true;
  try {
    const response = await fetch('/api/me/status?ts=' + Date.now(), { cache: 'no-store', credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    traktUser = payload.authenticated ? { ...payload, avatar: payload.avatar || payload.user?.avatar || payload.profile?.avatar || '' } : { authenticated: false };
    updateTraktAccountPanel();
    if (!payload.authenticated) return { ok: false, authenticated: false };
    return await importStatusPayload(payload, options.source || 'Personal Supabase status', options);
  } catch (err) {
    setText('syncStatus', `Personal status refresh failed: ${err.message}`);
    if (!options.suppressToast) showToast('Personal sync warning', err.message, 'warning');
    return { ok: false, error: err.message };
  } finally {
    traktStatusLoadInProgress = false;
  }
}

async function syncPersonalTrakt(options = {}) {
  const background = Boolean(options.background);
  const startedAt = new Date().toISOString();
  if (!background) setText('syncStatus', 'Contacting Trakt, updating Supabase, and waiting for the fresh status row…');

  async function runSyncRequest(attempt) {
    if (attempt > 1) {
      setText('syncStatus', `Trakt returned an empty first response. Retrying sync request ${attempt}/4…`);
      await new Promise(resolve => setTimeout(resolve, attempt === 2 ? 1200 : 2200));
    }

    const response = await fetch('/api/sync/trakt/', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({ source: 'wolf-universe-tracker', ts: Date.now(), attempt })
    });

    const payload = await response.json().catch(() => ({}));
    if (response.status === 202 && payload.retryable) return { retryable: true, payload };
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
    return { retryable: false, payload };
  }

  let syncPayload = null;
  let lastRetryablePayload = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = await runSyncRequest(attempt);
    if (!result.retryable) {
      syncPayload = result.payload;
      break;
    }
    lastRetryablePayload = result.payload;
  }

  if (!syncPayload) {
    const previousCount = Number(lastRetryablePayload?.watched_count || lastRetryablePayload?.status_count || 0);
    if (lastRetryablePayload && previousCount > 0) {
      await importStatusPayload(lastRetryablePayload, 'Previous Supabase status', { suppressToast: true, silentNoChange: true });
    }
    throw new Error(lastRetryablePayload?.error || 'Trakt returned an empty watched-status build after retries. Supabase was not overwritten; try again shortly.');
  }

  traktUser = {
    authenticated: true,
    username: syncPayload.username || traktUser?.username || '',
    updated_at: syncPayload.updated_at || startedAt
  };
  updateTraktAccountPanel();

  const expectedUpdatedAt = syncPayload.updated_at || startedAt;
  const expectedKeys = Number(syncPayload.watched_keys || syncPayload.status_count || Object.keys(syncPayload.statuses || {}).length || (Array.isArray(syncPayload.episodes) ? syncPayload.episodes.length : 0) || 0);
  const expectedServerMatches = Number(syncPayload.matched || syncPayload.guide_matches || syncPayload.debug?.watchedShows?.guideMatches || syncPayload.debug?.history?.guideMatches || 0);

  let bestResult = await importStatusPayload(
    syncPayload,
    'Personal Trakt sync',
    { suppressToast: true, silentNoChange: true }
  );

  async function readPersonalStatusDirect(attempt) {
    const url = `/api/me/status?ts=${Date.now()}&after=${encodeURIComponent(expectedUpdatedAt)}&attempt=${attempt}`;
    const r = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      headers: { 'Cache-Control': 'no-cache' }
    });
    const payload = await r.json().catch(() => ({}));
    if (!r.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${r.status}`);
    traktUser = payload.authenticated ? payload : { authenticated: false };
    updateTraktAccountPanel();
    const imported = await importStatusPayload(
      payload,
      'Personal Supabase status',
      { suppressToast: true, silentNoChange: true }
    );
    imported.updated_at = payload.updated_at || null;
    imported.status_count = payload.status_count || Object.keys(payload.statuses || {}).length;
    return imported;
  }

  // Important: Vercel/Supabase can be read-after-write delayed for a short moment.
  // Do not report success from the first stale row. Keep reading until the row is
  // at least as new as this sync call, or until we have imported a useful status map.
  const delays = [0, 350, 700, 1200, 1800, 2600];
  for (let i = 0; i < delays.length; i += 1) {
    if (delays[i]) await new Promise(resolve => setTimeout(resolve, delays[i]));
    if (!background) setText('syncStatus', `Finalizing personal Trakt sync… checking Supabase update ${i + 1}/${delays.length}.`);
    try {
      const retry = await readPersonalStatusDirect(i + 1);
      if (retry && retry.ok !== false) {
        if (!bestResult || retry.matched >= (bestResult.matched || 0) || retry.watched >= (bestResult.watched || 0)) {
          bestResult = retry;
        }
        const rowIsFresh = !retry.updated_at || !expectedUpdatedAt || new Date(retry.updated_at).getTime() >= new Date(expectedUpdatedAt).getTime() - 1500;
        const hasExpectedSize = !expectedKeys || retry.status_count >= Math.max(1, Math.floor(expectedKeys * 0.95));
        const hasExpectedMatches = !expectedServerMatches || retry.matched >= Math.max(1, Math.floor(expectedServerMatches * 0.95));
        if (rowIsFresh && hasExpectedSize && (hasExpectedMatches || retry.watched > 0)) break;
      }
    } catch (err) {
      if (i === delays.length - 1) throw err;
    }
  }

  const watched = bestResult?.watched ?? getWatchedCountFromMap();
  const matched = bestResult?.matched ?? 0;
  const serverTail = expectedServerMatches ? ` Server matched ${expectedServerMatches} guide rows.` : '';
  if (background) {
    setText('syncStatus', `Hourly background sync complete: ${watched} watched entries loaded at ${new Date().toLocaleTimeString()}.`);
  } else {
    setText('syncStatus', `Personal Trakt sync complete: ${watched} watched entries loaded, ${matched} browser guide rows matched at ${new Date().toLocaleTimeString()}.${serverTail}`);
    showToast('Personal Trakt sync complete', `${watched} watched entries loaded.`, 'success', 5200);
  }
  return bestResult;
}


function stopSyncPolling(message = '') {
  if (syncPollTimer) clearInterval(syncPollTimer);
  syncPollTimer = null;
  syncPollDeadline = 0;
  syncPollStartedAt = 0;
  syncBaselineSignature = '';
  if (message) setText('syncStatus', message);
}

function startStatusPolling({ reason = 'Trakt sync', intervalMs = 20000, maxMs = 6 * 60 * 1000 } = {}) {
  stopSyncPolling();
  syncPollStartedAt = Date.now();
  syncPollDeadline = syncPollStartedAt + maxMs;
  syncBaselineSignature = lastHostedStatusSignature || getCurrentStatusSignature();
  let attempt = 0;

  const tick = async () => {
    attempt += 1;
    const elapsed = Math.max(1, Math.round((Date.now() - syncPollStartedAt) / 1000));
    setText('syncStatus', `${reason} is running. Waiting for the updated watched_status.json… checked ${attempt} time${attempt === 1 ? '' : 's'} (${elapsed}s).`);
    const result = await fetchHostedStatus({ source: 'Sync polling', silentNoChange: true, suppressToast: true, expectedChange: true, allowSharedHosted: true, skipPersonal: true });

    if (result?.updated) {
      const watched = getWatchedCountFromMap();
      stopSyncPolling(`Sync complete. Updated watched status loaded: ${watched} watched entries at ${new Date().toLocaleTimeString()}.`);
      showToast('Sync complete', `Updated watched status loaded: ${watched} watched entries.`, 'success');
      return;
    }

    if (Date.now() >= syncPollDeadline) {
      stopSyncPolling(`${reason} was triggered, but the hosted status file did not change yet. If GitHub Actions just finished, wait for the redeploy/cache and press Pull latest.`);
      showToast('Still waiting for update', 'The sync may still be deploying. Try Pull latest in a minute.', 'warning');
    }
  };

  tick();
  syncPollTimer = setInterval(tick, intervalMs);
}

async function importStatusPayload(payload, source = 'import', options = {}) {
  const incoming = payload.statuses || payload || {};
  const beforeSignature = getCurrentStatusSignature();
  const incomingSignature = statusSignatureFromPayload(payload);
  let changed = 0;
  let matched = 0;

  function applyToEpisode(ep, status) {
    status = normalizeStatus(status);
    if (!ep || !status) return;
    matched++;

    const noOrder = episodeKey(ep);
    const existingId = normalizeStatus(statusMap[ep.id]);
    const existingKey = normalizeStatus(statusMap[noOrder]);

    // Never let a stale "Not Started" payload downgrade a freshly imported
    // watched status for the same guide row. Watched always wins.
    const finalStatus = statusRank(status) >= Math.max(statusRank(existingId), statusRank(existingKey))
      ? status
      : (statusRank(existingId) >= statusRank(existingKey) ? existingId : existingKey);

    if (normalizeStatus(statusMap[ep.id]) !== finalStatus) {
      statusMap[ep.id] = finalStatus;
      changed++;
    }
    if (normalizeStatus(statusMap[noOrder]) !== finalStatus) {
      statusMap[noOrder] = finalStatus;
      if (normalizeStatus(statusMap[ep.id]) === finalStatus) changed++;
    }
  }

  if (Array.isArray(payload.episodes)) {
    for (const item of payload.episodes) {
      const status = normalizeStatus(item.status);
      if (!status) continue;

      const direct = item.id !== undefined && item.id !== null ? episodeByExactId.get(String(item.id)) : null;
      if (direct) applyToEpisode(direct, status);

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

    const existingRaw = normalizeStatus(statusMap[rawId]);
    const finalRaw = statusRank(existingRaw) > statusRank(status) ? existingRaw : status;
    if (normalizeStatus(statusMap[rawId]) !== finalRaw) {
      statusMap[rawId] = finalRaw;
      changed++;
    }
  }

  const afterSignature = getCurrentStatusSignature();
  const hostedChanged = incomingSignature && incomingSignature !== lastHostedStatusSignature;
  const localChanged = afterSignature !== beforeSignature || changed > 0;
  const updatedForPolling = Boolean(options.expectedChange && syncBaselineSignature && incomingSignature && incomingSignature !== syncBaselineSignature);

  if (localChanged) save();
  lastHostedStatusSignature = incomingSignature || lastHostedStatusSignature;
  lastHostedStatusFetchedAt = Date.now();
  if (localChanged || options.forceRender) renderPreservingScroll();

  const watched = getWatchedCountFromMap();
  const time = new Date().toLocaleTimeString();

  if (changed > 0) {
    if (!options.background) setText('syncStatus', `${source}: ${changed} status changes applied, ${matched} guide rows matched, ${watched} watched entries loaded at ${time}.`);
    if (!options.suppressToast) showToast(source, `${changed} changes applied. ${matched} guide rows matched.`, 'success');
  } else if (options.expectedChange) {
    if (!options.background) setText('syncStatus', `${source}: no updated status file yet. Sync may still be running or waiting for Vercel/GitHub Pages to redeploy. Last check ${time}.`);
    if (!options.suppressToast && !options.silentNoChange) showToast(source, 'No updated status file yet. Try again after the workflow/deploy finishes.', 'info');
  } else {
    if (!options.background) setText('syncStatus', `${source}: already current. ${matched} guide rows matched, ${watched} watched entries loaded at ${time}.`);
    if (!options.suppressToast && !options.silentNoChange) showToast(source, `Already current. ${watched} watched entries loaded.`, 'info');
  }

  return { changed, matched, watched, incomingSignature, hostedChanged, localChanged, updated: updatedForPolling || (options.expectedChange && changed > 0) };
}

async function fetchHostedStatus(options = {}) {
  if (traktUser?.authenticated && !options.skipPersonal) {
    const personal = await fetchPersonalSupabaseStatus({ source: options.source || 'Personal Supabase status', ...options });
    if (personal?.ok !== false || personal?.authenticated !== false) return personal;
  }

  if (!traktUser?.authenticated && isServerMode() && !isLocalHost() && !options.allowSharedHosted) {
    const message = 'No Trakt account connected. Login with Trakt to load personal progress. Logged-out progress stays local to this browser.';
    setText('syncStatus', message);
    updateTraktAccountPanel();
    return { ok: false, authenticated: false, error: 'not-authenticated' };
  }

  if (window.location.protocol === 'file:') {
    const message = 'Auto-sync needs a server. For local use, start local_tracker_server.py and open http://localhost:8080/law_order_tracker_app/';
    setText('syncStatus', message);
    if (!options.suppressToast) showToast('Sync unavailable in file mode', 'Use local_tracker_server.py or Vercel/GitHub Pages.', 'warning');
    return { ok: false, error: 'file-mode' };
  }

  try {
    const statusUrl = new URL('data/watched_status.json?ts=' + Date.now(), window.location.href);
    const response = await fetch(statusUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`status file returned HTTP ${response.status}`);
    const payload = await response.json();
    return await importStatusPayload(payload, options.source || 'Shared hosted status', options);
  } catch (err) {
    const message = `Status refresh failed: ${err.message}. If you just triggered sync, wait for the workflow/deploy and try Pull latest again.`;
    setText('syncStatus', message);
    if (!options.suppressToast) showToast('Sync warning', err.message, 'warning');
    return { ok: false, error: err.message };
  }
}

async function triggerCloudSync() {
  if (window.location.protocol === 'file:') {
    await showModal({
      title: 'Sync unavailable in file mode',
      message: 'Open this app through local_tracker_server.py for local fallback sync, or Vercel for personal Trakt login. Static file mode cannot run /api routes.',
      type: 'warning',
      confirmText: 'OK'
    });
    return;
  }

  const local = isLocalHost();
  const hasPersonal = Boolean(traktUser?.authenticated);
  if (!hasPersonal && !local) {
    const login = await showModal({
      title: 'Login with Trakt first?',
      message: 'Personal sync uses Supabase and does not trigger GitHub commits or Vercel deployments. Login once, then Sync with Trakt will update only your account.',
      type: 'info',
      confirmText: 'Login with Trakt',
      cancelText: 'Cancel'
    });
    if (login) loginWithTrakt();
    return;
  }
  const ok = await showModal({
    title: hasPersonal ? 'Sync your Trakt account now?' : 'Sync with Trakt now?',
    message: hasPersonal
      ? 'This syncs your own Trakt watched history into Supabase. It does not commit files to GitHub and does not trigger a Vercel deployment.'
      : 'This will run your local sync endpoint. Keep the local_tracker_server.py window open until it finishes.',
    type: 'info',
    confirmText: 'Start sync',
    cancelText: 'Cancel'
  });
  if (!ok) return;

  const btn = document.getElementById('syncNowBtn');
  const previousText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = hasPersonal ? 'Syncing your Trakt…' : (local ? 'Running local sync…' : 'Starting online sync…');
  }
  setText('syncStatus', hasPersonal ? 'Syncing your personal Trakt account through Supabase…' : (local ? 'Running local Trakt sync…' : 'Starting shared online Trakt sync…'));

  try {
    if (hasPersonal) {
      await syncPersonalTrakt();
      return;
    }

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

    if (payload.completed || payload.finished || payload.local || local) {
      setText('syncStatus', payload.message || 'Local sync finished. Loading updated watched_status.json…');
      showToast('Sync finished', payload.message || 'Loading updated status now.', 'success');
      await fetchHostedStatus({ source: 'Local sync result', expectedChange: false, skipPersonal: true, allowSharedHosted: true });
    } else {
      const workflowText = payload.run_url ? ` Workflow: ${payload.run_url}` : '';
      setText('syncStatus', `Shared online sync started. Waiting for the updated watched_status.json to be published…${workflowText}`);
      showToast('Shared online sync started', 'Polling until the updated status file is available.', 'success');
      startStatusPolling({ reason: 'Shared online Trakt sync', intervalMs: 20000, maxMs: 6 * 60 * 1000 });
    }
  } catch (err) {
    stopSyncPolling();
    const detail = err.message || String(err);
    setText('syncStatus', `Sync failed: ${detail}`);
    showToast('Sync failed', detail, 'danger', 6500);
    window.setTimeout(() => {
      showModal({
        title: 'Sync failed',
        message: `${detail}\n\nPersonal sync: check Supabase and Trakt environment variables. Local fallback: make sure local_tracker_server.py is running. Shared online fallback: check GITHUB_PAT, GITHUB_REPO, and GITHUB_WORKFLOW.`,
        type: 'danger',
        confirmText: 'OK'
      });
    }, 350);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = previousText || 'Sync with Trakt';
    }
  }
}

function stopPersonalAutoSync() {
  if (personalAutoSyncTimer) clearInterval(personalAutoSyncTimer);
  personalAutoSyncTimer = null;
}

function startPersonalAutoSync() {
  stopPersonalAutoSync();
  if (!traktUser?.authenticated || localStorage.getItem(AUTOSYNC_KEY) === '0') return;
  personalAutoSyncTimer = setInterval(async () => {
    if (!traktUser?.authenticated || personalSyncInProgress) return;
    try {
      personalSyncInProgress = true;
      await syncPersonalTrakt({ background: true });
    } catch (err) {
      console.warn('Background Trakt sync failed:', err);
    } finally {
      personalSyncInProgress = false;
    }
  }, PERSONAL_AUTO_SYNC_INTERVAL_MS);
}

function setAutoSync(enabled) {
  localStorage.setItem(AUTOSYNC_KEY, enabled ? '1' : '0');
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
  stopPersonalAutoSync();
  if (!enabled) return;

  // Do not run an immediate background refresh here. The initial login/status
  // load already happens on page open, and instant auto-refresh was the main
  // cause of scroll jumps while browsing. Background work is hourly and quiet.
  autoTimer = setInterval(() => {
    fetchHostedStatus({
      source: 'Hourly background status refresh',
      suppressToast: true,
      silentNoChange: true,
      background: true
    });
  }, AUTO_SYNC_INTERVAL_MS);

  startPersonalAutoSync();
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
      scheduleRender(true);
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

  const heroCard = document.getElementById('heroCard');
  if (heroCard) {
    heroCard.addEventListener('click', ev => {
      if (ev.target.closest('button')) return;
      if (currentNextEpisode) openEpisodeDetail(currentNextEpisode);
    });
  }

  const nextPoster = document.getElementById('nextPoster');
  if (nextPoster) {
    nextPoster.addEventListener('click', ev => {
      ev.stopPropagation();
      if (currentNextEpisode) openEpisodeDetail(currentNextEpisode);
      else openImageLightbox(nextPoster.dataset.lightboxSrc || nextPoster.src, nextPoster.dataset.lightboxTitle || 'Artwork');
    });
  }

  const episodeOverlay = document.getElementById('episodeModalOverlay');
  if (episodeOverlay) {
    episodeOverlay.addEventListener('mouseover', ev => {
      const actorButton = ev.target.closest('.castPill[data-actor-key]');
      if (actorButton) showActorPortraitFloating(actorButton);
    });
    episodeOverlay.addEventListener('mousemove', ev => {
      const actorButton = ev.target.closest('.castPill[data-actor-key]');
      if (actorButton) positionActorPortraitFloating(actorButton);
    });
    episodeOverlay.addEventListener('mouseout', ev => {
      const actorButton = ev.target.closest('.castPill[data-actor-key]');
      if (actorButton && !actorButton.contains(ev.relatedTarget)) hideActorPortraitFloating();
    });
    episodeOverlay.addEventListener('click', ev => {
      const actorButton = ev.target.closest('.castPill[data-actor-key]');
      if (actorButton) {
        ev.preventDefault();
        hideActorPortraitFloating();
        selectActorFromDetail(actorButton.dataset.actorName || actorButton.textContent || '');
        return;
      }
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
    const next = (current.length ? current : scopedEpisodes).find(e => getStatus(e) !== 'Watched');
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
    const next = (current.length ? current : scopedEpisodes).find(e => getStatus(e) !== 'Watched');
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
      renderPreservingScroll();
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

window.loadTraktUser = loadTraktUser;
document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem(THEME_KEY) === 'light') document.body.classList.add('light');
  if (!episodes.length) {
    setText('syncStatus', 'Episode data did not load. Make sure data/episodes.js is next to index.html.');
  }
  initOptions();
  ensureTraktAccountPanel();
  bindEvents();
  render();
  loadTraktUser({ pullStatus: true, quiet: true });
});
