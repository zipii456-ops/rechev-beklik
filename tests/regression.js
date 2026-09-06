// בדיקת רגרסיה מלאה למערכת. הרצה: node tests/regression.js [כתובת]
// ברירת מחדל: http://localhost:3000
const BASE = process.argv[2] || 'http://localhost:3000';
let failures = 0;

const check = (name, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : ' -- ' + JSON.stringify(extra)));
  if (!cond) failures++;
};

const api = async (path, { method, body, token } = {}) => {
  const res = await fetch(BASE + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const login = (email, password = 'demo1234') =>
  api('/api/supplier/login', { body: { email, password } }).then(r => r.data.token);

(async () => {
  // ===== דפים ונכסים =====
  for (const p of ['/', '/supplier', '/admin', '/demo', '/start', '/install', '/credits.html',
                   '/app.css', '/carcard.js', '/sw.js', '/manifest.webmanifest',
                   '/apple-touch-icon.png', '/cars/toyota-corolla.jpg']) {
    const r = await fetch(BASE + p);
    check('נטען: ' + p, r.status === 200, r.status);
  }
  const start = await (await fetch(BASE + '/start')).text();
  check('עמוד הפתיחה עם כפתורים בשמות',
    start.includes('כניסה כלקוח') && start.includes('כניסה כספק') && start.includes('לוח ניהול'));

  // ===== צי הרכבים =====
  const t = await login('moshe@demo.co.il');
  check('כניסת ספק', !!t);

  const before = (await api('/api/supplier/cars', { token: t })).data.cars.length;
  const c1 = await api('/api/supplier/cars', { token: t, body: { model: 'טויוטה קורולה', carType: 'משפחתי', gearbox: 'אוטומטי' } });
  check('הוספת רכב', c1.status === 200 && !!c1.data.id, c1.data);
  check('תמונה נבחרה לפי הדגם', c1.data.photo === '/cars/toyota-corolla.jpg', c1.data);

  const fleet = (await api('/api/supplier/cars', { token: t })).data.cars;
  check('הרכב מופיע בצי מיד לאחר ההוספה', fleet.some(c => c.id === c1.data.id), fleet.map(c => c.model));
  check('מונה הצי עלה באחד', fleet.length === before + 1, { before, after: fleet.length });

  const c2 = await api('/api/supplier/cars', { token: t, body: { model: 'קיה פיקנטו', carType: 'קטן', gearbox: 'ידני' } });
  const noModel = await api('/api/supplier/cars', { token: t, body: { model: '', carType: 'קטן' } });
  check('רכב בלי דגם נדחה', noModel.status === 400);

  const edit = await api(`/api/supplier/cars/${c2.data.id}`, { token: t, method: 'PATCH',
    body: { model: 'קיה פיקנטו 2024', carType: 'קטן', gearbox: 'אוטומטי' } });
  check('עריכת רכב', edit.status === 200, edit.data);
  const other = await login('yaakov@demo.co.il');
  const foreign = await api(`/api/supplier/cars/${c2.data.id}`, { token: other, method: 'PATCH', body: { model: 'x', carType: 'קטן' } });
  check('ספק אחר לא עורך רכב שאינו שלו', foreign.status === 404);

  // ===== בקשה, הצעה עם כמה רכבים, בחירה =====
  const req = await api('/api/requests', { body: {
    region: 'ירושלים', neighborhood: 'רמות', startDate: '2026-09-01', endDate: '2026-09-04',
    carType: 'משפחתי', driverAge: 33, licenseYears: 11, phone: '050-4445555',
  }});
  check('יצירת בקשת לקוח', req.status === 200 && !!req.data.publicId, req.data);

  const mine = (await api('/api/supplier/requests', { token: t })).data.requests
    .find(r => r.publicId === req.data.publicId);
  check('הבקשה מגיעה לספק באזור', !!mine);
  check('הטלפון מוסתר לפני בחירה', mine && mine.customerPhone === undefined);

  const offers = await api(`/api/supplier/requests/${mine.id}/offers`, { token: t, body: {
    offers: [{ carId: c1.data.id, price: 250 }, { carId: c2.data.id, price: 190 }],
    priceUnit: 'ליום', note: 'כולל ביטוח',
  }});
  check('הגשת שני רכבים בהצעה אחת', offers.status === 200 && offers.data.count === 2, offers.data);

  const track = await api('/api/track/' + req.data.trackToken);
  check('הלקוח רואה שתי הצעות', track.data.offers.length === 2, track.data.offers.map(o => o.carModel));
  check('כל הצעה עם דגם ותמונה', track.data.offers.every(o => o.carModel && o.carPhoto));
  check('ממוין מהזול ליקר', track.data.offers[0].price === 190);
  check('ללא פרטי ספק', !('supplierName' in track.data.offers[0]));

  const choose = await api(`/api/track/${req.data.trackToken}/choose`, { body: { offerId: track.data.offers[0].id } });
  check('בחירת הצעה', choose.status === 200);
  const won = (await api('/api/supplier/requests', { token: t })).data.requests
    .find(r => r.publicId === req.data.publicId);
  check('הספק רואה שנבחר', won.myOffers.some(o => o.chosen));
  check('הטלפון נחשף לספק הזוכה', won.customerPhone === '050-4445555');
  const loser = (await api('/api/supplier/requests', { token: other })).data.requests
    .find(r => r.publicId === req.data.publicId);
  check('ספק מפסיד לא מקבל טלפון', !loser || loser.customerPhone === undefined);

  const final = await api(`/api/supplier/offers/${won.myOffers.find(o => o.chosen).id}/status`,
    { token: t, body: { status: 'נסגר', finalAmount: 760 } });
  check('סגירת עסקה עם סכום סופי', final.status === 200 && final.data.commission > 0, final.data);
  check('דמי ניהול חושבו', final.data.commission === Math.round(760 * final.data.percent) / 100, final.data);

  // ===== ניהול =====
  const admin = (await api('/api/admin/login', { body: { email: 'admin@demo.co.il', password: 'admin1234' } })).data.token;
  check('כניסת מנהל', !!admin);
  const ov = await api('/api/admin/overview', { token: admin });
  const adminReq = ov.data.requests.find(r => r.publicId === req.data.publicId);
  check('המנהל רואה טלפון וספק נבחר', adminReq && adminReq.phone === '050-4445555' && !!adminReq.chosenSupplier, adminReq);
  check('גישה ללא הרשאה נדחית', (await api('/api/admin/overview')).status === 401);

  const sup = ov.data.suppliers.find(s => s.email === 'chaim@demo.co.il');
  const pw = await api(`/api/admin/suppliers/${sup.id}/password`, { token: admin, body: { password: 'temp123456' } });
  check('קביעת סיסמה חדשה לספק', pw.status === 200);
  check('הסיסמה החדשה עובדת', (await api('/api/supplier/login', { body: { email: sup.email, password: 'temp123456' } })).status === 200);
  await api(`/api/admin/suppliers/${sup.id}/password`, { token: admin, body: { password: 'demo1234' } });
  check('הוחזר למצב הדמו', (await api('/api/supplier/login', { body: { email: sup.email, password: 'demo1234' } })).status === 200);

  // ===== ניקוי =====
  await api('/api/admin/clear-requests', { token: admin, body: {} });
  for (const id of [c1.data.id, c2.data.id]) await api('/api/supplier/cars/' + id, { token: t, method: 'DELETE' });
  const after = await api('/api/admin/overview', { token: admin });
  check('ניקוי: אין בקשות, הספקים נשארו',
    after.data.requests.length === 0 && after.data.suppliers.length === 7,
    { requests: after.data.requests.length, suppliers: after.data.suppliers.length });

  console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TESTS FAILED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(1); });
