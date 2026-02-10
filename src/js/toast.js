/**
 * toast.js — Toast notification module
 *
 * Uses the single #toast element defined in index.html.
 * Supports three types: 'info', 'success', 'error'.
 * Supports optional undo callback with hover-pause behavior.
 *
 * Exports: showToast, initToast
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let toastTimer = null;
let undoCallback = null;
let isHovering = false;
let remainingTime = 0;
let pauseTimestamp = 0;

// DOM references (resolved in initToast)
let toastEl = null;
let toastDot = null;
let toastMsg = null;
let toastUndo = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Dismiss the toast immediately and clean up state.
 */
function dismissToast() {
    if (!toastEl) return;
    toastEl.classList.remove('show');
    clearTimeout(toastTimer);
    toastTimer = null;
    undoCallback = null;
    remainingTime = 0;
    pauseTimestamp = 0;
    isHovering = false;
}

/**
 * Start (or resume) the auto-dismiss countdown.
 * @param {number} ms — milliseconds until dismiss
 */
function startDismissTimer(ms) {
    clearTimeout(toastTimer);
    remainingTime = ms;
    pauseTimestamp = Date.now();
    toastTimer = setTimeout(dismissToast, ms);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show a toast notification.
 *
 * @param {string} message  — The message to display
 * @param {'info'|'success'|'error'} [type='info'] — Visual type
 * @param {object|Function} [options] — Options or undoCallback shorthand
 * @param {number} [options.duration=3000]       — Auto-dismiss delay in ms
 * @param {Function|null} [options.undoCallback] — If provided, show an Undo button
 */
export function showToast(message, type = 'info', options = {}) {
    if (!toastEl || !toastMsg || !toastDot) return;

    // If called with a function as third arg (convenience shorthand),
    // treat it as undoCallback directly.
    if (typeof options === 'function') {
        return showToast(message, type, { undoCallback: options });
    }

    const duration = options.duration ?? 3000;
    const onUndo = options.undoCallback ?? null;

    // Clear any active toast
    clearTimeout(toastTimer);

    // Set content
    toastMsg.textContent = message;
    toastDot.className = 'toast-dot ' + type;

    // Undo button
    undoCallback = onUndo;
    if (toastUndo) {
        toastUndo.style.display = onUndo ? '' : 'none';
    }

    // Show
    toastEl.classList.add('show');

    // Start auto-dismiss timer
    isHovering = false;
    startDismissTimer(duration);
}

/**
 * Initialize the toast module.
 * Resolves DOM references and binds event listeners.
 * Call once after DOMContentLoaded (from app.js).
 */
export function initToast() {
    toastEl = document.getElementById('toast');
    toastDot = document.getElementById('toastDot');
    toastMsg = document.getElementById('toastMsg');
    toastUndo = document.getElementById('toastUndo');

    if (!toastEl) return;

    // Undo button click
    if (toastUndo) {
        toastUndo.addEventListener('click', () => {
            if (undoCallback) {
                undoCallback();
                undoCallback = null;
            }
            dismissToast();
        });
    }

    // Hover pause: if the toast has an undo callback, pause the dismiss timer
    // while the user is hovering, so they have time to click Undo.
    toastEl.addEventListener('mouseenter', () => {
        if (!undoCallback) return; // Only pause for undo toasts
        isHovering = true;
        const elapsed = Date.now() - pauseTimestamp;
        remainingTime = Math.max(0, remainingTime - elapsed);
        clearTimeout(toastTimer);
    });

    toastEl.addEventListener('mouseleave', () => {
        if (!isHovering) return;
        isHovering = false;
        // Resume the countdown with whatever time was remaining (min 1s)
        startDismissTimer(Math.max(remainingTime, 1000));
    });
}
