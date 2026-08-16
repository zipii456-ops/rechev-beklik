// ממשק ספק — טאבים: אושרו לטיפול / בקשות חדשות / ממתינות ללקוח / היסטוריה
(function () {
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'rb_supplier_token';
  const PRICE_UNITS = ['ליום', 'לשעה', 'לעסקה'];
  let pollTimer = null;
  let activeTab = null; // נקבע אוטומטית בטעינה הראשונה

  function showMsg(text, kind) {
    $('msg').innerHTML = text ? `<div class="msg ${kind}">${text}</div>` : '';
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, {
      method: options.body ? 'POST' : (options.method || 'GET'),
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { logoutLocal(); throw new Error(data.error || 'נדרשת התחברות'); }
    if (!res.ok) throw new Error(data.error || 'שגיאה, נסו שוב');
    return data;
  }

  const fmtDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
  const yesNo = (v) => v ? 'כן' : 'לא';
  const priceUnitOptions = (selected) =>
    PRICE_UNITS.map(u => `<option ${u === selected ? 'selected' : ''}>${u}</option>`).join('');
  const priceText = (o) => `₪${o.price} ${o.priceUnit || ''}`;

  function showView(name) {
    $('view-login').classList.toggle('hidden', name !== 'login');
    $('view-board').classList.toggle('hidden', name !== 'board');
    $('user-info').classList.toggle('hidden', name !== 'board');
  }

  function logoutLocal() {
    localStorage.removeItem(TOKEN_KEY);
    clearInterval(pollTimer);
    showView('login');
  }

  // ---- התחברות ----
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('/api/supplier/login', { body: {
        email: $('l-email').value, password: $('l-password').value,
      }});
      localStorage.setItem(TOKEN_KEY, data.token);
      showMsg('');
      enterBoard();
    } catch (err) {
      showMsg(err.message, 'error');
    }
  });

  $('logout-btn').onclick = async () => {
    try { await api('/api/supplier/logout', { body: {} }); } catch (e) {}
    logoutLocal();
  };

  // ---- לוח בקשות ----
  function enterBoard() {
    showView('board');
    load();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => load(true), 25000);
  }

  async function load(silent) {
    try {
      const data = await api('/api/supplier/requests');
      $('sup-name').textContent = `${data.supplier.name} · אזור ${data.supplier.region}`;
      render(data.requests);
    } catch (err) {
      if (!silent) showMsg(err.message, 'error');
    }
  }

  function requestDetails(r) {
    return `
      <dl class="kv">
        <dt>אזור</dt><dd>${r.region} — ${r.neighborhood}</dd>
        <dt>תאריכים</dt><dd>${fmtDate(r.startDate)} עד ${fmtDate(r.endDate)}</dd>
        <dt>סוג רכב</dt><dd>${r.carType}</dd>
        <dt>גיל הנהג</dt><dd>${r.driverAge} (ותק ${r.licenseYears} שנים)</dd>
      </dl>
      <div class="tags">
        ${r.urgent ? '<span class="tag urgent">דרוש מיידי</span>' : ''}
        <span class="tag">שבת: ${yesNo(r.shabbat)}</span>
        <span class="tag">נהג נוסף: ${yesNo(r.extraDriver)}</span>
      </div>`;
  }

  function render(requests) {
    // חלוקה לארבע קבוצות ברורות
    const won = requests.filter(r => r.status === 'נבחרה הצעה' && r.myOffer && r.myOffer.chosen);
    const open = requests.filter(r => r.status === 'חדש' && !r.myOffer);
    const sent = requests.filter(r => r.status === 'חדש' && r.myOffer);
    const done = requests.filter(r => ['נסגר', 'לא נסגר'].includes(r.status) ||
      (r.status === 'נבחרה הצעה' && (!r.myOffer || !r.myOffer.chosen)));

    // בכניסה ראשונה: אם יש הצעות שאושרו — פותחים ישר עליהן
    if (!activeTab) activeTab = won.length ? 'won' : 'open';

    const tabs = [
      { key: 'won', label: '✔ אושרו — לטיפול', count: won.length, attention: won.length > 0 },
      { key: 'open', label: 'בקשות חדשות', count: open.length },
      { key: 'sent', label: 'ממתינות ללקוח', count: sent.length },
      { key: 'done', label: 'היסטוריה', count: done.length },
    ];

    let html = `<div class="tabs">` + tabs.map(t => `
      <button data-tab="${t.key}" class="${activeTab === t.key ? 'on' : ''} ${t.attention ? 'attention' : ''}">
        ${t.label} <span class="tab-count">${t.count}</span>
      </button>`).join('') + `</div>`;

    if (activeTab === 'won') {
      html += won.length ? won.map(r => `
        <div class="card won-card">
          <div class="won-banner">🎉 הלקוח אישר את ההצעה שלך!</div>
          <div class="req-head"><h3>בקשה ${r.publicId}</h3><span class="badge chosen">נבחרה</span></div>
          ${requestDetails(r)}
          <p class="hint" style="margin-top:10px">ההצעה שאושרה: <strong>${priceText(r.myOffer)}</strong>${r.myOffer.note ? ' · ' + r.myOffer.note : ''}</p>
          ${r.customerPhone ? `<div class="phone-box">📞 טלפון הלקוח: <a href="tel:${r.customerPhone}">${r.customerPhone}</a> — התקשרו לסגירת ההשכרה</div>` : ''}
          <p class="hint">לאחר סיום הטיפול מול הלקוח — חובה לעדכן את תוצאת העסקה:</p>
          <div class="btn-row">
            <button class="btn small" data-final="${r.myOffer.id}" data-status="נסגר">העסקה נסגרה ✓</button>
            <button class="btn small danger-outline" data-final="${r.myOffer.id}" data-status="לא נסגר">לא נסגרה</button>
          </div>
        </div>`).join('')
        : '<div class="card empty">אין כרגע הצעות שאושרו וממתינות לטיפול.<br>כשלקוח יאשר הצעה שלך — היא תופיע כאן, והטאב יודגש בזהב.</div>';
    }

    if (activeTab === 'open') {
      html += open.length ? open.map(r => `
        <div class="card">
          <div class="req-head"><h3>בקשה ${r.publicId}</h3><span class="badge waiting">ממתינה להצעה</span></div>
          ${requestDetails(r)}
          <form data-offer-form="${r.id}" style="margin-top:12px">
            <div class="row2">
              <div class="field">
                <label>מחיר (₪) *</label>
                <input type="number" min="1" name="price" placeholder="לדוגמה: 250">
              </div>
              <div class="field">
                <label>יחידת מחיר</label>
                <select name="priceUnit">${priceUnitOptions('ליום')}</select>
              </div>
            </div>
            <div class="field">
              <label>הערה כללית</label>
              <input type="text" name="note" placeholder='למשל: כולל ק"מ חופשי'>
            </div>
            <div class="btn-row">
              <button class="btn small" type="submit">שלח הצעה</button>
              <button class="btn small outline" type="button" data-unavail="${r.id}">אין זמינות</button>
            </div>
          </form>
        </div>`).join('')
        : '<div class="card empty">אין כרגע בקשות חדשות באזור שלך</div>';
    }

    if (activeTab === 'sent') {
      html += sent.length ? sent.map(r => `
        <div class="card">
          <div class="req-head"><h3>בקשה ${r.publicId}</h3>
            <span class="badge waiting">${r.myOffer.available ? 'ממתין לתשובת הלקוח' : 'סומן: אין זמינות'}</span></div>
          ${requestDetails(r)}
          ${r.myOffer.available ? `<p class="hint" style="margin-top:8px">ההצעה שלך: <strong>${priceText(r.myOffer)}</strong>${r.myOffer.note ? ' · ' + r.myOffer.note : ''} — אפשר לעדכן:</p>
          <form data-offer-form="${r.id}">
            <div class="row2">
              <div class="field"><label>מחיר (₪)</label><input type="number" min="1" name="price" value="${r.myOffer.price}"></div>
              <div class="field"><label>יחידת מחיר</label><select name="priceUnit">${priceUnitOptions(r.myOffer.priceUnit || 'ליום')}</select></div>
            </div>
            <div class="field"><label>הערה</label><input type="text" name="note" value="${r.myOffer.note || ''}"></div>
            <div class="btn-row"><button class="btn small secondary" type="submit">עדכן הצעה</button></div>
          </form>` : ''}
        </div>`).join('')
        : '<div class="card empty">אין הצעות שממתינות לתשובת לקוח</div>';
    }

    if (activeTab === 'done') {
      html += done.length ? done.map(r => {
        const mine = r.myOffer && r.myOffer.chosen;
        let badge;
        if (r.status === 'נסגר') badge = '<span class="badge closed">נסגר ✓</span>';
        else if (r.status === 'לא נסגר') badge = '<span class="badge lost">לא נסגר</span>';
        else badge = '<span class="badge lost">נבחרה הצעה אחרת</span>';
        return `
        <div class="card">
          <div class="req-head"><h3>בקשה ${r.publicId}</h3>${badge}</div>
          <div class="kv">
            <dt>תאריכים</dt><dd>${fmtDate(r.startDate)} עד ${fmtDate(r.endDate)}</dd>
            <dt>סוג רכב</dt><dd>${r.carType}</dd>
            ${r.myOffer && r.myOffer.available ? `<dt>ההצעה שלך</dt><dd>${priceText(r.myOffer)}${mine ? ' (נבחרה)' : ''}</dd>` : ''}
            ${mine && r.customerPhone ? `<dt>טלפון הלקוח</dt><dd><a href="tel:${r.customerPhone}">${r.customerPhone}</a></dd>` : ''}
          </div>
        </div>`;
      }).join('')
        : '<div class="card empty">אין עדיין היסטוריה</div>';
    }

    $('board').innerHTML = html;
    bindBoard();
  }

  function bindBoard() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => { activeTab = btn.dataset.tab; load(true); };
    });
    document.querySelectorAll('[data-offer-form]').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api(`/api/supplier/requests/${form.dataset.offerForm}/offers`, { body: {
            price: form.elements.price.value,
            priceUnit: form.elements.priceUnit ? form.elements.priceUnit.value : 'ליום',
            note: form.elements.note ? form.elements.note.value : '',
          }});
          showMsg('ההצעה נשלחה ללקוח', 'success');
          load(true);
        } catch (err) { showMsg(err.message, 'error'); }
      });
    });
    document.querySelectorAll('[data-unavail]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('לסמן שאין לך זמינות לבקשה זו?')) return;
        try {
          await api(`/api/supplier/requests/${btn.dataset.unavail}/offers`, { body: { available: false } });
          load(true);
        } catch (err) { showMsg(err.message, 'error'); }
      };
    });
    document.querySelectorAll('[data-final]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm(`לעדכן את העסקה כ"${btn.dataset.status}"?`)) return;
        try {
          await api(`/api/supplier/offers/${btn.dataset.final}/status`, { body: { status: btn.dataset.status } });
          showMsg('הסטטוס עודכן — תודה!', 'success');
          load(true);
        } catch (err) { showMsg(err.message, 'error'); }
      };
    });
  }

  // ---- ניתוב ראשוני ----
  if (localStorage.getItem(TOKEN_KEY)) enterBoard();
  else showView('login');
})();
