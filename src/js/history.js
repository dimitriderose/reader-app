/**
 * history.js — History view (dynamic rendering from API)
 *
 * Fetches history entries from the API, groups by date,
 * renders entries with progress rings, handles delete + undo,
 * clear all with confirmation, click to re-open.
 *
 * Exports: mountHistory
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
let entries = [];
let deleteTimer = null;
let pendingDeleteId = null;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const view = () => document.getElementById('historyView');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/** Group entries by date label (Today, Yesterday, specific date) */
function groupByDate(entries) {
    const groups = [];
    const groupMap = new Map();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeekStart = new Date(today);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    for (const entry of entries) {
        const opened = new Date(entry.opened_at);
        const entryDate = new Date(opened.getFullYear(), opened.getMonth(), opened.getDate());
        let label;

        if (entryDate >= today) {
            label = 'Today';
        } else if (entryDate >= yesterday) {
            label = 'Yesterday';
        } else if (entryDate >= lastWeekStart) {
            label = 'Last week';
        } else {
            label = opened.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        }

        if (!groupMap.has(label)) {
            const group = { label, entries: [] };
            groupMap.set(label, group);
            groups.push(group);
        }
        groupMap.get(label).entries.push(entry);
    }

    return groups;
}

/** Time ago label for individual entries */
function timeAgo(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? 's' : ''} ago`;
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay} days ago`;
    if (diffDay < 30) return `${Math.floor(diffDay / 7)} week${Math.floor(diffDay / 7) > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Progress ring SVG
// ---------------------------------------------------------------------------

const CIRCUMFERENCE = 2 * Math.PI * 9; // r=9, C ≈ 56.549

function renderProgressRing(current, total) {
    const progress = total > 0 ? Math.round((current / total) * 100) : 0;
    const isComplete = progress >= 100;
    const offset = CIRCUMFERENCE - (progress / 100) * CIRCUMFERENCE;

    if (isComplete) {
        return `
            <div class="progress-ring complete" title="100%">
                <svg width="24" height="24" viewBox="0 0 24 24">
                    <circle class="progress-ring-bg" cx="12" cy="12" r="9"/>
                    <circle class="progress-ring-fill" cx="12" cy="12" r="9"
                        stroke-dasharray="${CIRCUMFERENCE.toFixed(3)}"
                        stroke-dashoffset="0"/>
                </svg>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#51CF66" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
            </div>`;
    }

    return `
        <div class="progress-ring" title="${progress}%">
            <svg width="24" height="24" viewBox="0 0 24 24">
                <circle class="progress-ring-bg" cx="12" cy="12" r="9"/>
                <circle class="progress-ring-fill" cx="12" cy="12" r="9"
                    stroke-dasharray="${CIRCUMFERENCE.toFixed(3)}"
                    stroke-dashoffset="${offset.toFixed(3)}"/>
            </svg>
            <span class="progress-ring-text">${progress}</span>
        </div>`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderEntry(entry) {
    const progress = entry.total_pages > 0
        ? Math.round((entry.current_page / entry.total_pages) * 100)
        : 0;
    const isComplete = progress >= 100;
    const domain = entry.source_domain || '';
    const faviconUrl = domain
        ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`
        : '';

    // Page info
    let pageInfo;
    if (isComplete) {
        pageInfo = `<span class="entry-meta-item meta-finished">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
            Finished
        </span>`;
    } else if (entry.current_page <= 1 && entry.total_pages > 1) {
        pageInfo = `<span class="entry-meta-item meta-not-started">Not started</span>`;
    } else {
        pageInfo = `<span class="entry-meta-item">Page ${entry.current_page} of ${entry.total_pages}</span>`;
    }

    // Saved star (if article_id exists, the entry is also in the library)
    const starHtml = entry.article_id
        ? `<span class="entry-star" title="Saved to library">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
           </span>`
        : '';

    return `
        <div class="history-entry${isComplete ? ' finished' : ''}" data-id="${entry.id}">
            <div class="entry-left">
                <div class="entry-title">${escapeHtml(entry.title)}</div>
                <div class="entry-meta">
                    ${domain ? `<span class="entry-meta-item">
                        ${faviconUrl ? `<img class="meta-favicon" src="${faviconUrl}" alt="">` : ''}
                        ${escapeHtml(domain)}
                    </span>
                    <span class="meta-dot">&middot;</span>` : ''}
                    ${pageInfo}
                    <span class="meta-dot">&middot;</span>
                    <span class="entry-meta-item">${timeAgo(entry.opened_at)}</span>
                </div>
            </div>
            <div class="entry-right">
                ${starHtml}
                ${renderProgressRing(entry.current_page, entry.total_pages)}
                <button class="entry-delete" title="Remove from history" data-id="${entry.id}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        </div>`;
}

function renderGroups(groups) {
    return groups.map(group => `
        <div class="date-group">
            <div class="date-group-header">
                <span class="date-group-label">${escapeHtml(group.label)}</span>
                <div class="date-group-line"></div>
            </div>
            ${group.entries.map(renderEntry).join('')}
        </div>
    `).join('');
}

