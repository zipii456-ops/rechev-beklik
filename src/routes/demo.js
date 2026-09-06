// כניסה מהירה לבדיקות — בחירת משתמש בלחיצה, בלי סיסמה.
// מופעל רק כש-DEMO_LOGIN אינו '0'. לפני השקה אמיתית יש לכבות!
const express = require('express');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const { createSession } = require('../auth');

// פרטי הכניסה לדמו נלקחים מקובץ הזריעה — לשימוש בבדיקות בלבד
function demoDefaults() {
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'seed-data.json'), 'utf8'));
    return {
      admin: { email: seed.admin.email, password: seed.admin.password },
      supplierPassword: (seed.suppliers[0] || {}).password || '',
    };
  } catch (e) {
    return null;
  }
}

const router = express.Router();
const enabled = () => process.env.DEMO_LOGIN !== '0';

router.use((req, res, next) => {
  if (!enabled()) return res.status(404).json({ error: 'מצב הדגמה כבוי' });
  next();
});

router.get('/accounts', (req, res) => {
  const suppliers = db.prepare(
    'SELECT id, name, region, email FROM suppliers WHERE removed=0 AND active=1 ORDER BY region, name'
  ).all();
  const admin = db.prepare('SELECT id, name FROM admins ORDER BY id LIMIT 1').get();
  res.json({
    suppliers,
    admin: admin ? { id: admin.id, name: admin.name } : null,
    defaults: demoDefaults(),
  });
});

router.post('/login', (req, res) => {
  const { role, id } = req.body || {};
  if (role === 'supplier') {
    const sup = db.prepare('SELECT * FROM suppliers WHERE id=? AND removed=0 AND active=1').get(Number(id));
    if (!sup) return res.status(404).json({ error: 'הספק לא נמצא' });
    return res.json({ token: createSession('supplier', sup.id), name: sup.name });
  }
  if (role === 'admin') {
    const admin = db.prepare('SELECT * FROM admins ORDER BY id LIMIT 1').get();
    if (!admin) return res.status(404).json({ error: 'לא נמצא מנהל' });
    return res.json({ token: createSession('admin', admin.id), name: admin.name });
  }
  res.status(400).json({ error: 'תפקיד לא חוקי' });
});

module.exports = router;
