// API לקוח — ללא הרשמה: יצירת בקשה, מעקב לפי טוקן, בחירת הצעה
const express = require('express');
const { db, REGIONS, CAR_TYPES, CAR_MODELS, PRICE_UNITS, newToken, publicIdFor } = require('../db');

const router = express.Router();

router.get('/meta', (req, res) => {
  res.json({ regions: REGIONS, carTypes: CAR_TYPES, carModels: CAR_MODELS, priceUnits: PRICE_UNITS });
});

router.post('/requests', (req, res) => {
  const b = req.body || {};
  const errors = [];

  if (!REGIONS.includes(b.region)) errors.push('אזור');
  if (!String(b.neighborhood || '').trim()) errors.push('שכונה');
  if (!b.startDate) errors.push('תאריך התחלה');
  if (!b.endDate) errors.push('תאריך סיום');
  if (b.startDate && b.endDate && b.endDate < b.startDate) errors.push('תאריך סיום לפני ההתחלה');
  if (!CAR_TYPES.includes(b.carType)) errors.push('סוג רכב');
  const age = Number(b.driverAge);
  if (!age || age < 16 || age > 99) errors.push('גיל הנהג');
  const lic = Number(b.licenseYears);
  if (Number.isNaN(lic) || lic < 0) errors.push('ותק רישיון');
  const phone = String(b.phone || '').trim();
  if (!/^0\d[\d-]{7,9}$/.test(phone)) errors.push('טלפון');

  if (errors.length) {
    return res.status(400).json({ error: 'נא לבדוק את השדות: ' + errors.join(', ') });
  }

  const token = newToken();
  const info = db.prepare(`
    INSERT INTO requests (track_token, region, neighborhood, start_date, end_date, car_type,
      driver_age, license_years, shabbat, extra_driver, urgent, phone)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    token, b.region, String(b.neighborhood).trim(), b.startDate, b.endDate, b.carType,
    age, lic, b.shabbat ? 1 : 0, b.extraDriver ? 1 : 0, b.urgent ? 1 : 0, phone
  );
  const id = Number(info.lastInsertRowid);
  const publicId = publicIdFor(id);
  db.prepare('UPDATE requests SET public_id=? WHERE id=?').run(publicId, id);

  res.json({ publicId, trackToken: token });
});

// תצוגת בקשה ללקוח — 'חדש' מוצג כ"ממתין להצעות"
function customerRequestView(r) {
  return {
    publicId: r.public_id,
    status: r.status === 'חדש' ? 'ממתין להצעות' : r.status,
    region: r.region,
    neighborhood: r.neighborhood,
    startDate: r.start_date,
    endDate: r.end_date,
    carType: r.car_type,
    urgent: !!r.urgent,
    createdAt: r.created_at,
  };
}

router.get('/track/:token', (req, res) => {
  const r = db.prepare('SELECT * FROM requests WHERE track_token=?').get(req.params.token);
  if (!r) return res.status(404).json({ error: 'הבקשה לא נמצאה' });

  // ללא פרטי ספק — רק מחיר, סוג רכב ותנאים
  const offers = db.prepare(`
    SELECT id, price, price_unit, car_type, car_model, note, chosen, status
    FROM offers WHERE request_id=? AND available=1
    ORDER BY chosen DESC, price ASC`).all(r.id);

  res.json({
    request: customerRequestView(r),
    offers: offers.map(o => ({
      id: o.id, price: o.price, priceUnit: o.price_unit, carType: o.car_type,
      carModel: o.car_model, note: o.note,
      chosen: !!o.chosen, status: o.status,
    })),
  });
});

router.post('/track/:token/choose', (req, res) => {
  const r = db.prepare('SELECT * FROM requests WHERE track_token=?').get(req.params.token);
  if (!r) return res.status(404).json({ error: 'הבקשה לא נמצאה' });
  if (r.status !== 'חדש') return res.status(400).json({ error: 'כבר נבחרה הצעה לבקשה זו' });

  const offer = db.prepare('SELECT * FROM offers WHERE id=? AND request_id=? AND available=1')
    .get(Number(req.body?.offerId), r.id);
  if (!offer) return res.status(404).json({ error: 'ההצעה לא נמצאה' });

  db.prepare('UPDATE offers SET chosen=1 WHERE id=?').run(offer.id);
  db.prepare("UPDATE requests SET status='נבחרה הצעה' WHERE id=?").run(r.id);
  res.json({ ok: true });
});

module.exports = router;