function renderView() {
    const el = view();
    if (!el) return;

    const groups = groupByDate(entries);
    const isEmpty = entries.length === 0;

    el.innerHTML = `
        <div class="page-container">
            <div class="page-header">
                <div class="page-header-top">
                    <h1 class="page-title">Reading History</h1>
                    ${!isEmpty ? '<button class="clear-all-btn" id="clearAllBtn">Clear all history</button>' : ''}
                </div>
                <p class="page-subtitle">Your recently opened articles</p>
            </div>

            <div class="clear-confirm" id="clearConfirm">
                <p class="clear-confirm-title">Clear all reading history?</p>
                <div class="clear-confirm-actions">
                    <button class="btn-ghost" id="clearCancel">Cancel</button>
                    <button class="btn-danger" id="clearConfirmBtn">Clear all</button>
                </div>
            </div>

            <div id="historyList"${isEmpty ? ' class="hidden"' : ''}>
                ${renderGroups(groups)}
            </div>

            <div class="empty-state${isEmpty ? ' visible' : ''}" id="emptyState">
                <div class="empty-state-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                </div>
                <h2 class="empty-state-title">No reading history</h2>
                <p class="empty-state-subtitle">Articles you open will appear here automatically</p>
            </div>
        </div>`;

    bindEvents();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function bindEvents() {
    const el = view();
    if (!el) return;

    // Entry click → open article
    el.querySelectorAll('.history-entry').forEach(entry => {
        entry.addEventListener('click', (e) => {
            if (e.target.closest('.entry-delete')) return;
            openEntry(entry.dataset.id);
        });
    });

    // Delete buttons
    el.querySelectorAll('.entry-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const entry = btn.closest('.history-entry');
            if (entry) deleteEntry(entry);
        });
    });

    // Clear all button
    const clearAllBtn = el.querySelector('#clearAllBtn');
    const clearConfirm = el.querySelector('#clearConfirm');
    const historyList = el.querySelector('#historyList');

    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            if (historyList) historyList.classList.add('hidden');
            if (clearConfirm) clearConfirm.classList.add('visible');
        });
    }

    const clearCancel = el.querySelector('#clearCancel');
    if (clearCancel) {
        clearCancel.addEventListener('click', () => {
            if (clearConfirm) clearConfirm.classList.remove('visible');
            if (historyList) historyList.classList.remove('hidden');
        });
    }

    const clearConfirmBtn = el.querySelector('#clearConfirmBtn');
    if (clearConfirmBtn) {
        clearConfirmBtn.addEventListener('click', () => clearAll());
    }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function deleteEntry(entryEl) {
    const entryId = entryEl.dataset.id;

    // Cancel previous pending delete
    if (deleteTimer) {
        clearTimeout(deleteTimer);
        if (pendingDeleteId) {
            actualDelete(pendingDeleteId);
        }
    }

    // Remove from local state
    const removedEntry = entries.find(e => e.id === entryId);
    entries = entries.filter(e => e.id !== entryId);

    // Animate out
    entryEl.classList.add('removing');

    setTimeout(() => {
        // Re-render to handle empty groups
        renderView();
    }, 360);

    pendingDeleteId = entryId;

    showToast('Entry removed from history', 'info', {
        undoCallback: () => {
            clearTimeout(deleteTimer);
            pendingDeleteId = null;
            if (removedEntry) {
                entries.push(removedEntry);
                // Re-sort by opened_at desc
                entries.sort((a, b) => new Date(b.opened_at) - new Date(a.opened_at));
                renderView();
                showToast('Entry restored', 'success');
            }
        },
        duration: 5000,
    });

    deleteTimer = setTimeout(() => {
        actualDelete(entryId);
        pendingDeleteId = null;
        deleteTimer = null;
    }, 5000);
}

async function actualDelete(entryId) {
    try {
        await api.delete(`/api/history/${entryId}`);
    } catch (err) {
        console.error('Delete failed:', err);
    }
}

async function clearAll() {
    try {
        await api.delete('/api/history/clear');
        entries = [];
        renderView();
        showToast('History cleared', 'info');
    } catch (err) {
        showToast('Failed to clear history', 'error');
    }
}

async function openEntry(entryId) {
    const { navigate } = await import('./app.js');
    sessionStorage.setItem('reader-history-id', entryId);
    navigate('/');
}

async function fetchHistory() {
    try {
        const data = await api.get('/api/history');
        entries = data.entries || [];
        renderView();
    } catch (err) {
        console.error('Failed to load history:', err);
        showToast('Failed to load history', 'error');
    }
}

// ---------------------------------------------------------------------------
// Public: mountHistory
// ---------------------------------------------------------------------------

/**
 * Mount the history view. Called by the router when navigating to /history.
 */
export async function mountHistory() {
    await fetchHistory();
}