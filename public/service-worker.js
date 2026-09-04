const CACHE_NAME = 'miofive-video-converter-v5';
const APP_BASE_URL = new URL('./', self.registration.scope);
const STATIC_ASSETS = [
    '',
    'index.html',
    'styles.css',
    'player-styles.css',
    'app.js',
    'player.js',
    'folder-browser.js',
    'dialog.js',
    'demo-api-mock.js',
    'security.js',
    'manifest.webmanifest',
    'app-icon.svg',
].map((assetPath) => new URL(assetPath, APP_BASE_URL).href);
const STATIC_ASSET_PATHS = new Set(STATIC_ASSETS.map((assetUrl) => new URL(assetUrl).pathname));

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

    if (
        request.method !== 'GET' ||
        url.origin !== self.location.origin ||
        !url.pathname.startsWith(APP_BASE_URL.pathname)
    ) {
        return;
    }

    const isAppShellRequest =
        request.mode === 'navigate' ||
        STATIC_ASSET_PATHS.has(url.pathname);

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
            .catch(async () => {
                const cached = await caches.match(request, {ignoreSearch: true});
                if (cached) return cached;
                if (request.mode === 'navigate') {
                    return caches.match(new URL('index.html', APP_BASE_URL).href);
                }
                return undefined;
            })
    );
});
