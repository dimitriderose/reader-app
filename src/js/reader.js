/**
 * reader.js — Flipbook engine + save + position sync + history logging
 *
 * Extracted from docs/design_v2.html and refactored into an ES module.
 * CSS multi-column layout drives pagination; page flipping changes translateX offset.
 */

import { api } from './api.js';
import { getSession, setPendingSave } from './supabase.js';
import { openAuthModal } from './auth.js';
import { showToast } from './toast.js';
import { applyTheme } from './theme.js';
import { marked } from 'marked';
import { initAudioReader, setAudioContent, cleanupAudio } from './audio-reader.js';

// Configure marked for clean output
marked.setOptions({
    breaks: true,
    gfm: true,
});

/**
 * Lazy-load PDF.js only when needed (it's ~1MB).
 * Returns the pdfjsLib module.
 */
let _pdfjsLib = null;
async function getPdfJs() {
    if (_pdfjsLib) return _pdfjsLib;
    const mod = await import('pdfjs-dist');
    // Load the worker source as raw text, then create a Blob URL.
    // This avoids all Vite/bundler path-resolution issues.
    const workerMod = await import('pdfjs-dist/build/pdf.worker.min.mjs?raw');
    const blob = new Blob([workerMod.default], { type: 'application/javascript' });
    mod.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    _pdfjsLib = mod;
    return _pdfjsLib;
}

/**
 * Lazy-load JSZip only when needed (for EPUB parsing).
 */
let _JSZip = null;
async function getJSZip() {
    if (_JSZip) return _JSZip;
    const mod = await import('jszip');
    _JSZip = mod.default || mod;
    return _JSZip;
}

/**
 * Parse an EPUB file from an ArrayBuffer.
 * Returns { title, html } with chapter content concatenated.
 */
async function parseEpub(arrayBuffer) {
    const JSZip = await getJSZip();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // --- DRM detection ---
    if (zip.file('META-INF/rights.xml') && !zip.file('license.lcpl')) {
        throw new Error('DRM_ADOBE');
    }

    // --- LCP detection & decryption ---
    let contentKey = null;
    let encryptedPaths = new Set();

    if (zip.file('license.lcpl')) {
        const lcplJson = JSON.parse(await zip.file('license.lcpl').async('text'));
        const encKeyB64 = lcplJson?.encryption?.content_key?.encrypted_value;
        if (!encKeyB64) throw new Error('DRM_LCP_UNSUPPORTED');

        // Prompt for passphrase
        const passphrase = await promptForPassphrase();
        if (!passphrase) throw new Error('LCP_CANCELLED');

        // SHA-256 hash the passphrase → User Key
        const encoder = new TextEncoder();
        const passphraseHash = await crypto.subtle.digest('SHA-256', encoder.encode(passphrase));
        const userKey = await crypto.subtle.importKey(
            'raw', passphraseHash, { name: 'AES-CBC' }, false, ['decrypt']
        );

        // Decrypt the content key
        const encKeyBytes = Uint8Array.from(atob(encKeyB64), c => c.charCodeAt(0));
        const iv = encKeyBytes.slice(0, 16);
        const ciphertext = encKeyBytes.slice(16);

        let decryptedKey;
        try {
            decryptedKey = await crypto.subtle.decrypt(
                { name: 'AES-CBC', iv }, userKey, ciphertext
            );
        } catch {
            throw new Error('LCP_WRONG_PASSPHRASE');
        }

        contentKey = await crypto.subtle.importKey(
            'raw', decryptedKey, { name: 'AES-CBC' }, false, ['decrypt']
        );

        // Parse encryption.xml to find which files are encrypted
        const encXml = zip.file('META-INF/encryption.xml');
        if (encXml) {
            const encDoc = new DOMParser().parseFromString(
                await encXml.async('text'), 'application/xml'
            );
            encDoc.querySelectorAll('CipherReference').forEach(ref => {
                const uri = ref.getAttribute('URI');
                if (uri) encryptedPaths.add(uri);
            });
        }
    }

    // Helper: read a file from the ZIP, decrypting if needed
    async function readZipFile(path, asType = 'text') {
        const file = zip.file(path);
        if (!file) return null;

        if (contentKey && encryptedPaths.has(path)) {
            const encrypted = await file.async('uint8array');
            const iv = encrypted.slice(0, 16);
            const cipher = encrypted.slice(16);
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-CBC', iv }, contentKey, cipher
            );
            if (asType === 'text') return new TextDecoder().decode(decrypted);
            return decrypted;
        }

        return file.async(asType === 'text' ? 'text' : 'uint8array');
    }

    // --- Parse container.xml → find OPF path ---
    const containerXml = await readZipFile('META-INF/container.xml');
    if (!containerXml) throw new Error('Invalid EPUB: missing container.xml');

    const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
    const rootfile = containerDoc.querySelector('rootfile');
    const opfPath = rootfile?.getAttribute('full-path');
    if (!opfPath) throw new Error('Invalid EPUB: no rootfile found');

    // OPF directory (chapter hrefs are relative to this)
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

    // --- Parse OPF → manifest + spine + metadata ---
    const opfXml = await readZipFile(opfPath);
    if (!opfXml) throw new Error('Invalid EPUB: missing OPF file');

    const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

    // Title
    const titleEl = opfDoc.querySelector('metadata title') ||
                     opfDoc.querySelector('dc\\:title, title');
    const title = titleEl?.textContent?.trim() || '';

    // Manifest: id → { href, mediaType }
    const manifest = {};
    opfDoc.querySelectorAll('manifest item').forEach(item => {
        manifest[item.getAttribute('id')] = {
            href: item.getAttribute('href'),
            mediaType: item.getAttribute('media-type'),
        };
    });

    // Spine: ordered list of idref
    const spine = [];
    opfDoc.querySelectorAll('spine itemref').forEach(ref => {
        spine.push(ref.getAttribute('idref'));
    });

    // --- Read and process chapters ---
    const chapters = [];

    for (const idref of spine) {
        const item = manifest[idref];
        if (!item) continue;
        const mediaType = item.mediaType || '';
        if (!mediaType.includes('html') && !mediaType.includes('xml')) continue;

        const chapterPath = opfDir + item.href;
        const chapterHtml = await readZipFile(chapterPath);
        if (!chapterHtml) continue;

        // Parse and extract body content
        const doc = new DOMParser().parseFromString(chapterHtml, 'application/xhtml+xml');
        const body = doc.querySelector('body');
        if (!body || !body.innerHTML.trim()) continue;

        // Convert images: replace relative src with base64 data URIs
        const images = body.querySelectorAll('img');
        for (const img of images) {
            const src = img.getAttribute('src');
            if (!src || src.startsWith('data:')) continue;

            // Resolve relative path from chapter location
            const chapterDir = chapterPath.includes('/')
                ? chapterPath.substring(0, chapterPath.lastIndexOf('/') + 1)
                : opfDir;
            const imgPath = resolveRelativePath(chapterDir, src);

            const imgData = await readZipFile(imgPath, 'binary');
            if (imgData) {
                // Determine MIME type from manifest or extension
                const ext = src.split('.').pop().toLowerCase();
                const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
                const mime = mimeMap[ext] || 'image/png';
                const b64 = arrayBufferToBase64(imgData instanceof ArrayBuffer ? imgData : imgData.buffer);
                img.setAttribute('src', `data:${mime};base64,${b64}`);
            }
        }

        chapters.push({ href: item.href, html: body.innerHTML });
    }

    if (chapters.length === 0) {
        throw new Error('Could not extract content from this EPUB.');
    }

    const html = chapters
        .map(ch => `<div class="epub-chapter" data-epub-src="${ch.href}">${ch.html}</div>`)
        .join('\n');

    return { title, html };
}

