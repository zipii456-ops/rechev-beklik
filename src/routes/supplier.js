// API ספק — בקשות מהאזור שלו בלבד, צי רכבים, הצעות (כמה רכבים לבקשה), וסטטוס סופי
const express = require('express');
const { db, CAR_TYPES, GEARBOXES, FINAL_STATUSES, PRICE_UNITS, verifyPassword, resolveCarImage,
  commissionPercentFor, calcCommission } = require('../db');
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
const carView = (c) => ({ id: c.id, model: c.model, carType: c.car_type, gearbox: c.gearbox, photo: c.photo });

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
  const gearbox = GEARBOXES.includes(b.gearbox) ? b.gearbox : 'אוטומטי';
  const info = db.prepare('INSERT INTO supplier_cars (supplier_id, model, car_type, gearbox, photo) VALUES (?,?,?,?,?)')
    .run(req.supplier.id, model, b.carType, gearbox, photo);
  res.json({ ok: true, id: Number(info.lastInsertRowid), photo, gearbox });
});

// עריכת רכב בצי — הדגם, הסוג ותיבת ההילוכים; התמונה מתעדכנת לפי הדגם החדש
router.patch('/cars/:id', requireAuth('supplier'), (req, res) => {
  const car = db.prepare('SELECT * FROM supplier_cars WHERE id=? AND supplier_id=? AND active=1')
    .get(Number(req.params.id), req.supplier.id);
  if (!car) return res.status(404).json({ error: 'הרכב לא נמצא' });

  const b = req.body || {};
  const model = String(b.model || '').trim().slice(0, 60);
  if (!model) return res.status(400).json({ error: 'נא לציין דגם רכב' });
  if (!CAR_TYPES.includes(b.carType)) return res.status(400).json({ error: 'נא לבחור סוג רכב' });
  const gearbox = GEARBOXES.includes(b.gearbox) ? b.gearbox : car.gearbox;
  const photo = resolveCarImage(model, b.carType);

  db.prepare('UPDATE supplier_cars SET model=?, car_type=?, gearbox=?, photo=? WHERE id=?')
    .run(model, b.carType, gearbox, photo, car.id);

  // הצעות פתוחות שמשתמשות ברכב מתעדכנות; הצעות שכבר נבחרו נשארות כפי שהיו
  db.prepare('UPDATE offers SET car_model=?, car_type=? WHERE car_id=? AND chosen=0')
    .run(model, b.carType, car.id);

  res.json({ ok: true, photo, gearbox });
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

  const myOffersStmt = db.prepare(`
    SELECT o.*, c.photo AS car_photo, c.gearbox AS car_gearbox
    FROM offers o LEFT JOIN supplier_cars c ON c.id = o.car_id
    WHERE o.request_id=? AND o.supplier_id=?
    ORDER BY o.chosen DESC, o.price ASC`);

  // טלפון הלקוח נחשף אך ורק לספק שהצעתו נבחרה — עיקרון מניעת עקיפה
  res.json({
    supplier: { name: sup.name, region: sup.region },
    requests: rows.map(r => {
      const all = myOffersStmt.all(r.id, sup.id);
      const carOffers = all.filter(o => o.available);
      const won = all.some(o => o.chosen);
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
        extraDriver: !!r.extra_driver,
        urgent: !!r.urgent,
        status: r.status,
        createdAt: r.created_at,
        customerPhone: won ? r.phone : undefined,
        markedUnavailable: all.length > 0 && carOffers.length === 0,
        myOffers: carOffers.map(o => ({
          id: o.id, price: o.price, priceUnit: o.price_unit,
          carId: o.car_id, carModel: o.car_model, carType: o.car_type,
          carPhoto: o.car_photo, gearbox: o.car_gearbox, note: o.note,
          chosen: !!o.chosen, status: o.status,
        })),
      };
    }),
  });
});

