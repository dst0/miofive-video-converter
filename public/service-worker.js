const CACHE_NAME = 'miofive-video-converter-v3';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/player-styles.css',
    '/app.js',
    '/player.js',
    '/folder-browser.js',
    '/demo-api-mock.js',
    '/manifest.webmanifest',
    '/app-icon.svg',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
        return;
    }

    const isAppShellRequest =
        request.mode === 'navigate' ||
        STATIC_ASSETS.includes(url.pathname) ||
        (url.pathname === '/' && STATIC_ASSETS.includes('/'));

    if (!isAppShellRequest) {
        return;
    }

    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response && response.ok) {
                    const responseCopy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseCopy);
                    });
                }
                return response;
            })
            .catch(() => caches.match(request))
    );
});
