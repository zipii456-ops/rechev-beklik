// רכב בקליק — שרת ראשי
const express = require('express');
const path = require('path');
const { seedIfEmpty } = require('./src/db');
const customerRoutes = require('./src/routes/customer');
const supplierRoutes = require('./src/routes/supplier');
const adminRoutes = require('./src/routes/admin');

seedIfEmpty();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', customerRoutes);
app.use('/api/supplier', supplierRoutes);
app.use('/api/admin', adminRoutes);

// דפי הממשקים
const page = (file) => (req, res) => res.sendFile(path.join(__dirname, 'public', file));
app.get('/track/:token', page('index.html'));
app.get('/supplier', page('supplier.html'));
app.get('/admin', page('admin.html'));
app.get('/healthz', (req, res) => res.json({ ok: true }));

// שגיאה כללית — תשובת JSON אחידה
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'שגיאה בשרת, נסו שוב' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`רכב בקליק פועל על http://localhost:${PORT}`);
});
