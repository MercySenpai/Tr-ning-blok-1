// Service worker: appka funguje offline.
// Pri každej zmene súborov zvýš číslo verzie nižšie, aby si telefón stiahol nové súbory.
const VERZIA = 'trening-v2';
const SUBORY = ['./', 'index.html', 'style.css', 'app.js', 'blok1_plan.json',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERZIA).then(c => c.addAll(SUBORY)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // zmaž staré verzie cache
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(n => n !== VERZIA).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

// Najprv sieť (vždy čerstvé), ak nie je internet, vezme sa uložená kópia.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => {
      const kopia = r.clone();
      caches.open(VERZIA).then(c => c.put(e.request, kopia));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
