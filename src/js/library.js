/**
 * library.js — Library view (dynamic rendering from API)
 *
 * Fetches articles + collections from the API, renders sidebar
 * and article cards, handles sort, collection filter, remove + undo.
 *
 * Exports: mountLibrary
 *
 * Integration points:
 *   - api.js       — HTTP helpers
 *   - toast.js     — Notifications
 *   - app.js       — navigate() for opening reader
 */

import { api } from './api.js';
import { showToast } from './toast.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let articles = [];
let collections = [];
let activeCollection = 'all';
let currentSort = 'lastread';
let deleteTimer = null;
let pendingDeleteId = null;
let mounted = false;

// ---------------------------------------------------------------------------
// DOM references (inside #libraryView)
// ---------------------------------------------------------------------------
const view = () => document.getElementById('libraryView');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/** Relative time label (e.g. "3 hours ago", "Yesterday") */
function timeAgo(isoString) {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay} days ago`;
    if (diffDay < 30) return `${Math.floor(diffDay / 7)} week${Math.floor(diffDay / 7) > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
}

/** Reading time from word_count */
function readingTime(wordCount) {
    const minutes = Math.max(1, Math.round((wordCount || 0) / 225));
    return `${minutes} min read`;
}

/** Get collection name and color for an article */
function getCollectionInfo(collectionId) {
    if (!collectionId) return { name: 'Uncategorized', color: null };
    const col = collections.find(c => c.id === collectionId);
    return col ? { name: col.name, color: col.color } : { name: 'Uncategorized', color: null };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderSidebar() {
    const totalCount = articles.length;
    const uncatCount = articles.filter(a => !a.collection_id).length;

    let html = `
        <div class="sidebar-title">Collections</div>
        <ul class="collection-list">
            <li class="collection-item${activeCollection === 'all' ? ' active' : ''}" data-collection="all">
                <span class="collection-label">All Articles</span>
                <span class="collection-count">${totalCount}</span>
            </li>
            <li class="collection-item${activeCollection === 'uncategorized' ? ' active' : ''}" data-collection="uncategorized">
                <span class="collection-label">Uncategorized</span>
                <span class="collection-count">${uncatCount}</span>
            </li>`;

    for (const col of collections) {
        const count = articles.filter(a => a.collection_id === col.id).length;
        const isActive = activeCollection === col.id ? ' active' : '';
        html += `
            <li class="collection-item${isActive}" data-collection="${col.id}">
                <span class="collection-dot ${escapeHtml(col.color || 'blue')}"></span>
                <span class="collection-label">${escapeHtml(col.name)}</span>
                <span class="collection-count">${count}</span>
                <button class="collection-menu-btn" data-col-id="${col.id}" title="Collection options" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.8rem;padding:2px 6px;border-radius:4px;margin-left:auto;opacity:0;transition:opacity 0.15s;">&middot;&middot;&middot;</button>
            </li>`;
    }

    html += `
        </ul>
        <button class="new-collection-btn" id="newCollectionBtn">+ New Collection</button>`;

    return html;
}

function renderCard(article) {
    const progress = article.total_pages > 0
        ? Math.round((article.current_page / article.total_pages) * 100)
        : 0;
    const isComplete = progress >= 100;
    const colInfo = getCollectionInfo(article.collection_id);
    const domain = article.source_domain || '';
    const faviconUrl = domain
        ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`
        : '';

    const pageInfo = article.current_page <= 1 && article.total_pages > 1
        ? 'Not started'
        : `Page ${article.current_page} of ${article.total_pages}`;

    const readTimeLabel = article.last_read_at
        ? `Read ${timeAgo(article.last_read_at)}`
        : 'Not yet read';

    return `
        <div class="article-card${isComplete ? ' completed-card' : ''}" data-card-id="${article.id}" data-collection="${article.collection_id || 'uncategorized'}">
            <div class="card-top">
                <div class="card-meta-row">
                    <div class="card-source">
                        ${faviconUrl ? `<img class="card-favicon" src="${faviconUrl}" alt="">` : ''}
                        <span class="card-domain">${escapeHtml(domain)}</span>
                    </div>
                    <span class="card-badge">${escapeHtml(colInfo.name)}</span>
                </div>
                <div class="card-title">${escapeHtml(article.title)}</div>
                <div class="card-reading-time">${readingTime(article.word_count)}</div>
            </div>
            <div class="card-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progress}%"></div>
                </div>
                <div class="progress-info">
                    <span>${pageInfo}</span>
                    <span>${progress}%</span>
                </div>
            </div>
            <div class="card-bottom">
                <div class="card-time-stack">
                    ${isComplete
                        ? `<span class="card-time"><span class="completed-badge"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg> Finished</span></span>`
                        : `<span>${readTimeLabel}</span>`
                    }
                    <span class="time-secondary">Saved ${timeAgo(article.saved_at)}</span>
                </div>
                <button class="menu-btn" aria-label="Card menu">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
                    </svg>
                    <div class="card-menu">
                        <button class="card-menu-item move-btn">Move to...</button>
                        <button class="card-menu-item danger remove-btn">Remove from library</button>
                    </div>
                </button>
            </div>
        </div>`;
}

function getFilteredArticles() {
    let filtered = [...articles];

    // Filter by collection
    if (activeCollection === 'uncategorized') {
        filtered = filtered.filter(a => !a.collection_id);
    } else if (activeCollection !== 'all') {
        filtered = filtered.filter(a => a.collection_id === activeCollection);
    }

    return filtered;
}

function renderCards() {
    const filtered = getFilteredArticles();

    if (filtered.length === 0) {
        return `
            <div class="empty-state visible">
                <div class="empty-icon">
                    <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10 56V22c0-2 1-4 3-4h14c3 0 6 1 8 3v38c-2-2-5-3-8-3H13c-2 0-3-2-3-4z"/>
                        <path d="M70 56V22c0-2-1-4-3-4H53c-3 0-6 1-8 3v38c2-2 5-3 8-3h14c2 0 3-2 3-4z"/>
                        <path d="M35 21v38"/><path d="M45 21v38"/>
                    </svg>
                </div>
                <h2 class="empty-title">Your library is empty</h2>
                <p class="empty-subtitle">Articles you save will appear here</p>
            </div>`;
    }

    return `<div class="cards-grid" id="cardsGrid">${filtered.map(renderCard).join('')}</div>`;
}

function renderView() {
    const el = view();
    if (!el) return;

    const filtered = getFilteredArticles();

    el.innerHTML = `
        <style>.collection-item:hover .collection-menu-btn{opacity:1}.collection-menu-btn:hover{background:var(--surface-2)!important}</style>
        <div class="page-body">
            <aside class="sidebar" id="librarySidebar">${renderSidebar()}</aside>
            <main class="main-content">
                <div class="content-header">
                    <div>
                        <h1 class="content-title">Your Library</h1>
                        <p class="content-subtitle" id="articleCount">${filtered.length} article${filtered.length !== 1 ? 's' : ''} saved</p>
                    </div>
                    <div class="sort-wrapper">
                        <select class="sort-select" id="sortSelect">
                            <option value="lastread"${currentSort === 'lastread' ? ' selected' : ''}>Sort by: Last read</option>
                            <option value="saved"${currentSort === 'saved' ? ' selected' : ''}>Sort by: Date saved</option>
                            <option value="progress"${currentSort === 'progress' ? ' selected' : ''}>Sort by: Progress</option>
                        </select>
                    </div>
                </div>
                ${renderCards()}
            </main>
        </div>
        <div class="menu-overlay" id="menuOverlay"></div>`;

    bindEvents();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

let openMenu = null;

function closeAllMenus() {
    document.querySelectorAll('.card-menu.open').forEach(m => m.classList.remove('open'));
    openMenu = null;
    const overlay = document.getElementById('menuOverlay');
    if (overlay) overlay.classList.remove('active');
}

function bindEvents() {
    // Collection sidebar clicks
    const el = view();
    if (!el) return;

    el.querySelectorAll('.collection-item').forEach(item => {
        item.addEventListener('click', () => {
            activeCollection = item.dataset.collection;
            renderView();
        });
    });

    // Collection context menu buttons
    el.querySelectorAll('.collection-menu-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showCollectionContextMenu(btn, btn.dataset.colId);
        });
    });

    // Sort select
    const sortSelect = el.querySelector('#sortSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            currentSort = sortSelect.value;
            fetchArticles();
            // Persist sort preference
            api.patch('/api/user/preferences', { sort_preference: currentSort })
                .catch(err => console.error('Failed to save sort preference:', err));
        });
    }

    // New collection button
    const newColBtn = el.querySelector('#newCollectionBtn');
    if (newColBtn) {
        newColBtn.addEventListener('click', () => {
            const name = prompt('Collection name:');
            if (name && name.trim()) {
                createCollection(name.trim());
            }
        });
    }

    // Menu overlay
    const overlay = el.querySelector('#menuOverlay');
    if (overlay) {
        overlay.addEventListener('click', closeAllMenus);
    }

    // Card events
    el.querySelectorAll('.article-card').forEach(card => {
        bindCardEvents(card);
    });
}

function showMoveMenu(card) {
    const articleId = card.dataset.cardId;
    const article = articles.find(a => a.id === articleId);
    if (!article) return;

    // Remove any existing move menu
    const existing = document.getElementById('moveMenu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'moveMenu';
    menu.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;box-shadow:0 8px 32px rgba(0,0,0,0.18);z-index:500;min-width:220px;max-width:300px;';

    const title = document.createElement('div');
    title.textContent = 'Move to collection';
    title.style.cssText = 'font-weight:600;font-size:0.85rem;margin-bottom:12px;color:var(--text);font-family:var(--font-ui);';
    menu.appendChild(title);

    // Uncategorized option
    const currentColId = article.collection_id;
    const addOption = (label, colId) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        const isActive = colId === currentColId || (colId === null && !currentColId);
        btn.style.cssText = `width:100%;padding:8px 12px;background:${isActive ? 'var(--surface-2)' : 'none'};border:none;color:var(--text);font-family:var(--font-ui);font-size:0.8rem;font-weight:${isActive ? '600' : '500'};cursor:pointer;border-radius:6px;text-align:left;margin-bottom:2px;`;
        if (!isActive) {
            btn.onmouseenter = () => btn.style.background = 'var(--surface-2)';
            btn.onmouseleave = () => btn.style.background = 'none';
        }
        btn.onclick = async () => {
            if (isActive) { cleanup(); return; }
            try {
                await api.patch('/api/articles/' + articleId, { collection_id: colId });
                article.collection_id = colId;
                cleanup();
                renderView();
                showToast('Moved to ' + label, 'success');
            } catch (err) {
                showToast('Failed to move article', 'error');
            }
        };
        menu.appendChild(btn);
    };

    addOption('Uncategorized', null);
    for (const col of collections) {
        addOption(col.name, col.id);
    }

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'moveMenuBackdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:499;';
    const cleanup = () => {
        menu.remove();
        backdrop.remove();
    };
    backdrop.onclick = cleanup;

    document.body.appendChild(backdrop);
    document.body.appendChild(menu);
}

function showCollectionContextMenu(anchor, colId) {
    const col = collections.find(c => c.id === colId);
    if (!col) return;

    // Remove any existing
    const existing = document.getElementById('colContextMenu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'colContextMenu';
    menu.style.cssText = 'position:absolute;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:4px;box-shadow:0 4px 16px rgba(0,0,0,0.12);z-index:200;min-width:140px;';

    // Position near the button
    const rect = anchor.getBoundingClientRect();
    menu.style.top = rect.bottom + 4 + 'px';
    menu.style.left = rect.left + 'px';

    const btnStyle = 'width:100%;padding:8px 12px;background:none;border:none;color:var(--text);font-family:var(--font-ui);font-size:0.8rem;font-weight:500;cursor:pointer;border-radius:6px;text-align:left;';

    // Rename
    const renameBtn = document.createElement('button');
    renameBtn.textContent = 'Rename';
    renameBtn.style.cssText = btnStyle;
    renameBtn.onmouseenter = () => renameBtn.style.background = 'var(--surface-2)';
    renameBtn.onmouseleave = () => renameBtn.style.background = 'none';
    renameBtn.onclick = async () => {
        menu.remove();
        document.removeEventListener('click', closeMenu);
        const newName = prompt('Rename collection:', col.name);
        if (newName && newName.trim() && newName.trim() !== col.name) {
            try {
                await api.patch('/api/collections/' + colId, { name: newName.trim() });
                await fetchCollections();
                renderView();
                showToast('Collection renamed', 'success');
            } catch (err) {
                showToast(err.message || 'Failed to rename', 'error');
            }
        }
    };
    menu.appendChild(renameBtn);

    // Delete
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.style.cssText = btnStyle + 'color:var(--error);';
    deleteBtn.onmouseenter = () => { deleteBtn.style.background = 'var(--error-bg, var(--surface-2))'; };
    deleteBtn.onmouseleave = () => { deleteBtn.style.background = 'none'; };
    deleteBtn.onclick = async () => {
        menu.remove();
        document.removeEventListener('click', closeMenu);
        if (!confirm('Delete "' + col.name + '"? Articles will be moved to Uncategorized.')) return;
        try {
            await api.delete('/api/collections/' + colId);
            if (activeCollection === colId) activeCollection = 'all';
            await Promise.all([fetchCollections(), fetchArticles()]);
            showToast('Collection deleted', 'info');
        } catch (err) {
            showToast(err.message || 'Failed to delete', 'error');
        }
    };
    menu.appendChild(deleteBtn);

    document.body.appendChild(menu);

    const closeMenu = (e) => {
        if (!menu.contains(e.target) && e.target !== anchor) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

function bindCardEvents(card) {
    // Click card to open article
    card.addEventListener('click', (e) => {
        // Don't open if clicking menu
        if (e.target.closest('.menu-btn')) return;
        const articleId = card.dataset.cardId;
        openArticle(articleId);
    });

    // Menu button
    const menuBtn = card.querySelector('.menu-btn');
    if (menuBtn) {
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = menuBtn.querySelector('.card-menu');
            if (openMenu && openMenu !== menu) {
                openMenu.classList.remove('open');
            }
            menu.classList.toggle('open');
            const overlay = document.getElementById('menuOverlay');
            if (menu.classList.contains('open')) {
                openMenu = menu;
                if (overlay) overlay.classList.add('active');
            } else {
                openMenu = null;
                if (overlay) overlay.classList.remove('active');
            }
        });
    }

    // Remove button
    const removeBtn = card.querySelector('.remove-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllMenus();
            removeArticle(card);
        });
    }

    // Move button
    const moveBtn = card.querySelector('.move-btn');
    if (moveBtn) {
        moveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllMenus();
            showMoveMenu(card);
        });
    }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function fetchArticles() {
    try {
        const params = new URLSearchParams({ sort: currentSort });
        const data = await api.get(`/api/articles?${params}`);
        articles = data.articles || [];
        renderView();
    } catch (err) {
        console.error('Failed to load articles:', err);
        showToast('Failed to load library', 'error');
    }
}

async function fetchCollections() {
    try {
        const data = await api.get('/api/collections');
        collections = data.collections || [];
    } catch (err) {
        console.error('Failed to load collections:', err);
    }
}

async function createCollection(name) {
    try {
        await api.post('/api/collections', { name });
        await fetchCollections();
        renderView();
        showToast('Collection created', 'success');
    } catch (err) {
        showToast(err.message || 'Failed to create collection', 'error');
    }
}

function removeArticle(card) {
    const articleId = card.dataset.cardId;

    // Cancel any previous pending delete
    if (deleteTimer) {
        clearTimeout(deleteTimer);
        if (pendingDeleteId) {
            actualDelete(pendingDeleteId);
        }
    }

    // Animate removal
    const cardHeight = card.offsetHeight;
    card.style.maxHeight = cardHeight + 'px';
    void card.offsetHeight;
    card.classList.add('removing');

    // Remove from articles array
    const removedArticle = articles.find(a => a.id === articleId);
    articles = articles.filter(a => a.id !== articleId);

    // Remove card from DOM after animation
    setTimeout(() => {
        if (card.parentNode) card.remove();
        updateArticleCount();
    }, 450);

    pendingDeleteId = articleId;

    // Show toast with undo
    showToast('Article removed', 'info', {
        undoCallback: () => {
            // Undo: restore article to array and re-render
            clearTimeout(deleteTimer);
            pendingDeleteId = null;
            if (removedArticle) {
                articles.push(removedArticle);
                renderView();
                showToast('Article restored', 'success');
            }
        },
        duration: 5000,
    });

    // Delayed delete from server
    deleteTimer = setTimeout(() => {
        actualDelete(articleId);
        pendingDeleteId = null;
        deleteTimer = null;
    }, 5000);
}

async function actualDelete(articleId) {
    try {
        await api.delete(`/api/articles/${articleId}`);
    } catch (err) {
        console.error('Delete failed:', err);
    }
}

function updateArticleCount() {
    const countEl = document.getElementById('articleCount');
    if (!countEl) return;
    const filtered = getFilteredArticles();
    countEl.textContent = `${filtered.length} article${filtered.length !== 1 ? 's' : ''} saved`;
}

async function openArticle(articleId) {
    // Navigate to reader with this article
    // The reader module will handle fetching the full article
    const { navigate } = await import('./app.js');
    // Store the article ID so reader can pick it up
    sessionStorage.setItem('reader-article-id', articleId);
    navigate('/');
}

// ---------------------------------------------------------------------------
// Public: mountLibrary
// ---------------------------------------------------------------------------

/**
 * Mount the library view. Called by the router when navigating to /library.
 * Fetches data from the API and renders the view.
 */
export async function mountLibrary() {
    // Load user sort preference, then fetch data
    try {
        const profileData = await api.get('/api/user/profile');
        if (profileData?.profile?.sort_preference) {
            currentSort = profileData.profile.sort_preference;
        }
    } catch (_) {
        // Non-critical — use default
    }
    // Fetch collections and articles in parallel
    await Promise.all([fetchCollections(), fetchArticles()]);
}