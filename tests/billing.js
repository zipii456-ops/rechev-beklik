// בדיקת מנגנון דמי הניהול. הרצה: node tests/billing.js [כתובת]
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

// עסקה מלאה: בקשה → הצעה → בחירה → סגירה בסכום נתון
async function runDeal({ supToken, carId, region, price, finalAmount }) {
  const req = await api('/api/requests', { body: {
    region, neighborhood: 'מרכז', startDate: '2026-10-01', endDate: '2026-10-05',
    carType: 'משפחתי', driverAge: 35, licenseYears: 10, phone: '050-1234567',
  }});
  const mine = (await api('/api/supplier/requests', { token: supToken })).data.requests
    .find(r => r.publicId === req.data.publicId);
  await api(`/api/supplier/requests/${mine.id}/offers`, { token: supToken, body: {
    offers: [{ carId, price }], priceUnit: 'ליום',
  }});
  const track = await api('/api/track/' + req.data.trackToken);
  await api(`/api/track/${req.data.trackToken}/choose`, { body: { offerId: track.data.offers[0].id } });
  const won = (await api('/api/supplier/requests', { token: supToken })).data.requests
    .find(r => r.publicId === req.data.publicId);
  const offerId = won.myOffers.find(o => o.chosen).id;
  const close = await api(`/api/supplier/offers/${offerId}/status`, {
    token: supToken, body: { status: 'נסגר', finalAmount } });
  return { publicId: req.data.publicId, offerId, close };
}

