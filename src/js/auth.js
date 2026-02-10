/**
 * Auth Modal — State machine with 4 states + Supabase auth calls
 *
 * States: sign-in | register | forgot | prompt
 *
 * Exports: openAuthModal, closeAuthModal, initAuth
 *
 * Integration points:
 *   - supabase.js   — Supabase client + setPendingSave (Flow A)
 *   - toast.js      — Success/error notifications
 *
 * The modal HTML lives in src/index.html (created by another agent).
 * This module queries DOM elements by ID and wires up event listeners.
 */

import { supabase } from './supabase.js';
import { showToast } from './toast.js';

// ---------------------------------------------------------------------------
// DOM References (resolved lazily in initAuth)
// ---------------------------------------------------------------------------
let backdrop, modalClose;
let stateSignin, stateRegister, stateForgot, statePrompt;

// Sign-in form elements
let signinForm, signinEmail, signinPassword, signinSubmit;
let signinEmailError, signinPasswordError, signinServerError;

// Register form elements
let registerForm, registerName, registerEmail, registerPassword, registerSubmit;
let registerEmailError, registerPasswordError, registerServerError;

// Forgot-password form elements
let forgotFormWrapper, forgotFormEl, forgotEmail, forgotSubmit;
let forgotEmailError, forgotServerError, forgotSuccess, forgotSentEmail;

// Prompt elements
let promptDismiss;

// Current modal state (null when closed)
let currentState = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple email format check */
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Clear all validation errors across all forms */
function clearErrors() {
    document.querySelectorAll('.auth-input').forEach(input => input.classList.remove('error'));
    document.querySelectorAll('.field-error').forEach(err => err.classList.remove('visible'));
    document.querySelectorAll('.auth-server-error').forEach(el => {
        el.classList.remove('visible');
        el.textContent = '';
    });
}

/** Show a field-level validation error */
function showFieldError(inputEl, errorEl, message) {
    if (inputEl) inputEl.classList.add('error');
    if (errorEl) {
        if (message) errorEl.textContent = message;
        errorEl.classList.add('visible');
    }
}

/** Show a server-level error inside a form */
function showServerError(errorEl, message) {
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.add('visible');
    }
}

/** Set loading state on a submit button */
function setLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
        btn.classList.add('loading');
        btn.disabled = true;
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

/** Reset all form inputs inside the modal */
function resetForms() {
    [signinForm, registerForm, forgotFormEl].forEach(form => {
        if (form) form.reset();
    });
    // Reset loading states on all submit buttons
    [signinSubmit, registerSubmit, forgotSubmit].forEach(btn => setLoading(btn, false));
}

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

/**
 * Transition between the 4 modal states (or close).
 * @param {'sign-in'|'register'|'forgot'|'prompt'|null} newState
 */
export function switchState(newState) {
    // Hide all auth states
    document.querySelectorAll('.auth-state').forEach(s => s.classList.remove('active'));

    // Clear validation / server errors
    clearErrors();

    // Reset loading states
    [signinSubmit, registerSubmit, forgotSubmit].forEach(btn => setLoading(btn, false));

    // Reset forgot-password view to form (not success confirmation)
    if (newState === 'forgot') {
        if (forgotFormWrapper) forgotFormWrapper.style.display = '';
        if (forgotSuccess) forgotSuccess.classList.remove('visible');
    }

    // Show the requested state
    const stateMap = {
        'sign-in': stateSignin,
        'register': stateRegister,
        'forgot': stateForgot,
        'prompt': statePrompt,
    };

    const target = stateMap[newState];
    if (target) {
        target.classList.add('active');
        backdrop.classList.add('visible');
        currentState = newState;

        // Focus first input in the active form for accessibility
        const firstInput = target.querySelector('input:not([type="checkbox"])');
        if (firstInput) {
            // Slight delay so the transition can start before focusing
            setTimeout(() => firstInput.focus(), 100);
        }
    } else {
        // Close modal
        backdrop.classList.remove('visible');
        currentState = null;
        resetForms();
    }
}

/**
 * Open the auth modal in the given state.
 * @param {'sign-in'|'register'|'forgot'|'prompt'} state
 */
export function openAuthModal(state = 'sign-in') {
    switchState(state);
}

/**
 * Close the auth modal and reset forms.
 */
export function closeAuthModal() {
    switchState(null);
}

// ---------------------------------------------------------------------------
// Auth Handlers
// ---------------------------------------------------------------------------

/**
 * Sign in with email + password via Supabase.
 */
