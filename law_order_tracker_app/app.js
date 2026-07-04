'use strict';

const STORE_KEY = 'law_order_tracker_status_v5';
const LEGACY_STORE_KEYS = ['law_order_tracker_status_v4', 'law_order_tracker_status_v3', 'law_order_tracker_status_v2', 'law_order_tracker_status'];
const COOKIE_PREFIX = 'lo_status_v5_';
const COOKIE_CHUNKS = 'lo_status_v5_chunks';
const THEME_KEY = 'law_order_tracker_theme';
const AUTOSYNC_KEY = 'law_order_auto_sync';
const ACCOUNT_ENABLED_KEY = 'law_order_account_enabled';
const SUPABASE_CONFIG = window.LAW_ORDER_ACCOUNT_CONFIG || {};
const PAGE_SIZE = 250;

let episodes = Array.isArray(window.LAW_ORDER_EPISODES) ? window.LAW_ORDER_EPISODES : [];
const themes = window.SHOW_THEMES || {};
let statusMap = loadStatusMap();
let current = [];
let renderedCount = 0;
let deferredInstallPrompt = null;
let autoTimer = null;
let supabaseClient = null;
let currentUser = null;
let cloudSaveTimer = null;
let accountLoadInProgress = false;
let accountSaveInProgress = false;

function getCookie(name) {
  const found = document.cookie.split('; ').find(row => row.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.split('=').slice(1).join('=')) : '';
}

function setCookie(name, value, days = 3650) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
}

