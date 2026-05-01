import { getAllCards, saveCard, deleteCard } from '../storage.js';
let allCards = [];
async function init() {
    await loadCards();
    setupNavigation();
    setupAddForm();
    setupSearch();
}
async function loadCards() {
    allCards = await getAllCards();
    renderGrid(allCards);
}
function renderGrid(cards) {
    const grid = document.getElementById('card-grid');
    if (cards.length === 0) {
        grid.innerHTML = '<p style="color:#86868b;padding:40px 0;text-align:center;">还没有书签，去「添加书签」页面创建一个吧</p>';
        return;
    }
    grid.innerHTML = cards.map(card => `
    <div class="card" data-id="${card.id}">
      <div class="card-header">
        <div class="card-favicon">${card.favicon ? `<img src="${escapeHtml(card.favicon)}" width="36" height="36">` : '🌐'}</div>
        <div class="card-header-text">
          <div class="card-title">${escapeHtml(card.title)}</div>
          <div class="card-url">${escapeHtml(card.url)}</div>
        </div>
      </div>
      ${card.description ? `<div class="card-desc">${escapeHtml(card.description)}</div>` : ''}
      <div class="card-meta">
        <span>${formatDate(card.createdAt)}</span>
        <div class="card-actions">
          <button class="btn-open" data-url="${escapeHtml(card.url)}">打开</button>
          <button class="btn-delete" data-id="${card.id}">删除</button>
        </div>
      </div>
    </div>
  `).join('');
    grid.querySelectorAll('.btn-open').forEach(el => {
        el.addEventListener('click', () => {
            const url = el.dataset.url;
            if (url)
                window.open(url, '_blank');
        });
    });
    grid.querySelectorAll('.btn-delete').forEach(el => {
        el.addEventListener('click', async () => {
            const id = el.dataset.id;
            if (!id)
                return;
            await deleteCard(id);
            await loadCards();
        });
    });
}
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            const target = item.getAttribute('href')?.replace('#', '');
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            if (target === 'cards') {
                document.getElementById('cards-section')?.classList.add('active');
            }
            else if (target === 'add') {
                document.getElementById('add-section')?.classList.add('active');
            }
        });
    });
}
function setupAddForm() {
    const form = document.getElementById('add-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('add-url').value.trim();
        const title = document.getElementById('add-title').value.trim();
        const desc = document.getElementById('add-desc').value.trim();
        if (!url || !title)
            return;
        await saveCard({ url, title, description: desc || undefined });
        form.reset();
        await loadCards();
        // Switch to cards view
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelector('.nav-item[href="#cards"]')?.classList.add('active');
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById('cards-section')?.classList.add('active');
    });
}
function setupSearch() {
    const input = document.getElementById('search-input');
    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) {
            renderGrid(allCards);
            return;
        }
        const filtered = allCards.filter(c => c.title.toLowerCase().includes(q) ||
            c.url.toLowerCase().includes(q) ||
            (c.description && c.description.toLowerCase().includes(q)));
        renderGrid(filtered);
    });
}
function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function formatDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
document.addEventListener('DOMContentLoaded', init);
//# sourceMappingURL=options.js.map