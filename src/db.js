// בסיס הנתונים — SQLite מובנה של Node, כולל יצירת סכמה וטעינת נתוני דמו
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const REGIONS = ['ירושלים', 'אשדוד', 'בני ברק', 'יהוד'];
const CAR_TYPES = ['קטן', 'משפחתי', '7 מקומות', 'מסחרי'];
const PRICE_UNITS = ['ליום', 'לשעה', 'לעסקה'];
// קטלוג דגמים נפוצים בצי ההשכרה בישראל — לכל דגם תמונה קבועה ב-public/cars/<slug>.jpg
// (תמונות ברישיון חופשי מוויקימדיה קומונס; הקרדיטים ב-public/cars/credits.json)
const CAR_CATALOG = [
  { name: 'קיה פיקנטו', type: 'קטן', slug: 'kia-picanto', aliases: ['picanto'] },
  { name: 'יונדאי i10', type: 'קטן', slug: 'hyundai-i10', aliases: ['i10'] },
  { name: 'יונדאי i20', type: 'קטן', slug: 'hyundai-i20', aliases: ['i20'] },
  { name: 'טויוטה יאריס', type: 'קטן', slug: 'toyota-yaris', aliases: ['yaris', 'יאריס'] },
  { name: 'סוזוקי סוויפט', type: 'קטן', slug: 'suzuki-swift', aliases: ['swift', 'סוויפט'] },
  { name: 'מאזדה 2', type: 'קטן', slug: 'mazda-2', aliases: ['mazda 2', 'mazda2'] },
  { name: 'סקודה פאביה', type: 'קטן', slug: 'skoda-fabia', aliases: ['fabia', 'פאביה'] },
  { name: 'קיה סטוניק', type: 'קטן', slug: 'kia-stonic', aliases: ['stonic', 'סטוניק'] },
  { name: 'יונדאי ונו', type: 'קטן', slug: 'hyundai-venue', aliases: ['venue'] },
  { name: 'טויוטה קורולה', type: 'משפחתי', slug: 'toyota-corolla', aliases: ['corolla', 'קורולה'] },
  { name: 'מאזדה 3', type: 'משפחתי', slug: 'mazda-3', aliases: ['mazda 3', 'mazda3'] },
  { name: 'סקודה אוקטביה', type: 'משפחתי', slug: 'skoda-octavia', aliases: ['octavia', 'אוקטביה'] },
  { name: 'יונדאי אלנטרה', type: 'משפחתי', slug: 'hyundai-elantra', aliases: ['elantra', 'אלנטרה'] },
  { name: 'קיה ספורטז\'', type: 'משפחתי', slug: 'kia-sportage', aliases: ['sportage', 'ספורטז'] },
  { name: 'יונדאי טוסון', type: 'משפחתי', slug: 'hyundai-tucson', aliases: ['tucson', 'טוסון'] },
  { name: 'טויוטה RAV4', type: 'משפחתי', slug: 'toyota-rav4', aliases: ['rav4', 'rav 4'] },
  { name: 'פיג\'ו 3008', type: 'משפחתי', slug: 'peugeot-3008', aliases: ['3008'] },
  { name: 'קיה נירו', type: 'משפחתי', slug: 'kia-niro', aliases: ['niro', 'נירו'] },
  { name: 'קיה סורנטו', type: '7 מקומות', slug: 'kia-sorento', aliases: ['sorento', 'סורנטו'] },
  { name: 'יונדאי סנטה פה', type: '7 מקומות', slug: 'hyundai-santa-fe', aliases: ['santa fe', 'סנטה פה'] },
  { name: 'קיה קרניבל', type: '7 מקומות', slug: 'kia-carnival', aliases: ['carnival', 'קרניבל'] },
  { name: 'סקודה קודיאק', type: '7 מקומות', slug: 'skoda-kodiaq', aliases: ['kodiaq', 'קודיאק'] },
  { name: 'טויוטה היילנדר', type: '7 מקומות', slug: 'toyota-highlander', aliases: ['highlander', 'היילנדר'] },
  { name: 'סיטרואן ספייסטורר', type: '7 מקומות', slug: 'citroen-spacetourer', aliases: ['spacetourer', 'ספייסטורר'] },
  { name: 'פורד טרנזיט', type: 'מסחרי', slug: 'ford-transit', aliases: ['transit', 'טרנזיט'] },
  { name: 'רנו קנגו', type: 'מסחרי', slug: 'renault-kangoo', aliases: ['kangoo', 'קנגו'] },
  { name: 'סיטרואן ברלינגו', type: 'מסחרי', slug: 'citroen-berlingo', aliases: ['berlingo', 'ברלינגו'] },
  { name: 'פיג\'ו פרטנר', type: 'מסחרי', slug: 'peugeot-partner', aliases: ['partner', 'פרטנר'] },
  { name: 'פיאט דוקאטו', type: 'מסחרי', slug: 'fiat-ducato', aliases: ['ducato', 'דוקאטו'] },
  { name: 'טויוטה פרואייס', type: 'מסחרי', slug: 'toyota-proace', aliases: ['proace', 'פרואייס'] },
];
// מפרט מוצג לכל סוג רכב (מושבים/דלתות/מזוודות) — בסגנון כרטיס הרכב של בוקינג
const CAR_TYPE_SPECS = {
  'קטן': { seats: 5, doors: 4, bags: 2 },
  'משפחתי': { seats: 5, doors: 5, bags: 3 },
  '7 מקומות': { seats: 7, doors: 5, bags: 4 },
  'מסחרי': { seats: 3, doors: 4, bags: 6 },
};
const GEARBOXES = ['אוטומטי', 'ידני'];

