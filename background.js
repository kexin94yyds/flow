/**
 * background.js — Service Worker for Badge Updates
 *
 * Chrome's "always-on" background script for Tab Out.
 * Its only job: keep the toolbar badge showing the current open tab count.
 *
 * Since we no longer have a server, we query chrome.tabs directly.
 * The badge counts real web tabs (skipping chrome:// and extension pages).
 *
 * Color coding gives a quick at-a-glance health signal:
 *   Green  (#3d7a4a) → 1–10 tabs  (focused, manageable)
 *   Amber  (#b8892e) → 11–20 tabs (getting busy)
 *   Red    (#b35a5a) → 21+ tabs   (time to cull!)
 */

const NEW_TAB_DESTINATION_STORAGE_KEY = 'tabout_newtab_destination';
const CUSTOM_NEW_TAB_CONFIG_STORAGE_KEY = 'tabout_custom_newtab_config';
const DEFAULT_CUSTOM_NEW_TAB_URL = 'https://tobooks.xin/tobooks-main/';
const NEW_TAB_DESTINATION_CUSTOM = 'custom';
const NEW_TAB_DESTINATION_TABOUT = 'tabout';

function normalizeNewTabDestination(destination) {
  return destination === NEW_TAB_DESTINATION_CUSTOM
    ? NEW_TAB_DESTINATION_CUSTOM
    : NEW_TAB_DESTINATION_TABOUT;
}

async function saveNewTabDestination(destination) {
  try {
    await chrome.storage.local.set({
      [NEW_TAB_DESTINATION_STORAGE_KEY]: normalizeNewTabDestination(destination),
    });
  } catch {
    // Do not block the visible navigation path on a transient storage failure.
  }
}

async function getSavedNewTabDestination() {
  try {
    const result = await chrome.storage.local.get(NEW_TAB_DESTINATION_STORAGE_KEY);
    return normalizeNewTabDestination(result[NEW_TAB_DESTINATION_STORAGE_KEY]);
  } catch {
    return NEW_TAB_DESTINATION_TABOUT;
  }
}

function normalizeCustomNewTabUrl(value) {
  try {
    const raw = String(value || '').trim();
    if (!raw) return DEFAULT_CUSTOM_NEW_TAB_URL;

    const hasProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(raw);
    const candidate = hasProtocol ? raw : `https://${raw}`;
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return DEFAULT_CUSTOM_NEW_TAB_URL;
    }

    return parsed.href;
  } catch {
    return DEFAULT_CUSTOM_NEW_TAB_URL;
  }
}

async function getCustomNewTabUrl() {
  try {
    const result = await chrome.storage.local.get(CUSTOM_NEW_TAB_CONFIG_STORAGE_KEY);
    return normalizeCustomNewTabUrl(result[CUSTOM_NEW_TAB_CONFIG_STORAGE_KEY]?.url);
  } catch {
    return DEFAULT_CUSTOM_NEW_TAB_URL;
  }
}

async function openUrlInCurrentOrNewTab(tab, url) {
  if (typeof tab?.id === 'number') {
    try {
      await chrome.tabs.update(tab.id, { url });
      return;
    } catch {
      // Fall through and create a tab if Chrome will not update this one.
    }
  }

  await chrome.tabs.create({ url });
}

// ─── Badge updater ────────────────────────────────────────────────────────────

/**
 * updateBadge()
 *
 * Counts open real-web tabs and updates the extension's toolbar badge.
 * "Real" tabs = not chrome://, not extension pages, not about:blank.
 */
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});

    // Only count actual web pages — skip browser internals and extension pages
    const count = tabs.filter(t => {
      const url = t.url || '';
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('about:') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://')
      );
    }).length;

    // Don't show "0" — an empty badge is cleaner
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });

    if (count === 0) return;

    // Pick badge color based on workload level
    let color;
    if (count <= 10) {
      color = '#3d7a4a'; // Green — you're in control
    } else if (count <= 20) {
      color = '#b8892e'; // Amber — things are piling up
    } else {
      color = '#b35a5a'; // Red — time to focus and close some tabs
    }

    await chrome.action.setBadgeBackgroundColor({ color });

  } catch {
    // If something goes wrong, clear the badge rather than show stale data
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Update badge when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});

// Update badge when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Follow the selected new-tab destination when the user clicks the extension
// from Chrome's toolbar or extensions menu.
chrome.action.onClicked.addListener(async (tab) => {
  const destination = await getSavedNewTabDestination();
  const targetUrl = destination === NEW_TAB_DESTINATION_CUSTOM
    ? await getCustomNewTabUrl()
    : chrome.runtime.getURL('index.html');
  await openUrlInCurrentOrNewTab(tab, targetUrl);
});

// Update badge whenever a tab is opened
chrome.tabs.onCreated.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is closed
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
});

// Update badge when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener(() => {
  updateBadge();
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
