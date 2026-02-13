/**
 * highlight-manager.js — Text highlighting and annotation system
 *
 * Provides selection-based text highlighting with color choices,
 * annotation notes, XPath-based range serialization that survives
 * re-pagination, and a sidebar panel for browsing all highlights.
 */

import { api } from './api.js';
import { getSession } from './supabase.js';
import { showToast } from './toast.js';

// ==========================================
// STATE
// ==========================================
let highlights = [];        // Array of highlight data objects
let flipContent = null;     // DOM reference
let currentArticleId = null;
let popup = null;
let sidebar = null;
let sidebarList = null;
let sidebarEmpty = null;
let pendingRange = null;    // The Range object from current selection

// ==========================================
// XPATH UTILITIES
// ==========================================

/**
 * Generate an XPath string for a node relative to a root element.
 */
function getXPath(node, root) {
    if (node === root) return '';
    const parts = [];
    let current = node;
    while (current && current !== root) {
        let index = 1;
        let sibling = current.previousSibling;
        while (sibling) {
            if (sibling.nodeType === current.nodeType &&
                sibling.nodeName === current.nodeName) {
                index++;
            }
            sibling = sibling.previousSibling;
        }
        parts.unshift(current.nodeName.toLowerCase() + '[' + index + ']');
        current = current.parentNode;
    }
    return '/' + parts.join('/');
}

/**
 * Resolve an XPath string back to a DOM node relative to a root element.
 */
function resolveXPath(xpath, root) {
    if (!xpath || xpath === '') return root;
    const parts = xpath.split('/').filter(Boolean);
    let current = root;
    for (const part of parts) {
        const match = part.match(/^(.+)\[(\d+)\]$/);
        if (!match) return null;
        const nodeName = match[1].toUpperCase();
        const targetIndex = parseInt(match[2]);
        let index = 0;
        let found = null;
        for (const child of current.childNodes) {
            if (child.nodeName === nodeName ||
                (child.nodeType === 3 && nodeName === '#TEXT')) {
                index++;
                if (index === targetIndex) {
                    found = child;
                    break;
                }
            }
        }
        if (!found) return null;
        current = found;
    }
    return current;
}

// ==========================================
// RANGE SERIALIZATION
// ==========================================

function serializeRange(range) {
    return {
        start_xpath: getXPath(range.startContainer, flipContent),
        start_offset: range.startOffset,
        end_xpath: getXPath(range.endContainer, flipContent),
        end_offset: range.endOffset,
        selected_text: range.toString(),
    };
}

function deserializeRange(data) {
    const startNode = resolveXPath(data.start_xpath, flipContent);
    const endNode = resolveXPath(data.end_xpath, flipContent);
    if (!startNode || !endNode) return null;

    try {
        const range = document.createRange();
        range.setStart(startNode, data.start_offset);
        range.setEnd(endNode, data.end_offset);
        return range;
    } catch {
        return null;
    }
}

// ==========================================
// HIGHLIGHT RENDERING
// ==========================================

/**
 * Wrap a range in <mark> elements. Handles ranges spanning multiple text nodes
 * by splitting into per-text-node segments.
 */
function applyHighlightMarks(range, color, highlightId) {
    if (!range) return;

    const textNodes = [];
    const walker = document.createTreeWalker(
        range.commonAncestorContainer.nodeType === 3
            ? range.commonAncestorContainer.parentNode
            : range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        null
    );

    let inRange = false;
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node === range.startContainer) inRange = true;
        if (inRange) textNodes.push(node);
        if (node === range.endContainer) break;
    }

    // If startContainer === endContainer (single text node)
    if (textNodes.length === 0 && range.startContainer.nodeType === 3) {
        textNodes.push(range.startContainer);
    }

    for (const textNode of textNodes) {
        const mark = document.createElement('mark');
        mark.className = 'user-highlight';
        mark.dataset.highlightId = highlightId;
        mark.dataset.color = color;

        let start = 0;
        let end = textNode.textContent.length;

        if (textNode === range.startContainer) start = range.startOffset;
        if (textNode === range.endContainer) end = range.endOffset;

        // Split text node to wrap only the selected portion
        if (start > 0) {
            textNode.splitText(start);
            const newTextNode = textNode.nextSibling;
            if (end - start < newTextNode.textContent.length) {
                newTextNode.splitText(end - start);
            }
            newTextNode.parentNode.insertBefore(mark, newTextNode);
            mark.appendChild(newTextNode);
        } else if (end < textNode.textContent.length) {
            textNode.splitText(end);
            textNode.parentNode.insertBefore(mark, textNode);
            mark.appendChild(textNode);
        } else {
            textNode.parentNode.insertBefore(mark, textNode);
            mark.appendChild(textNode);
        }
    }
}

/**
 * Remove all <mark> elements for a given highlight ID, restoring text nodes.
 */
