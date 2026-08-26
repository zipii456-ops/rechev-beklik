// API ספק — בקשות מהאזור שלו בלבד, צי רכבים, הצעות, וסטטוס סופי
const express = require('express');
const { db, CAR_TYPES, FINAL_STATUSES, PRICE_UNITS, verifyPassword, resolveCarImage } = require('../db');
const { createSession, destroySession, requireAuth } = require('../auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const sup = db.prepare('SELECT * FROM suppliers WHERE email=? AND removed=0').get(String(email || '').trim().toLowerCase());
  if (!sup || !verifyPassword(password || '', sup.password_hash)) {
    return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
  }
  if (!sup.active) return res.status(403).json({ error: 'החשבון נחסם. יש לפנות למנהל המערכת' });
  const token = createSession('supplier', sup.id);
  res.json({ token, name: sup.name, region: sup.region });
});

router.post('/logout', requireAuth('supplier'), (req, res) => {
  destroySession(req.auth.token);
  res.json({ ok: true });
});

// ===== צי הרכבים של הספק =====
const carView = (c) => ({ id: c.id, model: c.model, carType: c.car_type, photo: c.photo });

router.get('/cars', requireAuth('supplier'), (req, res) => {
  const cars = db.prepare(
    'SELECT * FROM supplier_cars WHERE supplier_id=? AND active=1 ORDER BY car_type, model'
  ).all(req.supplier.id);
  res.json({ cars: cars.map(carView) });
});

router.post('/cars', requireAuth('supplier'), (req, res) => {
  const b = req.body || {};
  const model = String(b.model || '').trim().slice(0, 60);
  if (!model) return res.status(400).json({ error: 'נא לציין דגם רכב' });
  if (!CAR_TYPES.includes(b.carType)) return res.status(400).json({ error: 'נא לבחור סוג רכב' });

  // התמונה נקבעת אוטומטית לפי הדגם (כמו ב-Booking), מהקטלוג
  const photo = resolveCarImage(model, b.carType);

  const info = db.prepare('INSERT INTO supplier_cars (supplier_id, model, car_type, photo) VALUES (?,?,?,?)')
    .run(req.supplier.id, model, b.carType, photo);
  res.json({ ok: true, id: Number(info.lastInsertRowid), photo });
});

// הסרה רכה — הצעות ישנות שמקושרות לרכב שומרות את התמונה
router.delete('/cars/:id', requireAuth('supplier'), (req, res) => {
  const info = db.prepare('UPDATE supplier_cars SET active=0 WHERE id=? AND supplier_id=?')
    .run(Number(req.params.id), req.supplier.id);
  if (!info.changes) return res.status(404).json({ error: 'הרכב לא נמצא' });
  res.json({ ok: true });
});

// ===== בקשות =====
// הבקשות הרלוונטיות לספק: פתוחות באזור שלו, או כאלה שכבר הגיש להן הצעה
router.get('/requests', requireAuth('supplier'), (req, res) => {
  const sup = req.supplier;
  const rows = db.prepare(`
    SELECT r.* FROM requests r
    WHERE r.region = ?
      AND (r.status = 'חדש' OR EXISTS (SELECT 1 FROM offers o WHERE o.request_id = r.id AND o.supplier_id = ?))
    ORDER BY r.urgent DESC, r.created_at DESC`).all(sup.region, sup.id);

  const myOfferStmt = db.prepare(`
    SELECT o.*, c.photo AS car_photo FROM offers o
    LEFT JOIN supplier_cars c ON c.id = o.car_id
    WHERE o.request_id=? AND o.supplier_id=?`);

  // טלפון הלקוח נחשף אך ורק לספק שהצעתו נבחרה — עיקרון מניעת עקיפה
  res.json({
    supplier: { name: sup.name, region: sup.region },
    requests: rows.map(r => {
      const o = myOfferStmt.get(r.id, sup.id);
      return {
        id: r.id,
        publicId: r.public_id,
        region: r.region,
        neighborhood: r.neighborhood,
        startDate: r.start_date,
        endDate: r.end_date,
        carType: r.car_type,
        driverAge: r.driver_age,
        licenseYears: r.license_years,
        shabbat: !!r.shabbat,
        extraDriver: !!r.extra_driver,
        urgent: !!r.urgent,
        status: r.status,
        createdAt: r.created_at,
        customerPhone: o && o.chosen ? r.phone : undefined,
        myOffer: o ? {
          id: o.id, price: o.price, priceUnit: o.price_unit,
          carId: o.car_id, carModel: o.car_model, carPhoto: o.car_photo, note: o.note,
          available: !!o.available, chosen: !!o.chosen, status: o.status,
        } : null,
      };
    }),
  });
});