// שמות הדגמים לפי סוג — לרשימה הנפתחת אצל הספק
const CAR_MODELS = {};
for (const c of CAR_CATALOG) (CAR_MODELS[c.type] = CAR_MODELS[c.type] || []).push(c.name);
// תמונת ברירת מחדל לכל סוג, כשהדגם שנכתב לא מזוהה
const TYPE_FALLBACK_SLUG = { 'קטן': 'kia-picanto', 'משפחתי': 'toyota-corolla', '7 מקומות': 'kia-sorento', 'מסחרי': 'ford-transit' };

// מזהה דגם מטקסט חופשי (למשל "טויוטה קורולה 2024 אוטומט") ומחזיר את כתובת התמונה
function resolveCarImage(modelText, carType) {
  const t = String(modelText || '').toLowerCase().replace(/['"׳״]/g, '');
  const hit = CAR_CATALOG.find(c =>
    t.includes(c.name.toLowerCase().replace(/['"׳״]/g, '')) || c.aliases.some(a => t.includes(a.toLowerCase()))
  );
  const slug = hit ? hit.slug : (TYPE_FALLBACK_SLUG[carType] || 'toyota-corolla');
  return '/cars/' + slug + '.jpg';
}
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

CREATE TABLE IF NOT EXISTS supplier_cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  model TEXT NOT NULL,
  car_type TEXT NOT NULL,
  photo TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
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
if (!offerCols.includes('car_model')) {
  db.exec('ALTER TABLE offers ADD COLUMN car_model TEXT');
}
if (!offerCols.includes('car_id')) {
  db.exec('ALTER TABLE offers ADD COLUMN car_id INTEGER REFERENCES supplier_cars(id)');
}

// מעבר לכמה הצעות (רכבים) מאותו ספק לאותה בקשה — הסרת המגבלה הישנה
const offersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='offers'").get();
if (offersSql && /UNIQUE\(request_id, supplier_id\)/.test(offersSql.sql)) {
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec(`
    CREATE TABLE offers_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES requests(id),
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      car_id INTEGER REFERENCES supplier_cars(id),
      price INTEGER,
      price_unit TEXT NOT NULL DEFAULT 'ליום',
      car_type TEXT,
      car_model TEXT,
      note TEXT,
      available INTEGER NOT NULL DEFAULT 1,
      chosen INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'הצעה נשלחה',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO offers_new (id, request_id, supplier_id, car_id, price, price_unit, car_type, car_model, note, available, chosen, status, created_at)
      SELECT id, request_id, supplier_id, car_id, price, price_unit, car_type, car_model, note, available, chosen, status, created_at FROM offers;
    DROP TABLE offers;
    ALTER TABLE offers_new RENAME TO offers;
  `);
  db.exec('PRAGMA foreign_keys=ON');
  console.log('טבלת ההצעות עודכנה — ניתן להציע כמה רכבים לאותה בקשה');
}
// עמודות לניהול דמי הניהול (עמלה) על עסקאות שנסגרו
const billCols = db.prepare('PRAGMA table_info(offers)').all().map(c => c.name);
if (!billCols.includes('final_amount')) db.exec('ALTER TABLE offers ADD COLUMN final_amount INTEGER');
if (!billCols.includes('commission')) db.exec('ALTER TABLE offers ADD COLUMN commission INTEGER');
if (!billCols.includes('commission_paid')) db.exec('ALTER TABLE offers ADD COLUMN commission_paid INTEGER NOT NULL DEFAULT 0');
if (!billCols.includes('closed_at')) db.exec('ALTER TABLE offers ADD COLUMN closed_at TEXT');

// אישור הלקוח: NULL = טרם נשאל, 1 = קיבל את הרכב, 0 = לא קיבל
if (!billCols.includes('customer_confirmed')) db.exec('ALTER TABLE offers ADD COLUMN customer_confirmed INTEGER');
if (!billCols.includes('confirmed_at')) db.exec('ALTER TABLE offers ADD COLUMN confirmed_at TEXT');
// חיוב שבוטל על ידי ההנהלה (למשל עסקה במחלוקת)
if (!billCols.includes('commission_waived')) db.exec('ALTER TABLE offers ADD COLUMN commission_waived INTEGER NOT NULL DEFAULT 0');

const supCols = db.prepare('PRAGMA table_info(suppliers)').all().map(c => c.name);
if (!supCols.includes('commission_percent')) db.exec('ALTER TABLE suppliers ADD COLUMN commission_percent REAL');

// רכב אחד יכול להופיע פעם אחת בלבד בכל בקשה
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_request_car ON offers(request_id, car_id) WHERE car_id IS NOT NULL');

const carCols = db.prepare('PRAGMA table_info(supplier_cars)').all().map(c => c.name);
if (!carCols.includes('gearbox')) {
  db.exec("ALTER TABLE supplier_cars ADD COLUMN gearbox TEXT NOT NULL DEFAULT 'אוטומטי'");
}

const DEFAULT_COMMISSION = 10;   // אחוז ברירת מחדל מדמי הניהול

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value));
}

// אחוז העמלה שחל על ספק מסוים — תעריף אישי אם הוגדר, אחרת התעריף הכללי
function commissionPercentFor(supplier) {
  if (supplier && supplier.commission_percent !== null && supplier.commission_percent !== undefined) {
    return Number(supplier.commission_percent);
  }
  return Number(getSetting('commission_percent', DEFAULT_COMMISSION));
}

function calcCommission(amount, percent) {
  return Math.round((Number(amount) || 0) * (Number(percent) || 0)) / 100;
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

// אתחול ראשוני: חשבון אדמין תמיד; נתוני דמו (ספקים + בקשות) רק עם SEED_DEMO=1
function seedIfEmpty() {
  const seedPath = path.join(__dirname, '..', 'seed-data.json');
  if (!fs.existsSync(seedPath)) return;
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  // סיסמאות נקבעות במשתני סביבה בלבד — לעולם לא בקוד
  const adminEmail = (process.env.ADMIN_EMAIL || seed.admin.email).trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';
  const supplierPassword = process.env.SUPPLIER_PASSWORD || 'demo1234';
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('אזהרה: ADMIN_PASSWORD לא הוגדר — נעשה שימוש בסיסמת פיתוח. אין להשתמש בכך בייצור.');
  }

  // חשבון אדמין חייב להתקיים כדי שאפשר יהיה לנהל את המערכת
  const { n: adminCount } = db.prepare('SELECT COUNT(*) AS n FROM admins').get();
  if (adminCount === 0) {
    db.prepare('INSERT INTO admins (name, email, password_hash) VALUES (?,?,?)').run(
      seed.admin.name, adminEmail, hashPassword(adminPassword)
    );
    console.log('חשבון אדמין נוצר');
  }

  // הספקים הם נתוני בסיס קבועים — נטענים תמיד כשבסיס הנתונים ריק
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM suppliers').get();
  if (n > 0) return;

  const insSup = db.prepare(
    'INSERT INTO suppliers (name, region, contact_name, email, password_hash, active) VALUES (?,?,?,?,?,?)'
  );
  const supIdsByRegion = {};
  for (const s of seed.suppliers) {
    const info = insSup.run(s.name, s.region, s.contactName, s.email, hashPassword(supplierPassword), s.active ? 1 : 0);
    const id = Number(info.lastInsertRowid);
    if (s.active) (supIdsByRegion[s.region] = supIdsByRegion[s.region] || []).push(id);
  }
  console.log('ספקי הבסיס נטענו');

  // בקשות דמו — רק בהפעלה מפורשת
  if (process.env.SEED_DEMO !== '1') return;

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
  db, REGIONS, CAR_TYPES, CAR_MODELS, CAR_CATALOG, CAR_TYPE_SPECS, GEARBOXES, PRICE_UNITS, REQUEST_STATUSES, FINAL_STATUSES,
  DEFAULT_COMMISSION, getSetting, setSetting, commissionPercentFor, calcCommission,
  resolveCarImage,
  hashPassword, verifyPassword, newToken, publicIdFor, seedIfEmpty,
};
