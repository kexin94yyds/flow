# Tab Out

Tab Out replaces Chrome's new tab page with a local dashboard of your open tabs.

## What It Does

- Groups open tabs by domain.
- Shows each open tab as a link preview card with title, description, favicon, and social card image when available.
- Caches link previews in `chrome.storage.local`.
- Jumps to an existing tab instead of opening duplicates.
- Closes individual tabs, duplicate tabs, or all open tabs.
- Saves tabs for later in `chrome.storage.local`.
- Runs as a pure Manifest V3 Chrome extension.

## Permissions

The extension requests `host_permissions` for `http://*/*` and `https://*/*` so it can fetch each open page's Open Graph/Twitter metadata and display preview images locally in the new-tab dashboard.

## Install Locally

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder:

```text
/Users/apple/最简单的网页
```

Open a new tab after loading the extension.

## Source And License

This project is based on `zarazhangrui/tab-out` and keeps the upstream MIT license attribution in `LICENSE`.