function removeHighlightMarks(highlightId) {
    if (!flipContent) return;
    const marks = flipContent.querySelectorAll(
        'mark.user-highlight[data-highlight-id="' + highlightId + '"]'
    );
    marks.forEach(mark => {
        const parent = mark.parentNode;
        while (mark.firstChild) {
            parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        parent.normalize(); // merge adjacent text nodes
    });
}

/**
 * Re-render all highlights from stored data.
 * Called after loadArticle or re-pagination.
 */
function renderAllHighlights() {
    // First, clear any existing marks
    if (flipContent) {
        const existingMarks = flipContent.querySelectorAll('mark.user-highlight');
        existingMarks.forEach(mark => {
            const parent = mark.parentNode;
            while (mark.firstChild) {
                parent.insertBefore(mark.firstChild, mark);
            }
            parent.removeChild(mark);
        });
        flipContent.normalize();
    }

    // Then apply each highlight
    for (const hl of highlights) {
        const range = deserializeRange(hl);
        if (range) {
            applyHighlightMarks(range, hl.color, hl.id);
        }
    }

    updateSidebar();
}

// ==========================================
// STORAGE (localStorage + API)
// ==========================================

function getStorageKey() {
    // Use article ID if available, otherwise a simple key
    return currentArticleId
        ? 'reader-highlights-' + currentArticleId
        : null;
}

async function loadHighlights(articleId) {
    currentArticleId = articleId;
    highlights = [];

    if (articleId) {
        // Try server first
        const session = await getSession();
        if (session) {
            try {
                const data = await api.get('/api/articles/' + articleId + '/highlights');
                highlights = data.highlights || [];
                renderAllHighlights();
                return;
            } catch {
                // Fall through to localStorage
            }
        }
    }

    // Local storage fallback
    const key = getStorageKey();
    if (key) {
        try {
            highlights = JSON.parse(localStorage.getItem(key)) || [];
        } catch {
            highlights = [];
        }
    }
    renderAllHighlights();
}

async function saveHighlight(data, color) {
    const hlData = {
        ...data,
        color: color,
        id: 'hl-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        created_at: new Date().toISOString(),
    };

    if (currentArticleId) {
        const session = await getSession();
        if (session) {
            try {
                const result = await api.post(
                    '/api/articles/' + currentArticleId + '/highlights',
                    { ...data, color }
                );
                hlData.id = result.highlight.id;
            } catch {
                // Save locally as fallback
            }
        }
    }

    highlights.push(hlData);

    // Also save to localStorage
    const key = getStorageKey();
    if (key) {
        localStorage.setItem(key, JSON.stringify(highlights));
    }

    return hlData;
}

async function deleteHighlight(highlightId) {
    if (currentArticleId) {
        const session = await getSession();
        if (session) {
            try {
                await api.delete(
                    '/api/articles/' + currentArticleId + '/highlights/' + highlightId
                );
            } catch {
                // Continue with local deletion
            }
        }
    }

    highlights = highlights.filter(h => h.id !== highlightId);

    const key = getStorageKey();
    if (key) {
        localStorage.setItem(key, JSON.stringify(highlights));
    }

    removeHighlightMarks(highlightId);
    updateSidebar();
}

async function updateHighlightNote(highlightId, note) {
    const hl = highlights.find(h => h.id === highlightId);
    if (!hl) return;

    hl.note = note;

    if (currentArticleId) {
        const session = await getSession();
        if (session) {
            try {
                await api.patch(
                    '/api/articles/' + currentArticleId + '/highlights/' + highlightId,
                    { note }
                );
            } catch {
                // Continue with local update
            }
        }
    }

    const key = getStorageKey();
    if (key) {
        localStorage.setItem(key, JSON.stringify(highlights));
    }

    updateSidebar();
}

// ==========================================
// POPUP (on text selection)
// ==========================================

function showPopup(x, y) {
    if (!popup) return;
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
    popup.classList.add('visible');
}

function hidePopup() {
    if (!popup) return;
    popup.classList.remove('visible');
    pendingRange = null;
}

function handleSelectionEnd() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
        hidePopup();
        return;
    }

    const range = sel.getRangeAt(0);
    // Only handle selections within flipContent
    if (!flipContent || !flipContent.contains(range.commonAncestorContainer)) {
        hidePopup();
        return;
    }

    // Ignore if selection is inside a highlight mark (could be editing)
    const text = range.toString().trim();
    if (!text) {
        hidePopup();
        return;
    }

    pendingRange = range.cloneRange();

    // Position popup above the selection
    const rect = range.getBoundingClientRect();
    const readerView = document.getElementById('readerView');
    const rvRect = readerView ? readerView.getBoundingClientRect() : { left: 0, top: 0 };

    const popupX = rect.left + rect.width / 2 - 75 - rvRect.left; // center roughly
    const popupY = rect.top - 45 - rvRect.top;

    showPopup(Math.max(8, popupX), Math.max(8, popupY));
}

