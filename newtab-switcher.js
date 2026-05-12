(function () {
  'use strict';

  const DEFAULT_CUSTOM_NEW_TAB_URL = 'https://tobooks.xin/tobooks-main/';
  const hostId = 'tabout-newtab-switcher-host';

  if (document.getElementById(hostId)) return;

  function getCustomNewTabUrl() {
    const configured = typeof LOCAL_CUSTOM_NEW_TAB_URL === 'string'
      ? LOCAL_CUSTOM_NEW_TAB_URL.trim()
      : '';
    return configured || DEFAULT_CUSTOM_NEW_TAB_URL;
  }

  function getTabOutUrl() {
    try {
      return chrome.runtime.getURL('index.html');
    } catch {
      return '';
    }
  }

  const host = document.createElement('div');
  host.id = hostId;
  const shadow = host.attachShadow({ mode: 'closed' });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      .switcher {
        position: fixed;
        top: 18px;
        right: 24px;
        z-index: 2147483647;
        display: inline-grid;
        grid-template-columns: 1fr 1fr;
        align-items: center;
        gap: 3px;
        padding: 4px;
        border: 1px solid rgba(25, 32, 44, 0.18);
        border-radius: 8px;
        background: rgba(245, 247, 250, 0.92);
        color: #111827;
        font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow:
          inset 0 1px 2px rgba(15, 23, 42, 0.12),
          0 8px 26px rgba(15, 23, 42, 0.16);
        backdrop-filter: blur(14px) saturate(1.1);
        -webkit-backdrop-filter: blur(14px) saturate(1.1);
      }

      button {
        all: unset;
        min-width: 82px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        border-radius: 6px;
        color: rgba(17, 24, 39, 0.62);
        cursor: pointer;
        letter-spacing: 0;
        user-select: none;
        transition: color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
      }

      button:hover {
        color: #111827;
        background: rgba(255, 255, 255, 0.54);
      }

      button.is-active {
        color: #111827;
        background: rgba(255, 255, 255, 0.76);
        box-shadow:
          inset 0 2px 5px rgba(15, 23, 42, 0.16),
          0 1px 0 rgba(255, 255, 255, 0.82);
        cursor: default;
      }

      button:focus-visible {
        outline: 2px solid rgba(37, 99, 235, 0.62);
        outline-offset: 2px;
      }

      .icon {
        width: 17px;
        text-align: center;
        font-weight: 700;
      }

      @media (max-width: 720px) {
        .switcher {
          top: 12px;
          right: 12px;
          transform: scale(0.92);
          transform-origin: top right;
        }
      }
    </style>
    <nav class="switcher" aria-label="New tab destination">
      <button type="button" data-target="custom" class="is-active" aria-current="page" title="Current Tobooks page">
        <span class="icon" aria-hidden="true">▣</span>
        <span>Books</span>
      </button>
      <button type="button" data-target="tabout" title="Open Tab Out">
        <span class="icon" aria-hidden="true">∞</span>
        <span>Tab Out</span>
      </button>
    </nav>
  `;

  document.documentElement.appendChild(host);

  shadow.querySelector('[data-target="custom"]')?.addEventListener('click', () => {
    const customUrl = getCustomNewTabUrl();
    if (customUrl && window.location.href !== customUrl) {
      window.location.assign(customUrl);
    }
  });

  shadow.querySelector('[data-target="tabout"]')?.addEventListener('click', () => {
    const tabOutUrl = getTabOutUrl();
    if (chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'open-tabout-page' }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          if (tabOutUrl) window.location.assign(tabOutUrl);
        }
      });
      return;
    }
    if (tabOutUrl) window.location.assign(tabOutUrl);
  });
})();
