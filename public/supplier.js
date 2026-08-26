// ממשק ספק — עיצוב בסגנון בוקינג. טאבים: אושרו / בקשות חדשות / ממתינות ללקוח / היסטוריה / הרכבים שלי
(function () {
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'rb_supplier_token';
  const PRICE_UNITS = ['ליום', 'לשעה', 'לעסקה'];

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

  let meta = { carTypes: [], carModels: {}, carTypeSpecs: {}, gearboxes: ['אוטומטי', 'ידני'] };
  let cars = [];
  let pollTimer = null;
  let activeTab = null;

  function showMsg(text, kind) {
    $('msg').innerHTML = text ? `<div class="msg ${kind}">${text}</div>` : '';
    if (text) window.scrollTo({ top: 0, behavior: 'smooth' });
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

  const esc = (s) => RB.esc(s);
  const yesNo = (v) => v ? 'כן' : 'לא';
  const priceUnitOptions = (sel) => PRICE_UNITS.map(u => `<option ${u === sel ? 'selected' : ''}>${u}</option>`).join('');

  function showView(name) {
    $('view-login').classList.toggle('hidden', name !== 'login');
    $('view-board').classList.toggle('hidden', name !== 'board');
    $('user-info').classList.toggle('hidden', name !== 'board');
    if (name !== 'board') $('search-summary').innerHTML = '';
  }

  function logoutLocal() {
    clearToken();
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
      setToken(data.token);
      showMsg('');
      enterBoard();
    } catch (err) { showMsg(err.message, 'error'); }
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
      render(data.supplier, data.requests);
    } catch (err) {
      if (!silent) showMsg(err.message, 'error');
    }
  }

  // פרטי הבקשה כשורות מפרט מאוירות
  function requestSpecs(r) {
    const days = RB.rentalDays(r.startDate, r.endDate);
    const s = meta.carTypeSpecs[r.carType];
    return RB.spec('calendar', `${RB.fmtDate(r.startDate)} – ${RB.fmtDate(r.endDate)} · ${RB.daysText(days)}`)
      + RB.spec('car', `מבוקש: ${esc(r.carType)}${s ? ` · ${s.seats} מושבים` : ''}`)
      + RB.spec('pin', `${esc(r.region)} — ${esc(r.neighborhood)}`)
      + RB.spec('seats', `נהג בן ${r.driverAge} · ותק ${r.licenseYears} שנים`);
  }

  function requestTags(r) {
    return `<div class="tags">
      ${r.urgent ? '<span class="tag urgent">דרוש מיידי</span>' : ''}
      <span class="tag">נהג נוסף: ${yesNo(r.extraDriver)}</span>
    </div>`;
  }

  // בחירת רכב מהצי — קודם הרכבים שמתאימים לסוג המבוקש
  function carSelect(r, selectedId) {
    if (!cars.length) {
      return `<div class="msg info">כדי להגיש הצעה צריך קודם להוסיף רכבים לצי שלך —
        <a href="#" data-goto-cars>למעבר לטאב "הרכבים שלי"</a></div>`;
    }
    const fit = cars.filter(c => c.carType === r.carType);
    const others = cars.filter(c => c.carType !== r.carType);
    const opt = (c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.model)} · ${esc(c.carType)} · ${esc(c.gearbox || '')}</option>`;
    return `
      <div class="field">
        <label>הרכב המוצע *</label>
        <select name="carId" required>
          <option value="">בחרו רכב מהצי שלך</option>
          ${fit.length ? `<optgroup label="מתאים לבקשה (${esc(r.carType)})">${fit.map(opt).join('')}</optgroup>` : ''}
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
          <input type="text" name="note" value="${o ? esc(o.note || '') : ''}" placeholder="למשל: כולל ביטוח מקיף">
        </div>
        <div class="btn-row">
          <button class="btn small ${o ? 'secondary' : ''}" type="submit" ${cars.length ? '' : 'disabled'}>${o ? 'עדכון ההצעה' : 'שליחת הצעה'}</button>
          ${o ? '' : `<button class="btn small outline" type="button" data-unavail="${r.id}">אין זמינות</button>`}
        </div>
      </form>`;
  }

  // כרטיס הצעה קיימת — אותו כרטיס רכב שהלקוח רואה
  function offerCard(r, cfg) {
    const days = RB.rentalDays(r.startDate, r.endDate);
    return RB.carCard({
      model: r.myOffer.carModel || r.carType,
      similar: !!r.myOffer.carModel,
      photo: r.myOffer.carPhoto,
      chosen: cfg.chosen,
      ribbon: cfg.ribbon,
      specs: RB.specRows({ carType: r.carType, gearbox: r.myOffer.gearbox, note: r.myOffer.note }, meta.carTypeSpecs)
        + RB.spec('calendar', `${RB.fmtDate(r.startDate)} – ${RB.fmtDate(r.endDate)}`),
      place: { title: 'בקשה ' + r.publicId, sub: `${r.region} — ${r.neighborhood}` },
      price: RB.priceBlock(r.myOffer, days),
      extra: cfg.extra || '',
      actions: cfg.actions || '',
    });
  }

  function render(supplier, requests) {
    const won = requests.filter(r => r.status === 'נבחרה הצעה' && r.myOffer && r.myOffer.chosen);
    const open = requests.filter(r => r.status === 'חדש' && !r.myOffer);
    const sent = requests.filter(r => r.status === 'חדש' && r.myOffer);
    const done = requests.filter(r => ['נסגר', 'לא נסגר'].includes(r.status) ||
      (r.status === 'נבחרה הצעה' && (!r.myOffer || !r.myOffer.chosen)));

    if (!activeTab) activeTab = won.length ? 'won' : (cars.length ? 'open' : 'cars');

    // פס סיכום עליון — האזור של הספק ומצב העבודה
    $('search-summary').innerHTML = RB.searchBox(
      'אזור ' + supplier.region,
      `${open.length} בקשות חדשות · ${sent.length} ממתינות ללקוח · ${cars.length} רכבים בצי`
    );

    const tabs = [
      { key: 'won', label: '✔ אושרו — לטיפול', count: won.length, attention: won.length > 0 },
      { key: 'open', label: 'בקשות חדשות', count: open.length },
      { key: 'sent', label: 'ממתינות ללקוח', count: sent.length },
      { key: 'done', label: 'היסטוריה', count: done.length },
      { key: 'cars', label: '🚗 הרכבים שלי', count: cars.length },
    ];

    let html = '<div class="tabs">' + tabs.map(t => `
      <button data-tab="${t.key}" class="${activeTab === t.key ? 'on' : ''} ${t.attention ? 'attention' : ''}">
        ${t.label} <span class="tab-count">${t.count}</span>
      </button>`).join('') + '</div>';

    if (activeTab === 'won') {
      html += won.length ? won.map(r => offerCard(r, {
        chosen: true,
        ribbon: { text: '🎉 הלקוח אישר את ההצעה שלך!', cls: '' },
        extra: r.customerPhone
          ? `<div class="phone-box">📞 טלפון הלקוח: <a href="tel:${esc(r.customerPhone)}">${esc(r.customerPhone)}</a> — התקשרו לסגירת ההשכרה</div>`
          : '',
        actions: `<div class="btn-row" style="margin:0">
            <button class="btn small" data-final="${r.myOffer.id}" data-status="נסגר">העסקה נסגרה ✓</button>
            <button class="btn small danger-outline" data-final="${r.myOffer.id}" data-status="לא נסגר">לא נסגרה</button>
          </div>`,
      })).join('')
        : '<div class="card empty">אין כרגע הצעות שאושרו וממתינות לטיפול.<br>כשלקוח יאשר הצעה שלך — היא תופיע כאן, והטאב יודגש בצהוב.</div>';
    }

    if (activeTab === 'open') {
      html += open.length ? open.map(r => `
        <div class="rcard">
          ${r.urgent ? '<div class="rcard-ribbon gold">⚡ הרכב דרוש באופן מיידי</div>' : ''}
          <div class="rcard-body">
            <div class="req-head">
              <h3 class="rcard-title">בקשה ${r.publicId}</h3>
              <span class="badge waiting">ממתינה להצעה</span>
            </div>
            <div class="rcard-specs" style="margin-top:8px">${requestSpecs(r)}</div>
            ${requestTags(r)}
            ${offerForm(r)}
          </div>
        </div>`).join('')
        : '<div class="card empty">אין כרגע בקשות חדשות באזור שלך</div>';
    }

    if (activeTab === 'sent') {
      html += sent.length ? sent.map(r => r.myOffer.available
        ? offerCard(r, {
            ribbon: { text: 'ההצעה נשלחה — ממתינה לתשובת הלקוח', cls: 'grey' },
            extra: offerForm(r),
          })
        : `<div class="rcard"><div class="rcard-ribbon grey">סומן: אין זמינות</div>
             <div class="rcard-body">
               <h3 class="rcard-title">בקשה ${r.publicId}</h3>
               <div class="rcard-specs" style="margin-top:8px">${requestSpecs(r)}</div>
             </div></div>`).join('')
        : '<div class="card empty">אין הצעות שממתינות לתשובת לקוח</div>';
    }

    if (activeTab === 'done') {
      html += done.length ? done.map(r => {
        const mine = r.myOffer && r.myOffer.chosen;
        let ribbon;
        if (r.status === 'נסגר' && mine) ribbon = { text: '✓ העסקה נסגרה', cls: '' };
        else if (r.status === 'לא נסגר' && mine) ribbon = { text: 'העסקה לא נסגרה', cls: 'grey' };
        else ribbon = { text: 'נבחרה הצעה של ספק אחר', cls: 'grey' };

        if (!r.myOffer || !r.myOffer.available) {
          return `<div class="rcard"><div class="rcard-ribbon grey">${ribbon.text}</div>
            <div class="rcard-body">
              <h3 class="rcard-title">בקשה ${r.publicId}</h3>
              <div class="rcard-specs" style="margin-top:8px">${requestSpecs(r)}</div>
            </div></div>`;
        }
        return offerCard(r, {
          chosen: mine && r.status === 'נסגר',
          ribbon,
          extra: mine && r.customerPhone
            ? `<div class="phone-box">📞 טלפון הלקוח: <a href="tel:${esc(r.customerPhone)}">${esc(r.customerPhone)}</a></div>` : '',
        });
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
        <p class="hint">הרכבים שתוסיפו כאן יופיעו לבחירה בכל הצעה. תמונת הרכב נבחרת אוטומטית לפי הדגם.</p>
        <form id="add-car-form">
          <div class="row2">
            <div class="field">
              <label>סוג רכב *</label>
              <select name="carType">${meta.carTypes.map(t => `<option>${t}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>תיבת הילוכים</label>
              <select name="gearbox">${(meta.gearboxes || []).map(g => `<option>${g}</option>`).join('')}</select>
            </div>
          </div>
          <div class="field">
            <label>דגם *</label>
            <input type="text" name="model" list="all-models" placeholder="למשל: טויוטה קורולה 2024" required autocomplete="off">
            <datalist id="all-models">${allModels.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
          </div>
          <div class="car-preview" id="add-car-preview"></div>
          <button class="btn small" type="submit" id="add-car-btn">הוספת רכב</button>
        </form>
      </div>
      ${cars.length ? cars.map(c => `
        <div class="card fleet-card">
          ${c.photo ? `<img class="fleet-thumb" src="${esc(c.photo)}" alt="">` : '<div class="fleet-thumb no-photo">🚗</div>'}
          <div style="flex:1">
            <strong>${esc(c.model)}</strong>
            <div class="order-sub">${esc(c.carType)} · ${esc(c.gearbox || 'אוטומטי')}</div>
          </div>
          <button class="btn small danger-outline" data-remove-car="${c.id}">הסרה</button>
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
        preview.innerHTML = c && c.photo ? `<img class="car-photo" src="${esc(c.photo)}" alt="">` : '';
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
            gearbox: addForm.elements.gearbox.value,
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
  if (getToken()) enterBoard();
  else showView('login');
})();
