const STORAGE_KEY = 'reader-theme';

export function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEY) || '';
    applyTheme(saved);
    bindThemeDots();
}

export function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
    // Update active dot
    document.querySelectorAll('.theme-dot').forEach(dot => {
        dot.classList.toggle('active', dot.dataset.theme === theme);
    });
}

export function getTheme() {
    return localStorage.getItem(STORAGE_KEY) || '';
}

export function setTheme(themeName) {
    applyTheme(themeName);
}

function bindThemeDots() {
    document.querySelectorAll('.theme-dot').forEach(dot => {
        dot.addEventListener('click', () => applyTheme(dot.dataset.theme));
    });
}
