// ממשק ספק — טאבים: אושרו לטיפול / בקשות חדשות / ממתינות ללקוח / היסטוריה / הרכבים שלי
(function () {
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'rb_supplier_token';
  const PRICE_UNITS = ['ליום', 'לשעה', 'לעסקה'];
  let meta = { carTypes: [], carModels: {} }; // נטען מהשרת
  let cars = [];                              // צי הרכבים של הספק
  let pollTimer = null;
  let activeTab = null; // נקבע אוטומטית בטעינה הראשונה

  function showMsg(text, kind) {
    $('msg').innerHTML = text ? `<div class="msg ${kind}">${text}</div>` : '';
    if (text) window.scrollTo({ top: 0, behavior: 'smooth' });
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

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
  const yesNo = (v) => v ? 'כן' : 'לא';
  const priceUnitOptions = (selected) =>
    PRICE_UNITS.map(u => `<option ${u === selected ? 'selected' : ''}>${u}</option>`).join('');
  const priceText = (o) => `₪${o.price} ${o.priceUnit || ''}`;
  const carLine = (o) => o.carModel ? `${esc(o.carModel)} · ` : '';

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

  // ---- לוח ----
  function enterBoard() {
    showView('board');
    load();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => load(true), 25000);
  }

  async function load(silent) {
    try {
      if (!meta.carTypes.length) meta = await api('/api/meta');
      const [carsData, data] = await Promise.all([api('/api/supplier/cars'), api('/api/supplier/requests')]);
      cars = carsData.cars;
      $('sup-name').textContent = `${data.supplier.name} · אזור ${data.supplier.region}`;
      render(data.requests);
    } catch (err) {
      if (!silent) showMsg(err.message, 'error');
    }
  }

  function requestDetails(r) {
    return `
      <dl class="kv">
        <dt>אזור</dt><dd>${r.region} — ${esc(r.neighborhood)}</dd>
        <dt>תאריכים</dt><dd>${fmtDate(r.startDate)} עד ${fmtDate(r.endDate)}</dd>
        <dt>סוג רכב</dt><dd>${r.carType}</dd>
        <dt>גיל הנהג</dt><dd>${r.driverAge} (ותק ${r.licenseYears} שנים)</dd>
      </dl>
      <div class="tags">
        ${r.urgent ? '<span class="tag urgent">דרוש מיידי</span>' : ''}
        <span class="tag">נהג נוסף: ${yesNo(r.extraDriver)}</span>
      </div>`;
  }

  // בחירת רכב מהצי — קודם הרכבים שמתאימים לסוג המבוקש
  function carSelect(r, selectedId) {
    if (!cars.length) {
      return `<div class="msg info" style="margin:10px 0">כדי להגיש הצעה צריך קודם להוסיף רכבים לצי שלך —
        <a href="#" data-goto-cars>לטאב "הרכבים שלי"</a></div>`;
    }
    const fit = cars.filter(c => c.carType === r.carType);
    const others = cars.filter(c => c.carType !== r.carType);
    const opt = (c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.model)} (${c.carType})</option>`;
    return `
      <div class="field">
        <label>הרכב המוצע *</label>
        <select name="carId" required>
          <option value="">בחרו רכב מהצי שלך</option>
          ${fit.length ? `<optgroup label="מתאים לבקשה (${r.carType})">${fit.map(opt).join('')}</optgroup>` : ''}
          ${others.length ? `<optgroup label="רכבים אחרים">${others.map(opt).join('')}</optgroup>` : ''}
        </select>
        <div class="car-preview" data-car-preview></div>
      </div>`;
  }

  function offerForm(r) {
    const o = r.myOffer;
    return `
      <form data-offer-form="${r.id}" style="margin-top:12px">
        ${carSelect(r, o ? o.carId : null)}
        <div class="row2">
          <div class="field">
            <label>מחיר (₪) *</label>
            <input type="number" min="1" name="price" value="${o ? o.price : ''}" placeholder="לדוגמה: 250">
          </div>
          <div class="field">
            <label>יחידת מחיר</label>
            <select name="priceUnit">${priceUnitOptions(o ? o.priceUnit : 'ליום')}</select>
          </div>
        </div>
        <div class="field">
          <label>הערה כללית</label>
          <input type="text" name="note" value="${o ? esc(o.note || '') : ''}" placeholder='למשל: כולל ק"מ חופשי'>
        </div>
        <div class="btn-row">
          <button class="btn small ${o ? 'secondary' : ''}" type="submit" ${cars.length ? '' : 'disabled'}>${o ? 'עדכן הצעה' : 'שלח הצעה'}</button>
          ${o ? '' : `<button class="btn small outline" type="button" data-unavail="${r.id}">אין זמינות</button>`}
        </div>
      </form>`;
  }

  function render(requests) {
    const won = requests.filter(r => r.status === 'נבחרה הצעה' && r.myOffer && r.myOffer.chosen);
    const open = requests.filter(r => r.status === 'חדש' && !r.myOffer);
    const sent = requests.filter(r => r.status === 'חדש' && r.myOffer);
    const done = requests.filter(r => ['נסגר', 'לא נסגר'].includes(r.status) ||
      (r.status === 'נבחרה הצעה' && (!r.myOffer || !r.myOffer.chosen)));

    // בכניסה ראשונה: הצעות שאושרו → אחרת בקשות חדשות → ואם אין צי, ישר להוספת רכבים
    if (!activeTab) activeTab = won.length ? 'won' : (cars.length ? 'open' : 'cars');

    const tabs = [
      { key: 'won', label: '✔ אושרו — לטיפול', count: won.length, attention: won.length > 0 },
      { key: 'open', label: 'בקשות חדשות', count: open.length },
      { key: 'sent', label: 'ממתינות ללקוח', count: sent.length },
      { key: 'done', label: 'היסטוריה', count: done.length },
      { key: 'cars', label: '🚗 הרכבים שלי', count: cars.length },
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
          ${r.myOffer.carPhoto ? `<img class="car-photo" src="${r.myOffer.carPhoto}" alt="">` : ''}
          ${requestDetails(r)}
          <p class="hint" style="margin-top:10px">ההצעה שאושרה: <strong>${carLine(r.myOffer)}${priceText(r.myOffer)}</strong>${r.myOffer.note ? ' · ' + esc(r.myOffer.note) : ''}</p>
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
          ${offerForm(r)}
        </div>`).join('')
        : '<div class="card empty">אין כרגע בקשות חדשות באזור שלך</div>';
    }

    if (activeTab === 'sent') {
      html += sent.length ? sent.map(r => `
        <div class="card">
          <div class="req-head"><h3>בקשה ${r.publicId}</h3>
            <span class="badge waiting">${r.myOffer.available ? 'ממתין לתשובת הלקוח' : 'סומן: אין זמינות'}</span></div>
          ${requestDetails(r)}
          ${r.myOffer.available ? `<p class="hint" style="margin-top:8px">ההצעה שלך: <strong>${carLine(r.myOffer)}${priceText(r.myOffer)}</strong> — אפשר לעדכן:</p>${offerForm(r)}` : ''}
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
            ${r.myOffer && r.myOffer.available ? `<dt>ההצעה שלך</dt><dd>${carLine(r.myOffer)}${priceText(r.myOffer)}${mine ? ' (נבחרה)' : ''}</dd>` : ''}
            ${mine && r.customerPhone ? `<dt>טלפון הלקוח</dt><dd><a href="tel:${r.customerPhone}">${r.customerPhone}</a></dd>` : ''}
          </div>
        </div>`;
      }).join('')
        : '<div class="card empty">אין עדיין היסטוריה</div>';
    }

    if (activeTab === 'cars') html += renderCarsTab();

    $('board').innerHTML = html;
    bindBoard();
  }

  // ---- טאב הרכבים שלי ----
  function renderCarsTab() {
    const allModels = Object.values(meta.carModels || {}).flat();
    return `
      <div class="card">
        <h3>הוספת רכב לצי</h3>
        <p class="hint">הרכבים שתוסיפו כאן יופיעו לבחירה בכל הצעה. התמונה נבחרת אוטומטית לפי הדגם.</p>
        <form id="add-car-form">
          <div class="row2">
            <div class="field">
              <label>סוג רכב *</label>
              <select name="carType">${meta.carTypes.map(t => `<option>${t}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>דגם *</label>
              <input type="text" name="model" list="all-models" placeholder="למשל: טויוטה קורולה 2024" required autocomplete="off">
              <datalist id="all-models">${allModels.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
            </div>
          </div>
          <div class="car-preview" id="add-car-preview"></div>
          <button class="btn small" type="submit" id="add-car-btn">הוסף רכב</button>
        </form>
      </div>
      ${cars.length ? cars.map(c => `
        <div class="card fleet-card">
          ${c.photo ? `<img class="fleet-thumb" src="${c.photo}" alt="">` : '<div class="fleet-thumb no-photo">🚗</div>'}
          <div style="flex:1">
            <strong>${esc(c.model)}</strong>
            <div class="order-sub">${c.carType}${c.photo ? '' : ' · ללא תמונה'}</div>
          </div>
          <button class="btn small danger-outline" data-remove-car="${c.id}">הסר</button>
        </div>`).join('')
        : '<div class="card empty">עדיין אין רכבים בצי שלך — הוסיפו את הרכב הראשון למעלה</div>'}`;
  }

  function bindBoard() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => { activeTab = btn.dataset.tab; load(true); };
    });
    document.querySelectorAll('[data-goto-cars]').forEach(a => {
      a.onclick = (e) => { e.preventDefault(); activeTab = 'cars'; load(true); };
    });

    // תצוגה מקדימה של הרכב שנבחר בהצעה
    document.querySelectorAll('select[name="carId"]').forEach(sel => {
      const preview = sel.parentElement.querySelector('[data-car-preview]');
      const update = () => {
        const c = cars.find(x => String(x.id) === sel.value);
        preview.innerHTML = c && c.photo ? `<img class="car-photo" src="${c.photo}" alt="">` : '';
      };
      sel.onchange = update;
      update();
    });

    document.querySelectorAll('[data-offer-form]').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api(`/api/supplier/requests/${form.dataset.offerForm}/offers`, { body: {
            carId: form.elements.carId ? form.elements.carId.value : '',
            price: form.elements.price.value,
            priceUnit: form.elements.priceUnit.value,
            note: form.elements.note.value,
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

    // ---- צי הרכבים ----
    const addForm = $('add-car-form');
    if (addForm) {
      // תצוגה מקדימה של התמונה שתיבחר אוטומטית לדגם שמוקלד
      let previewTimer = null;
      const updatePreview = () => {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(async () => {
          const model = addForm.elements.model.value.trim();
          if (!model) { $('add-car-preview').innerHTML = ''; return; }
          try {
            const { url } = await api(`/api/car-image?model=${encodeURIComponent(model)}&type=${encodeURIComponent(addForm.elements.carType.value)}`);
            $('add-car-preview').innerHTML = `<img class="car-photo" src="${url}" alt=""><div class="order-sub">התמונה שתוצג ללקוח</div>`;
          } catch (e) {}
        }, 300);
      };
      addForm.elements.model.oninput = updatePreview;
      addForm.elements.carType.onchange = updatePreview;

      addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('add-car-btn');
        btn.disabled = true;
        try {
          await api('/api/supplier/cars', { body: {
            model: addForm.elements.model.value,
            carType: addForm.elements.carType.value,
          }});
          showMsg('הרכב נוסף לצי שלך', 'success');
          load(true);
        } catch (err) { showMsg(err.message, 'error'); btn.disabled = false; }
      });
    }
    document.querySelectorAll('[data-remove-car]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('להסיר את הרכב מהצי? הצעות קיימות לא יושפעו.')) return;
        try {
          await api(`/api/supplier/cars/${btn.dataset.removeCar}`, { method: 'DELETE' });
          load(true);
        } catch (err) { showMsg(err.message, 'error'); }
      };
    });
  }

  // ---- ניתוב ראשוני ----
  if (localStorage.getItem(TOKEN_KEY)) enterBoard();
  else showView('login');
})();
