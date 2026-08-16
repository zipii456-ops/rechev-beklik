// ניהול התחברות והרשאות — טוקן פשוט בטבלת sessions
const { db, newToken } = require('./db');

function createSession(role, userId) {
  const token = newToken(24);
  db.prepare('INSERT INTO sessions (token, role, user_id) VALUES (?,?,?)').run(token, role, userId);
  return token;
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token=?').run(token);
}

function destroyUserSessions(role, userId) {
  db.prepare('DELETE FROM sessions WHERE role=? AND user_id=?').run(role, userId);
}

// middleware: דורש התחברות בתפקיד נתון ('supplier' או 'admin')
function requireAuth(role) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'נדרשת התחברות' });
    const session = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
    if (!session || session.role !== role) return res.status(401).json({ error: 'נדרשת התחברות' });

    if (role === 'supplier') {
      const sup = db.prepare('SELECT * FROM suppliers WHERE id=? AND removed=0').get(session.user_id);
      if (!sup) return res.status(401).json({ error: 'נדרשת התחברות' });
      if (!sup.active) return res.status(403).json({ error: 'החשבון נחסם. יש לפנות למנהל המערכת' });
      req.supplier = sup;
    }

    req.auth = { role, userId: session.user_id, token };
    next();
  };
}

module.exports = { createSession, destroySession, destroyUserSessions, requireAuth };
