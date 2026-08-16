// בסיס הנתונים — SQLite מובנה של Node, כולל יצירת סכמה וטעינת נתוני דמו
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const REGIONS = ['ירושלים', 'אשדוד', 'בני ברק', 'יהוד'];
const CAR_TYPES = ['קטן', 'משפחתי', '7 מקומות', 'מסחרי'];
const PRICE_UNITS = ['ליום', 'לשעה', 'לעסקה'];
// 'חדש' מוצג ללקוח כ"ממתין להצעות"
const REQUEST_STATUSES = ['חדש', 'נבחרה הצעה', 'נסגר', 'לא נסגר'];
const FINAL_STATUSES = ['נסגר', 'לא נסגר'];

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  contact_name TEXT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  removed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT UNIQUE,
  track_token TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  car_type TEXT NOT NULL,
  driver_age INTEGER NOT NULL,
  license_years INTEGER NOT NULL,
  shabbat INTEGER NOT NULL DEFAULT 0,
  extra_driver INTEGER NOT NULL DEFAULT 0,
  urgent INTEGER NOT NULL DEFAULT 0,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'חדש',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  price INTEGER,
  car_type TEXT,
  note TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  chosen INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'הצעה נשלחה',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(request_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// הוספת עמודות חדשות לבסיסי נתונים קיימים
const offerCols = db.prepare('PRAGMA table_info(offers)').all().map(c => c.name);
if (!offerCols.includes('price_unit')) {
  db.exec("ALTER TABLE offers ADD COLUMN price_unit TEXT NOT NULL DEFAULT 'ליום'");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function newToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function publicIdFor(id) {
  return 'RB-' + (1000 + id);
}

// טעינת נתוני דמו מ-seed-data.json בהרצה ראשונה בלבד
function seedIfEmpty() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM suppliers').get();
  if (n > 0) return;

  const seedPath = path.join(__dirname, '..', 'seed-data.json');
  if (!fs.existsSync(seedPath)) return;
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  const insSup = db.prepare(
    'INSERT INTO suppliers (name, region, contact_name, email, password_hash, active) VALUES (?,?,?,?,?,?)'
  );
  const supIdsByRegion = {};
  for (const s of seed.suppliers) {
    const info = insSup.run(s.name, s.region, s.contactName, s.email, hashPassword(s.password), s.active ? 1 : 0);
    const id = Number(info.lastInsertRowid);
    if (s.active) (supIdsByRegion[s.region] = supIdsByRegion[s.region] || []).push(id);
  }

  db.prepare('INSERT INTO admins (name, email, password_hash) VALUES (?,?,?)').run(
    seed.admin.name, seed.admin.email, hashPassword(seed.admin.password)
  );

  const insReq = db.prepare(`
    INSERT INTO requests (track_token, region, neighborhood, start_date, end_date, car_type,
      driver_age, license_years, shabbat, extra_driver, urgent, phone, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insOffer = db.prepare(`
    INSERT INTO offers (request_id, supplier_id, price, price_unit, car_type, note, available, chosen, status)
    VALUES (?,?,?,?,?,?,?,?,?)`);

  const basePrices = { 'קטן': 190, 'משפחתי': 260, '7 מקומות': 340, 'מסחרי': 310 };
  const demoNotes = ['מחיר ליום, כולל ק"מ חופשי', 'כולל ביטוח מקיף, השתתפות עצמית מופחתת'];

  for (const r of seed.customerRequests) {
    const seedStatus = r.status;
    const dbStatus = seedStatus === 'ממתין להצעות' ? 'חדש' : seedStatus;
    const info = insReq.run(
      newToken(), r.region, r.neighborhood, r.startDate, r.endDate, r.carType,
      r.driverAge, r.licenseYears, r.shabbatDriving ? 1 : 0, r.extraDriver ? 1 : 0,
      r.urgent ? 1 : 0, r.customerPhone, dbStatus
    );
    const reqId = Number(info.lastInsertRowid);
    db.prepare('UPDATE requests SET public_id=? WHERE id=?').run(publicIdFor(reqId), reqId);

    // הצעות דמו: לבקשות שאינן "חדש" ממש — כדי שכל מסך יראה תוכן
    if (seedStatus === 'חדש') continue;
    const sups = supIdsByRegion[r.region] || [];
    const needsChosen = ['נבחרה הצעה', 'נסגר', 'לא נסגר'].includes(seedStatus);
    const base = basePrices[r.carType] || 250;
    sups.forEach((sid, i) => {
      const chosen = needsChosen && i === 0 ? 1 : 0;
      const offerStatus = chosen && FINAL_STATUSES.includes(seedStatus) ? seedStatus : 'הצעה נשלחה';
      insOffer.run(reqId, sid, base + i * 25, 'ליום', r.carType, demoNotes[i % demoNotes.length], 1, chosen, offerStatus);
    });
  }

  console.log('נתוני דמו נטענו בהצלחה');
}

module.exports = {
  db, REGIONS, CAR_TYPES, PRICE_UNITS, REQUEST_STATUSES, FINAL_STATUSES,
  hashPassword, verifyPassword, newToken, publicIdFor, seedIfEmpty,
};