async function handleSignIn(email, password) {
    setLoading(signinSubmit, true);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(signinSubmit, false);

    if (error) {
        showServerError(signinServerError, error.message || 'Invalid credentials');
        return;
    }

    // Success
    closeAuthModal();
    updateHeaderUI(data.user);
    showToast('Signed in successfully', 'success');
}

/**
 * Register a new account with email + password via Supabase.
 */
async function handleRegister(email, password, displayName) {
    setLoading(registerSubmit, true);

    const options = {};
    if (displayName) {
        options.data = { display_name: displayName };
    }

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options,
    });

    setLoading(registerSubmit, false);

    if (error) {
        showServerError(registerServerError, error.message || 'Registration failed');
        return;
    }

    // Supabase may require email confirmation. If session is null, inform the user.
    if (data.session) {
        closeAuthModal();
        updateHeaderUI(data.user);
        showToast('Account created', 'success');
    } else {
        closeAuthModal();
        showToast('Check your email to confirm your account', 'info');
    }
}

/**
 * Send a password reset email via Supabase.
 */
async function handleForgotPassword(email) {
    setLoading(forgotSubmit, true);

    const { error } = await supabase.auth.resetPasswordForEmail(email);

    setLoading(forgotSubmit, false);

    if (error) {
        showServerError(forgotServerError, error.message || 'Could not send reset email');
        return;
    }

    // Show success confirmation
    if (forgotFormWrapper) forgotFormWrapper.style.display = 'none';
    if (forgotSentEmail) forgotSentEmail.textContent = email;
    if (forgotSuccess) forgotSuccess.classList.add('visible');
}

/**
 * Initiate OAuth sign-in (Google or GitHub).
 * @param {'google'|'github'} provider
 */
async function handleOAuthSignIn(provider) {
    const { error } = await supabase.auth.signInWithOAuth({ provider });

    if (error) {
        showToast(error.message || `${provider} sign-in failed`, 'error');
    }
    // OAuth redirects away from the page; no further action needed here.
}

// ---------------------------------------------------------------------------
// Header UI Update
// ---------------------------------------------------------------------------

/**
 * Update header to reflect signed-in or signed-out state.
 * Called after successful auth and on page load from initAuth.
 */
function updateHeaderUI(user) {
    const signinBtn = document.getElementById('headerSignin');
    const userAvatar = document.getElementById('userAvatar');
    const headerNav = document.getElementById('headerNav');
    const navDivider1 = document.getElementById('navDivider1');
    const navDivider2 = document.getElementById('navDivider2');

    if (user) {
        // Signed in — hide Sign In button, show nav + avatar + dividers
        if (signinBtn) signinBtn.classList.add('hidden');
        if (headerNav) headerNav.classList.remove('hidden');
        if (navDivider1) navDivider1.classList.remove('hidden');
        if (navDivider2) navDivider2.classList.remove('hidden');
        if (userAvatar) {
            userAvatar.classList.remove('hidden');
            // Set initials from display_name or email
            const name = user.user_metadata?.display_name || user.email || '';
            const initials = name
                .split(/[\s@]+/)
                .filter(Boolean)
                .slice(0, 2)
                .map(w => w[0].toUpperCase())
                .join('');
            userAvatar.textContent = initials || '?';

            // Sign-out dropdown
            userAvatar.onclick = () => {
                // Remove existing dropdown if any
                let existing = document.getElementById('avatarDropdown');
                if (existing) {
                    existing.remove();
                    return;
                }

                const dropdown = document.createElement('div');
                dropdown.id = 'avatarDropdown';
                dropdown.style.cssText = 'position:absolute;top:100%;right:0;margin-top:4px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:4px;box-shadow:0 4px 16px rgba(0,0,0,0.12);z-index:200;min-width:140px;';

                const signOutBtn = document.createElement('button');
                signOutBtn.textContent = 'Sign out';
                signOutBtn.style.cssText = 'width:100%;padding:8px 12px;background:none;border:none;color:var(--text);font-family:var(--font-ui);font-size:0.8rem;font-weight:500;cursor:pointer;border-radius:6px;text-align:left;';
                signOutBtn.onmouseenter = () => signOutBtn.style.background = 'var(--surface-2)';
                signOutBtn.onmouseleave = () => signOutBtn.style.background = 'none';
                signOutBtn.onclick = async (e) => {
                    e.stopPropagation();
                    dropdown.remove();
                    await supabase.auth.signOut();
                    showToast('Signed out', 'info');
                };

                dropdown.appendChild(signOutBtn);

                // Position relative to avatar
                userAvatar.style.position = 'relative';
                userAvatar.appendChild(dropdown);

                // Close on click outside
                const closeDropdown = (e) => {
                    if (!dropdown.contains(e.target) && e.target !== userAvatar) {
                        dropdown.remove();
                        document.removeEventListener('click', closeDropdown);
                    }
                };
                setTimeout(() => document.addEventListener('click', closeDropdown), 0);
            };
        }
    } else {
        // Signed out — show Sign In button, hide nav + avatar + dividers
        if (signinBtn) signinBtn.classList.remove('hidden');
        if (headerNav) headerNav.classList.add('hidden');
        if (navDivider1) navDivider1.classList.add('hidden');
        if (navDivider2) navDivider2.classList.add('hidden');
        if (userAvatar) userAvatar.classList.add('hidden');
        if (userAvatar) userAvatar.onclick = null;
    }
}

