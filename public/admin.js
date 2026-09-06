// לוח ניהול — צפייה בהכול, שינוי סטטוסים, ניהול ספקים
(function () {
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'rb_admin_token';

  // טוקן: נשמר גם לטאב הנוכחי בלבד (sessionStorage) — כך אפשר להיות מחוברים
  // לכמה משתמשים במקביל בטאבים שונים; localStorage שומר לכניסה הבאה.
  (function readTokenFromUrl() {
    const m = location.hash.match(/token=([0-9a-f]+)/);
    if (m) {
      sessionStorage.setItem(TOKEN_KEY, m[1]);
      history.replaceState(null, '', location.pathname);
    }
  })();
  const getToken = () => sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
  const setToken = (t) => { sessionStorage.setItem(TOKEN_KEY, t); localStorage.setItem(TOKEN_KEY, t); };
  const clearToken = () => { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); };

  let overview = null;
  let billing = null;

  function showMsg(text, kind) {
    $('msg').innerHTML = text ? `<div class="msg ${kind}">${text}</div>` : '';
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
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
    clearToken();
    showView('login');
  }

  // ---- התחברות ----
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('/api/admin/login', { body: { email: $('l-email').value, password: $('l-password').value } });
      setToken(data.token);
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
      for (const t of ['requests', 'offers', 'suppliers', 'billing']) {
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
      billing = await api('/api/admin/billing');
      renderRequests();
      renderOffers();
      renderSuppliers();
      renderBilling();
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
              <button class="btn small outline" data-password="${s.id}" data-email="${esc(s.email)}">סיסמה חדשה</button>
              <button class="btn small ${s.active ? 'danger-outline' : 'outline'}" data-toggle="${s.id}" data-active="${s.active ? 0 : 1}">
                ${s.active ? 'חסימה' : 'ביטול חסימה'}
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

    // קביעת סיסמה חדשה לספק — נוצרת סיסמה קלה למסירה, וניתן לערוך אותה
    document.querySelectorAll('[data-password]').forEach(btn => {
      btn.onclick = async () => {
        const email = btn.dataset.email;
        const suggested = 'rb' + Math.floor(1000 + Math.random() * 9000) + Math.random().toString(36).slice(2, 5);
        const password = prompt(`סיסמה חדשה עבור ${email}

אפשר להשאיר את הסיסמה המוצעת או להקליד אחרת.
לאחר השמירה יש למסור אותה לספק — היא לא ניתנת לצפייה שוב.`, suggested);
        if (password === null) return;
        try {
          await api(`/api/admin/suppliers/${btn.dataset.password}/password`, { body: { password } });
          showMsg(`הסיסמה עודכנה. יש למסור לספק: אימייל ${email} · סיסמה ${password}`, 'success');
        } catch (err) { showMsg(err.message, 'error'); }
      };
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

  // מילוי אוטומטי של פרטי כניסה — רק כשמצב ההדגמה פעיל (נעלם לפני עלייה לאוויר)
  async function prefillDemo() {
    try {
      const res = await fetch('/api/demo/accounts');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.admin) return;
      $('l-email').value = data.admin.email || '';
      const box = document.createElement('div');
      box.className = 'card';
      box.style.maxWidth = '420px';
      box.style.margin = '0 auto';
      box.innerHTML = `<h3>כניסה מהירה לבדיקות</h3>
        <p class="hint">כניסה כמנהל בלחיצה אחת, בלי סיסמה.</p>
        <button class="btn small" id="demo-admin-btn" type="button">כניסה כ${data.admin.name}</button>`;
      $('view-login').appendChild(box);
      $('demo-admin-btn').onclick = async () => {
        try {
          const r = await fetch('/api/demo/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'admin' }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'שגיאה');
          setToken(d.token);
          $('admin-name').textContent = d.name;
          box.remove();
          showMsg('');
          enterDash();
        } catch (err) { showMsg(err.message, 'error'); }
      };
    } catch (e) {}
  }

  // ---- חיובים (דמי ניהול) ----
  const money = (n) => '\u20aa' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('he-IL');

  function renderBilling() {
    const rows = billing.suppliers;
    const t = billing.totals;

    const summary = `
      <div class="card">
        <h3>דמי ניהול</h3>
        <p class="hint">העמלה מחושבת אוטומטית מהסכום שהספק מדווח בסגירת העסקה.</p>
        <div class="row2">
          <div class="field">
            <label>אחוז דמי ניהול כללי</label>
            <input type="number" id="commission-pct" min="0" max="100" step="0.5" value="${billing.defaultPercent}">
          </div>
          <div class="field" style="display:flex;align-items:flex-end">
            <button class="btn small" id="save-commission" type="button">שמירת התעריף</button>
          </div>
        </div>
        <dl class="kv">
          <dt>עסקאות שנסגרו</dt><dd>${t.deals}</dd>
          <dt>מחזור העסקאות</dt><dd>${money(t.turnover)}</dd>
          <dt>סך דמי ניהול</dt><dd>${money(t.commission)}</dd>
          <dt>טרם שולם</dt><dd style="color:var(--red)">${money(t.unpaid)}</dd>
        </dl>
        <div class="btn-row"><button class="btn small outline" id="export-billing" type="button">ייצוא לאקסל (CSV)</button></div>
      </div>
      ${t.mismatches ? `<div class="msg error">
        <strong>⚠ ${t.mismatches} אי-התאמות לבדיקה</strong><br>
        בעסקאות אלה הספק דיווח שהעסקה לא נסגרה, אך הלקוח אישר שקיבל את הרכב.
      </div>` : ''}
      ${t.disputed ? `<div class="msg info">
        ב-${t.disputed} עסקאות שדווחו כסגורות הלקוח מסר שלא קיבל את הרכב — כדאי לברר לפני הגבייה.
      </div>` : ''}`;

    const perSupplier = rows.map(r => {
      const risk = r.notClosedCount > 0 && r.notClosedCount >= r.closedCount
        ? `<span class="tag urgent">${r.notClosedCount} סומנו "לא נסגר"</span>` : '';
      const mismatchBox = r.mismatches.length ? `
        <div class="msg error" style="margin-top:10px">
          <strong>⚠ הלקוח אישר קבלת רכב בעסקאות שדווחו כלא נסגרו:</strong>
          <ul style="margin:6px 18px 0">${r.mismatches.map(m =>
            `<li>${m.publicId} · ${esc(m.carModel || '')} · הוצע ${money(m.price)} ${esc(m.priceUnit || '')}</li>`).join('')}</ul>
        </div>` : '';
      return `
      <div class="card">
        <div class="req-head">
          <h3>${esc(r.name)} <span class="order-sub">${esc(r.region)}</span></h3>
          <span class="badge ${r.unpaid > 0 ? 'lost' : 'closed'}">${r.unpaid > 0 ? 'חוב: ' + money(r.unpaid) : 'אין חוב'}</span>
        </div>
        <dl class="kv">
          <dt>עסקאות שנסגרו</dt><dd>${r.closedCount}</dd>
          <dt>מחזור</dt><dd>${money(r.turnover)}</dd>
          <dt>דמי ניהול</dt><dd>${money(r.commission)}</dd>
          <dt>תעריף</dt><dd>${r.percent}%${r.customPercent === null ? ' (כללי)' : ' (אישי)'}</dd>
        </dl>
        <div class="tags">${risk}</div>
        ${mismatchBox}
        <div class="btn-row">
          <button class="btn small outline" data-set-pct="${r.supplierId}" data-current="${r.customPercent === null ? '' : r.customPercent}">תעריף אישי</button>
        </div>
        ${r.deals.length ? `<div class="table-wrap" style="margin-top:10px"><table>
          <thead><tr><th>בקשה</th><th>רכב</th><th>סכום העסקה</th><th>דמי ניהול</th><th>אישור לקוח</th><th>נסגרה</th><th>תשלום</th></tr></thead>
          <tbody>${r.deals.map(d => `
            <tr${d.waived ? ' style="opacity:.5"' : ''}>
              <td>${d.publicId}</td>
              <td>${esc(d.carModel || '—')}</td>
              <td>${money(d.finalAmount)}</td>
              <td>${d.waived ? '<s>' + money(d.commission) + '</s> בוטל' : money(d.commission)}</td>
              <td>${d.customerConfirmed === null ? '<span class="order-sub">ממתין</span>'
                    : (d.customerConfirmed ? '<span class="badge closed">אושר ✓</span>'
                                           : '<span class="badge lost">הלקוח מכחיש</span>')}</td>
              <td>${(d.closedAt || '').slice(0, 10)}</td>
              <td>
                <button class="btn small ${d.paid ? 'outline' : 'secondary'}" data-paid="${d.offerId}" data-value="${d.paid ? 0 : 1}">
                  ${d.paid ? 'שולם ✓' : 'סמן כשולם'}</button>
                <button class="btn small outline" data-waive="${d.offerId}" data-value="${d.waived ? 0 : 1}">
                  ${d.waived ? 'החזרת חיוב' : 'ביטול חיוב'}</button>
              </td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">אין עדיין עסקאות שנסגרו</div>'}
      </div>`;
    }).join('');

    $('tab-billing').innerHTML = summary + perSupplier;

    $('save-commission').onclick = async () => {
      try {
        await api('/api/admin/settings/commission', { body: { percent: $('commission-pct').value } });
        showMsg('התעריף עודכן. הוא יחול על עסקאות שייסגרו מעכשיו.', 'success');
        load();
      } catch (err) { showMsg(err.message, 'error'); }
    };

    document.querySelectorAll('[data-set-pct]').forEach(btn => {
      btn.onclick = async () => {
        const val = prompt('תעריף אישי באחוזים לספק זה.\nלהשארה ריק — יחול התעריף הכללי.', btn.dataset.current);
        if (val === null) return;
        try {
          await api(`/api/admin/suppliers/${btn.dataset.setPct}/commission`, { body: { percent: val.trim() === '' ? null : val } });
          showMsg('התעריף עודכן', 'success');
          load();
        } catch (err) { showMsg(err.message, 'error'); }
      };
    });

    document.querySelectorAll('[data-waive]').forEach(btn => {
      btn.onclick = async () => {
        const waiving = Number(btn.dataset.value) === 1;
        if (waiving && !confirm('לבטל את החיוב על עסקה זו? היא לא תיכלל בדוח הגבייה.')) return;
        try {
          await api(`/api/admin/offers/${btn.dataset.waive}/waive`, { body: { waived: Number(btn.dataset.value) } });
          showMsg(waiving ? 'החיוב בוטל' : 'החיוב הוחזר', 'success');
          load();
        } catch (err) { showMsg(err.message, 'error'); }
      };
    });

    document.querySelectorAll('[data-paid]').forEach(btn => {
      btn.onclick = async () => {
        try {
          await api(`/api/admin/offers/${btn.dataset.paid}/paid`, { body: { paid: Number(btn.dataset.value) } });
          load();
        } catch (err) { showMsg(err.message, 'error'); }
      };
    });

    $('export-billing').onclick = () => {
      const lines = [['ספק', 'אזור', 'בקשה', 'רכב', 'סכום העסקה', 'דמי ניהול', 'אישור לקוח', 'תאריך סגירה', 'שולם', 'בוטל']];
      billing.suppliers.forEach(r => r.deals.forEach(d => lines.push([
        r.name, r.region, d.publicId, d.carModel || '', d.finalAmount, d.commission,
        d.customerConfirmed === null ? 'ממתין' : (d.customerConfirmed ? 'אושר' : 'הוכחש'),
        (d.closedAt || '').slice(0, 10), d.paid ? 'כן' : 'לא', d.waived ? 'כן' : 'לא',
      ])));
      const csv = '\ufeff' + lines.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rechev-beklik-billing.csv';
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  // ---- ניתוב ראשוני ----
  if (getToken()) enterDash();
  else { showView('login'); prefillDemo(); }
})();