// הגשת הצעה (רכב מהצי + מחיר) או ציון חוסר זמינות (available:false)
router.post('/requests/:id/offers', requireAuth('supplier'), (req, res) => {
  const sup = req.supplier;
  const r = db.prepare('SELECT * FROM requests WHERE id=?').get(Number(req.params.id));
  if (!r || r.region !== sup.region) return res.status(404).json({ error: 'הבקשה לא נמצאה' });
  if (r.status !== 'חדש') return res.status(400).json({ error: 'הבקשה כבר אינה פתוחה להצעות' });

  const b = req.body || {};
  const available = b.available !== false;
  let price = null;
  let car = null;
  if (available) {
    price = Number(b.price);
    if (!price || price <= 0) return res.status(400).json({ error: 'נא להזין מחיר' });
    car = db.prepare('SELECT * FROM supplier_cars WHERE id=? AND supplier_id=? AND active=1')
      .get(Number(b.carId), sup.id);
    if (!car) return res.status(400).json({ error: 'נא לבחור רכב מהצי שלך' });
  }
  const priceUnit = PRICE_UNITS.includes(b.priceUnit) ? b.priceUnit : 'ליום';
  const note = String(b.note || '').trim() || null;

  const existing = db.prepare('SELECT * FROM offers WHERE request_id=? AND supplier_id=?').get(r.id, sup.id);
  if (existing && existing.chosen) {
    return res.status(400).json({ error: 'ההצעה כבר נבחרה על ידי הלקוח ולא ניתן לשנותה' });
  }
  const values = [price, priceUnit, car ? car.car_type : r.car_type, car ? car.model : null, car ? car.id : null, note, available ? 1 : 0];
  if (existing) {
    db.prepare(`UPDATE offers SET price=?, price_unit=?, car_type=?, car_model=?, car_id=?, note=?, available=?, status='הצעה נשלחה' WHERE id=?`)
      .run(...values, existing.id);
  } else {
    db.prepare(`INSERT INTO offers (price, price_unit, car_type, car_model, car_id, note, available, request_id, supplier_id) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(...values, r.id, sup.id);
  }
  res.json({ ok: true });
});

// עדכון סטטוס סופי (חובה) להצעה שנבחרה: "נסגר" / "לא נסגר"
router.post('/offers/:id/status', requireAuth('supplier'), (req, res) => {
  const status = req.body?.status;
  if (!FINAL_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'סטטוס לא חוקי' });
  }
  const offer = db.prepare('SELECT * FROM offers WHERE id=? AND supplier_id=?')
    .get(Number(req.params.id), req.supplier.id);
  if (!offer) return res.status(404).json({ error: 'ההצעה לא נמצאה' });
  if (!offer.chosen) return res.status(400).json({ error: 'ניתן לעדכן סטטוס סופי רק להצעה שנבחרה' });

  db.prepare('UPDATE offers SET status=? WHERE id=?').run(status, offer.id);
  db.prepare('UPDATE requests SET status=? WHERE id=?').run(status, offer.request_id);
  res.json({ ok: true });
});

module.exports = router;