// ---------------------------------------------------------------------------
// Form Validation
// ---------------------------------------------------------------------------

/**
 * Validate sign-in form. Returns true if valid.
 */
function validateSignIn() {
    const email = signinEmail.value.trim();
    const password = signinPassword.value;
    let valid = true;

    if (!email) {
        showFieldError(signinEmail, signinEmailError, 'Please enter your email address');
        valid = false;
    } else if (!isValidEmail(email)) {
        showFieldError(signinEmail, signinEmailError, 'Please enter a valid email address');
        valid = false;
    }

    if (!password) {
        showFieldError(signinPassword, signinPasswordError, 'Please enter your password');
        valid = false;
    } else if (password.length < 6) {
        showFieldError(signinPassword, signinPasswordError, 'Password must be at least 6 characters');
        valid = false;
    }

    return valid;
}

/**
 * Validate register form. Returns true if valid.
 */
function validateRegister() {
    const email = registerEmail.value.trim();
    const password = registerPassword.value;
    let valid = true;

    if (!email) {
        showFieldError(registerEmail, registerEmailError, 'Please enter your email address');
        valid = false;
    } else if (!isValidEmail(email)) {
        showFieldError(registerEmail, registerEmailError, 'Please enter a valid email address');
        valid = false;
    }

    if (!password) {
        showFieldError(registerPassword, registerPasswordError, 'Please enter a password');
        valid = false;
    } else if (password.length < 6) {
        showFieldError(registerPassword, registerPasswordError, 'Password must be at least 6 characters');
        valid = false;
    }

    return valid;
}

/**
 * Validate forgot-password form. Returns true if valid.
 */
function validateForgot() {
    const email = forgotEmail.value.trim();

    if (!email) {
        showFieldError(forgotEmail, forgotEmailError, 'Please enter your email address');
        return false;
    }

    if (!isValidEmail(email)) {
        showFieldError(forgotEmail, forgotEmailError, 'Please enter a valid email address');
        return false;
    }

    return true;
}

// ---------------------------------------------------------------------------
// Event Binding
// ---------------------------------------------------------------------------

function bindFormEvents() {
    // --- Sign-in form ---
    if (signinForm) {
        signinForm.addEventListener('submit', (e) => {
            e.preventDefault();
            clearErrors();
            if (!validateSignIn()) return;
            handleSignIn(signinEmail.value.trim(), signinPassword.value);
        });
    }

    // --- Register form ---
    if (registerForm) {
        registerForm.addEventListener('submit', (e) => {
            e.preventDefault();
            clearErrors();
            if (!validateRegister()) return;
            const displayName = registerName ? registerName.value.trim() : '';
            handleRegister(registerEmail.value.trim(), registerPassword.value, displayName);
        });
    }

    // --- Forgot password form ---
    if (forgotFormEl) {
        forgotFormEl.addEventListener('submit', (e) => {
            e.preventDefault();
            clearErrors();
            if (!validateForgot()) return;
            handleForgotPassword(forgotEmail.value.trim());
        });
    }
}

function bindModalEvents() {
    // Close button
    if (modalClose) {
        modalClose.addEventListener('click', closeAuthModal);
    }

    // Backdrop click closes modal
    if (backdrop) {
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeAuthModal();
        });
    }

    // Escape key closes modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && currentState !== null) {
            closeAuthModal();
        }
    });

    // Prompt dismiss button
    if (promptDismiss) {
        promptDismiss.addEventListener('click', closeAuthModal);
    }
}