function readStatusCookieBackup() {
  try {
    const chunkCount = Number(getCookie(COOKIE_CHUNKS) || 0);
    if (!chunkCount) return null;
    let raw = '';
    for (let i = 0; i < chunkCount; i++) raw += getCookie(`${COOKIE_PREFIX}${i}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn('Could not read cookie status backup:', err);
    return null;
  }
}

function writeStatusCookieBackup(map) {
  try {
    const raw = JSON.stringify(map || {});
    const oldChunks = Number(getCookie(COOKIE_CHUNKS) || 0);
    for (let i = 0; i < oldChunks; i++) deleteCookie(`${COOKIE_PREFIX}${i}`);

    // Cookies are small, so split the status backup into chunks. This is a backup;
    // localStorage remains the main storage for large libraries.
    const chunkSize = 3000;
    const chunks = Math.max(1, Math.ceil(raw.length / chunkSize));
    for (let i = 0; i < chunks; i++) setCookie(`${COOKIE_PREFIX}${i}`, raw.slice(i * chunkSize, (i + 1) * chunkSize));
    setCookie(COOKIE_CHUNKS, String(chunks));
  } catch (err) {
    console.warn('Could not write cookie status backup:', err);
  }
}

function loadStatusMap() {
  try {
    const currentRaw = localStorage.getItem(STORE_KEY);
    if (currentRaw) return JSON.parse(currentRaw) || {};
    for (const key of LEGACY_STORE_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) || {};
        localStorage.setItem(STORE_KEY, JSON.stringify(parsed));
        writeStatusCookieBackup(parsed);
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Could not read local status storage:', err);
  }

  const cookieBackup = readStatusCookieBackup();
  if (cookieBackup && typeof cookieBackup === 'object') {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cookieBackup)); } catch (_) {}
    return cookieBackup;
  }
  return {};
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(statusMap));
  } catch (err) {
    console.warn('Could not write localStorage status:', err);
  }
  writeStatusCookieBackup(statusMap);
}


function isAccountConfigured() {
  return Boolean(
    SUPABASE_CONFIG &&
    SUPABASE_CONFIG.url &&
    SUPABASE_CONFIG.anonKey &&
    !String(SUPABASE_CONFIG.url).includes('YOUR_SUPABASE') &&
    !String(SUPABASE_CONFIG.anonKey).includes('YOUR_SUPABASE')
  );
}

function mergeStatusMaps(base, incoming) {
  const merged = { ...(base || {}) };
  for (const [key, value] of Object.entries(incoming || {})) {
    const status = normalizeStatus(value);
    if (!status) continue;
    // Do not let a remote/older Not Started erase a meaningful local status.
    if (status === 'Not Started' && merged[key] && merged[key] !== 'Not Started') continue;
    merged[key] = status;
  }
  return merged;
}

function setupSupabaseClient() {
  if (supabaseClient || !isAccountConfigured() || !window.supabase) return supabaseClient;
  supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  return supabaseClient;
}

function setAccountText(message) {
  const el = document.getElementById('accountStatus');
  if (el) el.textContent = message;
}

function renderAccountUi() {
  const panel = document.getElementById('accountPanel');
  if (!panel) return;
  const configured = Boolean(setupSupabaseClient());
  panel.style.display = configured ? '' : '';
  const signedIn = Boolean(currentUser);
  const authBox = document.getElementById('authBox');
  const userBox = document.getElementById('userBox');
  if (authBox) authBox.style.display = signedIn ? 'none' : '';
  if (userBox) userBox.style.display = signedIn ? '' : 'none';
  const email = document.getElementById('accountEmail');
  if (email && currentUser) email.textContent = currentUser.email || currentUser.id;
  if (!configured) {
    setAccountText('Account sync is not configured yet. Add your Supabase URL and anon key in data/account_config.js. Local browser saving still works.');
  } else if (signedIn) {
    setAccountText('Signed in. Your watch status is saved to your account and restored on every device.');
  } else {
    setAccountText('Sign in to save your watch status to your account. Email magic-link and password sign-in are supported.');
  }
}

async function loadAccountStatus() {
  const client = setupSupabaseClient();
  if (!client || !currentUser) return;
  accountLoadInProgress = true;
  try {
    const { data, error } = await client
      .from('watch_status')
      .select('status, updated_at')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (error) throw error;
    if (data && data.status) {
      statusMap = mergeStatusMaps(statusMap, data.status);
      localStorage.setItem(STORE_KEY, JSON.stringify(statusMap));
      writeStatusCookieBackup(statusMap);
      render();
      showToast('Account loaded', 'Your saved account watch status was loaded.', 'success');
    } else {
      await saveAccountStatus(true);
      showToast('Account initialized', 'Your current local status was saved to your account.', 'success');
    }
  } catch (err) {
    showToast('Account load failed', err.message || String(err), 'error');
    setAccountText('Account load failed: ' + (err.message || String(err)));
  } finally {
    accountLoadInProgress = false;
  }
}

async function saveAccountStatus(force = false) {
  const client = setupSupabaseClient();
  if (!client || !currentUser || accountLoadInProgress) return;
  if (accountSaveInProgress && !force) return;
  accountSaveInProgress = true;
  try {
    const payload = {
      user_id: currentUser.id,
      status: statusMap || {},
      updated_at: new Date().toISOString()
    };
    const { error } = await client.from('watch_status').upsert(payload, { onConflict: 'user_id' });
    if (error) throw error;
    setAccountText('Saved to account at ' + new Date().toLocaleTimeString());
  } catch (err) {
    console.warn('Account save failed:', err);
    setAccountText('Account save failed: ' + (err.message || String(err)));
    if (force) showToast('Account save failed', err.message || String(err), 'error');
  } finally {
    accountSaveInProgress = false;
  }
}

function scheduleAccountSave() {
  if (!currentUser || accountLoadInProgress) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => saveAccountStatus(false), 900);
}

async function initAccount() {
  const client = setupSupabaseClient();
  renderAccountUi();
  if (!client) return;
  const { data } = await client.auth.getSession();
  currentUser = data && data.session ? data.session.user : null;
  renderAccountUi();
  if (currentUser) await loadAccountStatus();
  client.auth.onAuthStateChange(async (event, session) => {
    currentUser = session ? session.user : null;
    renderAccountUi();
    if (currentUser && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) await loadAccountStatus();
  });
}

async function signInOrSignUpAccount() {
  const client = setupSupabaseClient();
  if (!client) return showModal({ title: 'Account sync not configured', message: 'Add your Supabase project URL and anon key in data/account_config.js first.', type: 'warning', confirmText: 'OK' });
  const email = document.getElementById('authEmail')?.value.trim();
  const password = document.getElementById('authPassword')?.value;
  if (!email) return showToast('Email required', 'Enter your email address first.', 'warning');
  try {
    let result;
    if (password) {
      result = await client.auth.signInWithPassword({ email, password });
      if (result.error && /Invalid login credentials/i.test(result.error.message)) {
        result = await client.auth.signUp({ email, password });
      }
    } else {
      result = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
    }
    if (result.error) throw result.error;
    if (password) showToast('Signed in', 'Your account status will sync automatically.', 'success');
    else showModal({ title: 'Check your email', message: 'Supabase sent you a magic sign-in link. Open it on this device to finish signing in.', type: 'success', confirmText: 'OK' });
  } catch (err) {
    showModal({ title: 'Sign-in failed', message: err.message || String(err), type: 'error', confirmText: 'OK' });
  }
}

async function signOutAccount() {
  const client = setupSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
  currentUser = null;
  renderAccountUi();
  showToast('Signed out', 'Local browser status remains saved on this device.', 'info');
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

const SHOW_NAME_ALIASES = {
  [normText('Law & Order: SVU')]: normText('Law & Order: Special Victims Unit'),
  [normText('SVU')]: normText('Law & Order: Special Victims Unit'),
  [normText('Criminal Intent')]: normText('Law & Order: Criminal Intent'),
  [normText('Law Order Criminal Intent')]: normText('Law & Order: Criminal Intent'),
  [normText('Organized Crime')]: normText('Law & Order: Organized Crime'),
  [normText('Trial by Jury')]: normText('Law & Order: Trial by Jury'),
  [normText('Law Order UK')]: normText('Law & Order: UK'),
  [normText('Law Order LA')]: normText('Law & Order: LA'),
  [normText('True Crime')]: normText('Law & Order True Crime'),
  [normText('NY Undercover')]: normText('New York Undercover')
};

function normShow(value) {
  const n = normText(value);
  return SHOW_NAME_ALIASES[n] || n;
}

function episodeKey(ep) {
  return `${normShow(ep.show)}|${normNum(ep.season)}|${normNum(ep.episode)}`;
}

const episodeByExactId = new Map(episodes.map(ep => [String(ep.id), ep]));
const episodesByNoOrderKey = episodes.reduce((map, ep) => {
  const key = episodeKey(ep);
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(ep);
  return map;
}, new Map());

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


function showToast(title, message = '', type = 'info', timeout = 4200) {
  const host = document.getElementById('toastHost');
  if (!host) return;
  const colors = { success: '#28c76f', error: '#ef4444', warning: '#f6ad3d', info: '#60a5fa' };
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
    if (!overlay) {
      resolve(true);
      return;
    }
    const colors = { success: '#28c76f', error: '#ef4444', warning: '#f6ad3d', info: '#60a5fa' };
    const icon = type === 'success' ? '✓' : type === 'error' ? '!' : type === 'warning' ? '!' : 'i';
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
    nextMeta.innerHTML = '<span class="metaPill">Your Law & Order universe tracker is complete.</span>';
    nextNotes.textContent = '';
    setImageSafe(poster, artwork('Law & Order'));
    return;
  }

  nextTitle.textContent = `${next.show} ${next.code}${next.title ? ' — ' + next.title : ''}`;
  nextMeta.innerHTML = `<span class="metaPill">#${esc(next.order)}</span><span class="metaPill">${esc(next.airDate || 'No air date')}</span><span class="metaPill">Season ${esc(next.season)}, Episode ${esc(next.episode)}</span>`;
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

async function markBulk(scope, status) {
  const show = document.getElementById('bulkShow').value;
  const season = document.getElementById('bulkSeason').value;
  const targets = episodes.filter(ep => ep.show === show && (scope === 'show' || String(ep.season) === String(season)));
  const label = scope === 'show' ? `${show}` : `${show} Season ${season}`;
  const ok = await showModal({
    title: status === 'Watched' ? 'Mark as watched?' : 'Mark as unwatched?',
    message: `${label}: this will update ${targets.length} episodes to ${status === 'Watched' ? 'Watched' : 'Not Started'}.`,
    type: status === 'Watched' ? 'success' : 'warning',
    confirmText: status === 'Watched' ? 'Yes, update' : 'Yes, reset',
    cancelText: 'Cancel',
    danger: status !== 'Watched'
  });
  if (!ok) return;
  let changed = 0;
  targets.forEach(ep => {
    if (getStatus(ep) !== status) changed++;
    statusMap[ep.id] = status;
    statusMap[episodeKey(ep)] = status;
  });
  save();
  render();
  setText('syncStatus', `${changed} episode statuses updated.`);
  showToast('Bulk update complete', `${changed} episodes updated for ${label}.`, 'success');
}


function exportJson() {
  const payload = {
    version: 4,
    exportedAt: new Date().toISOString(),
    statuses: statusMap
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'law_order_watch_status.json');
  showToast('Export ready', 'Status JSON downloaded.', 'success');
}

function exportCsv() {
  const rows = [['Order', 'Status', 'Air Date', 'Show', 'Season', 'Episode', 'Code', 'Title', 'Notes']];
  current.forEach(ep => rows.push([ep.order, getStatus(ep), ep.airDate, ep.show, ep.season, ep.episode, ep.code, ep.title, ep.notes]));
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'law_order_current_view.csv');
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
  const remoteSource = /auto|hosted|trakt|sync/i.test(source);
  let changed = 0;
  let matched = 0;
  let skippedDowngrades = 0;

  function shouldApply(ep, status) {
    // Cloud/Trakt status files should never erase statuses the user changed in
    // the browser. This keeps watched marks persistent after refresh/redeploy.
    if (remoteSource && status === 'Not Started' && getStatus(ep) !== 'Not Started') {
      skippedDowngrades++;
      return false;
    }
    return true;
  }

  function applyToEpisode(ep, status) {
    if (!ep || !status) return;
    matched++;
    if (!shouldApply(ep, status)) return;
    if (statusMap[ep.id] !== status) {
      statusMap[ep.id] = status;
      changed++;
    }
    const noOrder = episodeKey(ep);
    if (statusMap[noOrder] !== status) statusMap[noOrder] = status;
  }

  // Preferred format: [{show, season, episode, status}]
  if (Array.isArray(payload.episodes)) {
    for (const item of payload.episodes) {
      const status = normalizeStatus(item.status);
      if (!status) continue;
      const key = `${normShow(item.show)}|${normNum(item.season)}|${normNum(item.episode)}`;
      const eps = episodesByNoOrderKey.get(key) || [];
      eps.forEach(ep => applyToEpisode(ep, status));
    }
  }

  // Backward compatible format: {statuses: {'Show|Season|Episode|Order': 'Watched'}}
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

    // Keep unknown statuses so an exported file does not lose data.
    // For hosted auto-sync, do not import unknown Not Started entries because
    // they can bloat storage and cannot affect visible guide rows.
    if (!(remoteSource && status === 'Not Started')) {
      if (statusMap[rawId] !== status) {
        statusMap[rawId] = status;
        changed++;
      }
    }
  }

  save();
  render();
  const extra = skippedDowngrades ? ` ${skippedDowngrades} local user changes protected.` : '';
  setText('syncStatus', `${source}: ${changed} status changes applied, ${matched} guide rows matched at ${new Date().toLocaleTimeString()}.${extra}`);
  showToast(source, `${changed} changes applied. ${matched} guide rows matched.${extra}`, changed ? 'success' : 'info');
  if (currentUser) await saveAccountStatus(true);
}

async function fetchHostedStatus() {
  if (window.location.protocol === 'file:') {
    setText('syncStatus', 'Auto-sync needs a local server, GitHub Pages, or Vercel. For local testing run: python -m http.server 8080, then open http://localhost:8080/law_order_tracker_app/');
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
      message: 'The in-website sync button works on Vercel because it uses a secure serverless API route. Locally, run python sync_trakt_and_excel.py instead.',
      type: 'warning',
      confirmText: 'OK'
    });
    return;
  }

  const ok = await showModal({
    title: 'Sync with Trakt now?',
    message: 'This will trigger the GitHub Actions Trakt sync. It usually takes 1–3 minutes, then Vercel redeploys the updated watched status automatically.',
    type: 'info',
    confirmText: 'Start sync',
    cancelText: 'Cancel'
  });
  if (!ok) return;

  const btn = document.getElementById('syncNowBtn');
  const previousText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Starting sync…';
  }
  setText('syncStatus', 'Starting cloud Trakt sync via GitHub Actions…');

  try {
    const response = await fetch('/api/trigger-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'law-order-tracker-app', ts: Date.now() })
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    const urlText = payload.run_url ? ` Open the workflow run: ${payload.run_url}` : '';
    setText('syncStatus', 'Cloud sync started. The site will pull the updated Trakt status in the background and save it to your account if you are signed in.' + urlText);
    showToast('Cloud sync started', 'GitHub Actions is now syncing Trakt. This page will poll for updates automatically.', 'success');
    window.setTimeout(fetchHostedStatus, 15000);
    window.setTimeout(fetchHostedStatus, 60000);
    window.setTimeout(fetchHostedStatus, 150000);
    window.setTimeout(fetchHostedStatus, 300000);
  } catch (err) {
    setText('syncStatus', `Cloud sync failed: ${err.message}`);
    showToast('Cloud sync failed', err.message, 'danger');
    await showModal({
      title: 'Could not start cloud sync',
      message: `${err.message}\n\nCheck that Vercel has GITHUB_PAT, GITHUB_REPO, and GITHUB_WORKFLOW environment variables set, then redeploy.`,
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

  document.getElementById('markNextWatched').addEventListener('click', async () => {
    const next = episodes.find(e => getStatus(e) !== 'Watched');
    if (!next) return showToast('Nothing to mark', 'All episodes are already watched.', 'info');
    const ok = await showModal({
      title: 'Mark next episode watched?',
      message: `${next.show} ${next.code}${next.title ? ' — ' + next.title : ''}`,
      type: 'success',
      confirmText: 'Mark watched',
      cancelText: 'Cancel'
    });
    if (ok) setStatus(next, 'Watched');
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

  document.getElementById('syncNowBtn').addEventListener('click', triggerCloudSync);
  const pullBtn = document.getElementById('pullStatusBtn');
  if (pullBtn) pullBtn.addEventListener('click', fetchHostedStatus);
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
    showToast('Filters reset', 'Showing unwatched episodes again.', 'info');
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
      showModal({ title: 'Import failed', message: err.message, type: 'error', confirmText: 'OK' });
    } finally {
      event.target.value = '';
    }
  });

  document.getElementById('installBtn').addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt = null;
    } else {
      showModal({ title: 'Install app', message: 'On mobile, open the browser menu and choose Add to Home Screen / Install app.', type: 'info', confirmText: 'OK' });
    }
  });

  const autoSync = document.getElementById('autoSync');
  autoSync.checked = localStorage.getItem(AUTOSYNC_KEY) !== '0';
  autoSync.addEventListener('change', event => setAutoSync(event.target.checked));
  setAutoSync(autoSync.checked);

  const signInBtn = document.getElementById('accountSignIn');
  if (signInBtn) signInBtn.addEventListener('click', signInOrSignUpAccount);
  const signOutBtn = document.getElementById('accountSignOut');
  if (signOutBtn) signOutBtn.addEventListener('click', signOutAccount);
  const saveCloudBtn = document.getElementById('accountSaveNow');
  if (saveCloudBtn) saveCloudBtn.addEventListener('click', () => saveAccountStatus(true));
  const loadCloudBtn = document.getElementById('accountLoadNow');
  if (loadCloudBtn) loadCloudBtn.addEventListener('click', loadAccountStatus);
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
  initAccount();
  const savedCount = Object.keys(statusMap || {}).length;
  if (savedCount) setText('syncStatus', `Loaded ${savedCount} saved local status entries from this browser.`);
});
