// API אדמין — צפייה בהכול, שינוי סטטוסים, ניהול ספקים
const express = require('express');
const { db, REGIONS, REQUEST_STATUSES, FINAL_STATUSES, hashPassword, verifyPassword,
  getSetting, setSetting, commissionPercentFor, DEFAULT_COMMISSION } = require('../db');
const { createSession, destroySession, destroyUserSessions, requireAuth } = require('../auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const admin = db.prepare('SELECT * FROM admins WHERE email=?').get(String(email || '').trim().toLowerCase());
  if (!admin || !verifyPassword(password || '', admin.password_hash)) {
    return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
  }
  const token = createSession('admin', admin.id);
  res.json({ token, name: admin.name });
});

router.post('/logout', requireAuth('admin'), (req, res) => {
  destroySession(req.auth.token);
  res.json({ ok: true });
});

// תמונת מצב מלאה: בקשות (כולל טלפון), הצעות (כולל שם ספק), ספקים
router.get('/overview', requireAuth('admin'), (req, res) => {
  const requests = db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM offers o WHERE o.request_id = r.id AND o.available = 1) AS offers_count,
      (SELECT s.name FROM offers o JOIN suppliers s ON s.id = o.supplier_id
        WHERE o.request_id = r.id AND o.chosen = 1) AS chosen_supplier
    FROM requests r ORDER BY r.created_at DESC`).all();

  const offers = db.prepare(`
    SELECT o.*, s.name AS supplier_name, r.public_id AS request_public_id, r.region AS request_region
    FROM offers o
    JOIN suppliers s ON s.id = o.supplier_id
    JOIN requests r ON r.id = o.request_id
    ORDER BY o.created_at DESC`).all();

  const suppliers = db.prepare(`
    SELECT id, name, region, contact_name, email, active,
      (SELECT COUNT(*) FROM offers o WHERE o.supplier_id = suppliers.id) AS offers_count
    FROM suppliers WHERE removed = 0 ORDER BY region, name`).all();

  res.json({
    requests: requests.map(r => ({
      id: r.id, publicId: r.public_id, region: r.region, neighborhood: r.neighborhood,
      startDate: r.start_date, endDate: r.end_date, carType: r.car_type,
      driverAge: r.driver_age, licenseYears: r.license_years,
      shabbat: !!r.shabbat, extraDriver: !!r.extra_driver, urgent: !!r.urgent,
      phone: r.phone, status: r.status, createdAt: r.created_at,
      offersCount: r.offers_count, chosenSupplier: r.chosen_supplier,
    })),
    offers: offers.map(o => ({
      id: o.id, requestPublicId: o.request_public_id, region: o.request_region,
      supplierName: o.supplier_name, price: o.price, priceUnit: o.price_unit, carType: o.car_type,
      carModel: o.car_model,
      note: o.note, available: !!o.available, chosen: !!o.chosen,
      status: o.status, createdAt: o.created_at,
    })),
    suppliers: suppliers.map(s => ({
      id: s.id, name: s.name, region: s.region, contactName: s.contact_name,
      email: s.email, active: !!s.active, offersCount: s.offers_count,
    })),
    statuses: REQUEST_STATUSES,
    regions: REGIONS,
  });
});

// שינוי סטטוס ידני לבקשה; החזרה ל'חדש' פותחת אותה מחדש להצעות
router.post('/requests/:id/status', requireAuth('admin'), (req, res) => {
  const status = req.body?.status;
  if (!REQUEST_STATUSES.includes(status)) return res.status(400).json({ error: 'סטטוס לא חוקי' });
  const r = db.prepare('SELECT * FROM requests WHERE id=?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'הבקשה לא נמצאה' });

  db.prepare('UPDATE requests SET status=? WHERE id=?').run(status, r.id);
  if (FINAL_STATUSES.includes(status)) {
    db.prepare('UPDATE offers SET status=? WHERE request_id=? AND chosen=1').run(status, r.id);
  } else if (status === 'חדש') {
    db.prepare("UPDATE offers SET chosen=0, status='הצעה נשלחה' WHERE request_id=?").run(r.id);
  }
  res.json({ ok: true });
});

// ניקוי כל הבקשות וההצעות — לצורכי בדיקות (הספקים נשארים)
router.post('/clear-requests', requireAuth('admin'), (req, res) => {
  db.prepare('DELETE FROM offers').run();
  db.prepare('DELETE FROM requests').run();
  res.json({ ok: true });
});

// ===== דמי ניהול =====
// דוח חיובים: לכל ספק — עסקאות שנסגרו, מחזור, עמלה, ומה טרם שולם
router.get('/billing', requireAuth('admin'), (req, res) => {
  const suppliers = db.prepare('SELECT * FROM suppliers WHERE removed=0 ORDER BY region, name').all();
  const dealsStmt = db.prepare(`
    SELECT o.id, o.final_amount, o.commission, o.commission_paid, o.closed_at, o.car_model,
           r.public_id, r.region
    FROM offers o JOIN requests r ON r.id = o.request_id
    WHERE o.supplier_id=? AND o.status='נסגר' AND o.chosen=1
    ORDER BY o.closed_at DESC`);
  // מדד להתחמקות: כמה עסקאות שנבחרו סומנו בסוף כ"לא נסגר"
  const lostStmt = db.prepare(
    "SELECT COUNT(*) AS n FROM offers WHERE supplier_id=? AND chosen=1 AND status='לא נסגר'");
  const round2 = (n) => Math.round(n * 100) / 100;

  const rows = suppliers.map(sup => {
    const deals = dealsStmt.all(sup.id);
    const notClosed = lostStmt.get(sup.id).n;
    const commission = deals.reduce((a, d) => a + (d.commission || 0), 0);
    const unpaid = deals.filter(d => !d.commission_paid).reduce((a, d) => a + (d.commission || 0), 0);
    return {
      supplierId: sup.id, name: sup.name, region: sup.region, email: sup.email,
      active: !!sup.active,
      percent: commissionPercentFor(sup),
      customPercent: sup.commission_percent === null || sup.commission_percent === undefined
        ? null : Number(sup.commission_percent),
      closedCount: deals.length,
      notClosedCount: notClosed,
      turnover: deals.reduce((a, d) => a + (d.final_amount || 0), 0),
      commission: round2(commission),
      unpaid: round2(unpaid),
      deals: deals.map(d => ({
        offerId: d.id, publicId: d.public_id, region: d.region, carModel: d.car_model,
        finalAmount: d.final_amount, commission: d.commission,
        paid: !!d.commission_paid, closedAt: d.closed_at,
      })),
    };
  });

  res.json({
    defaultPercent: Number(getSetting('commission_percent', DEFAULT_COMMISSION)),
    suppliers: rows,
    totals: {
      turnover: rows.reduce((a, r) => a + r.turnover, 0),
      commission: round2(rows.reduce((a, r) => a + r.commission, 0)),
      unpaid: round2(rows.reduce((a, r) => a + r.unpaid, 0)),
      deals: rows.reduce((a, r) => a + r.closedCount, 0),
    },
  });
});

// שינוי אחוז דמי הניהול הכללי
router.post('/settings/commission', requireAuth('admin'), (req, res) => {
  const percent = Number(req.body?.percent);
  if (Number.isNaN(percent) || percent < 0 || percent > 100) {
    return res.status(400).json({ error: 'אחוז חייב להיות בין 0 ל-100' });
  }
  setSetting('commission_percent', percent);
  res.json({ ok: true, percent });
});

// תעריף אישי לספק (ריק = לפי התעריף הכללי)
router.post('/suppliers/:id/commission', requireAuth('admin'), (req, res) => {
  const sup = db.prepare('SELECT * FROM suppliers WHERE id=? AND removed=0').get(Number(req.params.id));
  if (!sup) return res.status(404).json({ error: 'הספק לא נמצא' });
  const raw = req.body?.percent;
  if (raw === null || raw === '' || raw === undefined) {
    db.prepare('UPDATE suppliers SET commission_percent=NULL WHERE id=?').run(sup.id);
    return res.json({ ok: true, percent: null });
  }
  const percent = Number(raw);
  if (Number.isNaN(percent) || percent < 0 || percent > 100) {
    return res.status(400).json({ error: 'אחוז חייב להיות בין 0 ל-100' });
  }
  db.prepare('UPDATE suppliers SET commission_percent=? WHERE id=?').run(percent, sup.id);
  res.json({ ok: true, percent });
});

// סימון חיוב כשולם / לא שולם
router.post('/offers/:id/paid', requireAuth('admin'), (req, res) => {
  const offer = db.prepare("SELECT * FROM offers WHERE id=? AND status='נסגר'").get(Number(req.params.id));
  if (!offer) return res.status(404).json({ error: 'החיוב לא נמצא' });
  const paid = req.body?.paid ? 1 : 0;
  db.prepare('UPDATE offers SET commission_paid=? WHERE id=?').run(paid, offer.id);
  res.json({ ok: true, paid: !!paid });
});

// הוספת ספק
router.post('/suppliers', requireAuth('admin'), (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!name) return res.status(400).json({ error: 'נא להזין שם ספק' });
  if (!REGIONS.includes(b.region)) return res.status(400).json({ error: 'נא לבחור אזור' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'אימייל לא תקין' });
  if (password.length < 6) return res.status(400).json({ error: 'סיסמה — לפחות 6 תווים' });

  try {
    db.prepare('INSERT INTO suppliers (name, region, contact_name, email, password_hash) VALUES (?,?,?,?,?)')
      .run(name, b.region, String(b.contactName || '').trim() || null, email, hashPassword(password));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'קיים כבר ספק עם האימייל הזה' });
    throw e;
  }
  res.json({ ok: true });
});

// קביעת סיסמה חדשה לספק — המנהל מוסר אותה לספק, וכל החיבורים הקיימים מנותקים
router.post('/suppliers/:id/password', requireAuth('admin'), (req, res) => {
  const id = Number(req.params.id);
  const sup = db.prepare('SELECT * FROM suppliers WHERE id=? AND removed=0').get(id);
  if (!sup) return res.status(404).json({ error: 'הספק לא נמצא' });
  const password = String(req.body?.password || '');
  if (password.length < 6) return res.status(400).json({ error: 'סיסמה — לפחות 6 תווים' });

  db.prepare('UPDATE suppliers SET password_hash=? WHERE id=?').run(hashPassword(password), id);
  destroyUserSessions('supplier', id);
  res.json({ ok: true, email: sup.email });
});

// חסימה / ביטול חסימה
router.patch('/suppliers/:id', requireAuth('admin'), (req, res) => {
  const id = Number(req.params.id);
  const sup = db.prepare('SELECT * FROM suppliers WHERE id=? AND removed=0').get(id);
  if (!sup) return res.status(404).json({ error: 'הספק לא נמצא' });
  const active = req.body?.active ? 1 : 0;
  db.prepare('UPDATE suppliers SET active=? WHERE id=?').run(active, id);
  if (!active) destroyUserSessions('supplier', id);
  res.json({ ok: true });
});

// הסרת ספק (הסרה רכה — ההיסטוריה נשמרת)
router.delete('/suppliers/:id', requireAuth('admin'), (req, res) => {
  const id = Number(req.params.id);
  const sup = db.prepare('SELECT * FROM suppliers WHERE id=? AND removed=0').get(id);
  if (!sup) return res.status(404).json({ error: 'הספק לא נמצא' });
  db.prepare('UPDATE suppliers SET removed=1, active=0 WHERE id=?').run(id);
  destroyUserSessions('supplier', id);
  res.json({ ok: true });
});

module.exports = router;