(async () => {
  const admin = (await api('/api/admin/login', { body: { email: 'admin@demo.co.il', password: 'admin1234' } })).data.token;
  const t = (await api('/api/supplier/login', { body: { email: 'moshe@demo.co.il', password: 'demo1234' } })).data.token;
  const car = await api('/api/supplier/cars', { token: t, body: { model: 'טויוטה קורולה', carType: 'משפחתי', gearbox: 'אוטומטי' } });

  // תעריף כללי
  const setPct = await api('/api/admin/settings/commission', { token: admin, body: { percent: 10 } });
  check('קביעת תעריף כללי 10%', setPct.status === 200 && setPct.data.percent === 10, setPct.data);
  const bad = await api('/api/admin/settings/commission', { token: admin, body: { percent: 150 } });
  check('אחוז לא חוקי נדחה', bad.status === 400);

  // עסקה ראשונה: ₪1000 → ₪100 עמלה
  const d1 = await runDeal({ supToken: t, carId: car.data.id, region: 'ירושלים', price: 250, finalAmount: 1000 });
  check('סגירת עסקה מחזירה עמלה', d1.close.status === 200 && d1.close.data.commission === 100, d1.close.data);

  // סגירה בלי סכום נדחית
  const d2req = await api('/api/requests', { body: {
    region: 'ירושלים', neighborhood: 'רמות', startDate: '2026-10-10', endDate: '2026-10-12',
    carType: 'משפחתי', driverAge: 40, licenseYears: 20, phone: '050-7654321' } });
  const m2 = (await api('/api/supplier/requests', { token: t })).data.requests.find(r => r.publicId === d2req.data.publicId);
  await api(`/api/supplier/requests/${m2.id}/offers`, { token: t, body: { offers: [{ carId: car.data.id, price: 300 }], priceUnit: 'ליום' } });
  const tr2 = await api('/api/track/' + d2req.data.trackToken);
  await api(`/api/track/${d2req.data.trackToken}/choose`, { body: { offerId: tr2.data.offers[0].id } });
  const won2 = (await api('/api/supplier/requests', { token: t })).data.requests.find(r => r.publicId === d2req.data.publicId);
  const offer2 = won2.myOffers.find(o => o.chosen).id;
  const noAmount = await api(`/api/supplier/offers/${offer2}/status`, { token: t, body: { status: 'נסגר' } });
  check('סגירה ללא סכום נדחית', noAmount.status === 400, noAmount.data);
  const closed2 = await api(`/api/supplier/offers/${offer2}/status`, { token: t, body: { status: 'נסגר', finalAmount: 1500 } });
  check('סגירה עם סכום ₪1500 → עמלה ₪150', closed2.data.commission === 150, closed2.data);

  // מסך הספק
  const supBill = await api('/api/supplier/billing', { token: t });
  check('הספק רואה שתי עסקאות', supBill.data.totals.deals === 2, supBill.data.totals);
  check('סך מחזור ₪2500', supBill.data.totals.turnover === 2500, supBill.data.totals);
  check('סך עמלה ₪250', supBill.data.totals.commission === 250, supBill.data.totals);
  check('הכול טרם שולם', supBill.data.totals.unpaid === 250);

  // דוח המנהל
  let adminBill = await api('/api/admin/billing', { token: admin });
  let row = adminBill.data.suppliers.find(r => r.email === 'moshe@demo.co.il');
  check('המנהל רואה את החיובים של הספק', row.closedCount === 2 && row.commission === 250, row);
  check('סיכום כללי', adminBill.data.totals.commission === 250 && adminBill.data.totals.unpaid === 250, adminBill.data.totals);

  // סימון כשולם
  const paid = await api(`/api/admin/offers/${d1.offerId}/paid`, { token: admin, body: { paid: 1 } });
  check('סימון חיוב כשולם', paid.status === 200 && paid.data.paid === true, paid.data);
  adminBill = await api('/api/admin/billing', { token: admin });
  row = adminBill.data.suppliers.find(r => r.email === 'moshe@demo.co.il');
  check('החוב ירד ל-₪150', row.unpaid === 150, row.unpaid);
  const supBill2 = await api('/api/supplier/billing', { token: t });
  check('הספק רואה שהחיוב שולם', supBill2.data.totals.unpaid === 150);

  // תעריף אישי לספק
  const custom = await api(`/api/admin/suppliers/${row.supplierId}/commission`, { token: admin, body: { percent: 5 } });
  check('תעריף אישי 5%', custom.status === 200 && custom.data.percent === 5, custom.data);
  const d3 = await runDeal({ supToken: t, carId: car.data.id, region: 'ירושלים', price: 200, finalAmount: 800 });
  check('עסקה חדשה מחושבת ב-5% → ₪40', d3.close.data.commission === 40, d3.close.data);
  const reset = await api(`/api/admin/suppliers/${row.supplierId}/commission`, { token: admin, body: { percent: null } });
  check('ביטול תעריף אישי', reset.status === 200 && reset.data.percent === null);

  // מדד "לא נסגר" — לזיהוי התחמקות
  const d4 = await api('/api/requests', { body: {
    region: 'ירושלים', neighborhood: 'גילה', startDate: '2026-11-01', endDate: '2026-11-03',
    carType: 'משפחתי', driverAge: 30, licenseYears: 8, phone: '050-1112222' } });
  const m4 = (await api('/api/supplier/requests', { token: t })).data.requests.find(r => r.publicId === d4.data.publicId);
  await api(`/api/supplier/requests/${m4.id}/offers`, { token: t, body: { offers: [{ carId: car.data.id, price: 100 }], priceUnit: 'ליום' } });
  const tr4 = await api('/api/track/' + d4.data.trackToken);
  await api(`/api/track/${d4.data.trackToken}/choose`, { body: { offerId: tr4.data.offers[0].id } });
  const won4 = (await api('/api/supplier/requests', { token: t })).data.requests.find(r => r.publicId === d4.data.publicId);
  await api(`/api/supplier/offers/${won4.myOffers.find(o => o.chosen).id}/status`, { token: t, body: { status: 'לא נסגר' } });
  adminBill = await api('/api/admin/billing', { token: admin });
  row = adminBill.data.suppliers.find(r => r.email === 'moshe@demo.co.il');
  check('המנהל רואה כמה עסקאות סומנו "לא נסגר"', row.notClosedCount === 1, row.notClosedCount);
  check('עסקה שלא נסגרה אינה מחויבת', row.closedCount === 3, row.closedCount);

  // הרשאות
  check('ספק לא יכול לשנות תעריף', (await api('/api/admin/settings/commission', { token: t, body: { percent: 0 } })).status === 401);
  check('ספק לא יכול לסמן שולם', (await api(`/api/admin/offers/${d1.offerId}/paid`, { token: t, body: { paid: 1 } })).status === 401);

  // ניקוי
  await api('/api/admin/clear-requests', { token: admin, body: {} });
  await api('/api/supplier/cars/' + car.data.id, { token: t, method: 'DELETE' });

  console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TESTS FAILED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(1); });
