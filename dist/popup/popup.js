import { getAllCards, deleteCard } from '../storage.js';
let allCards = [];
async function init() {
    await loadCards();
    setupListeners();
}
async function loadCards() {
    allCards = await getAllCards();
    renderCards(allCards);
}
function renderCards(cards) {
    const list = document.getElementById('card-list');
    const empty = document.getElementById('empty-state');
    if (cards.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    list.innerHTML = cards.map(card => `
    <div class="card" data-id="${card.id}">
      <div class="card-favicon">${card.favicon ? `<img src="${escapeHtml(card.favicon)}" width="32" height="32">` : '🌐'}</div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(card.title)}</div>
        <div class="card-url">${escapeHtml(card.url)}</div>
        <div class="card-date">${formatDate(card.createdAt)}</div>
      </div>
      <button class="card-delete" data-id="${card.id}" title="删除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  `).join('');
    list.querySelectorAll('.card').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.card-delete'))
                return;
            const id = el.dataset.id;
            const card = cards.find(c => c.id === id);
            if (card)
                chrome.tabs.create({ url: card.url });
        });
    });
    list.querySelectorAll('.card-delete').forEach(el => {
        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = el.dataset.id;
            if (!id)
                return;
            await deleteCard(id);
            await loadCards();
        });
    });
}
function setupListeners() {
    const saveBtn = document.getElementById('save-current');
    const optionsBtn = document.getElementById('open-options');
    const searchInput = document.getElementById('search-input');
    saveBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url)
            return;
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
            alert('无法保存浏览器内置页面');
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
            const { saveCard } = await import('../storage.js');
            await saveCard({
                url: tab.url,
                title: result?.title || tab.title || tab.url,
                description: result?.description,
                favicon: tab.favIconUrl
            });
            await loadCards();
        }
        catch (err) {
            console.error('保存失败', err);
        }
    });
    optionsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });
    searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        if (!q) {
            renderCards(allCards);
            return;
        }
        const filtered = allCards.filter(c => c.title.toLowerCase().includes(q) ||
            c.url.toLowerCase().includes(q) ||
            (c.description && c.description.toLowerCase().includes(q)));
        renderCards(filtered);
    });
}
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function formatDate(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
}
document.addEventListener('DOMContentLoaded', init);
//# sourceMappingURL=popup.js.map