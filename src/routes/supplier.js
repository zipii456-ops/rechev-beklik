// API ספק — בקשות מהאזור שלו בלבד, ללא טלפון לקוח
const express = require('express');
const { db, FINAL_STATUSES, verifyPassword } = require('../db');
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

// הבקשות הרלוונטיות לספק: פתוחות באזור שלו, או כאלה שכבר הגיש להן הצעה
router.get('/requests', requireAuth('supplier'), (req, res) => {
  const sup = req.supplier;
  const rows = db.prepare(`
    SELECT r.* FROM requests r
    WHERE r.region = ?
      AND (r.status = 'חדש' OR EXISTS (SELECT 1 FROM offers o WHERE o.request_id = r.id AND o.supplier_id = ?))
    ORDER BY r.urgent DESC, r.created_at DESC`).all(sup.region, sup.id);

  const myOfferStmt = db.prepare('SELECT * FROM offers WHERE request_id=? AND supplier_id=?');

  // ללא טלפון הלקוח — עיקרון מניעת עקיפה
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
        myOffer: o ? {
          id: o.id, price: o.price, note: o.note,
          available: !!o.available, chosen: !!o.chosen, status: o.status,
        } : null,
      };
    }),
  });
});

// הגשת הצעה או ציון חוסר זמינות (available:false)
router.post('/requests/:id/offers', requireAuth('supplier'), (req, res) => {
  const sup = req.supplier;
  const r = db.prepare('SELECT * FROM requests WHERE id=?').get(Number(req.params.id));
  if (!r || r.region !== sup.region) return res.status(404).json({ error: 'הבקשה לא נמצאה' });
  if (r.status !== 'חדש') return res.status(400).json({ error: 'הבקשה כבר אינה פתוחה להצעות' });

  const b = req.body || {};
  const available = b.available !== false;
  let price = null;
  if (available) {
    price = Number(b.price);
    if (!price || price <= 0) return res.status(400).json({ error: 'נא להזין מחיר' });
  }
  const carType = String(b.carType || r.car_type);
  const note = String(b.note || '').trim() || null;

  const existing = db.prepare('SELECT * FROM offers WHERE request_id=? AND supplier_id=?').get(r.id, sup.id);
  if (existing && existing.chosen) {
    return res.status(400).json({ error: 'ההצעה כבר נבחרה על ידי הלקוח ולא ניתן לשנותה' });
  }
  if (existing) {
    db.prepare(`UPDATE offers SET price=?, car_type=?, note=?, available=?, status='הצעה נשלחה' WHERE id=?`)
      .run(price, carType, note, available ? 1 : 0, existing.id);
  } else {
    db.prepare(`INSERT INTO offers (request_id, supplier_id, price, car_type, note, available) VALUES (?,?,?,?,?,?)`)
      .run(r.id, sup.id, price, carType, note, available ? 1 : 0);
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
