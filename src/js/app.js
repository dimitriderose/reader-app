/**
 * app.js — SPA router + application initialization
 *
 * Main entry point loaded by index.html's script tag.
 * Orchestrates module initialization, client-side routing,
 * and auth state management for the header UI.
 *
 * Exports: navigate
 */

import '../css/base.css';
import '../css/auth.css';
import '../css/reader.css';
import '../css/library.css';
import '../css/history.css';

import { initTheme } from './theme.js';
import { initToast, showToast } from './toast.js';
import { supabase, getSession, getPendingSave } from './supabase.js';
import { initAuth, openAuthModal } from './auth.js';
import { initReader } from './reader.js';
import { api } from './api.js';

// ==========================================
// VIEW CONTAINERS
// ==========================================

const views = {
    input:   document.getElementById('inputView'),
    reader:  document.getElementById('readerView'),
    library: document.getElementById('libraryView'),
    history: document.getElementById('historyView'),
};

// ==========================================
// ROUTER
// ==========================================

/** Map URL pathname to view name */
function pathnameToView(pathname) {
    if (pathname === '/library')  return 'library';
    if (pathname === '/history')  return 'history';
    return 'input'; // '/' and everything else
}

/**
 * Show the view matching the given name and hide all others.
 * @param {string} name — 'input' | 'reader' | 'library' | 'history'
 */
function showView(name) {
    Object.entries(views).forEach(([key, el]) => {
        if (!el) return;
        if (key === name) {
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });

    // Update nav link active state
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.view === name);
    });
}

/**
 * Route to the current URL. Dynamically imports view modules when needed.
 */
async function route() {
    const path = window.location.pathname;
    const viewName = pathnameToView(path);

    if (viewName === 'library') {
        showView('library');
        try {
            const { mountLibrary } = await import('./library.js');
            if (typeof mountLibrary === 'function') mountLibrary();
        } catch (e) {
            console.warn('library.js not available:', e.message);
        }
    } else if (viewName === 'history') {
        showView('history');
        try {
            const { mountHistory } = await import('./history.js');
            if (typeof mountHistory === 'function') mountHistory();
        } catch (e) {
            console.warn('history.js not available:', e.message);
        }
    } else {
        // Check if there's a pending article to open from library
        const pendingArticleId = sessionStorage.getItem('reader-article-id');
        if (pendingArticleId) {
            sessionStorage.removeItem('reader-article-id');
            showView('input'); // Show input initially while loading
            try {
                const data = await api.get('/api/articles/' + pendingArticleId);
                if (data && data.article) {
                    const { openArticle } = await import('./reader.js');
                    openArticle(data.article);
                }
            } catch (err) {
                console.error('Failed to open article:', err);
                showToast('Failed to open article', 'error');
            }
            return;
        }

        // Check if there's a pending history entry to open
        const pendingHistoryId = sessionStorage.getItem('reader-history-id');
        if (pendingHistoryId) {
            sessionStorage.removeItem('reader-history-id');
            showView('input'); // Show input initially while loading
            try {
                const data = await api.get('/api/history/' + pendingHistoryId);
                if (data && data.entry) {
                    const { openArticleFromHistory } = await import('./reader.js');
                    openArticleFromHistory(data.entry);
                }
            } catch (err) {
                console.error('Failed to open history entry:', err);
                showToast('Failed to open article', 'error');
            }
            return;
        }

        showView('input');
    }
}

/**
 * Navigate to a new path using the History API.
 * @param {string} path — e.g. '/', '/library', '/history'
 */
export function navigate(path) {
    if (path === window.location.pathname) return;
    history.pushState(null, '', path);
    route();
}

// ==========================================
// NAV LINK WIRING
// ==========================================

function bindNavLinks() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const view = link.dataset.view;
            const path = view === 'input' ? '/' : '/' + view;
            navigate(path);
        });
    });

    const logo = document.getElementById('logoLink');
    if (logo) {
        logo.addEventListener('click', () => {
            // Always reset to input view, even if already on '/'
            // (e.g. when reader is open, URL is still '/')
            history.pushState(null, '', '/');
            showView('input');
        });
    }
}

// ==========================================
// AUTH STATE — HEADER UI + PENDING SAVE
// ==========================================

function listenAuthState() {
    if (!supabase) return;
    supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
            // Handle Flow A: pending save
            const pending = getPendingSave();
            if (pending) {
                try {
                    await api.post('/api/articles', pending);
                    showToast('Saved to library', 'success');
                } catch (err) {
                    console.error('Pending save failed:', err);
                    showToast('Failed to save article', 'error');
                }
            }

            // If on a view that needs data, re-render it
            const current = pathnameToView(window.location.pathname);
            if (current === 'library') {
                try {
                    const { mountLibrary } = await import('./library.js');
                    if (typeof mountLibrary === 'function') mountLibrary();
                } catch (_) { /* not yet available */ }
            }
        }

        if (event === 'SIGNED_OUT') {
            const current = pathnameToView(window.location.pathname);
            if (current === 'library' || current === 'history') {
                navigate('/');
            }
        }
    });
}

// ==========================================
// POPSTATE (browser back/forward)
// ==========================================

window.addEventListener('popstate', () => route());

// ==========================================
// INITIALIZATION
// ==========================================

// Theme (synchronous — no flash of wrong theme)
initTheme();

// Toast
initToast();

// Auth module (binds modal events, checks existing session, updates header)
initAuth();

// Reader module (binds flipbook events, input panels)
initReader();

// Nav links
bindNavLinks();

// Auth state listener (app-level: pending save, redirect)
listenAuthState();

// Run initial route
route();