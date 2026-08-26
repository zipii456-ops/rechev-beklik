// ממשק ספק — הצעה של כמה רכבים לאותה בקשה, בשורות קומפקטיות עם תמונה קטנה
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
  let editingCarId = null;          // רכב שנמצא כרגע בעריכה
  const drafts = {};                // טיוטת ההצעה לכל בקשה: [{carId, price}]
  const draftUnit = {};             // יחידת מחיר לכל בקשה
  const draftNote = {};             // הערה לכל בקשה

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
  const carById = (id) => cars.find(c => c.id === Number(id));

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

  // שמירת מה שהוקלד לפני רענון המסך, כדי שלא ילך לאיבוד
  function syncDraftsFromDOM() {
    document.querySelectorAll('[data-draft-req]').forEach(box => {
      const id = box.dataset.draftReq;
      const rows = [...box.querySelectorAll('[data-draft-row]')].map(row => ({
        carId: Number(row.dataset.draftRow),
        price: row.querySelector('input[name="price"]').value,
      }));
      drafts[id] = rows;
      const unit = box.querySelector('select[name="priceUnit"]');
      if (unit) draftUnit[id] = unit.value;
      const note = box.querySelector('input[name="note"]');
      if (note) draftNote[id] = note.value;
    });
  }

  // ---- פרטי בקשה ----
  function requestSpecs(r) {
    const days = RB.rentalDays(r.startDate, r.endDate);
    const s = meta.carTypeSpecs[r.carType];
    return RB.spec('calendar', `${RB.fmtDate(r.startDate)} – ${RB.fmtDate(r.endDate)} · ${RB.daysText(days)}`)
      + RB.spec('car', `מבוקש: ${esc(r.carType)}${s ? ` · ${s.seats} מושבים` : ''}`)
      + RB.spec('pin', `${esc(r.region)} — ${esc(r.neighborhood)}`)
      + RB.spec('seats', `נהג בן ${r.driverAge} · ותק ${r.licenseYears} שנים`);
  }

  const requestTags = (r) => `<div class="tags">
      ${r.urgent ? '<span class="tag urgent">דרוש מיידי</span>' : ''}
      <span class="tag">נהג נוסף: ${yesNo(r.extraDriver)}</span>
    </div>`;

  // שורת רכב קומפקטית — תמונה קטנה, דגם, ומה שצריך מימין
  function carRowHtml(car, right, cls) {
    return `<div class="pick-row ${cls || ''}">
      ${car.photo ? `<img class="pick-thumb" src="${esc(car.photo)}" alt="">` : '<div class="pick-thumb no-photo">🚗</div>'}
      <div class="pick-name"><strong>${esc(car.model)}</strong>
        <small>${esc(car.carType)}${car.gearbox ? ' · ' + esc(car.gearbox) : ''}</small></div>
      ${right || ''}
    </div>`;
  }

  // ---- בונה ההצעה: בחירת כמה רכבים מהצי ----
  function offerBuilder(r) {
    if (!cars.length) {
      return `<div class="msg info">כדי להגיש הצעה צריך קודם להוסיף רכבים לצי שלך —
        <a href="#" data-goto-cars>למעבר לטאב "הרכבים שלי"</a></div>`;
    }
    if (!drafts[r.id]) {
      drafts[r.id] = r.myOffers.map(o => ({ carId: o.carId, price: String(o.price) }));
      draftUnit[r.id] = r.myOffers[0] ? r.myOffers[0].priceUnit : 'ליום';
      draftNote[r.id] = r.myOffers[0] ? (r.myOffers[0].note || '') : '';
    }
    const draft = drafts[r.id];
    const chosenIds = draft.map(d => d.carId);
    const available = cars.filter(c => !chosenIds.includes(c.id));
    // רכבים שמתאימים לסוג המבוקש מוצגים ראשונים
    available.sort((a, b) => (b.carType === r.carType) - (a.carType === r.carType));

    const rows = draft.map(d => {
      const car = carById(d.carId);
      if (!car) return '';
      return carRowHtml(car, `
        <div class="pick-price">
          <input type="number" name="price" min="1" value="${esc(d.price)}" placeholder="מחיר">
        </div>
        <button type="button" class="row-x" data-remove-draft="${r.id}:${car.id}" title="הסרה">✕</button>`,
        'selected');
    }).join('');

    return `
      <div class="builder" data-draft-req="${r.id}">
        ${draft.length ? `
          <div class="builder-title">הרכבים בהצעה שלך <span class="count">${draft.length}</span></div>
          <div class="pick-list rows">${draft.map((d, i) => {
            const car = carById(d.carId);
            return car ? `<div data-draft-row="${car.id}">${carRowHtml(car, `
              <div class="pick-price"><input type="number" name="price" min="1" value="${esc(d.price)}" placeholder="מחיר ₪"></div>
              <button type="button" class="row-x" data-remove-draft="${r.id}:${car.id}" title="הסרה">✕</button>`, 'selected')}</div>` : '';
          }).join('')}</div>` : ''}

        ${available.length ? `
          <div class="builder-title">${draft.length ? 'הוספת רכב נוסף' : 'בחרו רכבים מהצי — לחיצה מוסיפה לרשימה'}</div>
          <div class="pick-list">${available.map(c => `
            <button type="button" class="pick-btn" data-add-draft="${r.id}:${c.id}">
              ${carRowHtml(c, '<span class="pick-plus">+</span>')}
            </button>`).join('')}</div>` : ''}

        ${draft.length ? `
          <div class="row2" style="margin-top:12px">
            <div class="field">
              <label>יחידת מחיר (לכל הרכבים)</label>
              <select name="priceUnit">${PRICE_UNITS.map(u => `<option ${u === (draftUnit[r.id] || 'ליום') ? 'selected' : ''}>${u}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>הערה כללית</label>
              <input type="text" name="note" value="${esc(draftNote[r.id] || '')}" placeholder="למשל: כולל ביטוח מקיף">
            </div>
          </div>` : ''}

        <div class="btn-row">
          <button class="btn small" type="button" data-send-offers="${r.id}" ${draft.length ? '' : 'disabled'}>
            ${r.myOffers.length ? 'עדכון ההצעה' : 'שליחת ההצעה'}${draft.length > 1 ? ` (${draft.length} רכבים)` : ''}
          </button>
          ${r.myOffers.length ? '' : `<button class="btn small outline" type="button" data-unavail="${r.id}">אין זמינות</button>`}
        </div>
      </div>`;
  }

  function render(supplier, requests) {
    syncDraftsFromDOM();

    const won = requests.filter(r => r.myOffers.some(o => o.chosen) && r.status === 'נבחרה הצעה');
    const open = requests.filter(r => r.status === 'חדש' && !r.myOffers.length && !r.markedUnavailable);
    const sent = requests.filter(r => r.status === 'חדש' && (r.myOffers.length || r.markedUnavailable));
    const done = requests.filter(r => ['נסגר', 'לא נסגר'].includes(r.status) ||
      (r.status === 'נבחרה הצעה' && !r.myOffers.some(o => o.chosen)));

    if (!activeTab) activeTab = won.length ? 'won' : (cars.length ? 'open' : 'cars');

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
      html += won.length ? won.map(r => {
        const o = r.myOffers.find(x => x.chosen);
        const days = RB.rentalDays(r.startDate, r.endDate);
        const total = o.priceUnit === 'ליום' ? ` · סה"כ ₪${o.price * days}` : '';
        return `
        <div class="rcard is-chosen">
          <div class="rcard-ribbon">🎉 הלקוח אישר את ההצעה שלך!</div>
          <div class="rcard-body">
            <div class="req-head"><h3 class="rcard-title">בקשה ${r.publicId}</h3><span class="badge chosen">נבחרה</span></div>
            ${carRowHtml({ model: o.carModel || r.carType, carType: o.carType || r.carType, gearbox: o.gearbox, photo: o.carPhoto },
              `<div class="pick-price static">₪${o.price} ${esc(o.priceUnit)}${total}</div>`, 'selected')}
            <div class="rcard-specs" style="margin-top:10px">${requestSpecs(r)}</div>
            ${o.note ? `<div class="order-sub" style="margin-top:6px">${esc(o.note)}</div>` : ''}
            ${r.customerPhone ? `<div class="phone-box">📞 טלפון הלקוח: <a href="tel:${esc(r.customerPhone)}">${esc(r.customerPhone)}</a> — התקשרו לסגירת ההשכרה</div>` : ''}
            <div class="btn-row">
              <button class="btn small" data-final="${o.id}" data-status="נסגר">העסקה נסגרה ✓</button>
              <button class="btn small danger-outline" data-final="${o.id}" data-status="לא נסגר">לא נסגרה</button>
            </div>
          </div>
        </div>`;
      }).join('')
        : '<div class="card empty">אין כרגע הצעות שאושרו וממתינות לטיפול.<br>כשלקוח יאשר הצעה שלך — היא תופיע כאן, והטאב יודגש בצהוב.</div>';
    }

    if (activeTab === 'open') {
      html += open.length ? open.map(r => `
        <div class="rcard">
          ${r.urgent ? '<div class="rcard-ribbon gold">⚡ הרכב דרוש באופן מיידי</div>' : ''}
          <div class="rcard-body">
            <div class="req-head"><h3 class="rcard-title">בקשה ${r.publicId}</h3><span class="badge waiting">ממתינה להצעה</span></div>
            <div class="rcard-specs" style="margin-top:8px">${requestSpecs(r)}</div>
            ${requestTags(r)}
            ${offerBuilder(r)}
          </div>
        </div>`).join('')
        : '<div class="card empty">אין כרגע בקשות חדשות באזור שלך</div>';
    }

    if (activeTab === 'sent') {
      html += sent.length ? sent.map(r => r.markedUnavailable ? `
        <div class="rcard">
          <div class="rcard-ribbon grey">סומן: אין זמינות</div>
          <div class="rcard-body">
            <h3 class="rcard-title">בקשה ${r.publicId}</h3>
            <div class="rcard-specs" style="margin-top:8px">${requestSpecs(r)}</div>
            <div class="btn-row"><button class="btn small outline" type="button" data-reopen="${r.id}">בכל זאת להציע רכב</button></div>
          </div>
        </div>` : `
        <div class="rcard">
          <div class="rcard-ribbon grey">${r.myOffers.length} ${r.myOffers.length === 1 ? 'רכב הוצע' : 'רכבים הוצעו'} — ממתין לתשובת הלקוח</div>
          <div class="rcard-body">
            <h3 class="rcard-title">בקשה ${r.publicId}</h3>
            <div class="rcard-specs" style="margin-top:8px">${requestSpecs(r)}</div>
            ${offerBuilder(r)}
          </div>
        </div>`).join('')
        : '<div class="card empty">אין הצעות שממתינות לתשובת לקוח</div>';
    }

    if (activeTab === 'done') {
      html += done.length ? done.map(r => {
        const mine = r.myOffers.find(o => o.chosen);
        let ribbon;
        if (r.status === 'נסגר' && mine) ribbon = '✓ העסקה נסגרה';
        else if (r.status === 'לא נסגר' && mine) ribbon = 'העסקה לא נסגרה';
        else ribbon = 'נבחרה הצעה של ספק אחר';
        const list = mine ? [mine] : r.myOffers;
        return `
        <div class="rcard">
          <div class="rcard-ribbon ${mine && r.status === 'נסגר' ? '' : 'grey'}">${ribbon}</div>
          <div class="rcard-body">
            <h3 class="rcard-title">בקשה ${r.publicId}</h3>
            <div class="rcard-specs" style="margin-top:8px">${requestSpecs(r)}</div>
            ${list.map(o => carRowHtml(
              { model: o.carModel || r.carType, carType: o.carType || r.carType, gearbox: o.gearbox, photo: o.carPhoto },
              `<div class="pick-price static">₪${o.price} ${esc(o.priceUnit)}</div>`)).join('')}
            ${mine && r.customerPhone ? `<div class="phone-box">📞 טלפון הלקוח: <a href="tel:${esc(r.customerPhone)}">${esc(r.customerPhone)}</a></div>` : ''}
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
          <div id="add-car-preview"></div>
          <button class="btn small" type="submit" id="add-car-btn">הוספת רכב</button>
        </form>
      </div>
      ${cars.length ? cars.map(c => c.id === editingCarId ? carEditForm(c) : `
        <div class="card" style="padding:10px 12px">
          ${carRowHtml(c, `<div class="btn-row" style="margin:0;gap:6px">
            <button class="btn small outline" data-edit-car="${c.id}">עריכה</button>
            <button class="btn small danger-outline" data-remove-car="${c.id}">הסרה</button>
          </div>`)}
        </div>`).join('')
        : '<div class="card empty">עדיין אין רכבים בצי שלך — הוסיפו את הרכב הראשון למעלה</div>'}`;
  }

  function carEditForm(c) {
    const allModels = Object.values(meta.carModels || {}).flat();
    return `
      <div class="card" style="border:2px solid var(--cta)">
        <h3>עריכת רכב</h3>
        <form data-edit-form="${c.id}">
          <div class="row2">
            <div class="field">
              <label>סוג רכב *</label>
              <select name="carType">${meta.carTypes.map(t => `<option ${t === c.carType ? 'selected' : ''}>${t}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>תיבת הילוכים</label>
              <select name="gearbox">${(meta.gearboxes || []).map(g => `<option ${g === (c.gearbox || 'אוטומטי') ? 'selected' : ''}>${g}</option>`).join('')}</select>
            </div>
          </div>
          <div class="field">
            <label>דגם *</label>
            <input type="text" name="model" list="all-models-edit" value="${esc(c.model)}" required autocomplete="off">
            <datalist id="all-models-edit">${allModels.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
          </div>
          <div data-edit-preview></div>
          <div class="btn-row">
            <button class="btn small" type="submit">שמירת השינויים</button>
            <button class="btn small outline" type="button" data-cancel-edit>ביטול</button>
          </div>
        </form>
      </div>`;
  }

  // תצוגה מקדימה קטנה של התמונה שתיבחר לדגם
  const miniPreview = (url, model, type, gearbox) =>
    `<div class="pick-row" style="margin:8px 0">
       <img class="pick-thumb" src="${url}" alt="">
       <div class="pick-name"><strong>${esc(model)}</strong><small>${esc(type)}${gearbox ? ' · ' + esc(gearbox) : ''} · התמונה שתוצג ללקוח</small></div>
     </div>`;

  function bindBoard() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => { syncDraftsFromDOM(); activeTab = btn.dataset.tab; load(true); };
    });
    document.querySelectorAll('[data-goto-cars]').forEach(a => {
      a.onclick = (e) => { e.preventDefault(); activeTab = 'cars'; load(true); };
    });

    // הוספה/הסרה של רכב מהטיוטה
    document.querySelectorAll('[data-add-draft]').forEach(btn => {
      btn.onclick = () => {
        syncDraftsFromDOM();
        const [reqId, carId] = btn.dataset.addDraft.split(':');
        drafts[reqId] = drafts[reqId] || [];
        if (!drafts[reqId].some(d => d.carId === Number(carId))) {
          drafts[reqId].push({ carId: Number(carId), price: '' });
        }
        load(true);
      };
    });
    document.querySelectorAll('[data-remove-draft]').forEach(btn => {
      btn.onclick = () => {
        syncDraftsFromDOM();
        const [reqId, carId] = btn.dataset.removeDraft.split(':');
        drafts[reqId] = (drafts[reqId] || []).filter(d => d.carId !== Number(carId));
        load(true);
      };
    });

    // שליחת ההצעה (כל הרכבים שנבחרו)
    document.querySelectorAll('[data-send-offers]').forEach(btn => {
      btn.onclick = async () => {
        syncDraftsFromDOM();
        const id = btn.dataset.sendOffers;
        const list = drafts[id] || [];
        if (!list.length) return showMsg('נא לבחור לפחות רכב אחד', 'error');
        if (list.some(d => !d.price || Number(d.price) <= 0)) return showMsg('נא להזין מחיר לכל רכב שנבחר', 'error');
        btn.disabled = true;
        try {
          const res = await api(`/api/supplier/requests/${id}/offers`, { body: {
            offers: list.map(d => ({ carId: d.carId, price: d.price })),
            priceUnit: draftUnit[id] || 'ליום',
            note: draftNote[id] || '',
          }});
          delete drafts[id];
          showMsg(res.count > 1 ? `${res.count} רכבים נשלחו ללקוח` : 'ההצעה נשלחה ללקוח', 'success');
          activeTab = 'sent';
          load(true);
        } catch (err) { showMsg(err.message, 'error'); btn.disabled = false; }
      };
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
    document.querySelectorAll('[data-reopen]').forEach(btn => {
      btn.onclick = () => { drafts[btn.dataset.reopen] = []; activeTab = 'sent'; load(true); };
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
    document.querySelectorAll('[data-edit-car]').forEach(btn => {
      btn.onclick = () => { editingCarId = Number(btn.dataset.editCar); load(true); };
    });
    document.querySelectorAll('[data-cancel-edit]').forEach(btn => {
      btn.onclick = () => { editingCarId = null; load(true); };
    });
    document.querySelectorAll('[data-edit-form]').forEach(form => {
      const preview = form.querySelector('[data-edit-preview]');
      let timer = null;
      const updatePreview = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const model = form.elements.model.value.trim();
          if (!model) { preview.innerHTML = ''; return; }
          try {
            const { url } = await api(`/api/car-image?model=${encodeURIComponent(model)}&type=${encodeURIComponent(form.elements.carType.value)}`);
            preview.innerHTML = miniPreview(url, model, form.elements.carType.value, form.elements.gearbox.value);
          } catch (e) {}
        }, 300);
      };
      form.elements.model.oninput = updatePreview;
      form.elements.carType.onchange = updatePreview;
      updatePreview();

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api(`/api/supplier/cars/${form.dataset.editForm}`, { method: 'PATCH', body: {
            model: form.elements.model.value,
            carType: form.elements.carType.value,
            gearbox: form.elements.gearbox.value,
          }});
          editingCarId = null;
          showMsg('פרטי הרכב עודכנו', 'success');
          load(true);
        } catch (err) { showMsg(err.message, 'error'); }
      });
    });

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
            $('add-car-preview').innerHTML = miniPreview(url, model, addForm.elements.carType.value, addForm.elements.gearbox.value);
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
