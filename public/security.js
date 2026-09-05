const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character]);
}

export function safeClassToken(value, fallback = 'other') {
    const token = String(value ?? '').toLowerCase();
    return /^[a-z0-9_-]+$/.test(token) ? token : fallback;
}

// Preferences are optional: privacy settings, storage quotas and ephemeral
// webviews must not prevent scanning or turn a completed export into an error.
export const safeStorage = Object.fromEntries(['getItem', 'setItem', 'removeItem'].map((method) => [
    method,
    (...args) => {
        try {
            return window.localStorage[method](...args);
        } catch {
            return null;
        }
    },
]));
