// Service Worker — מאפשר התקנה כאפליקציה וטעינה מהירה של התמונות.
// אסטרטגיה: קוד ודפים תמיד מהרשת (כדי שעדכונים יגיעו מיד), תמונות רכב מהמטמון.
const CACHE = 'rb-v1';
const IMG = /\/(cars|icon)/;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/icon-192.png', '/apple-touch-icon.png']).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // תמונות ואייקונים — מהמטמון קודם (מהיר, וחוסך נתונים)
  if (IMG.test(new URL(req.url).pathname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // דפים, קוד ו-API — מהרשת קודם, ורק אם אין רשת נופלים למטמון
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && !req.url.includes('/api/')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
