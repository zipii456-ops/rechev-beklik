// Service Worker — מאפשר התקנה כאפליקציה וטעינה מהירה של התמונות.
// אסטרטגיה: כל בקשות ה-API ישירות מהרשת (אף פעם לא מהמטמון!),
// דפים וקוד מהרשת עם גיבוי מקומי, ותמונות סטטיות מהמטמון.
const CACHE = 'rb-v2';

// רק קבצי תמונה סטטיים — חייב להתחיל בתיקייה עצמה,
// אחרת כתובות כמו /api/supplier/cars היו נתפסות בטעות ומוחזרות מהמטמון.
const STATIC_IMG = /^\/(cars\/|icon|apple-touch-icon|qr-)/;

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
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;

  // API — תמיד מהרשת, בלי מטמון בכלל. נתונים חייבים להיות עדכניים.
  if (url.pathname.startsWith('/api/')) return;

  // תמונות ואייקונים — מהמטמון קודם (מהיר, וחוסך נתונים)
  if (STATIC_IMG.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // דפים וקוד — מהרשת קודם, ורק אם אין רשת נופלים למטמון
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
