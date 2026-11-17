// Caches the site shell only (docs/ONLINE_LITE.md 8.6); data always comes from the data repo.
const SHELL = 'lite-shell-v1';
const FILES = ['./', 'index.html', 'app.css', 'js/main.js', 'js/data.js', 'js/model.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(k => k.startsWith('lite-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first so a new shell shows at once; the cache answers when offline.
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET' || url.origin !== location.origin) return;
    e.respondWith(fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(SHELL).then(c => c.put(e.request, copy));
        return res;
    }).catch(() => caches.match(e.request)));
});
