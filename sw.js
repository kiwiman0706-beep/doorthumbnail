// App-shell cache. Bump CACHE when any shell file changes.
const CACHE = 'door-thumbnail-v1';
const SHARE = 'door-thumbnail-share';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/model.js',
  './js/photos.js',
  './js/render.js',
  './js/editor.js',
  './js/timeline.js',
  './js/output.js',
  './js/backup.js',
  './js/autoslot.js',
  './js/ui.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Android share sheet: stash the incoming photos, then hand control to the app.
async function receiveShare(request) {
  const cache = await caches.open(SHARE);
  for (const k of await cache.keys()) await cache.delete(k);
  let n = 0;
  try {
    const fd = await request.formData();
    for (const f of fd.getAll('photos')) {
      if (!f || !f.size) continue;
      await cache.put(`/__shared/${n}`, new Response(f, {
        headers: {
          'content-type': f.type || 'image/jpeg',
          'x-filename': encodeURIComponent(f.name || `shared-${n}.jpg`),
        },
      }));
      n++;
    }
  } catch { /* nothing usable was shared */ }
  return Response.redirect(new URL(`./index.html?shared=${n}`, self.location).href, 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Network first so an updated deploy is picked up, cache as the offline fallback.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('./index.html'))),
  );
});
