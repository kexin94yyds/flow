"use strict";
// Background Service Worker
// 处理右键菜单、快捷键等全局功能
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'save-page',
        title: '保存当前页面到卡片书签',
        contexts: ['page', 'link']
    });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'save-page' && tab?.id) {
        const url = info.linkUrl || tab.url || '';
        const title = tab.title || url;
        if (url.startsWith('chrome://') || url.startsWith('edge://')) {
            return;
        }
        try {
            const [{ result }] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    return {
                        title: document.title,
                        description: document.querySelector('meta[name="description"]')?.content || ''
                    };
                }
            });
            const { saveCard } = await import('./storage.js');
            await saveCard({
                url,
                title: result?.title || title,
                description: result?.description,
                favicon: tab.favIconUrl
            });
        }
        catch (err) {
            console.error('Background save failed', err);
        }
    }
});
//# sourceMappingURL=background.js.map