// לוח ניהול — צפייה בהכול, שינוי סטטוסים, ניהול ספקים
(function () {
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'rb_admin_token';
  let overview = null;

  function showMsg(text, kind) {
    $('msg').innerHTML = text ? `<div class="msg ${kind}">${text}</div>` : '';
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, {
      method: options.method || (options.body ? 'POST' : 'GET'),
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { logoutLocal(); throw new Error(data.error || 'נדרשת התחברות'); }
    if (!res.ok) throw new Error(data.error || 'שגיאה, נסו שוב');
    return data;
  }

  const fmtDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const statusBadge = (status) => {
    const cls = { 'חדש': 'waiting', 'נבחרה הצעה': 'chosen', 'נסגר': 'closed', 'לא נסגר': 'lost', 'הצעה נשלחה': 'waiting' }[status] || 'waiting';
    return `<span class="badge ${cls}">${status}</span>`;
  };

  function showView(name) {
    $('view-login').classList.toggle('hidden', name !== 'login');
    $('view-dash').classList.toggle('hidden', name !== 'dash');
    $('user-info').classList.toggle('hidden', name !== 'dash');
  }

  function logoutLocal() {
    localStorage.removeItem(TOKEN_KEY);
    showView('login');
  }

  // ---- התחברות ----
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('/api/admin/login', { body: { email: $('l-email').value, password: $('l-password').value } });
      localStorage.setItem(TOKEN_KEY, data.token);
      $('admin-name').textContent = data.name;
      showMsg('');
      enterDash();
    } catch (err) { showMsg(err.message, 'error'); }
  });

  $('logout-btn').onclick = async () => {
    try { await api('/api/admin/logout', { body: {} }); } catch (e) {}
    logoutLocal();
  };

  // ---- טאבים ----
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b === btn));
      for (const t of ['requests', 'offers', 'suppliers']) {
        $('tab-' + t).classList.toggle('hidden', t !== btn.dataset.tab);
      }
    };
  });

  async function enterDash() {
    showView('dash');
    await load();
  }

  async function load() {
    try {
      overview = await api('/api/admin/overview');
      renderRequests();
      renderOffers();
      renderSuppliers();
    } catch (err) { showMsg(err.message, 'error'); }
  }

  // ---- בקשות ----
  function renderRequests() {
    const rows = overview.requests;
    const clearBtn = `<div class="btn-row" style="margin-bottom:12px">
      <button class="btn small danger-outline" id="clear-data-btn" type="button">🧹 נקה את כל הבקשות וההצעות</button>
    </div>`;
    $('tab-requests').innerHTML = clearBtn + (rows.length ? `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>מזהה</th><th>אזור</th><th>שכונה</th><th>תאריכים</th><th>רכב</th>
          <th>נהג</th><th>טלפון</th><th>דגלים</th><th>הצעות</th><th>ספק נבחר</th><th>סטטוס</th>
        </tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td>${r.publicId}</td>
            <td>${r.region}</td>
            <td>${esc(r.neighborhood)}</td>
            <td>${fmtDate(r.startDate)}–${fmtDate(r.endDate)}</td>
            <td>${r.carType}</td>
            <td>${r.driverAge} / ותק ${r.licenseYears}</td>
            <td dir="ltr">${esc(r.phone)}</td>
            <td>${r.urgent ? '<span class="tag urgent">מיידי</span>' : ''}${r.extraDriver ? '<span class="tag">נהג נוסף</span>' : ''}</td>
            <td>${r.offersCount}</td>
            <td>${esc(r.chosenSupplier || '—')}</td>
            <td>
              <select data-req-status="${r.id}">
                ${overview.statuses.map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="card empty">אין בקשות</div>');

    $('clear-data-btn').onclick = async () => {
      if (!confirm('למחוק את כל הבקשות וההצעות? הספקים יישארו. פעולה זו אינה הפיכה.')) return;
      try {
        await api('/api/admin/clear-requests', { body: {} });
        showMsg('כל הבקשות וההצעות נמחקו — המערכת נקייה', 'success');
        load();
      } catch (err) { showMsg(err.message, 'error'); }
    };

    document.querySelectorAll('[data-req-status]').forEach(sel => {
      sel.onchange = async () => {
        try {
          await api(`/api/admin/requests/${sel.dataset.reqStatus}/status`, { body: { status: sel.value } });
          showMsg('הסטטוס עודכן', 'success');
          load();
        } catch (err) { showMsg(err.message, 'error'); load(); }
      };
    });
  }

  // ---- הצעות ----
  function renderOffers() {
    const rows = overview.offers;
    $('tab-offers').innerHTML = rows.length ? `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>בקשה</th><th>אזור</th><th>ספק</th><th>דגם</th><th>מחיר</th><th>הערה</th><th>זמינות</th><th>נבחרה?</th><th>סטטוס</th>
        </tr></thead>
        <tbody>${rows.map(o => `
          <tr>
            <td>${o.requestPublicId}</td>
            <td>${o.region}</td>
            <td>${esc(o.supplierName)}</td>
            <td>${esc(o.carModel || '—')}</td>
            <td>${o.price ? '₪' + o.price + ' ' + (o.priceUnit || '') : '—'}</td>
            <td>${esc(o.note || '—')}</td>
            <td>${o.available ? 'זמין' : 'אין זמינות'}</td>
            <td>${o.chosen ? '★ נבחרה' : ''}</td>
            <td>${statusBadge(o.status)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="card empty">אין הצעות</div>';
  }

  // ---- ספקים ----
  function renderSuppliers() {
    const rows = overview.suppliers;
    $('tab-suppliers').innerHTML = `
      <div class="card">
        <h3>הוספת ספק חדש</h3>
        <form id="add-supplier">
          <div class="row2">
            <div class="field"><label>שם העסק *</label><input name="name" required></div>
            <div class="field"><label>אזור *</label>
              <select name="region">${overview.regions.map(r => `<option>${r}</option>`).join('')}</select>
            </div>
          </div>
          <div class="row2">
            <div class="field"><label>איש קשר</label><input name="contactName"></div>
            <div class="field"><label>אימייל *</label><input name="email" type="email" required></div>
          </div>
          <div class="field"><label>סיסמה ראשונית *</label><input name="password" type="text" minlength="6" required></div>
          <button class="btn small" type="submit">הוסף ספק</button>
        </form>
      </div>
      ${rows.length ? `<div class="table-wrap"><table>
        <thead><tr><th>שם</th><th>אזור</th><th>איש קשר</th><th>אימייל</th><th>הצעות</th><th>מצב</th><th>פעולות</th></tr></thead>
        <tbody>${rows.map(s => `
          <tr>
            <td>${esc(s.name)}</td>
            <td>${s.region}</td>
            <td>${esc(s.contactName || '—')}</td>
            <td dir="ltr">${esc(s.email)}</td>
            <td>${s.offersCount}</td>
            <td>${s.active ? '<span class="badge active">פעיל</span>' : '<span class="badge blocked">חסום</span>'}</td>
            <td>
              <button class="btn small ${s.active ? 'danger-outline' : 'outline'}" data-toggle="${s.id}" data-active="${s.active ? 0 : 1}">
                ${s.active ? 'חסום' : 'בטל חסימה'}
              </button>
              <button class="btn small danger-outline" data-remove="${s.id}">הסר</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="card empty">אין ספקים</div>'}`;

    $('add-supplier').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      try {
        await api('/api/admin/suppliers', { body: {
          name: f.name.value, region: f.region.value, contactName: f.contactName.value,
          email: f.email.value, password: f.password.value,
        }});
        showMsg('הספק נוסף בהצלחה', 'success');
        load();
      } catch (err) { showMsg(err.message, 'error'); }
    });

    document.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.onclick = async () => {
        try {
          await api(`/api/admin/suppliers/${btn.dataset.toggle}`, { method: 'PATCH', body: { active: Number(btn.dataset.active) } });
          load();
        } catch (err) { showMsg(err.message, 'error'); }
      };
    });
    document.querySelectorAll('[data-remove]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('להסיר את הספק? ההיסטוריה שלו תישמר אך הוא לא יוכל להתחבר.')) return;
        try {
          await api(`/api/admin/suppliers/${btn.dataset.remove}`, { method: 'DELETE' });
          load();
        } catch (err) { showMsg(err.message, 'error'); }
      };
    });
  }

  // ---- ניתוב ראשוני ----
  if (localStorage.getItem(TOKEN_KEY)) enterDash();
  else showView('login');
})();