// הגשת הצעות: רשימת רכבים מהצי, כל אחד עם מחיר. או סימון חוסר זמינות.
router.post('/requests/:id/offers', requireAuth('supplier'), (req, res) => {
  const sup = req.supplier;
  const r = db.prepare('SELECT * FROM requests WHERE id=?').get(Number(req.params.id));
  if (!r || r.region !== sup.region) return res.status(404).json({ error: 'הבקשה לא נמצאה' });
  if (r.status !== 'חדש') return res.status(400).json({ error: 'הבקשה כבר אינה פתוחה להצעות' });

  const b = req.body || {};

  // סימון "אין זמינות" — מסיר את ההצעות הקיימות ומשאיר סימון אחד
  if (b.available === false) {
    db.prepare('DELETE FROM offers WHERE request_id=? AND supplier_id=? AND chosen=0').run(r.id, sup.id);
    db.prepare('INSERT INTO offers (request_id, supplier_id, available, car_type) VALUES (?,?,0,?)')
      .run(r.id, sup.id, r.car_type);
    return res.json({ ok: true });
  }

  const items = Array.isArray(b.offers) ? b.offers : [];
  if (!items.length) return res.status(400).json({ error: 'נא לבחור לפחות רכב אחד ולהזין מחיר' });
  if (items.length > 10) return res.status(400).json({ error: 'ניתן להציע עד 10 רכבים לבקשה' });

  const priceUnit = PRICE_UNITS.includes(b.priceUnit) ? b.priceUnit : 'ליום';
  const note = String(b.note || '').trim() || null;

  // ולידציה מלאה לפני כתיבה — או שהכול נשמר, או ששום דבר לא נשמר
  const prepared = [];
  for (const item of items) {
    const price = Number(item.price);
    if (!price || price <= 0) return res.status(400).json({ error: 'נא להזין מחיר לכל רכב שנבחר' });
    const car = db.prepare('SELECT * FROM supplier_cars WHERE id=? AND supplier_id=? AND active=1')
      .get(Number(item.carId), sup.id);
    if (!car) return res.status(400).json({ error: 'אחד הרכבים אינו קיים בצי שלך' });
    if (prepared.some(p => p.car.id === car.id)) {
      return res.status(400).json({ error: 'אותו רכב נבחר יותר מפעם אחת' });
    }
    prepared.push({ car, price });
  }

  // מסירים את סימון "אין זמינות" ואת הרכבים שכבר לא בהצעה (למעט הצעה שנבחרה)
  const keepIds = prepared.map(p => p.car.id);
  const placeholders = keepIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM offers WHERE request_id=? AND supplier_id=? AND chosen=0
    AND (car_id IS NULL OR car_id NOT IN (${placeholders || 'NULL'}))`).run(r.id, sup.id, ...keepIds);

  const upsert = db.prepare(`
    INSERT INTO offers (request_id, supplier_id, car_id, price, price_unit, car_type, car_model, note, available)
    VALUES (?,?,?,?,?,?,?,?,1)
    ON CONFLICT(request_id, car_id) WHERE car_id IS NOT NULL DO UPDATE SET
      price=excluded.price, price_unit=excluded.price_unit, car_type=excluded.car_type,
      car_model=excluded.car_model, note=excluded.note, available=1, status='הצעה נשלחה'
    WHERE offers.chosen=0`);

  for (const { car, price } of prepared) {
    upsert.run(r.id, sup.id, car.id, price, priceUnit, car.car_type, car.model, note);
  }
  res.json({ ok: true, count: prepared.length });
});

// הסרת רכב בודד מההצעה
router.delete('/offers/:id', requireAuth('supplier'), (req, res) => {
  const offer = db.prepare('SELECT * FROM offers WHERE id=? AND supplier_id=?')
    .get(Number(req.params.id), req.supplier.id);
  if (!offer) return res.status(404).json({ error: 'ההצעה לא נמצאה' });
  if (offer.chosen) return res.status(400).json({ error: 'הלקוח כבר בחר בהצעה זו ולא ניתן להסירה' });
  const r = db.prepare('SELECT status FROM requests WHERE id=?').get(offer.request_id);
  if (r.status !== 'חדש') return res.status(400).json({ error: 'הבקשה כבר אינה פתוחה לשינויים' });
  db.prepare('DELETE FROM offers WHERE id=?').run(offer.id);
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

  if (status === 'נסגר') {
    // סכום העסקה בפועל נקבע על ידי הספק, וממנו מחושבים דמי הניהול
    const amount = Number(req.body?.finalAmount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'נא להזין את הסכום שנגבה בפועל' });
    }
    const percent = commissionPercentFor(req.supplier);
    const commission = calcCommission(amount, percent);
    db.prepare("UPDATE offers SET status=?, final_amount=?, commission=?, closed_at=datetime('now') WHERE id=?")
      .run(status, amount, commission, offer.id);
    db.prepare('UPDATE requests SET status=? WHERE id=?').run(status, offer.request_id);
    return res.json({ ok: true, finalAmount: amount, commission, percent });
  }

  db.prepare("UPDATE offers SET status=?, closed_at=datetime('now') WHERE id=?").run(status, offer.id);
  db.prepare('UPDATE requests SET status=? WHERE id=?').run(status, offer.request_id);
  res.json({ ok: true });
});

// החיובים של הספק — עסקאות שנסגרו ודמי הניהול עליהן
router.get('/billing', requireAuth('supplier'), (req, res) => {
  const rows = db.prepare(`
    SELECT o.id, o.final_amount, o.commission, o.commission_paid, o.closed_at,
           o.car_model, r.public_id, r.start_date, r.end_date
    FROM offers o JOIN requests r ON r.id = o.request_id
    WHERE o.supplier_id=? AND o.status='נסגר' AND o.chosen=1
    ORDER BY o.closed_at DESC`).all(req.supplier.id);

  const deals = rows.map(o => ({
    offerId: o.id, publicId: o.public_id, carModel: o.car_model,
    startDate: o.start_date, endDate: o.end_date,
    finalAmount: o.final_amount, commission: o.commission,
    paid: !!o.commission_paid, closedAt: o.closed_at,
  }));
  const unpaid = deals.filter(d => !d.paid);
  const round2 = (n) => Math.round(n * 100) / 100;
  res.json({
    percent: commissionPercentFor(req.supplier),
    deals,
    totals: {
      deals: deals.length,
      turnover: deals.reduce((a, d) => a + (d.finalAmount || 0), 0),
      commission: round2(deals.reduce((a, d) => a + (d.commission || 0), 0)),
      unpaid: round2(unpaid.reduce((a, d) => a + (d.commission || 0), 0)),
    },
  });
});

module.exports = router;