function bindNavigationEvents() {
    // All [data-goto] links within the modal (switch between states)
    document.querySelectorAll('#authModalContent [data-goto]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = link.dataset.goto;
            // Map "signin" -> "sign-in" if needed (HTML uses "signin", JS uses "sign-in")
            const stateKey = target === 'signin' ? 'sign-in' : target;
            switchState(stateKey);
        });
    });

    // Forgot password link in sign-in form
    const forgotLink = document.querySelector('#stateSignin .auth-link-muted');
    if (forgotLink) {
        forgotLink.addEventListener('click', (e) => {
            e.preventDefault();
            switchState('forgot');
        });
    }

    // Header Sign In button
    const headerSignin = document.getElementById('headerSignin');
    if (headerSignin) {
        headerSignin.addEventListener('click', () => {
            openAuthModal('sign-in');
        });
    }
}

function bindOAuthEvents() {
    // Google OAuth buttons (in all states that have them)
    document.querySelectorAll('#authModalContent .oauth-btn-google').forEach(btn => {
        btn.addEventListener('click', () => handleOAuthSignIn('google'));
    });

    // GitHub OAuth buttons
    document.querySelectorAll('#authModalContent .oauth-btn-github').forEach(btn => {
        btn.addEventListener('click', () => handleOAuthSignIn('github'));
    });
}

function bindInputClearErrors() {
    // Clear field errors when the user focuses an input
    document.querySelectorAll('#authModalContent .auth-input').forEach(input => {
        input.addEventListener('focus', () => {
            input.classList.remove('error');
            const errorEl = input.parentElement.querySelector('.field-error');
            if (errorEl) errorEl.classList.remove('visible');
        });

        // Also clear server errors when the user types
        input.addEventListener('input', () => {
            const form = input.closest('.auth-state');
            if (form) {
                const serverErr = form.querySelector('.auth-server-error');
                if (serverErr) {
                    serverErr.classList.remove('visible');
                    serverErr.textContent = '';
                }
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Auth State Change Listener
// ---------------------------------------------------------------------------

function listenAuthStateChanges() {
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
            updateHeaderUI(session.user);
            // Close auth modal if it's open
            if (currentState !== null) {
                closeAuthModal();
            }
        } else if (event === 'SIGNED_OUT') {
            updateHeaderUI(null);
        }
    });
}

// ---------------------------------------------------------------------------
// Custom Event: auth:required (from api.js on 401)
// ---------------------------------------------------------------------------

function listenAuthRequired() {
    window.addEventListener('auth:required', () => {
        openAuthModal('prompt');
    });
}

// ---------------------------------------------------------------------------
// Public: initAuth
// ---------------------------------------------------------------------------

/**
 * Initialize the auth module. Call once after DOMContentLoaded.
 * Resolves all DOM references, binds event listeners, checks current session.
 */
export function initAuth() {
    // --- Resolve DOM references ---
    backdrop = document.getElementById('authModal');
    modalClose = document.getElementById('authModalClose');

    stateSignin = document.getElementById('stateSignin');
    stateRegister = document.getElementById('stateRegister');
    stateForgot = document.getElementById('stateForgot');
    statePrompt = document.getElementById('statePrompt');

    // Sign-in
    signinForm = document.getElementById('signinForm');
    signinEmail = document.getElementById('signinEmail');
    signinPassword = document.getElementById('signinPassword');
    signinSubmit = document.getElementById('signinSubmit');
    signinEmailError = document.getElementById('signinEmailError');
    signinPasswordError = document.getElementById('signinPasswordError');
    signinServerError = document.getElementById('signinServerError');

    // Register
    registerForm = document.getElementById('registerForm');
    registerName = document.getElementById('registerName');
    registerEmail = document.getElementById('registerEmail');
    registerPassword = document.getElementById('registerPassword');
    registerSubmit = document.getElementById('registerSubmit');
    registerEmailError = document.getElementById('registerEmailError');
    registerPasswordError = document.getElementById('registerPasswordError');
    registerServerError = document.getElementById('registerServerError');

    // Forgot password
    forgotFormWrapper = document.getElementById('forgotForm');
    forgotFormEl = document.getElementById('forgotFormEl');
    forgotEmail = document.getElementById('forgotEmail');
    forgotSubmit = document.getElementById('forgotSubmit');
    forgotEmailError = document.getElementById('forgotEmailError');
    forgotServerError = document.getElementById('forgotServerError');
    forgotSuccess = document.getElementById('forgotSuccess');
    forgotSentEmail = document.getElementById('forgotSentEmail');

    // Prompt
    promptDismiss = document.getElementById('promptDismiss');

    // --- Bind events ---
    bindModalEvents();
    bindNavigationEvents();
    bindOAuthEvents();
    bindFormEvents();
    bindInputClearErrors();
    listenAuthStateChanges();
    listenAuthRequired();

    // --- Check current session on load ---
    supabase.auth.getSession().then(({ data }) => {
        updateHeaderUI(data.session?.user || null);
    });
}