async function handleColorClick(color) {
    if (!pendingRange) return;

    const data = serializeRange(pendingRange);
    const hl = await saveHighlight(data, color);

    applyHighlightMarks(pendingRange, color, hl.id);
    updateSidebar();

    // Clear selection
    window.getSelection().removeAllRanges();
    hidePopup();
}

function handleNoteClick() {
    if (!pendingRange) return;

    const note = prompt('Add a note for this highlight:');
    if (note === null) return; // Cancelled

    handleColorClick('yellow').then(() => {
        if (note.trim()) {
            const lastHl = highlights[highlights.length - 1];
            if (lastHl) {
                updateHighlightNote(lastHl.id, note.trim());
            }
        }
    });
}

// ==========================================
// SIDEBAR
// ==========================================

function updateSidebar() {
    if (!sidebarList || !sidebarEmpty) return;

    sidebarList.innerHTML = '';

    if (highlights.length === 0) {
        sidebarEmpty.style.display = 'block';
        return;
    }

    sidebarEmpty.style.display = 'none';

    for (const hl of highlights) {
        const item = document.createElement('div');
        item.className = 'hl-sidebar-item';

        const textEl = document.createElement('div');
        textEl.className = 'hl-sidebar-item-text';
        textEl.dataset.color = hl.color;
        textEl.textContent = hl.selected_text.length > 120
            ? hl.selected_text.substring(0, 120) + '...'
            : hl.selected_text;
        item.appendChild(textEl);

        if (hl.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'hl-sidebar-item-note';
            noteEl.textContent = hl.note;
            item.appendChild(noteEl);
        }

        const actions = document.createElement('div');
        actions.className = 'hl-sidebar-item-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'hl-sidebar-item-action';
        editBtn.textContent = hl.note ? 'Edit note' : 'Add note';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const newNote = prompt('Note:', hl.note || '');
            if (newNote !== null) {
                updateHighlightNote(hl.id, newNote.trim());
            }
        });
        actions.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'hl-sidebar-item-action delete';
        deleteBtn.textContent = 'Remove';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteHighlight(hl.id);
        });
        actions.appendChild(deleteBtn);

        item.appendChild(actions);

        // Click to navigate to highlight location
        item.addEventListener('click', () => {
            const range = deserializeRange(hl);
            if (range) {
                // Find the page this highlight is on by checking offsetLeft
                const node = range.startContainer.nodeType === 3
                    ? range.startContainer.parentElement
                    : range.startContainer;
                if (node && flipContent) {
                    // Dispatch custom event for reader.js to handle navigation
                    flipContent.dispatchEvent(new CustomEvent('navigate-to-element', {
                        detail: { element: node }
                    }));
                }
            }
        });

        sidebarList.appendChild(item);
    }
}

function toggleSidebar() {
    if (!sidebar) return;
    sidebar.classList.toggle('visible');
}

// ==========================================
// INIT
// ==========================================

export function initHighlightManager() {
    flipContent = document.getElementById('flipContent');
    popup = document.getElementById('highlightPopup');
    sidebar = document.getElementById('highlightsSidebar');
    sidebarList = document.getElementById('hlSidebarList');
    sidebarEmpty = document.getElementById('hlSidebarEmpty');

    // Color buttons in popup
    if (popup) {
        popup.querySelectorAll('.hl-color').forEach(btn => {
            btn.addEventListener('click', () => handleColorClick(btn.dataset.color));
        });
    }

    // Note button in popup
    const noteBtn = document.getElementById('hlNoteBtn');
    if (noteBtn) noteBtn.addEventListener('click', handleNoteClick);

    // Selection handler (mouseup on flipContent)
    if (flipContent) {
        flipContent.addEventListener('mouseup', () => {
            setTimeout(handleSelectionEnd, 10);
        });
        flipContent.addEventListener('touchend', () => {
            setTimeout(handleSelectionEnd, 300);
        });
    }

    // Close popup on click outside
    document.addEventListener('mousedown', (e) => {
        if (popup && !popup.contains(e.target)) {
            hidePopup();
        }
    });

    // Sidebar toggle
    const panelBtn = document.getElementById('highlightPanelBtn');
    if (panelBtn) panelBtn.addEventListener('click', toggleSidebar);

    const closeBtn = document.getElementById('hlSidebarClose');
    if (closeBtn) closeBtn.addEventListener('click', () => {
        sidebar.classList.remove('visible');
    });
}

/**
 * Load highlights for a given article. Called from reader.js on loadArticle.
 */
export function loadArticleHighlights(articleId) {
    loadHighlights(articleId);
}

/**
 * Clear highlights state (called when leaving reader).
 */
export function clearHighlights() {
    highlights = [];
    currentArticleId = null;
    hidePopup();
    if (sidebar) sidebar.classList.remove('visible');
    if (sidebarList) sidebarList.innerHTML = '';
}

/**
 * Re-render all highlights (called after re-pagination).
 */
export function refreshHighlights() {
    renderAllHighlights();
}
