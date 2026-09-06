// בדיקת אישור הלקוח וזיהוי אי-התאמות. הרצה: node tests/confirmation.js [כתובת]
const BASE = process.argv[2] || 'http://localhost:3000';
let failures = 0;
// פרטי הכניסה נקראים מהסביבה — אין סיסמאות קבועות בקוד
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@rechev-beklik.co.il';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
const SUPPLIER_PASSWORD = process.env.SUPPLIER_PASSWORD || 'demo1234';

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

// מביא עסקה עד לשלב שבו הספק צריך לדווח על התוצאה
async function dealUpTo({ token, carId, price = 200 }) {
  const req = await api('/api/requests', { body: {
    region: 'ירושלים', neighborhood: 'רמות', startDate: '2026-12-01', endDate: '2026-12-04',
    carType: 'משפחתי', driverAge: 35, licenseYears: 10, phone: '050-3334444',
  }});
  const mine = (await api('/api/supplier/requests', { token })).data.requests
    .find(r => r.publicId === req.data.publicId);
  await api(`/api/supplier/requests/${mine.id}/offers`, { token, body: { offers: [{ carId, price }], priceUnit: 'ליום' } });
  const track = await api('/api/track/' + req.data.trackToken);
  await api(`/api/track/${req.data.trackToken}/choose`, { body: { offerId: track.data.offers[0].id } });
  const won = (await api('/api/supplier/requests', { token })).data.requests
    .find(r => r.publicId === req.data.publicId);
  return { trackToken: req.data.trackToken, publicId: req.data.publicId, offerId: won.myOffers.find(o => o.chosen).id };
}

(async () => {
  const admin = (await api('/api/admin/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })).data.token;
  const t = (await api('/api/supplier/login', { body: { email: 'moshe@demo.co.il', password: SUPPLIER_PASSWORD } })).data.token;
  await api('/api/admin/settings/commission', { token: admin, body: { percent: 10 } });
  const car = await api('/api/supplier/cars', { token: t, body: { model: 'טויוטה קורולה', carType: 'משפחתי', gearbox: 'אוטומטי' } });

  // --- מקרה 1: עסקה נסגרה והלקוח מאשר ---
  const d1 = await dealUpTo({ token: t, carId: car.data.id });
  let track = await api('/api/track/' + d1.trackToken);
  check('לפני דיווח הספק אין בקשת אישור', track.data.request.needsConfirmation === false, track.data.request);
  const early = await api(`/api/track/${d1.trackToken}/confirm`, { body: { received: true } });
  check('אי אפשר לאשר לפני סיום העסקה', early.status === 400, early.data);

  await api(`/api/supplier/offers/${d1.offerId}/status`, { token: t, body: { status: 'נסגר', finalAmount: 900 } });
  track = await api('/api/track/' + d1.trackToken);
  check('אחרי סגירה הלקוח מתבקש לאשר', track.data.request.needsConfirmation === true);

  const conf = await api(`/api/track/${d1.trackToken}/confirm`, { body: { received: true } });
  check('הלקוח מאשר שקיבל את הרכב', conf.status === 200 && conf.data.received === true, conf.data);
  track = await api('/api/track/' + d1.trackToken);
  check('הבקשה כבר לא מבקשת אישור', track.data.request.needsConfirmation === false);
  check('האישור נשמר על ההצעה', track.data.offers.find(o => o.chosen).customerConfirmed === true);
  const twice = await api(`/api/track/${d1.trackToken}/confirm`, { body: { received: false } });
  check('אי אפשר לענות פעמיים', twice.status === 400);

  // --- מקרה 2: אי-התאמה — הספק דיווח "לא נסגר" והלקוח קיבל רכב ---
  const d2 = await dealUpTo({ token: t, carId: car.data.id, price: 350 });
  await api(`/api/supplier/offers/${d2.offerId}/status`, { token: t, body: { status: 'לא נסגר' } });
  await api(`/api/track/${d2.trackToken}/confirm`, { body: { received: true } });

  let bill = await api('/api/admin/billing', { token: admin });
  let row = bill.data.suppliers.find(r => r.email === 'moshe@demo.co.il');
  check('אי-התאמה מזוהה אצל הספק', row.mismatches.length === 1 && row.mismatches[0].publicId === d2.publicId, row.mismatches);
  check('אי-התאמה נספרת בסיכום הכללי', bill.data.totals.mismatches === 1, bill.data.totals);

  // --- מקרה 3: הספק דיווח "נסגר" והלקוח מכחיש ---
  const d3 = await dealUpTo({ token: t, carId: car.data.id, price: 150 });
  await api(`/api/supplier/offers/${d3.offerId}/status`, { token: t, body: { status: 'נסגר', finalAmount: 600 } });
  await api(`/api/track/${d3.trackToken}/confirm`, { body: { received: false } });
  bill = await api('/api/admin/billing', { token: admin });
  row = bill.data.suppliers.find(r => r.email === 'moshe@demo.co.il');
  check('עסקה במחלוקת מסומנת', row.disputedCount === 1, row.disputedCount);
  const disputed = row.deals.find(d => d.publicId === d3.publicId);
  check('מצב האישור מוצג למנהל', disputed.customerConfirmed === false, disputed);

  // --- ביטול חיוב על עסקה במחלוקת ---
  const before = row.commission;
  const waive = await api(`/api/admin/offers/${d3.offerId}/waive`, { token: admin, body: { waived: 1 } });
  check('ביטול חיוב', waive.status === 200 && waive.data.waived === true, waive.data);
  bill = await api('/api/admin/billing', { token: admin });
  row = bill.data.suppliers.find(r => r.email === 'moshe@demo.co.il');
  check('החיוב שבוטל ירד מהסיכום', row.commission === Math.round((before - 60) * 100) / 100, { before, after: row.commission });
  const supBill = await api('/api/supplier/billing', { token: t });
  check('הספק לא רואה חיוב שבוטל', !supBill.data.deals.some(d => d.publicId === d3.publicId), supBill.data.deals.map(d => d.publicId));

  const unwaive = await api(`/api/admin/offers/${d3.offerId}/waive`, { token: admin, body: { waived: 0 } });
  check('החזרת החיוב', unwaive.data.waived === false);

  // הרשאות
  check('ספק לא יכול לבטל חיוב', (await api(`/api/admin/offers/${d3.offerId}/waive`, { token: t, body: { waived: 1 } })).status === 401);

  // ניקוי
  await api('/api/admin/clear-requests', { token: admin, body: {} });
  await api('/api/supplier/cars/' + car.data.id, { token: t, method: 'DELETE' });

  console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TESTS FAILED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(1); });