/** Resolve a relative path (e.g., "../images/foo.png") against a base directory. */
function resolveRelativePath(base, rel) {
    if (rel.startsWith('/')) return rel.substring(1);
    const parts = base.split('/').filter(Boolean);
    for (const seg of rel.split('/')) {
        if (seg === '..') parts.pop();
        else if (seg !== '.') parts.push(seg);
    }
    return parts.join('/');
}

/** Convert an ArrayBuffer to a base64 string. */
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Prompt the user for an LCP passphrase.
 * Returns the passphrase string, or null if cancelled.
 */
function promptForPassphrase() {
    return new Promise(resolve => {
        const passphrase = window.prompt(
            'This EPUB is protected with LCP.\nPlease enter your passphrase to unlock it:'
        );
        resolve(passphrase);
    });
}

/**
 * Heuristic: does the text contain enough markdown syntax to treat it as markdown?
 */
function looksLikeMarkdown(text) {
    const markers = [
        /^#{1,6}\s/m,           // headings
        /\*\*.+?\*\*/,          // bold
        /\[.+?\]\(.+?\)/,       // links
        /^[-*]\s/m,             // unordered lists
        /^\d+\.\s/m,            // ordered lists
        /^```/m,                // code fences
        /^>/m,                  // blockquotes
        /^---$/m,               // horizontal rules
        /\|.+\|/,              // tables
    ];
    let hits = 0;
    for (const re of markers) {
        if (re.test(text)) hits++;
    }
    return hits >= 2;
}

// ==========================================
// STATE
// ==========================================
let currentPage = 0;
let totalPages = 1;
let isFlipping = false;
let fontSize = 20;
let isSerif = true;
let currentArticleId = null;   // null = not saved to library
let currentSourceUrl = null;
let currentTitle = '';
let currentContentHtml = '';

// Position auto-save
let positionTimer = null;
let positionDirty = false;
let cachedAccessToken = null;
let currentHistoryEntryId = null;
let historyPositionTimer = null;

// DOM references (populated in initReader)
let flipContent = null;
let fsVal = null;
let fontToggle = null;
let saveBtn = null;
let pageShadow = null;
let flipPrevZone = null;
let flipNextZone = null;
let pageCurl = null;
let flipbook = null;
let readerView = null;
let inputView = null;
let newBtn = null;

// Touch state
let touchStartX = 0;
let touchStartY = 0;

// Resize debounce
let resizeTimeout = null;

// Bookmarks
let currentBookmarks = [];
let bookmarkToggle = null;
let bookmarkIcon = null;
let bookmarksSidebar = null;
let bookmarksList = null;
let bookmarksEmpty = null;
let bookmarkSearchInput = null;
let bkSidebarResizing = false;

// Cache the access token so it's available synchronously in beforeunload
async function refreshCachedToken() {
    const session = await getSession();
    cachedAccessToken = session?.access_token || null;
}

// ==========================================
// CONTENT HASHING (Web Crypto API — M3)
// ==========================================

/**
 * Compute SHA-256 hex digest of a string using Web Crypto API.
 * @param {string} html
 * @returns {Promise<string>}
 */
async function hashContent(html) {
    const encoder = new TextEncoder();
    const data = encoder.encode(html);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ==========================================
// HISTORY AUTO-LOGGING
// ==========================================

/**
 * Log an article open to history (fire-and-forget).
 * Only logs if user is signed in.
 */
async function logToHistory(title, sourceUrl, contentHtml, page, total) {
    const session = await getSession();
    if (!session) return; // Don't log for anonymous users

    const contentHash = await hashContent(contentHtml);

    api.post('/api/history', {
        title,
        source_url: sourceUrl || null,
        content_html: contentHtml,
        content_hash: contentHash,
        current_page: page,
        total_pages: total,
    }).then(result => {
        if (result && result.entry) {
            currentHistoryEntryId = result.entry.id;
        }
    }).catch(err => console.error('History log failed:', err));
}

// ==========================================
// INTERNAL LINK NAVIGATION (EPUB TOC etc.)
// ==========================================

/**
 * Calculate which flipbook page an element lives on and flip to it.
 */
function navigateToElement(el) {
    if (!flipContent) return;

    const gap = getColumnGap();
    const pageWidth = getPageWidth();
    const computed = getComputedStyle(flipContent);
    const padLeft = parseFloat(computed.paddingLeft) || 56;
    const padRight = parseFloat(computed.paddingRight) || 56;
    const actualColumnWidth = pageWidth - padLeft - padRight;
    const stepSize = actualColumnWidth + gap;

    // offsetLeft gives position within the multi-column flow
    const page = Math.floor(el.offsetLeft / stepSize);
    flipTo(Math.max(0, Math.min(page, totalPages - 1)));
}

/**
 * Delegated click handler for internal links (EPUB chapter links, TOC, etc.).
 * Intercepts clicks on <a> tags with internal hrefs and navigates within the flipbook.
 */
function handleInternalLink(e) {
    const link = e.target.closest('a[href]');
    if (!link || !flipContent) return;

    const href = link.getAttribute('href');
    if (!href) return;

    // Let external links open in a new tab
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        return;
    }

    e.preventDefault();

    // Parse href into file part and fragment (e.g. "chapter2.xhtml#section1")
    let filePart = '';
    let fragment = '';
    const hashIndex = href.indexOf('#');
    if (hashIndex >= 0) {
        filePart = href.substring(0, hashIndex);
        fragment = href.substring(hashIndex + 1);
    } else {
        filePart = href;
    }

    let targetEl = null;

    // Try fragment ID first — most specific
    if (fragment) {
        targetEl = document.getElementById(fragment);
        // Make sure it's inside our content
        if (targetEl && !flipContent.contains(targetEl)) targetEl = null;
    }

    // If no fragment match, find the chapter div by file path
    if (!targetEl && filePart) {
        // Try exact match on data-epub-src
        targetEl = flipContent.querySelector('[data-epub-src="' + filePart + '"]');

        // Try matching by filename (last path segment) for relative links
        if (!targetEl) {
            const fileName = filePart.split('/').pop();
            const chapters = flipContent.querySelectorAll('.epub-chapter[data-epub-src]');
            for (const ch of chapters) {
                const src = ch.dataset.epubSrc;
                if (src === fileName || src.endsWith('/' + fileName)) {
                    targetEl = ch;
                    break;
                }
            }
        }
    }

    if (targetEl) {
        navigateToElement(targetEl);
    }
}

// ==========================================
// FLIPBOOK ENGINE
// ==========================================

function getPageWidth() {
    const viewport = document.querySelector('.flipbook-viewport');
    return viewport ? viewport.offsetWidth : 0;
}

function getColumnGap() {
    return parseInt(getComputedStyle(flipContent).columnGap) || 120;
}

function paginate() {
    const viewport = document.querySelector('.flipbook-viewport');
    if (!viewport || !flipContent) return;

    const viewportHeight = viewport.offsetHeight;
    const pageWidth = viewport.offsetWidth;
    const gap = getColumnGap();

    // Calculate the actual line-height in px to prevent word/line cutoff
    const computed = getComputedStyle(flipContent);
    const currentFontSize = parseFloat(computed.fontSize);
    const lineHeightRatio = parseFloat(computed.lineHeight) / currentFontSize;
    const lineHeightPx = currentFontSize * lineHeightRatio;

    // Fixed top padding, adjust bottom to make content area
    // an exact multiple of line-height
    const paddingTop = 48;
    const minPaddingBottom = 24;
    const rawContentHeight = viewportHeight - paddingTop - minPaddingBottom;
    const linesPerPage = Math.floor(rawContentHeight / lineHeightPx);
    const contentHeight = linesPerPage * lineHeightPx;
    const adjustedPaddingBottom = viewportHeight - paddingTop - contentHeight;

    // Apply the calculated height so columns break cleanly
    flipContent.style.height = viewportHeight + 'px';
    flipContent.style.paddingTop = paddingTop + 'px';
    flipContent.style.paddingBottom = adjustedPaddingBottom + 'px';

    // The actual column width is the viewport width minus horizontal padding
    const padLeft = parseFloat(computed.paddingLeft) || 56;
    const padRight = parseFloat(computed.paddingRight) || 56;
    const actualColumnWidth = pageWidth - padLeft - padRight;

    flipContent.style.columnWidth = actualColumnWidth + 'px';

    // Force layout recalc
    void flipContent.offsetHeight;

    const scrollW = flipContent.scrollWidth;
    const stepSize = actualColumnWidth + gap;
    totalPages = Math.max(1, Math.round(scrollW / stepSize));

    if (currentPage >= totalPages) currentPage = totalPages - 1;
    if (currentPage < 0) currentPage = 0;

    updatePosition(false);
    updateUI();
    updateBoundaries();
}

function updatePosition(animate) {
    if (!flipContent) return;

    const pageWidth = getPageWidth();
    const gap = getColumnGap();
    const computed = getComputedStyle(flipContent);
    const padLeft = parseFloat(computed.paddingLeft) || 56;
    const padRight = parseFloat(computed.paddingRight) || 56;
    const actualColumnWidth = pageWidth - padLeft - padRight;
    const offset = currentPage * (actualColumnWidth + gap);

    if (!animate) {
        flipContent.style.transition = 'none';
    } else {
        flipContent.style.transition = 'transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    }

    flipContent.style.transform = 'translateX(-' + offset + 'px)';

    if (!animate) {
        void flipContent.offsetHeight;
        flipContent.style.transition = 'transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    }
}

function updateUI() {
    const pageNum = document.getElementById('pageNum');
    const pageTotal = document.getElementById('pageTotal');
    const progressFill = document.getElementById('progressFill');

    if (pageNum) pageNum.textContent = currentPage + 1;
    if (pageTotal) pageTotal.textContent = totalPages;
    if (progressFill) {
        progressFill.style.width =
            totalPages > 1 ? ((currentPage / (totalPages - 1)) * 100) + '%' : '100%';
    }
    updateBookmarkButton();
}

function updateBoundaries() {
    if (!flipPrevZone || !flipNextZone || !pageCurl) return;

    // First page: suppress prev arrow
    if (currentPage <= 0) {
        flipPrevZone.classList.add('at-boundary');
    } else {
        flipPrevZone.classList.remove('at-boundary');
    }

    // Last page: suppress next arrow + page curl
    if (currentPage >= totalPages - 1) {
        flipNextZone.classList.add('at-boundary');
        pageCurl.classList.add('at-boundary');
    } else {
        flipNextZone.classList.remove('at-boundary');
        pageCurl.classList.remove('at-boundary');
    }
}

function triggerShadow(direction) {
    if (!pageShadow) return;
    pageShadow.className = 'page-shadow';
    void pageShadow.offsetHeight;
    pageShadow.classList.add(direction === 'forward' ? 'flip-forward' : 'flip-backward');
    setTimeout(() => { pageShadow.className = 'page-shadow'; }, 550);
}

function flipTo(page) {
    if (isFlipping) return;
    if (page < 0 || page >= totalPages) return;
    if (page === currentPage) return;

    isFlipping = true;
    const direction = page > currentPage ? 'forward' : 'backward';
    currentPage = page;

    triggerShadow(direction);
    updatePosition(true);
    updateUI();
    updateBoundaries();
    updateBookmarkButton();

    // Position auto-save on flip
    onPageFlip();

    setTimeout(() => { isFlipping = false; }, 530);
}

// ==========================================
// BOOKMARKS
// ==========================================

function simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
    }
    return hash.toString(36);
}

function getBookmarkStorageKey() {
    if (currentArticleId) return 'reader-bookmarks-' + currentArticleId;
    if (currentContentHtml) {
        return 'reader-bookmarks-hash-' + simpleHash(currentContentHtml.substring(0, 500));
    }
    return null;
}

function persistBookmarks() {
    const key = getBookmarkStorageKey();
    if (key) {
        try {
            localStorage.setItem(key, JSON.stringify(currentBookmarks));
        } catch { /* quota exceeded */ }
    }
}

function loadBookmarks() {
    const key = getBookmarkStorageKey();
    if (!key) { currentBookmarks = []; return; }
    try {
        currentBookmarks = JSON.parse(localStorage.getItem(key)) || [];
    } catch {
        currentBookmarks = [];
    }
    updateBookmarkButton();
    renderBookmarksList();
}

function isCurrentPageBookmarked() {
    return currentBookmarks.some(b => b.page_number === currentPage + 1);
}

function updateBookmarkButton() {
    if (!bookmarkToggle || !bookmarkIcon) return;
    if (isCurrentPageBookmarked()) {
        bookmarkToggle.classList.add('active');
        bookmarkIcon.innerHTML = '&#9873;'; // filled flag
    } else {
        bookmarkToggle.classList.remove('active');
        bookmarkIcon.innerHTML = '&#9872;'; // outline flag
    }

    const countEl = document.getElementById('bookmarkCount');
    if (countEl) {
        if (currentBookmarks.length > 0) {
            countEl.textContent = currentBookmarks.length;
            countEl.classList.add('visible');
        } else {
            countEl.classList.remove('visible');
        }
    }
}

function toggleBookmark() {
    const pageNum = currentPage + 1;
    const existing = currentBookmarks.find(b => b.page_number === pageNum);

    if (existing) {
        currentBookmarks = currentBookmarks.filter(b => b.id !== existing.id);
        showToast('Bookmark removed', 'info');
    } else {
        currentBookmarks.push({
            id: 'bk-' + Date.now(),
            page_number: pageNum,
            label: null,
            created_at: new Date().toISOString(),
        });
        showToast('Page ' + pageNum + ' bookmarked', 'success');
    }

    persistBookmarks();
    updateBookmarkButton();
    renderBookmarksList();
}

function renderBookmarksList() {
    if (!bookmarksList || !bookmarksEmpty) return;
    bookmarksList.innerHTML = '';

    const query = bookmarkSearchInput ? bookmarkSearchInput.value.trim().toLowerCase() : '';

    const sorted = [...currentBookmarks].sort((a, b) => a.page_number - b.page_number);

    const filtered = query
        ? sorted.filter(bk => {
            const pageTxt = 'page ' + bk.page_number;
            const label = (bk.label || '').toLowerCase();
            return pageTxt.includes(query) || label.includes(query);
        })
        : sorted;

    if (filtered.length === 0) {
        bookmarksEmpty.style.display = 'block';
        bookmarksEmpty.textContent = query ? 'No matching bookmarks' : 'No bookmarks yet';
        return;
    }
    bookmarksEmpty.style.display = 'none';

    for (const bk of filtered) {
        const item = document.createElement('div');
        item.className = 'bookmark-item';
        if (bk.page_number === currentPage + 1) item.classList.add('current-page');

        const info = document.createElement('div');
        info.className = 'bookmark-item-info';

        const pageSpan = document.createElement('span');
        pageSpan.className = 'bookmark-item-page';
        pageSpan.textContent = 'Page ' + bk.page_number + ' of ' + totalPages;
        info.appendChild(pageSpan);

        if (bk.label) {
            const labelSpan = document.createElement('span');
            labelSpan.className = 'bookmark-item-label';
            labelSpan.textContent = bk.label;
            info.appendChild(labelSpan);
        }

        const dateSpan = document.createElement('span');
        dateSpan.className = 'bookmark-item-date';
        dateSpan.textContent = formatBookmarkDate(bk.created_at);
        info.appendChild(dateSpan);

        item.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'bookmark-item-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'bookmark-item-action';
        editBtn.textContent = bk.label ? 'Edit' : 'Label';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const newLabel = prompt('Bookmark label:', bk.label || '');
            if (newLabel !== null) {
                bk.label = newLabel.trim() || null;
                persistBookmarks();
                renderBookmarksList();
            }
        });
        actions.appendChild(editBtn);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'bookmark-item-action delete';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            currentBookmarks = currentBookmarks.filter(b => b.id !== bk.id);
            persistBookmarks();
            updateBookmarkButton();
            renderBookmarksList();
        });
        actions.appendChild(removeBtn);

        item.appendChild(actions);

        item.addEventListener('click', () => {
            flipTo(bk.page_number - 1);
        });

        bookmarksList.appendChild(item);
    }
}

function formatBookmarkDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function toggleBookmarksSidebar() {
    if (!bookmarksSidebar) return;
    bookmarksSidebar.classList.toggle('visible');
    if (bookmarksSidebar.classList.contains('visible')) {
        renderBookmarksList();
    }
}

function initBookmarkSidebarResize() {
    const handle = document.getElementById('bkSidebarResize');
    if (!handle || !bookmarksSidebar) return;

    let startX = 0;
    let startWidth = 0;

    function onMouseMove(e) {
        if (!bkSidebarResizing) return;
        const newWidth = Math.max(200, Math.min(600, startWidth + (e.clientX - startX)));
        bookmarksSidebar.style.width = newWidth + 'px';
    }

    function onMouseUp() {
        if (!bkSidebarResizing) return;
        bkSidebarResizing = false;
        handle.classList.remove('active');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        bkSidebarResizing = true;
        startX = e.clientX;
        startWidth = bookmarksSidebar.offsetWidth;
        handle.classList.add('active');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

function flipNext() { flipTo(currentPage + 1); }
function flipPrev() { flipTo(currentPage - 1); }

// ==========================================
// POSITION AUTO-SAVE (debounced)
// ==========================================

function onPageFlip() {
    // Update library article position (debounced)
    if (currentArticleId) {
        positionDirty = true;

        clearTimeout(positionTimer);
        positionTimer = setTimeout(() => {
            api.patch('/api/articles/' + currentArticleId + '/position', {
                current_page: currentPage + 1,
                total_pages: totalPages,
            }).then(() => {
                positionDirty = false;
            }).catch(err => console.error('Position save failed:', err));
        }, 1500);
    }

    // Update history entry position (debounced, separate from library)
    if (currentHistoryEntryId) {
        clearTimeout(historyPositionTimer);
        historyPositionTimer = setTimeout(() => {
            api.patch('/api/history/' + currentHistoryEntryId + '/position', {
                current_page: currentPage + 1,
                total_pages: totalPages,
            }).catch(err => console.error('History position save failed:', err));
        }, 1500);
    }
}

// Final position save on beforeunload using fetch+keepalive
function onBeforeUnload() {
    if (currentArticleId && positionDirty) {
        const body = JSON.stringify({
            current_page: currentPage + 1,
            total_pages: totalPages,
        });
        // Use cached token since getSession() is async and beforeunload must be sync
        const token = cachedAccessToken;
        if (!token) return;
        fetch('/api/articles/' + currentArticleId + '/position', {
            method: 'PATCH',
            keepalive: true,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token,
            },
            body: body,
        }).catch(() => {});
    }
}

// ==========================================
// SAVE BUTTON
// ==========================================

function updateSaveButton() {
    if (!saveBtn) return;
    const iconEl = saveBtn.querySelector('.save-icon');
    const labelEl = saveBtn.querySelector('.save-label');

    if (currentArticleId) {
        saveBtn.classList.add('saved');
        saveBtn.setAttribute('title', 'Remove from library');
        if (iconEl) iconEl.innerHTML = '&#9733;'; // filled star
        if (labelEl) labelEl.textContent = 'Saved';
    } else {
        saveBtn.classList.remove('saved');
        saveBtn.setAttribute('title', 'Save to library');
        if (iconEl) iconEl.innerHTML = '&#9734;'; // empty star
        if (labelEl) labelEl.textContent = 'Save';
    }
}

function buildSavePayload() {
    return {
        title: currentTitle || 'Untitled',
        source_url: currentSourceUrl || null,
        content_html: currentContentHtml,
        current_page: currentPage + 1,
        total_pages: totalPages,
        font_size: fontSize,
        font_family: isSerif ? 'serif' : 'sans',
        theme: document.documentElement.getAttribute('data-theme') || 'light',
    };
}

/**
 * Show a collection picker dropdown below the save button.
 * Fetches collections from API, renders a small dropdown, and
 * resolves with the selected collection_id (or null for Uncategorized).
 * @returns {Promise<string|null>} collection_id or null
 */
async function pickCollection() {
    // Remove any existing picker
    const existing = document.getElementById('collectionPicker');
    if (existing) existing.remove();

    let collections = [];
    try {
        const data = await api.get('/api/collections');
        collections = data.collections || [];
    } catch (_) {
        // If we can't fetch collections, just save without picking
        return null;
    }

    // If no collections exist, skip picker
    if (collections.length === 0) return null;

    return new Promise((resolve) => {
        const picker = document.createElement('div');
        picker.id = 'collectionPicker';
        picker.style.cssText = 'position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:6px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:4px;box-shadow:0 4px 16px rgba(0,0,0,0.12);z-index:50;min-width:180px;max-height:240px;overflow-y:auto;';

        // Uncategorized option (default)
        const uncatBtn = document.createElement('button');
        uncatBtn.textContent = 'Uncategorized';
        uncatBtn.style.cssText = 'width:100%;padding:8px 12px;background:none;border:none;color:var(--text);font-family:var(--font-ui);font-size:0.8rem;font-weight:500;cursor:pointer;border-radius:6px;text-align:left;';
        uncatBtn.onmouseenter = () => uncatBtn.style.background = 'var(--surface-2)';
        uncatBtn.onmouseleave = () => uncatBtn.style.background = 'none';
        uncatBtn.onclick = (e) => { e.stopPropagation(); picker.remove(); cleanup(); resolve(null); };
        picker.appendChild(uncatBtn);

        // Divider
        if (collections.length > 0) {
            const divider = document.createElement('div');
            divider.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
            picker.appendChild(divider);
        }

        // Collection options
        for (const col of collections) {
            const btn = document.createElement('button');
            btn.textContent = col.name;
            btn.style.cssText = 'width:100%;padding:8px 12px;background:none;border:none;color:var(--text);font-family:var(--font-ui);font-size:0.8rem;font-weight:500;cursor:pointer;border-radius:6px;text-align:left;';
            btn.onmouseenter = () => btn.style.background = 'var(--surface-2)';
            btn.onmouseleave = () => btn.style.background = 'none';
            btn.onclick = (e) => { e.stopPropagation(); picker.remove(); cleanup(); resolve(col.id); };
            picker.appendChild(btn);
        }

        // Position relative to save button
        saveBtn.style.position = 'relative';
        saveBtn.appendChild(picker);

        // Click outside to cancel (resolve null = uncategorized)
        const closeHandler = (e) => {
            if (!picker.contains(e.target) && e.target !== saveBtn) {
                picker.remove();
                cleanup();
                resolve(null);
            }
        };
        const cleanup = () => {
            document.removeEventListener('click', closeHandler);
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    });
}

async function handleSave() {
    if (!saveBtn) return;

    // If already saved, unsave (remove from library)
    if (currentArticleId) {
        saveBtn.classList.add('saving');
        try {
            await api.delete('/api/articles/' + currentArticleId);
            currentArticleId = null;
            updateSaveButton();
            showToast('Removed from library', 'info');
        } catch (err) {
            showToast('Failed to remove: ' + err.message, 'error');
        } finally {
            saveBtn.classList.remove('saving');
        }
        return;
    }

    // Check if user is logged in
    const session = await getSession();
    const payload = buildSavePayload();

    if (!session) {
        // Flow A: store pending save, open auth modal
        setPendingSave(payload);
        openAuthModal('prompt');
        return;
    }

    // User is logged in — show collection picker, then save
    const collectionId = await pickCollection();
    if (collectionId !== undefined) {
        payload.collection_id = collectionId;
    }

    saveBtn.classList.add('saving');
    try {
        const result = await api.post('/api/articles', payload);
        currentArticleId = result.article.id;
        updateSaveButton();
        showToast('Saved to library', 'success');
    } catch (err) {
        showToast('Failed to save: ' + err.message, 'error');
    } finally {
        saveBtn.classList.remove('saving');
    }
}

// ==========================================
// FONT SIZE
// ==========================================

function applyFontSize() {
    if (!flipContent || !fsVal) return;
    flipContent.style.fontSize = fontSize + 'px';
    fsVal.textContent = fontSize;
    localStorage.setItem('reader-fs', fontSize);
    requestAnimationFrame(paginate);
}

function fontSizeDown() {
    if (fontSize > 14) { fontSize -= 2; applyFontSize(); }
}

function fontSizeUp() {
    if (fontSize < 36) { fontSize += 2; applyFontSize(); }
}

// ==========================================
// FONT FAMILY TOGGLE
// ==========================================

function applyFont() {
    if (!flipContent || !fontToggle) return;
    flipContent.style.fontFamily = isSerif
        ? "'Source Serif 4', Georgia, serif"
        : "'Inter', -apple-system, sans-serif";
    flipContent.style.lineHeight = isSerif ? '1.72' : '1.65';
    fontToggle.textContent = isSerif ? 'Serif' : 'Sans';
    localStorage.setItem('reader-font', isSerif ? 'serif' : 'sans');
    requestAnimationFrame(paginate);
}

function toggleFont() {
    isSerif = !isSerif;
    applyFont();
}

// ==========================================
// VIEW SWITCHING
// ==========================================

function showReader() {
    if (inputView) inputView.classList.add('hidden');
    if (readerView) readerView.classList.remove('hidden');
    if (newBtn) newBtn.classList.remove('hidden');
    requestAnimationFrame(() => {
        requestAnimationFrame(paginate);
    });
}

function showInput() {
    if (readerView) readerView.classList.add('hidden');
    if (inputView) inputView.classList.remove('hidden');
    if (newBtn) newBtn.classList.add('hidden');
    currentPage = 0;
    currentArticleId = null;
    currentSourceUrl = null;
    currentTitle = '';
    currentContentHtml = '';
    positionDirty = false;
    clearTimeout(positionTimer);
    currentHistoryEntryId = null;
    currentBookmarks = [];
    updateSaveButton();
    updateBookmarkButton();
    if (bookmarksSidebar) bookmarksSidebar.classList.remove('visible');
    if (bookmarksList) bookmarksList.innerHTML = '';
    cleanupAudio();
}

// ==========================================
// SEGMENTED TABS (URL / Upload / Paste)
// ==========================================

function initSegmentedTabs() {
    document.querySelectorAll('.seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.seg-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            const panel = document.getElementById(btn.dataset.panel);
            if (panel) panel.classList.add('active');
        });
    });
}

// ==========================================
// FILE DROP ZONE
// ==========================================

function initFileDropZone() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileBtn = document.getElementById('fileBtn');

    if (!dropZone || !fileInput || !fileBtn) return;

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            fileBtn.disabled = false;
            dropZone.classList.add('has-file');
            const textEl = dropZone.querySelector('.drop-zone-text');
            if (textEl) textEl.innerHTML = '<strong>' + e.dataTransfer.files[0].name + '</strong>';
        }
    });

    fileInput.addEventListener('change', () => {
        fileBtn.disabled = !fileInput.files.length;
        if (fileInput.files.length) {
            dropZone.classList.add('has-file');
            const textEl = dropZone.querySelector('.drop-zone-text');
            if (textEl) textEl.innerHTML = '<strong>' + fileInput.files[0].name + '</strong>';
        }
    });

    // Load file button
    fileBtn.addEventListener('click', async e => {
        e.preventDefault();
        if (!fileInput.files.length) return;

        fileBtn.classList.add('loading');
        const file = fileInput.files[0];
        const nameLower = file.name.toLowerCase();

        try {
            let html;
            let title = file.name.replace(/\.(txt|html?|md|markdown|pdf|epub)$/i, '');

            if (nameLower.endsWith('.pdf')) {
                // PDF — render each page as an image via pdf.js canvas
                const pdfjsLib = await getPdfJs();
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

                if (pdf.numPages === 0) {
                    showToast('This PDF has no pages.', 'error');
                    fileBtn.classList.remove('loading');
                    return;
                }

                const pageImages = [];
                const scale = 2; // 2x for sharp rendering on retina

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({ scale });
                    const canvas = document.createElement('canvas');
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    const ctx = canvas.getContext('2d');
                    await page.render({ canvasContext: ctx, viewport }).promise;
                    pageImages.push(canvas.toDataURL('image/png'));
                    page.cleanup();
                }

                // Build HTML with one image per page
                html = pageImages
                    .map(src => `<div class="pdf-page"><img src="${src}" alt="PDF page"></div>`)
                    .join('\n');

            } else if (nameLower.endsWith('.epub')) {
                // EPUB — extract chapters via JSZip
                try {
                    const result = await parseEpub(await file.arrayBuffer());
                    html = result.html;
                    if (result.title) title = result.title;
                } catch (epubErr) {
                    if (epubErr.message === 'DRM_ADOBE') {
                        showToast('This EPUB uses Adobe DRM which is not supported. Please use a DRM-free version.', 'error');
                    } else if (epubErr.message === 'LCP_WRONG_PASSPHRASE') {
                        showToast('Incorrect passphrase. Please try again.', 'error');
                    } else if (epubErr.message === 'LCP_CANCELLED') {
                        // User cancelled — do nothing
                    } else if (epubErr.message === 'DRM_LCP_UNSUPPORTED') {
                        showToast('This EPUB has unsupported LCP encryption.', 'error');
                    } else {
                        showToast('Failed to read EPUB: ' + epubErr.message, 'error');
                    }
                    fileBtn.classList.remove('loading');
                    return;
                }

            } else if (nameLower.endsWith('.md') || nameLower.endsWith('.markdown')) {
                // Markdown — parse to HTML
                const text = await file.text();
                html = marked.parse(text);

                // Extract title from first # heading
                const headingMatch = text.match(/^#\s+(.+)$/m);
                if (headingMatch) {
                    title = headingMatch[1].trim();
                }

            } else if (nameLower.endsWith('.html') || nameLower.endsWith('.htm')) {
                const text = await file.text();
                html = text;
                // Try to extract title from HTML
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, 'text/html');
                const titleEl = doc.querySelector('title');
                if (titleEl && titleEl.textContent.trim()) {
                    title = titleEl.textContent.trim();
                }

            } else {
                // Plain text — check if it's actually markdown
                const text = await file.text();
                if (looksLikeMarkdown(text)) {
                    html = marked.parse(text);
                } else {
                    html = text
                        .split(/\n\s*\n/)
                        .filter(p => p.trim())
                        .map(p => '<p>' + p.trim().replace(/\n/g, '<br>') + '</p>')
                        .join('\n');
                }
            }

            loadArticle(html, { title, sourceUrl: null });
        } catch (err) {
            showToast('Failed to read file: ' + err.message, 'error');
        } finally {
            fileBtn.classList.remove('loading');
        }
    });
}

// ==========================================
// URL FETCH
// ==========================================

function initUrlFetch() {
    const fetchBtn = document.getElementById('fetchBtn');
    const urlInput = document.getElementById('urlInput');

    if (!fetchBtn || !urlInput) return;

    fetchBtn.addEventListener('click', async e => {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (!url) {
            showToast('Please enter a URL', 'error');
            return;
        }

        fetchBtn.classList.add('loading');
        try {
            const result = await api.post('/api/fetch', { url });
            if (!result.content_html || !result.content_html.trim()) {
                showToast('No readable content found on this page', 'error');
                return;
            }
            loadArticle(result.content_html, {
                title: result.title || 'Untitled',
                sourceUrl: url,
            });
        } catch (err) {
            showToast('Failed to fetch: ' + err.message, 'error');
        } finally {
            fetchBtn.classList.remove('loading');
        }
    });

    // Allow Enter key in URL input
    urlInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            fetchBtn.click();
        }
    });
}

// ==========================================
// PASTE TEXT
// ==========================================

function initPasteText() {
    const pasteBtn = document.getElementById('pasteBtn');
    const pasteInput = document.getElementById('pasteInput');

    if (!pasteBtn || !pasteInput) return;

    pasteBtn.addEventListener('click', e => {
        e.preventDefault();
        const text = pasteInput.value.trim();
        if (!text) {
            showToast('Please enter some text', 'error');
            return;
        }

        let html;
        let title = 'Pasted Text';

        if (looksLikeMarkdown(text)) {
            // Parse as markdown
            html = marked.parse(text);
            const headingMatch = text.match(/^#\s+(.+)$/m);
            if (headingMatch) title = headingMatch[1].trim();
        } else {
            // Convert plain text to HTML paragraphs
            html = text
                .split(/\n\s*\n/)
                .filter(p => p.trim())
                .map(p => '<p>' + p.trim().replace(/\n/g, '<br>') + '</p>')
                .join('\n');
        }

        loadArticle(html, { title, sourceUrl: null });
    });
}

// ==========================================
// KEYBOARD NAVIGATION
// ==========================================

function handleKeydown(e) {
    if (!readerView || readerView.classList.contains('hidden')) return;

    switch (e.key) {
        case 'ArrowRight':
        case ' ':
            e.preventDefault();
            flipNext();
            break;
        case 'ArrowLeft':
            e.preventDefault();
            flipPrev();
            break;
        case 'PageDown':
            e.preventDefault();
            flipNext();
            break;
        case 'PageUp':
            e.preventDefault();
            flipPrev();
            break;
        case 'Home':
            e.preventDefault();
            flipTo(0);
            break;
        case 'End':
            e.preventDefault();
            flipTo(totalPages - 1);
            break;
        case 'b':
        case 'B':
            // Don't trigger if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') break;
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                toggleBookmarksSidebar();
            } else {
                e.preventDefault();
                toggleBookmark();
            }
            break;
    }
}

// ==========================================
// TOUCH / SWIPE
// ==========================================

function handleTouchStart(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
}

function handleTouchEnd(e) {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
        if (dx < 0) flipNext();
        else flipPrev();
    }
}

// ==========================================
// CORE: LOAD ARTICLE
// ==========================================

/**
 * Load content into the flipbook and show the reader view.
 *
 * @param {string} contentHtml - The HTML content to display
 * @param {object} options
 * @param {string}  [options.title]      - Article title
 * @param {string}  [options.sourceUrl]  - Original source URL
 * @param {string}  [options.articleId]  - Library article ID (if saved)
 * @param {number}  [options.currentPage] - Page to restore (1-based)
 * @param {number}  [options.fontSize]   - Font size to restore
 * @param {string}  [options.fontFamily] - 'serif' or 'sans'
 * @param {string}  [options.theme]      - Theme to apply
 */
function loadArticle(contentHtml, options = {}) {
    if (!flipContent) return;

    // Store state
    currentContentHtml = contentHtml;
    currentTitle = options.title || 'Untitled';
    currentSourceUrl = options.sourceUrl || null;
    currentArticleId = options.articleId || null;
    positionDirty = false;
    clearTimeout(positionTimer);
    currentHistoryEntryId = null;
    clearTimeout(historyPositionTimer);

    // Set content
    flipContent.innerHTML = contentHtml;

    // Set up audio reader with the new content
    setAudioContent(flipContent);

    // Restore preferences if provided
    if (options.fontSize) {
        fontSize = options.fontSize;
    }
    if (options.fontFamily) {
        isSerif = options.fontFamily !== 'sans';
    }
    if (options.theme) {
        applyTheme(options.theme);
    }

    // Apply font settings
    applyFontSize();
    applyFont();
    updateSaveButton();

    // Show reader view
    showReader();

    // Set page after pagination (needs layout to calculate)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            paginate();
            // Restore page position (options.currentPage is 1-based)
            if (options.currentPage && options.currentPage > 1) {
                const targetPage = Math.min(options.currentPage - 1, totalPages - 1);
                currentPage = targetPage;
                updatePosition(false);
                updateUI();
                updateBoundaries();
            }

            // Log to history (fire-and-forget)
            logToHistory(
                currentTitle,
                currentSourceUrl,
                currentContentHtml,
                currentPage + 1,
                totalPages
            );
        });
    });

    // Load bookmarks for this content
    loadBookmarks();

    // Refresh cached token
    refreshCachedToken();
}

// ==========================================
// PUBLIC: OPEN FROM LIBRARY
// ==========================================

/**
 * Open an article from library data.
 * Called by library.js when a card is clicked.
 *
 * @param {object} articleData - Full article object from GET /api/articles/:id
 */
export function openArticle(articleData) {
    loadArticle(articleData.content_html, {
        title: articleData.title,
        sourceUrl: articleData.source_url,
        articleId: articleData.id,
        currentPage: articleData.current_page,
        fontSize: articleData.font_size,
        fontFamily: articleData.font_family,
        theme: articleData.theme,
    });
}

// ==========================================
// PUBLIC: OPEN FROM HISTORY
// ==========================================

/**
 * Open an article from a history entry.
 * Called by history.js when an entry is clicked.
 *
 * @param {object} historyEntry - Full history entry from GET /api/history/:id
 */
export function openArticleFromHistory(historyEntry) {
    loadArticle(historyEntry.content_html, {
        title: historyEntry.title,
        sourceUrl: historyEntry.source_url,
        articleId: historyEntry.article_id || null,
        currentPage: historyEntry.current_page,
    });
}

// ==========================================
// PUBLIC: LOAD URL PROGRAMMATICALLY
// ==========================================

/**
 * Load an article by URL (used by other modules, e.g. from a shared link).
 *
 * @param {string} url - The URL to fetch and display
 */
export async function loadUrl(url) {
    try {
        const result = await api.post('/api/fetch', { url });
        loadArticle(result.content_html, {
            title: result.title || 'Untitled',
            sourceUrl: url,
        });
    } catch (err) {
        showToast('Failed to fetch: ' + err.message, 'error');
    }
}

// ==========================================
// INIT
// ==========================================

/**
 * Initialize the reader module.
 * Call once after DOMContentLoaded (from app.js).
 */
export function initReader() {
    // Cache DOM references
    flipContent = document.getElementById('flipContent');
    fsVal = document.getElementById('fsVal');
    fontToggle = document.getElementById('fontToggle');
    saveBtn = document.getElementById('saveBtn');
    pageShadow = document.getElementById('pageShadow');
    flipPrevZone = document.getElementById('flipPrev');
    flipNextZone = document.getElementById('flipNext');
    pageCurl = document.getElementById('pageCurl');
    flipbook = document.getElementById('flipbook');
    readerView = document.getElementById('readerView');
    inputView = document.getElementById('inputView');
    newBtn = document.getElementById('newBtn');

    // Restore persisted preferences
    const savedFs = parseInt(localStorage.getItem('reader-fs'));
    if (savedFs && savedFs >= 14 && savedFs <= 36) fontSize = savedFs;

    const savedFont = localStorage.getItem('reader-font');
    if (savedFont) isSerif = savedFont !== 'sans';

    // Apply initial font settings
    applyFontSize();
    applyFont();

    // ---- Event listeners ----

    // Font size buttons
    const fsDown = document.getElementById('fsDown');
    const fsUp = document.getElementById('fsUp');
    if (fsDown) fsDown.addEventListener('click', fontSizeDown);
    if (fsUp) fsUp.addEventListener('click', fontSizeUp);

    // Font family toggle
    if (fontToggle) fontToggle.addEventListener('click', toggleFont);

    // Save button
    if (saveBtn) saveBtn.addEventListener('click', handleSave);

    // New / back button
    if (newBtn) newBtn.addEventListener('click', showInput);

    // Click zones for page flipping
    if (flipNextZone) flipNextZone.addEventListener('click', flipNext);
    if (flipPrevZone) flipPrevZone.addEventListener('click', flipPrev);

    // Page curl click
    if (pageCurl) pageCurl.addEventListener('click', flipNext);

    // Internal EPUB link navigation (TOC, chapter cross-references)
    if (flipContent) flipContent.addEventListener('click', handleInternalLink);

    // Keyboard navigation
    document.addEventListener('keydown', handleKeydown);

    // Touch / swipe
    if (flipbook) {
        flipbook.addEventListener('touchstart', handleTouchStart, { passive: true });
        flipbook.addEventListener('touchend', handleTouchEnd, { passive: true });
    }

    // Window resize — recalculate pagination
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(paginate, 150);
    });

    // Before-unload — flush pending position save
    window.addEventListener('beforeunload', onBeforeUnload);

    // Initialize input view sub-components
    initSegmentedTabs();
    initFileDropZone();
    initUrlFetch();
    initPasteText();

    // Initialize audio reader
    initAudioReader();

    // ---- Bookmarks ----
    bookmarkToggle = document.getElementById('bookmarkToggle');
    bookmarkIcon = document.getElementById('bookmarkIcon');
    bookmarksSidebar = document.getElementById('bookmarksSidebar');
    bookmarksList = document.getElementById('bookmarksList');
    bookmarksEmpty = document.getElementById('bookmarksEmpty');
    bookmarkSearchInput = document.getElementById('bookmarkSearchInput');

    // Click = toggle bookmark on current page
    if (bookmarkToggle) {
        bookmarkToggle.addEventListener('click', toggleBookmark);
        // Right-click = open sidebar
        bookmarkToggle.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            toggleBookmarksSidebar();
        });
    }

    // Sidebar close button
    const bkSidebarClose = document.getElementById('bkSidebarClose');
    if (bkSidebarClose) {
        bkSidebarClose.addEventListener('click', () => {
            bookmarksSidebar.classList.remove('visible');
        });
    }

    // Search input filters list
    if (bookmarkSearchInput) {
        bookmarkSearchInput.addEventListener('input', renderBookmarksList);
    }

    // Resize handle
    initBookmarkSidebarResize();

    // Initial pagination (for any preloaded content)
    paginate();

    // Cache access token for beforeunload
    refreshCachedToken();
}
