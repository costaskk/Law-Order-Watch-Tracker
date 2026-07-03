'use strict';

const STORE_KEY = 'law_order_tracker_status_v4';
const LEGACY_STORE_KEYS = ['law_order_tracker_status_v3', 'law_order_tracker_status_v2', 'law_order_tracker_status'];
const THEME_KEY = 'law_order_tracker_theme';
const AUTOSYNC_KEY = 'law_order_auto_sync';
const PAGE_SIZE = 250;

let episodes = Array.isArray(window.LAW_ORDER_EPISODES) ? window.LAW_ORDER_EPISODES : [];
const themes = window.SHOW_THEMES || {};
let statusMap = loadStatusMap();
let current = [];
let renderedCount = 0;
let deferredInstallPrompt = null;
let autoTimer = null;

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

function getStatus(ep) {
  return statusMap[ep.id] || ep.status || 'Not Started';
}

function setStatus(ep, status) {
  statusMap[ep.id] = status;
  save();
  render();
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
    abbr: 'L&O',
    image: ''
  };
}

function artwork(show) {
  const t = theme(show);
  if (t.image) return t.image;
  const abbr = encodeURIComponent(t.abbr || String(show || 'L&O').slice(0, 4));
  const color = encodeURIComponent((t.primary || '#b91c1c').replace('#',''));
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='520'%3E%3Crect width='900' height='520' fill='%23${color}'/%3E%3Ctext x='50%25' y='52%25' text-anchor='middle' dominant-baseline='middle' font-family='Arial' font-size='96' font-weight='900' fill='white'%3E${abbr}%3C/text%3E%3C/svg%3E`;
}

function setImageSafe(img, src) {
  if (!img) return;
  img.onerror = () => { img.onerror = null; img.src = artwork('Law & Order'); };
  img.src = src || artwork('Law & Order');
  img.style.display = '';
}

function normalizeEpisodes() {
  episodes = episodes
    .filter(Boolean)
    .map((ep, index) => ({
      id: ep.id || `${ep.show || 'unknown'}-${ep.season || 0}-${ep.episode || index + 1}`,
      order: Number(ep.order) || index + 1,
      show: ep.show || 'Unknown Show',
      season: ep.season ?? '',
      episode: ep.episode ?? '',
      code: ep.code || buildCode(ep),
      title: ep.title || '',
      airDate: ep.airDate || ep.air_date || '',
      notes: ep.notes || '',
      era: ep.era || '',
      sourceWatch: ep.sourceWatch || ep.source_watch || ''
    }))
    .sort((a, b) => a.order - b.order);
}

function buildCode(ep) {
  const s = ep.season ? String(ep.season).padStart(2, '0') : '??';
  const e = ep.episode ? String(ep.episode).padStart(2, '0') : '??';
  return `S${s}E${e}`;
}

function initOptions() {
  normalizeEpisodes();
  const shows = [...new Set(episodes.map(e => e.show).filter(Boolean))];
  const showFilter = document.getElementById('showFilter');
  const bulkShow = document.getElementById('bulkShow');
  const strip = document.getElementById('showStrip');

  showFilter.length = 1;
  bulkShow.innerHTML = '';
  strip.innerHTML = '';

  shows.forEach(show => {
    showFilter.add(new Option(show, show));
    bulkShow.add(new Option(show, show));

    const watched = episodes.filter(e => e.show === show && getStatus(e) === 'Watched').length;
    const total = episodes.filter(e => e.show === show).length;
    const t = theme(show);
    const button = document.createElement('button');
    button.className = 'showChip';
    button.dataset.show = show;
    button.style.setProperty('--showColor', t.primary);
    button.innerHTML = `<span class="dot" style="background:${esc(t.primary)}"></span><span>${esc(show)}</span><small>${watched}/${total}</small>`;
    button.addEventListener('click', () => {
      showFilter.value = show;
      updateSeasonOptions();
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    strip.appendChild(button);
  });

  updateSeasonOptions();
}

function updateSeasonOptions() {
  const show = document.getElementById('showFilter').value;
  const seasonFilter = document.getElementById('seasonFilter');
  seasonFilter.innerHTML = '<option value="">All seasons</option>';

  uniqueSeasons(episodes.filter(e => !show || e.show === show))
    .forEach(season => seasonFilter.add(new Option(`Season ${season}`, season)));

  const bulkShow = document.getElementById('bulkShow').value;
  const bulkSeason = document.getElementById('bulkSeason');
  bulkSeason.innerHTML = '';
  uniqueSeasons(episodes.filter(e => e.show === bulkShow))
    .forEach(season => bulkSeason.add(new Option(`Season ${season}`, season)));
}

function uniqueSeasons(items) {
  return [...new Set(items.map(e => e.season).filter(v => v !== '' && v !== null && v !== undefined))]
    .sort((a, b) => Number(a) - Number(b));
}

function matches(ep) {
  const q = document.getElementById('searchBox').value.toLowerCase().trim();
  const show = document.getElementById('showFilter').value;
  const season = document.getElementById('seasonFilter').value;
  const statusFilter = document.getElementById('statusFilter').value;
  const hideWatched = document.getElementById('hideWatched').checked;
  const st = getStatus(ep);

  if (show && ep.show !== show) return false;
  if (season && String(ep.season) !== String(season)) return false;
  if (q) {
    const haystack = `${ep.title} ${ep.show} ${ep.notes} ${ep.code} ${ep.airDate}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (statusFilter === 'unwatched' && st === 'Watched') return false;
  if (statusFilter === 'watched' && st !== 'Watched') return false;
  if (statusFilter === 'watching' && st !== 'Watching') return false;
  if (statusFilter === 'skipped' && st !== 'Skipped') return false;
  if (hideWatched && statusFilter !== 'watched' && st === 'Watched') return false;
  return true;
}

