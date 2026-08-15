// AIC website service worker — PWA caching + push notifications.
// Bump CACHE_VERSION whenever you ship code/CSS/HTML changes that
// you need to flush on installed phones.
const CACHE_VERSION = 'v7';
const CACHE_NAME = `aic-site-${CACHE_VERSION}`;

const CORE_ASSETS = [
    '/',
    '/index.html',
    '/contact.html',
    '/activities.html',
    '/service-charity.html',
    '/service-development.html',
    '/service-madrasah.html',
    '/service-quran-circle.html',
    '/manifest.json',
    '/assets/css/styles.css',
    '/assets/js/script.js',
    '/assets/js/salah-widget.js',
    '/assets/js/notifications.js',
    '/assets/js/install.js',
    '/assets/images/logo.png',
    '/assets/images/bg-pattern.svg',
    '/assets/images/Masjid-1.png',
    '/assets/images/Masjid-2.png',
    '/data/config.json',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            // Use addAll with individual catches so one missing asset doesn't kill install.
            Promise.all(CORE_ASSETS.map((u) =>
                cache.add(u).catch((err) => console.warn('SW cache miss', u, err))
            ))
        )
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Only handle GETs
    if (req.method !== 'GET') return;

    // The donation app is in this SW's scope but must never be served stale:
    // it carries the SumUp affiliate key and its own config, and a cached copy
    // on a volunteer's phone would keep taking payments with old settings.
    // Leave it entirely to the network.
    if (url.origin === location.origin && url.pathname.startsWith('/donate-app/')) return;

    // Live Google Sheet: network-first, fall back to cache.
    if (url.host === 'docs.google.com') {
        event.respondWith(
            fetch(req).then((res) => {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((c) => c.put(req, copy));
                return res;
            }).catch(() => caches.match(req))
        );
        return;
    }

    // Same-origin only beyond this point.
    if (url.origin !== location.origin) return;

    const isNavigation = req.mode === 'navigate';
    const isHtml = req.headers.get('accept')?.includes('text/html') ?? false;
    const isData = url.pathname.startsWith('/data/');

    // Navigation / HTML / data: network-first so updates show, fall back to cache offline.
    if (isNavigation || isHtml || isData) {
        event.respondWith(
            fetch(req).then((res) => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(req, copy));
                }
                return res;
            }).catch(() =>
                caches.match(req).then((cached) => cached || caches.match('/index.html'))
            )
        );
        return;
    }

    // Static assets (CSS/JS/images): cache-first, fall back to network.
    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((res) => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(req, copy));
                }
                return res;
            });
        })
    );
});

// ===== Push notifications =====

const NOTIFICATION_ICON = new URL('/assets/images/logo.png', self.location.origin).href;

self.addEventListener('push', (event) => {
    let data = { title: 'Aldershot Islamic Centre — Prayer Times Today', body: '' };
    if (event.data) {
        try { data = { ...data, ...event.data.json() }; }
        catch { data.body = event.data.text(); }
    }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: NOTIFICATION_ICON,
            badge: NOTIFICATION_ICON,
            tag: data.tag || 'aic-daily',
            renotify: false,
            vibrate: [120, 60, 120],
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            for (const c of list) {
                if (c.url.startsWith(self.location.origin) && 'focus' in c) return c.focus();
            }
            return clients.openWindow('/');
        })
    );
});
