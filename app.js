/* ================================================================
   Tab Out — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';

document.addEventListener('error', (event) => {
  const target = event.target;
  if (target instanceof HTMLImageElement && target.dataset.hideOnError === 'true') {
    target.style.display = 'none';
    target.closest('.preview-media')?.classList.add('is-missing-image');
  }
}, true);


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

const DEFAULT_CUSTOM_NEW_TAB_URL = 'https://tobooks.xin/tobooks-main/';
const DEFAULT_CUSTOM_NEW_TAB_LABEL = 'Tobooks';
const NEW_TAB_DESTINATION_STORAGE_KEY = 'tabout_newtab_destination';
const CUSTOM_NEW_TAB_CONFIG_STORAGE_KEY = 'tabout_custom_newtab_config';
const NEW_TAB_DESTINATION_CUSTOM = 'custom';
const NEW_TAB_DESTINATION_TABOUT = 'tabout';
const LINK_PREVIEW_CACHE_KEY = 'link_previews_v4';
const LINK_PREVIEW_MAX_AGE = 1000 * 60 * 60 * 24 * 7;
const LINK_PREVIEW_MISS_MAX_AGE = 1000 * 60 * 60 * 12;
const LINK_PREVIEW_TIMEOUT_MS = 5000;
const LINK_PREVIEW_EAGER_COUNT = 6;
const LINK_PREVIEW_IDLE_DELAY_MS = 180;
const LINK_PREVIEW_CACHE_SAVE_DEBOUNCE_MS = 700;
const linkPreviewRequests = new Set();
let linkPreviewCache = {};
let linkPreviewCacheLoaded = false;
let previewQueueToken = 0;
let previewCacheSaveTimer = null;
let customNewTabConfig = null;

function getDefaultCustomNewTabUrl() {
  const configured = typeof LOCAL_CUSTOM_NEW_TAB_URL === 'string'
    ? LOCAL_CUSTOM_NEW_TAB_URL.trim()
    : '';
  return configured || DEFAULT_CUSTOM_NEW_TAB_URL;
}

function getDefaultCustomNewTabLabel() {
  const configured = typeof LOCAL_CUSTOM_NEW_TAB_LABEL === 'string'
    ? LOCAL_CUSTOM_NEW_TAB_LABEL.trim()
    : '';
  return configured || DEFAULT_CUSTOM_NEW_TAB_LABEL;
}

function normalizeCustomNewTabUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Enter a URL.');

  const hasProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(raw);
  const candidate = hasProtocol ? raw : `https://${raw}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Use an http or https URL.');
  }

  return parsed.href;
}

function getLabelFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, '');
    return hostname || DEFAULT_CUSTOM_NEW_TAB_LABEL;
  } catch {
    return DEFAULT_CUSTOM_NEW_TAB_LABEL;
  }
}

function normalizeCustomNewTabConfig(value) {
  if (!value || typeof value !== 'object') return null;

  try {
    const url = normalizeCustomNewTabUrl(value.url);
    const label = String(value.label || '').trim() || getLabelFromUrl(url);
    return { label, url };
  } catch {
    return null;
  }
}

async function loadCustomNewTabConfig() {
  try {
    if (!globalThis.chrome?.storage?.local) return;
    const result = await chrome.storage.local.get(CUSTOM_NEW_TAB_CONFIG_STORAGE_KEY);
    customNewTabConfig = normalizeCustomNewTabConfig(result[CUSTOM_NEW_TAB_CONFIG_STORAGE_KEY]);
  } catch {
    customNewTabConfig = null;
  }
}

async function saveCustomNewTabConfig(labelValue, urlValue) {
  const url = normalizeCustomNewTabUrl(urlValue);
  const label = String(labelValue || '').trim() || getLabelFromUrl(url);
  const nextConfig = { label, url };

  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({
      [CUSTOM_NEW_TAB_CONFIG_STORAGE_KEY]: nextConfig,
    });
  }

  customNewTabConfig = nextConfig;
  applyCustomNewTabConfig();
  return nextConfig;
}

function getCustomNewTabUrl() {
  return customNewTabConfig?.url || getDefaultCustomNewTabUrl();
}

function getCustomNewTabLabel() {
  return customNewTabConfig?.label || getDefaultCustomNewTabLabel();
}

function getTabOutUrl() {
  try {
    return chrome.runtime.getURL('index.html');
  } catch {
    return 'index.html';
  }
}

function applyCustomNewTabConfig() {
  const label = getCustomNewTabLabel();
  const url = getCustomNewTabUrl();

  document.querySelectorAll('[data-custom-newtab-label]').forEach(el => {
    el.textContent = label;
  });

  document.querySelectorAll('[data-action="open-custom-newtab"]').forEach(el => {
    const title = url ? `Open ${label}: ${url}` : `Open ${label}`;
    el.setAttribute('title', title);
    el.setAttribute('aria-label', title);
  });

  document.querySelectorAll('[data-action="edit-custom-newtab"]').forEach(el => {
    el.setAttribute('title', `Edit ${label}: ${url}`);
    el.setAttribute('aria-label', `Edit ${label} URL`);
  });
}

function normalizeNewTabDestination(destination) {
  return destination === NEW_TAB_DESTINATION_CUSTOM
    ? NEW_TAB_DESTINATION_CUSTOM
    : NEW_TAB_DESTINATION_TABOUT;
}

async function getNewTabDestination() {
  try {
    if (!globalThis.chrome?.storage?.local) return NEW_TAB_DESTINATION_TABOUT;
    const result = await chrome.storage.local.get(NEW_TAB_DESTINATION_STORAGE_KEY);
    return normalizeNewTabDestination(result[NEW_TAB_DESTINATION_STORAGE_KEY]);
  } catch {
    return NEW_TAB_DESTINATION_TABOUT;
  }
}

async function setNewTabDestination(destination) {
  const normalizedDestination = normalizeNewTabDestination(destination);
  try {
    if (!globalThis.chrome?.storage?.local) return;
    await chrome.storage.local.set({
      [NEW_TAB_DESTINATION_STORAGE_KEY]: normalizedDestination,
    });
  } catch {
    // Navigation should still work even if storage is temporarily unavailable.
  } finally {
    applyNewTabDestinationState(normalizedDestination);
  }
}

function applyNewTabDestinationState(destination) {
  const normalizedDestination = normalizeNewTabDestination(destination);

  document.querySelectorAll('[data-action="open-custom-newtab"]').forEach(el => {
    const isActive = normalizedDestination === NEW_TAB_DESTINATION_CUSTOM;
    el.classList.toggle('is-active', isActive);
    if (isActive) {
      el.setAttribute('aria-current', 'page');
    } else {
      el.removeAttribute('aria-current');
    }
  });

  document.querySelectorAll('[data-action="open-tabout-page"]').forEach(el => {
    const isActive = normalizedDestination === NEW_TAB_DESTINATION_TABOUT;
    el.classList.toggle('is-active', isActive);
    if (isActive) {
      el.setAttribute('aria-current', 'page');
    } else {
      el.removeAttribute('aria-current');
    }
  });
}

function getCustomNewTabEditor() {
  return {
    modal: document.getElementById('customNewTabModal'),
    form: document.getElementById('customNewTabForm'),
    labelInput: document.getElementById('customNewTabLabelInput'),
    urlInput: document.getElementById('customNewTabUrlInput'),
    error: document.getElementById('customNewTabError'),
  };
}

function setCustomNewTabError(message) {
  const { error } = getCustomNewTabEditor();
  if (error) error.textContent = message || '';
}

function openCustomNewTabEditor() {
  const { modal, labelInput, urlInput } = getCustomNewTabEditor();
  if (!modal || !labelInput || !urlInput) return;

  labelInput.value = getCustomNewTabLabel();
  urlInput.value = getCustomNewTabUrl();
  setCustomNewTabError('');
  modal.hidden = false;
  requestAnimationFrame(() => {
    urlInput.focus();
    urlInput.select();
  });
}

function closeCustomNewTabEditor() {
  const { modal } = getCustomNewTabEditor();
  if (modal) modal.hidden = true;
  setCustomNewTabError('');
}

function setupCustomNewTabEditor() {
  const { modal, form, labelInput, urlInput } = getCustomNewTabEditor();
  if (!modal || !form || !labelInput || !urlInput) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setCustomNewTabError('');

    try {
      const nextConfig = await saveCustomNewTabConfig(labelInput.value, urlInput.value);
      await setNewTabDestination(NEW_TAB_DESTINATION_CUSTOM);
      closeCustomNewTabEditor();
      showToast(`Custom tab saved: ${nextConfig.label}`);
    } catch (err) {
      setCustomNewTabError(err?.message || 'Could not save this URL.');
    }
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeCustomNewTabEditor();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeCustomNewTabEditor();
  });
}

async function maybeRedirectToCustomNewTab(destination) {
  const nextDestination = arguments.length > 0
    ? normalizeNewTabDestination(destination)
    : await getNewTabDestination();
  if (nextDestination !== NEW_TAB_DESTINATION_CUSTOM) return false;

  const customUrl = getCustomNewTabUrl();
  if (!customUrl || window.location.href === customUrl) return false;

  window.location.replace(customUrl);
  return true;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function scheduleIdleTask(callback) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    return globalThis.requestIdleCallback(callback, { timeout: 1500 });
  }
  return setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 0);
}

function scheduleLinkPreviewCacheSave() {
  clearTimeout(previewCacheSaveTimer);
  previewCacheSaveTimer = setTimeout(() => {
    previewCacheSaveTimer = null;
    void saveLinkPreviewCache();
  }, LINK_PREVIEW_CACHE_SAVE_DEBOUNCE_MS);
}

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      favIconUrl: t.favIconUrl,
      windowId: t.windowId,
      active:   t.active,
      lastAccessed: typeof t.lastAccessed === 'number' ? t.lastAccessed : 0,
      // Flag Tab Out's own pages so we can detect duplicate new tabs
      isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Out new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Out tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

function checkTabOutDupes() {
  const banner = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner || !countEl) return;

  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const dupeCount = openTabs.filter(tab => {
    const url = tab.url || '';
    return url === 'chrome://newtab/' || url === newtabUrl || url.startsWith(`${newtabUrl}?`);
  }).length;

  if (dupeCount > 1) {
    countEl.textContent = String(dupeCount);
    banner.style.display = 'flex';
    return;
  }

  banner.style.display = 'none';
}

/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

async function loadFlowItems() {
  if (window.FlowStorage?.loadFlowItems) {
    return window.FlowStorage.loadFlowItems();
  }

  try {
    const raw = localStorage.getItem('flowItems');
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

async function saveFlowItems(items) {
  if (window.FlowStorage?.saveFlowItems) {
    await window.FlowStorage.saveFlowItems(items);
    return;
  }

  localStorage.setItem('flowItems', JSON.stringify(items));
}

function hashString(value) {
  const input = String(value || '');
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function domainFromUrl(url) {
  if (!url) return '';
  try {
    if (url.startsWith('file://')) return friendlyDomain('local-files');
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return friendlyDomain(hostname) || hostname;
  } catch {
    return '';
  }
}

function previewCardId(tab) {
  return `preview-card-${hashString(tab?.url || tab?.title || '')}`;
}

function previewForTab(tab) {
  const cached = getCachedLinkPreview(tab?.url);
  if (cached) return cached;

  const rawUrl = tab?.url || '';
  let hostname = '';
  try {
    hostname = rawUrl.startsWith('file://') ? 'local-files' : new URL(rawUrl).hostname;
  } catch {
    hostname = '';
  }

  const cleanedTitle = stripTitleNoise(tab?.title || '');
  const smart = smartTitle(cleanTitle(cleanedTitle || rawUrl, hostname), rawUrl);
  return {
    url: rawUrl,
    title: smart || rawUrl || 'Untitled',
    description: domainFromUrl(rawUrl) || rawUrl,
    imageUrl: getXFallbackImageUrl(rawUrl),
    faviconUrl: tab?.favIconUrl || fallbackFaviconUrl(rawUrl),
    fetchedAt: 0,
    fetched: false,
  };
}

function inferFlowPlatform(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    if (hostname === 'x.com' || hostname === 'twitter.com') return 'Twitter';
    if (hostname.includes('youtube.com') || hostname === 'youtu.be') return 'YouTube';
    if (hostname.includes('bilibili.com')) return 'Bilibili';
    return 'Web';
  } catch {
    return 'Web';
  }
}

function buildFlowItem(tab) {
  const preview = getCachedLinkPreview(tab.url) || previewForTab(tab);
  const title = preview.title || tab.title || tab.url || '未命名';
  const note = preview.description || domainFromUrl(tab.url) || '';

  return {
    id: `tabout-${Date.now()}-${hashString(tab.url || title)}`,
    url: tab.url || '',
    title,
    category: 'read_later',
    note,
    image: preview.imageUrl || '',
    platform: inferFlowPlatform(tab.url),
    createdAt: Date.now(),
    pinned: false,
    source: 'tab-out',
  };
}

async function saveTabToFlow(tab) {
  if (!tab?.url) return 'skipped';

  const items = await loadFlowItems();
  const flowItem = buildFlowItem(tab);
  const existing = items.find(item => item.url === flowItem.url);

  if (existing) {
    existing.title = flowItem.title || existing.title;
    existing.note = flowItem.note || existing.note;
    existing.image = flowItem.image || existing.image;
    existing.platform = flowItem.platform || existing.platform;
    existing.updatedAt = Date.now();
    await saveFlowItems(items);
    return 'updated';
  }

  items.unshift(flowItem);
  await saveFlowItems(items);
  return 'saved';
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
  check:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

function uniqueTabsByUrl(tabs) {
  const byUrl = new Map();
  for (const tab of tabs) {
    if (!tab.url) continue;
    const existing = byUrl.get(tab.url);
    if (!existing || tab.active) byUrl.set(tab.url, tab);
  }
  return [...byUrl.values()];
}

function isPreviewableUrl(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}

async function loadLinkPreviewCache() {
  if (linkPreviewCacheLoaded) return;
  try {
    const result = await chrome.storage.local.get(LINK_PREVIEW_CACHE_KEY);
    linkPreviewCache = result[LINK_PREVIEW_CACHE_KEY] || {};
  } catch {
    linkPreviewCache = {};
  } finally {
    linkPreviewCacheLoaded = true;
  }
}

async function saveLinkPreviewCache() {
  try {
    await chrome.storage.local.set({ [LINK_PREVIEW_CACHE_KEY]: linkPreviewCache });
  } catch {
    // Cache failures should not break the new-tab page.
  }
}

function getCachedLinkPreview(url) {
  const cached = linkPreviewCache[url];
  if (!cached) return null;
  const maxAge = cached.fetched ? LINK_PREVIEW_MAX_AGE : LINK_PREVIEW_MISS_MAX_AGE;
  if (!cached.fetchedAt || Date.now() - cached.fetchedAt > maxAge) return null;
  return cached;
}

function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getMetaContent(doc, selectors) {
  for (const selector of selectors) {
    const value = doc.querySelector(selector)?.getAttribute('content');
    if (value) return normalizeText(value);
  }
  return '';
}

function getLinkHref(doc, selectors) {
  for (const selector of selectors) {
    const value = doc.querySelector(selector)?.getAttribute('href');
    if (value) return normalizeText(value);
  }
  return '';
}

function absolutizeUrl(value, baseUrl) {
  if (!value) return '';
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return '';
  }
}

function fallbackFaviconUrl(url) {
  try {
    const domain = new URL(url).hostname;
    return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : '';
  } catch {
    return '';
  }
}

function decodeJsonStringValue(value) {
  if (!value) return '';
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value
      .replace(/\\\//g, '/')
      .replace(/\\u0026/g, '&')
      .replace(/&amp;/g, '&');
  }
}

function isXStatusUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    return (
      (hostname === 'x.com' || hostname === 'twitter.com') &&
      /\/status\/\d+/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function getXUsername(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    if (hostname !== 'x.com' && hostname !== 'twitter.com') return '';
    const [username] = parsed.pathname.split('/').filter(Boolean);
    if (!username || username === 'i' || username === 'intent' || username === 'share') return '';
    return username;
  } catch {
    return '';
  }
}

function normalizeExtractedImageUrl(value) {
  const decoded = decodeJsonStringValue(value || '')
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
  return decoded.startsWith('http://') || decoded.startsWith('https://') ? decoded : '';
}

function getFirstExtractedImageUrl(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const url = normalizeExtractedImageUrl(match?.[1] || match?.[0] || '');
    if (url) return url;
  }
  return '';
}

function getXFallbackImageUrl(url) {
  const username = getXUsername(url);
  return username ? `https://unavatar.io/twitter/${encodeURIComponent(username)}` : '';
}

function extractXImageUrl(html, url) {
  if (!isXStatusUrl(url) || !html) return '';

  // X often omits tweet media from OG tags and places it in INITIAL_STATE.
  const mediaUrl = getFirstExtractedImageUrl(html, [
    /"media_url_https"\s*:\s*"([^"]+)"/,
    /"media_url"\s*:\s*"([^"]+)"/,
    /https?:\\\/\\\/pbs\.twimg\.com\\\/media\\\/[^"\\]+/,
    /https?:\/\/pbs\.twimg\.com\/media\/[^"'<>\s]+/,
  ]);
  if (mediaUrl) return mediaUrl;

  const profileImageUrl = getFirstExtractedImageUrl(html, [
    /"profile_image_url_https"\s*:\s*"([^"]+)"/,
    /"profile_image_url"\s*:\s*"([^"]+)"/,
  ]).replace('_normal.', '_400x400.');
  if (profileImageUrl) return profileImageUrl;

  return getXFallbackImageUrl(url);
}

async function fetchLinkPreview(tab) {
  const url = tab.url;
  const fallbackTitle = normalizeText(tab.title || url);
  const fallback = {
    url,
    title: fallbackTitle,
    description: '',
    imageUrl: getXFallbackImageUrl(url),
    faviconUrl: tab.favIconUrl || fallbackFaviconUrl(url),
    fetchedAt: Date.now(),
    fetched: false,
  };

  if (!isPreviewableUrl(url)) return fallback;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINK_PREVIEW_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'follow',
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/html')) return fallback;

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const finalUrl = response.url || url;

    const title = normalizeText(
      getMetaContent(doc, [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
      ]) || doc.querySelector('title')?.textContent || fallbackTitle
    );
    const description = getMetaContent(doc, [
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
    ]);
    const imageUrl = absolutizeUrl(getMetaContent(doc, [
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
    ]), finalUrl) || extractXImageUrl(html, finalUrl);
    const faviconUrl = absolutizeUrl(getLinkHref(doc, [
      'link[rel="apple-touch-icon"]',
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
    ]), finalUrl) || fallback.faviconUrl;

    return {
      url,
      title: title || fallback.title,
      description,
      imageUrl,
      faviconUrl,
      fetchedAt: Date.now(),
      fetched: true,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureLinkPreview(tab) {
  if (!isPreviewableUrl(tab.url) || getCachedLinkPreview(tab.url) || linkPreviewRequests.has(tab.url)) return;

  linkPreviewRequests.add(tab.url);
  try {
    const preview = await fetchLinkPreview(tab);
    const shouldCachePreview = preview.fetched && (preview.imageUrl || !isXStatusUrl(tab.url));
    if (shouldCachePreview) {
      linkPreviewCache[tab.url] = preview;
      linkPreviewCacheLoaded = true;
      scheduleLinkPreviewCacheSave();
    }
    updatePreviewCard(tab, preview);
  } finally {
    linkPreviewRequests.delete(tab.url);
  }
}

async function runLinkPreviewQueue(tabs, queueToken) {
  for (const tab of tabs) {
    if (queueToken !== previewQueueToken) return;
    await ensureLinkPreview(tab);
    if (queueToken !== previewQueueToken) return;
    await wait(LINK_PREVIEW_IDLE_DELAY_MS);
  }
}

function queueLinkPreviewFetches(tabs) {
  const previewable = uniqueTabsByUrl(tabs).filter(tab => isPreviewableUrl(tab.url) && !getCachedLinkPreview(tab.url));
  if (previewable.length === 0) return;

  const queueToken = ++previewQueueToken;
  const eagerTabs = previewable.slice(0, LINK_PREVIEW_EAGER_COUNT);
  const remainingTabs = previewable.slice(LINK_PREVIEW_EAGER_COUNT);

  void runLinkPreviewQueue(eagerTabs, queueToken);

  if (remainingTabs.length > 0) {
    scheduleIdleTask(() => {
      if (queueToken !== previewQueueToken) return;
      void runLinkPreviewQueue(remainingTabs, queueToken);
    });
  }
}

function renderPreviewMedia(preview, title) {
  const imageUrl = preview.imageUrl || '';
  const className = imageUrl ? 'preview-media has-image' : 'preview-media is-missing-image';
  return `
    <div class="${className}">
      <div class="preview-placeholder">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Z" />
        </svg>
      </div>
      ${imageUrl ? `<img class="preview-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" data-hide-on-error="true" loading="lazy" decoding="async">` : ''}
    </div>`;
}

function getTabAccessTimestamp(tab) {
  const timestamp = Number(tab?.lastAccessed || 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function formatCompactTimeBadge(timestamp) {
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(diff / 86400000);
  if (days < 7) return `${days}d`;

  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatTabCardTime(tab) {
  const timestamp = getTabAccessTimestamp(tab);
  return timestamp ? formatCompactTimeBadge(timestamp) : '';
}

function formatTabCardTimeTitle(tab) {
  const timestamp = getTabAccessTimestamp(tab);
  if (!timestamp) return '';

  return `Last viewed ${new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function savedItemToPreviewTab(item) {
  return {
    url: item.url || '',
    title: item.title || item.url || '',
  };
}

function formatSavedCardTime(item) {
  const timestamp = Date.parse(item?.savedAt || '');
  return Number.isFinite(timestamp) ? formatCompactTimeBadge(timestamp) : '';
}

function formatSavedCardTimeTitle(item) {
  const timestamp = Date.parse(item?.savedAt || '');
  if (!Number.isFinite(timestamp)) return '';

  return `Saved ${new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function renderTabPreviewCard(tab, urlCounts) {
  const preview = previewForTab(tab);
  const domain = domainFromUrl(tab.url);
  const title = preview.title || tab.title || tab.url;
  const description = preview.description || tab.url;
  const faviconUrl = preview.faviconUrl || tab.favIconUrl || fallbackFaviconUrl(tab.url);
  const safeUrl = escapeHtml(tab.url || '');
  const safeTitle = escapeHtml(title);
  const tabTime = formatTabCardTime(tab);
  const tabTimeTitle = formatTabCardTimeTitle(tab);
  const count = urlCounts[tab.url] || 1;

  return `
    <article class="link-preview-card app-tile" id="${previewCardId(tab)}" data-action="focus-tab" data-tab-url="${safeUrl}" role="button" tabindex="0" aria-label="${safeTitle}">
      ${renderPreviewMedia(preview, title)}
      <div class="preview-card-body">
        <div class="preview-domain">
          ${faviconUrl ? `<img src="${escapeHtml(faviconUrl)}" alt="" data-hide-on-error="true" loading="lazy" decoding="async">` : ''}
          <span>${escapeHtml(domain || 'Open tab')}</span>
          <span class="preview-domain-spacer"></span>
          ${tabTime ? `<span class="preview-time" title="${escapeHtml(tabTimeTitle)}">${escapeHtml(tabTime)}</span>` : ''}
          ${count > 1 ? `<span class="preview-dupe">${count}x</span>` : ''}
        </div>
        <h3 class="preview-title" title="${safeTitle}">${safeTitle}</h3>
        <p class="preview-description">${escapeHtml(description)}</p>
        <div class="preview-actions">
          <button class="action-btn save-tabs" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}">
            ${ICONS.archive}
            Save
          </button>
          <button class="action-btn close-tabs" data-action="close-single-tab" data-tab-url="${safeUrl}">
            ${ICONS.close}
            Close
          </button>
        </div>
      </div>
    </article>`;
}

function renderSavedPreviewCard(item) {
  const tab = savedItemToPreviewTab(item);
  const preview = previewForTab(tab);
  const domain = domainFromUrl(item.url);
  const title = preview.title || item.title || item.url;
  const faviconUrl = preview.faviconUrl || fallbackFaviconUrl(item.url);
  const safeUrl = escapeHtml(item.url || '');
  const safeTitle = escapeHtml(title);
  const savedTime = formatSavedCardTime(item);
  const savedTimeTitle = formatSavedCardTimeTitle(item);

  return `
    <article class="link-preview-card app-tile saved-preview-card" id="${previewCardId(tab)}" data-action="open-deferred-tab" data-tab-url="${safeUrl}" role="button" tabindex="0" aria-label="${safeTitle}">
      <button class="saved-card-remove" data-action="dismiss-deferred" data-deferred-id="${escapeHtml(item.id)}" title="Remove">
        ${ICONS.close}
      </button>
      ${renderPreviewMedia(preview, title)}
      <div class="preview-card-body">
        <div class="preview-domain">
          ${faviconUrl ? `<img src="${escapeHtml(faviconUrl)}" alt="" data-hide-on-error="true" loading="lazy" decoding="async">` : ''}
          <span>${escapeHtml(domain || 'Saved')}</span>
          <span class="preview-domain-spacer"></span>
          ${savedTime ? `<span class="preview-time" title="${escapeHtml(savedTimeTitle)}">${escapeHtml(savedTime)}</span>` : ''}
        </div>
        <h3 class="preview-title" title="${safeTitle}">${safeTitle}</h3>
      </div>
    </article>`;
}

function updatePreviewCard(tab, preview) {
  const card = document.getElementById(previewCardId(tab));
  if (!card) return;

  const title = preview.title || tab.title || tab.url;
  const description = preview.description || tab.url;
  const titleEl = card.querySelector('.preview-title');
  const descriptionEl = card.querySelector('.preview-description');
  const mediaEl = card.querySelector('.preview-media');
  const faviconEl = card.querySelector('.preview-domain img');

  if (titleEl) {
    titleEl.textContent = title;
    titleEl.setAttribute('title', title);
  }
  if (descriptionEl) descriptionEl.textContent = description;
  if (mediaEl) mediaEl.outerHTML = renderPreviewMedia(preview, title);
  if (faviconEl && preview.faviconUrl) faviconEl.setAttribute('src', preview.faviconUrl);
}

async function renderSavedTabsAsPreviewCards(activeItems) {
  const openTabsSection = document.getElementById('openTabsSection');
  const openTabsMissionsEl = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (!openTabsSection || !openTabsMissionsEl) return;

  openTabsMissionsEl.classList.add('link-preview-grid');

  const active = activeItems || (await getSavedTabs()).active;

  if (active.length === 0) {
    openTabsMissionsEl.innerHTML = `
      <div class="missions-empty-state saved-empty-state">
        <div class="empty-title">Nothing saved yet.</div>
        <div class="empty-subtitle">Save a tab and it will live here like an app.</div>
      </div>
    `;
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Saved apps';
    if (openTabsSectionCount) openTabsSectionCount.textContent = '';
    openTabsSection.style.display = 'block';
    return;
  }

  if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Saved apps';
  if (openTabsSectionCount) {
    openTabsSectionCount.textContent = `${active.length} saved`;
  }
  openTabsMissionsEl.innerHTML = active.map(item => renderSavedPreviewCard(item)).join('');
  openTabsSection.style.display = 'block';
  queueLinkPreviewFetches(active.map(savedItemToPreviewTab));
}

function renderOpenTabItem(tab, urlCounts) {
  const domain = domainFromUrl(tab.url);
  const title = tab.title || tab.url || 'Untitled';
  const faviconUrl = tab.favIconUrl || fallbackFaviconUrl(tab.url);
  const safeUrl = escapeHtml(tab.url || '');
  const safeTitle = escapeHtml(title);
  const tabTime = formatTabCardTime(tab);
  const count = urlCounts[tab.url] || 1;

  return `
    <div class="deferred-item open-tab-item" data-tab-url="${safeUrl}">
      <button class="open-tab-favicon" data-action="focus-tab" data-tab-url="${safeUrl}" title="Open tab">
        ${faviconUrl ? `<img src="${escapeHtml(faviconUrl)}" alt="" data-hide-on-error="true" loading="lazy" decoding="async">` : ''}
      </button>
      <div class="deferred-info">
        <button class="deferred-title text" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">${safeTitle}</button>
        <div class="deferred-meta">
          <span>${escapeHtml(domain || 'Open tab')}</span>
          ${tabTime ? `<span>${escapeHtml(tabTime)}</span>` : ''}
          ${count > 1 ? `<span>${count}x</span>` : ''}
        </div>
      </div>
      <button class="open-tab-save-btn" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save to Flow">
        ${ICONS.archive}
        <span>Save</span>
      </button>
      <button class="deferred-dismiss" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close tab">
        ${ICONS.close}
      </button>
    </div>`;
}

function renderOpenTabsColumn(realTabs) {
  const column = document.getElementById('deferredColumn');
  const list = document.getElementById('deferredList');
  const empty = document.getElementById('deferredEmpty');
  const countEl = document.getElementById('deferredCount');
  const archiveEl = document.getElementById('deferredArchive');
  const heading = column?.querySelector('.section-header h2');

  if (!column || !list || !empty) return;

  column.style.display = 'block';
  if (heading) heading.textContent = 'Open tabs';
  if (archiveEl) archiveEl.style.display = 'none';

  if (realTabs.length === 0) {
    list.style.display = 'none';
    empty.textContent = 'No open tabs.';
    empty.style.display = 'block';
    if (countEl) countEl.textContent = '';
    return;
  }

  const urlCounts = {};
  for (const tab of realTabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const displayTabs = uniqueTabsByUrl(realTabs);
  const duplicates = Object.values(urlCounts).reduce((sum, count) => sum + Math.max(0, count - 1), 0);

  if (countEl) {
    countEl.textContent = `${realTabs.length} tab${realTabs.length !== 1 ? 's' : ''}${duplicates ? ` · ${duplicates} dupes` : ''}`;
  }
  list.innerHTML = displayTabs.map(tab => renderOpenTabItem(tab, urlCounts)).join('');
  list.style.display = 'block';
  empty.style.display = 'none';
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const ago = timeAgo(item.savedAt);
  const title = item.title || item.url;

  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="deferred-title" title="${escapeHtml(title)}">
          <img src="${escapeHtml(faviconUrl)}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" data-hide-on-error="true" loading="lazy" decoding="async">${escapeHtml(title)}
        </a>
        <div class="deferred-meta">
          <span>${escapeHtml(domain)}</span>
          <span>${escapeHtml(ago)}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  const title = item.title || item.url;
  return `
    <div class="archive-item">
      <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="archive-item-title" title="${escapeHtml(title)}">
        ${escapeHtml(title)}
      </a>
      <span class="archive-item-date">${escapeHtml(ago)}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();
  const savedTabs = await getSavedTabs();

  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay') || document.getElementById('date');
  if (greetingEl) greetingEl.textContent = 'Flow';
  if (dateEl)     dateEl.textContent     = `${savedTabs.active.length} saved · ${realTabs.length} open`;

  // --- Render saved items as app-style cards, with open tabs in the side rail ---
  await loadLinkPreviewCache();
  await renderSavedTabsAsPreviewCards(savedTabs.active);
  renderOpenTabsColumn(realTabs);
  return;

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    openTabsSectionCount.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---
  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();
}

async function renderDashboard() {
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  if (action === 'edit-custom-newtab') {
    e.preventDefault();
    openCustomNewTabEditor();
    return;
  }

  if (action === 'cancel-custom-newtab') {
    e.preventDefault();
    closeCustomNewTabEditor();
    return;
  }

  if (action === 'open-custom-newtab') {
    e.preventDefault();
    await setNewTabDestination(NEW_TAB_DESTINATION_CUSTOM);
    showToast(`New tabs will open ${getCustomNewTabLabel()}`);
    return;
  }

  if (action === 'open-tabout-page') {
    e.preventDefault();
    await setNewTabDestination(NEW_TAB_DESTINATION_TABOUT);
    const tabOutUrl = getTabOutUrl();
    if (window.location.href !== tabOutUrl) window.location.assign(tabOutUrl);
    return;
  }

  // ---- Close duplicate Tab Out tabs ----
  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Tab Out tabs');
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Open a saved app tile ----
  if (action === 'open-deferred-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    const allTabs = await chrome.tabs.query({});
    const match = allTabs.find(t => t.url === tabUrl);
    if (match) {
      await chrome.tabs.update(match.id, { active: true });
      await chrome.windows.update(match.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: tabUrl, active: true });
    }
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    playCloseSound();

    // Animate the chip row/card out
    const chip = actionEl.closest('.page-chip');
    const previewCard = actionEl.closest('.link-preview-card');
    const openTabItem = actionEl.closest('.open-tab-item');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }
    if (previewCard) {
      const rect = previewCard.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      previewCard.classList.add('closing');
      setTimeout(() => {
        previewCard.remove();
        renderDashboard();
      }, 250);
    }
    if (openTabItem) {
      openTabItem.classList.add('removing');
      setTimeout(() => {
        openTabItem.remove();
        renderDashboard();
      }, 300);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast('Tab closed');
    if (!chip && !previewCard && !openTabItem) await renderDashboard();
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast('Failed to save tab');
      return;
    }

    // Close the tab in Chrome
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    // Animate chip/card out
    const chip = actionEl.closest('.page-chip');
    const previewCard = actionEl.closest('.link-preview-card');
    const openTabItem = actionEl.closest('.open-tab-item');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }
    if (previewCard) {
      previewCard.classList.add('closing');
      setTimeout(() => {
        previewCard.remove();
        renderDashboard();
      }, 250);
    }
    if (openTabItem) {
      openTabItem.classList.add('removing');
      setTimeout(() => {
        openTabItem.remove();
        renderDashboard();
      }, 300);
    }

    showToast('Saved for later');
    if (!previewCard && !openTabItem) await renderDashboard();
    return;
  }

  if (action === 'save-to-flow') {
    e.stopPropagation();
    const tabUrl = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    const tab = openTabs.find(t => t.url === tabUrl) || { url: tabUrl, title: tabTitle };
    const result = await saveTabToFlow(tab);
    showToast(result === 'updated' ? 'Updated in Flow' : 'Saved to Flow');
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    const savedCard = actionEl.closest('.saved-preview-card');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDashboard(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    if (savedCard) {
      savedCard.classList.add('closing');
      setTimeout(() => {
        savedCard.remove();
        renderDashboard();
      }, 250);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    const savedCard = actionEl.closest('.saved-preview-card');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDashboard();
      }, 300);
    }
    if (savedCard) {
      savedCard.classList.add('closing');
      setTimeout(() => {
        savedCard.remove();
        renderDashboard();
      }, 250);
    }
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast('Closed duplicates, kept one copy each');
    await renderDashboard();
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card, #openTabsMissions .link-preview-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      if (c.classList.contains('mission-card')) {
        animateCardOut(c);
      } else {
        c.classList.add('closing');
        setTimeout(() => c.remove(), 250);
      }
    });

    showToast('All tabs closed. Fresh start.');
    return;
  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || '<div style="font-size:12px;color:var(--muted);padding:8px 0">No results</div>';
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
async function initializeDashboard() {
  setupCustomNewTabEditor();
  await loadCustomNewTabConfig();
  applyCustomNewTabConfig();
  const destination = await getNewTabDestination();
  applyNewTabDestinationState(destination);
  if (await maybeRedirectToCustomNewTab(destination)) return;
  await renderDashboard();
}

initializeDashboard();