function render() {
  const total = episodes.length;
  const watched = episodes.filter(e => getStatus(e) === 'Watched').length;
  const percent = pct(watched, total);

  setText('totalCount', total);
  setText('watchedCount', watched);
  setText('remainingCount', total - watched);
  setText('progressPct', `${percent}%`);
  document.getElementById('progressBar').style.width = `${percent}%`;

  const next = episodes.find(e => getStatus(e) !== 'Watched');
  renderNext(next);

  current = episodes.filter(matches);
  renderedCount = Math.min(PAGE_SIZE, current.length);
  renderList();
  refreshShowStripCounts();
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
  const t = theme(next?.show);

  if (!next) {
    nextTitle.textContent = 'Everything is watched';
    nextMeta.textContent = 'Your Law & Order universe tracker is complete.';
    nextNotes.textContent = '';
    setImageSafe(poster, artwork('Law & Order'));
    return;
  }

  nextTitle.textContent = `${next.show} ${next.code}${next.title ? ' — ' + next.title : ''}`;
  nextMeta.textContent = `#${next.order} • ${next.airDate || 'No air date'} • Season ${next.season}, Episode ${next.episode}`;
  nextNotes.textContent = next.notes || '';
  heroCard.style.setProperty('--showColor', t.primary);

  setImageSafe(poster, artwork(next.show));
}

