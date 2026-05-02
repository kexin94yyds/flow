(function (global) {
  'use strict';

  const FLOW_KEYS = ['flowItems', 'flowNotes', 'flowData'];

  function hasExtensionStorage() {
    return typeof chrome !== 'undefined'
      && chrome.storage
      && chrome.storage.local
      && typeof chrome.storage.local.get === 'function'
      && typeof chrome.storage.local.set === 'function';
  }

  function readLocalJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeLocalJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[flow-storage] Could not write localStorage key:', key, err);
    }
  }

  async function getMany(keys) {
    if (hasExtensionStorage()) {
      try {
        return await chrome.storage.local.get(keys);
      } catch (err) {
        console.warn('[flow-storage] Could not read chrome.storage.local:', err);
      }
    }

    return keys.reduce((acc, key) => {
      acc[key] = readLocalJson(key, undefined);
      return acc;
    }, {});
  }

  async function setMany(payload, options) {
    const mirrorLocal = options?.mirrorLocal !== false;

    if (hasExtensionStorage()) {
      try {
        await chrome.storage.local.set(payload);
      } catch (err) {
        console.warn('[flow-storage] Could not write chrome.storage.local:', err);
      }
    }

    if (mirrorLocal) {
      Object.entries(payload).forEach(([key, value]) => {
        writeLocalJson(key, value);
      });
    }
  }

  async function loadFlowBundle() {
    const stored = await getMany(FLOW_KEYS);

    return {
      flowItems: Array.isArray(stored.flowItems)
        ? stored.flowItems
        : readLocalJson('flowItems', []),
      flowNotes: stored.flowNotes && typeof stored.flowNotes === 'object'
        ? stored.flowNotes
        : readLocalJson('flowNotes', null),
      flowData: stored.flowData && typeof stored.flowData === 'object'
        ? stored.flowData
        : readLocalJson('flowData', null)
    };
  }

  async function saveFlowBundle(bundle) {
    const payload = {};
    if ('flowItems' in bundle) payload.flowItems = bundle.flowItems;
    if ('flowNotes' in bundle) payload.flowNotes = bundle.flowNotes;
    if ('flowData' in bundle) payload.flowData = bundle.flowData;
    await setMany(payload);
  }

  async function loadFlowItems() {
    const { flowItems } = await loadFlowBundle();
    return Array.isArray(flowItems) ? flowItems : [];
  }

  async function saveFlowItems(items) {
    await saveFlowBundle({ flowItems: items });
  }

  global.FlowStorage = {
    hasExtensionStorage,
    readLocalJson,
    writeLocalJson,
    getMany,
    setMany,
    loadFlowBundle,
    saveFlowBundle,
    loadFlowItems,
    saveFlowItems
  };
})(window);
