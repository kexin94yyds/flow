const STORAGE_KEY = 'card_bookmarks';
export async function getAllCards() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || [];
}
export async function saveCard(input) {
    const cards = await getAllCards();
    const card = {
        ...input,
        id: generateId(),
        createdAt: Date.now(),
    };
    cards.unshift(card);
    await chrome.storage.local.set({ [STORAGE_KEY]: cards });
    return card;
}
export async function addCard(card) {
    const cards = await getAllCards();
    cards.unshift(card);
    await chrome.storage.local.set({ [STORAGE_KEY]: cards });
}
export async function updateCard(id, updates) {
    const cards = await getAllCards();
    const index = cards.findIndex(c => c.id === id);
    if (index === -1)
        return;
    cards[index] = { ...cards[index], ...updates };
    await chrome.storage.local.set({ [STORAGE_KEY]: cards });
}
export async function deleteCard(id) {
    const cards = await getAllCards();
    const filtered = cards.filter(c => c.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
}
export async function importCards(cards) {
    await chrome.storage.local.set({ [STORAGE_KEY]: cards });
}
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
//# sourceMappingURL=storage.js.map