function renderList() {
  const list = document.getElementById('episodeList');
  if (!current.length) {
    list.innerHTML = '<div class="card emptyState"><h2>No episodes match these filters</h2><p>Try Show all, clear search, or disable Hide watched.</p></div>';
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
  const notes = ep.notes ? `<div class="crossover">${esc(ep.notes)}</div>` : '';

  return `
    <article class="ep ${st === 'Watched' ? 'watched' : ''}" style="--showColor:${accent}" id="ep-${safeId(ep.order)}">
      <div class="order">#${esc(ep.order)}</div>
      <img class="epArt" src="${esc(artwork(ep.show))}" alt="${esc(ep.show)} artwork" loading="lazy" onerror="this.style.display='none'">
      <div class="epMain">
        <h3>${esc(ep.show)} ${esc(ep.code)}${title}</h3>
        <div class="meta">${esc(ep.airDate || 'No date')} • Season ${esc(ep.season)} Episode ${esc(ep.episode)} • <strong>${esc(st)}</strong></div>
        <span class="pill">${esc(ep.era || 'Guide')}</span>${source}${notes}
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

function markBulk(scope, status) {
  const show = document.getElementById('bulkShow').value;
  const season = document.getElementById('bulkSeason').value;
  let changed = 0;
  episodes.forEach(ep => {
    const sameShow = ep.show === show;
    const sameSeason = String(ep.season) === String(season);
    if (sameShow && (scope === 'show' || sameSeason)) {
      if (statusMap[ep.id] !== status) changed++;
      statusMap[ep.id] = status;
    }
  });
  save();
  render();
  setText('syncStatus', `${changed} episode statuses updated.`);
}

function exportJson() {
  const payload = {
    version: 4,
    exportedAt: new Date().toISOString(),
    statuses: statusMap
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'law_order_watch_status.json');
}

function exportCsv() {
  const rows = [['Order', 'Status', 'Air Date', 'Show', 'Season', 'Episode', 'Code', 'Title', 'Notes']];
  current.forEach(ep => rows.push([ep.order, getStatus(ep), ep.airDate, ep.show, ep.season, ep.episode, ep.code, ep.title, ep.notes]));
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'law_order_current_view.csv');
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
  for (const [id, value] of Object.entries(incoming)) {
    if (!['Not Started', 'Watching', 'Watched', 'Skipped'].includes(value)) continue;
    if (statusMap[id] !== value) {
      statusMap[id] = value;
      changed++;
    }
  }
  if (changed) save();
  render();
  setText('syncStatus', `${source}: ${changed} status changes applied at ${new Date().toLocaleTimeString()}.`);
}

async function fetchHostedStatus() {
  if (window.location.protocol === 'file:') {
    setText('syncStatus', 'Auto-sync needs a local server, GitHub Pages, or Vercel. For local testing run: python -m http.server 8080, then open http://localhost:8080/law_order_tracker_app/');
    return;
  }

  try {
    const response = await fetch('data/watched_status.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error(`status file returned HTTP ${response.status}`);
    await importStatusPayload(await response.json(), 'Auto-sync');
  } catch (err) {
    setText('syncStatus', `Auto-sync checked: ${err.message}. Run the Python sync script or upload watched_status.json to data/.`);
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

function refreshShowStripCounts() {
  document.querySelectorAll('.showChip').forEach(button => {
    const show = button.dataset.show;
    const total = episodes.filter(e => e.show === show).length;
    const watched = episodes.filter(e => e.show === show && getStatus(e) === 'Watched').length;
    const small = button.querySelector('small');
    if (small) small.textContent = `${watched}/${total}`;
  });
}

function bindEvents() {
  ['searchBox', 'showFilter', 'seasonFilter', 'statusFilter', 'hideWatched'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => {
      if (id === 'showFilter') updateSeasonOptions();
      render();
    });
    el.addEventListener('change', () => {
      if (id === 'showFilter') updateSeasonOptions();
      render();
    });
  });

  document.getElementById('episodeList').addEventListener('click', event => {
    const button = event.target.closest('button[data-id][data-status]');
    if (!button) return;
    setStatusById(button.dataset.id, button.dataset.status);
  });

  document.getElementById('bulkShow').addEventListener('change', updateSeasonOptions);
  document.getElementById('markSeasonWatched').addEventListener('click', () => markBulk('season', 'Watched'));
  document.getElementById('markSeasonUnwatched').addEventListener('click', () => markBulk('season', 'Not Started'));
  document.getElementById('markShowWatched').addEventListener('click', () => markBulk('show', 'Watched'));

  document.getElementById('markNextWatched').addEventListener('click', () => {
    const next = episodes.find(e => getStatus(e) !== 'Watched');
    if (next) setStatus(next, 'Watched');
  });

  const jump = () => {
    const next = episodes.find(e => getStatus(e) !== 'Watched');
    if (!next) return;
    document.getElementById('statusFilter').value = 'unwatched';
    document.getElementById('hideWatched').checked = true;
    render();
    setTimeout(() => document.getElementById(`ep-${safeId(next.order)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  document.getElementById('jumpNext').addEventListener('click', jump);
  document.getElementById('bottomNext').addEventListener('click', jump);

  document.getElementById('syncNowBtn').addEventListener('click', fetchHostedStatus);
  document.getElementById('exportJson').addEventListener('click', exportJson);
  document.getElementById('exportCsv').addEventListener('click', exportCsv);
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('searchBox').value = '';
    document.getElementById('showFilter').value = '';
    document.getElementById('seasonFilter').value = '';
    document.getElementById('statusFilter').value = 'unwatched';
    document.getElementById('hideWatched').checked = true;
    updateSeasonOptions();
    render();
  });

  document.querySelectorAll('.bottomNav button[data-status]').forEach(button => {
    button.addEventListener('click', () => {
      document.getElementById('statusFilter').value = button.dataset.status;
      document.getElementById('hideWatched').checked = button.dataset.status !== 'watched';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  document.getElementById('themeBtn').addEventListener('click', () => {
    document.body.classList.toggle('light');
    localStorage.setItem(THEME_KEY, document.body.classList.contains('light') ? 'light' : 'dark');
  });

  document.getElementById('importJson').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await importStatusPayload(JSON.parse(await file.text()), 'Manual import');
    } catch (err) {
      alert('Could not import JSON: ' + err.message);
    } finally {
      event.target.value = '';
    }
  });

  document.getElementById('installBtn').addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt = null;
    } else {
      alert('On mobile, open the browser menu and choose Add to Home Screen / Install app.');
    }
  });

  const autoSync = document.getElementById('autoSync');
  autoSync.checked = localStorage.getItem(AUTOSYNC_KEY) !== '0';
  autoSync.addEventListener('change', event => setAutoSync(event.target.checked));
  setAutoSync(autoSync.checked);
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
