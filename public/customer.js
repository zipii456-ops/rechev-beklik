// אפליקציית לקוח — טופס בקשה, אזור אישי, מעקב ובחירת הצעה (עיצוב בסגנון בוקינג)
(function () {
  const $ = (id) => document.getElementById(id);
  const LIST_KEY = 'rb_track_list';
  const msgEl = $('msg');
  let pollTimer = null;
  let meta = { carTypeSpecs: {} };
  let sortBy = 'price';   // price | model
  let lastTrack = null;   // { token, data }

  function showMsg(text, kind) {
    msgEl.innerHTML = text ? `<div class="msg ${kind}">${text}</div>` : '';
    if (text) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showView(name) {
    for (const v of ['view-form', 'view-success', 'view-track']) {
      $(v).classList.toggle('hidden', v !== 'view-' + name);
    }
    $('search-summary').innerHTML = '';
    showMsg('');
  }

  async function api(path, options) {
    const res = await fetch(path, options ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.body || {}),
    } : undefined);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'שגיאה, נסו שוב'); e.status = res.status; throw e; }
    return data;
  }

  const statusBadge = (status) => {
    const cls = { 'ממתין להצעות': 'waiting', 'נבחרה הצעה': 'chosen', 'נסגר': 'closed', 'לא נסגר': 'lost' }[status] || 'waiting';
    return `<span class="badge ${cls}">${status}</span>`;
  };

  // ---- האזור האישי: רשימת הזמנות ששמורה במכשיר ----
  const getList = () => { try { return JSON.parse(localStorage.getItem(LIST_KEY)) || []; } catch (e) { return []; } };
  const saveList = (l) => localStorage.setItem(LIST_KEY, JSON.stringify(l));
  function addToList(token) {
    const list = getList();
    if (!list.includes(token)) { list.unshift(token); saveList(list); }
  }
  (function migrate() {
    const old = localStorage.getItem('rb_track');
    if (old) { addToList(old); localStorage.removeItem('rb_track'); }
  })();

  async function renderMyOrders() {
    const box = $('my-orders');
    const list = getList();
    if (!list.length) { box.innerHTML = ''; return; }

    const rows = [];
    const stillValid = [];
    for (const token of list) {
      try {
        const data = await api('/api/track/' + token);
        stillValid.push(token);
        const r = data.request;
        rows.push(`
          <div class="order-row" data-open="${token}">
            <div>
              <strong>${r.publicId}</strong> · ${RB.esc(r.carType)} · ${RB.esc(r.region)}
              <div class="order-sub">${RB.fmtDate(r.startDate)}–${RB.fmtDate(r.endDate)} · ${data.offers.length} הצעות</div>
            </div>
            ${statusBadge(r.status)}
          </div>`);
      } catch (e) {
        if (e.status !== 404) stillValid.push(token);
      }
    }
    saveList(stillValid);

    box.innerHTML = rows.length ? `
      <div class="card">
        <h2>ההזמנות שלי</h2>
        <p class="hint">ההזמנות ששלחת מהמכשיר הזה — לחצו על הזמנה לצפייה בהצעות ובסטטוס.</p>
        ${rows.join('')}
      </div>` : '';

    box.querySelectorAll('[data-open]').forEach(el => { el.onclick = () => openTrack(el.dataset.open); });
  }

  // ---- טופס ----
  async function initForm() {
    meta = await api('/api/meta');
    $('f-region').innerHTML = '<option value="" disabled selected>בחרו אזור</option>' +
      meta.regions.map(r => `<option>${r}</option>`).join('');
    $('f-cartype').innerHTML = '<option value="" disabled selected>בחרו סוג רכב</option>' +
      meta.carTypes.map(c => `<option>${c}</option>`).join('');
    const today = new Date().toISOString().slice(0, 10);
    $('f-start').min = today;
    $('f-end').min = today;
  }

  $('request-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('submit-btn');
    btn.disabled = true;
    btn.textContent = 'שולח...';
    try {
      const data = await api('/api/requests', { body: {
        region: $('f-region').value,
        neighborhood: $('f-neighborhood').value,
        startDate: $('f-start').value,
        endDate: $('f-end').value,
        carType: $('f-cartype').value,
        driverAge: $('f-age').value,
        licenseYears: $('f-license').value,
        extraDriver: $('f-extra').checked,
        urgent: $('f-urgent').checked,
        phone: $('f-phone').value,
      }});
      addToList(data.trackToken);
      $('request-form').reset();
      $('success-id').textContent = data.publicId;
      const link = `${location.origin}/track/${data.trackToken}`;
      $('track-link').value = link;
      $('success-goto').onclick = () => openTrack(data.trackToken);
      $('copy-btn').onclick = async () => {
        await navigator.clipboard.writeText(link).catch(() => {});
        $('copy-btn').textContent = 'הועתק ✓';
        setTimeout(() => { $('copy-btn').textContent = 'העתק'; }, 1800);
      };
      showView('success');
    } catch (err) {
      showMsg(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'שלח בקשה';
    }
  });

  // ---- מעקב ----
  function openTrack(token) {
    history.replaceState(null, '', '/track/' + token);
    showView('track');
    loadTrack(token);
    clearInterval(pollTimer);
    pollTimer = setInterval(() => loadTrack(token, true), 20000);
  }

  function goHome() {
    clearInterval(pollTimer);
    history.replaceState(null, '', '/');
    showView('form');
    renderMyOrders();
  }

  async function loadTrack(token, silent) {
    try {
      const data = await api('/api/track/' + token);
      addToList(token);
      lastTrack = { token, data };
      renderTrack();
    } catch (err) {
      if (!silent) { goHome(); showMsg(err.message, 'error'); }
    }
  }

  function renderTrack() {
    const { token, data } = lastTrack;
    const r = data.request;
    const days = RB.rentalDays(r.startDate, r.endDate);

    // פס סיכום החיפוש — בראש העמוד, מסגרת צהובה
    $('search-summary').innerHTML = RB.searchBox(
      `${r.region} — ${r.neighborhood}`,
      `${RB.fmtDate(r.startDate)} – ${RB.fmtDate(r.endDate)} · ${RB.daysText(days)} · ${r.carType}`
    );

    $('track-status').innerHTML = statusBadge(r.status);
    $('track-id').textContent = 'מספר בקשה: ' + r.publicId;

    // אחרי סיום העסקה — מבקשים מהלקוח לאשר שקיבל את הרכב בפועל
    const confirmBox = $('confirm-box');
    if (r.needsConfirmation) {
      confirmBox.innerHTML = `
        <div class="card" style="border:2px solid var(--yellow)">
          <h3>רגע אחד — קיבלת את הרכב?</h3>
          <p class="hint">הסוכנות דיווחה שהטיפול בבקשה הסתיים.
            נשמח לדעת אם הרכב אכן נמסר לך, כדי לוודא שהעסקה תועדה נכון.</p>
          <div class="btn-row">
            <button class="btn small" data-confirm="yes">כן, קיבלתי את הרכב</button>
            <button class="btn small outline" data-confirm="no">לא, העסקה לא יצאה לפועל</button>
          </div>
        </div>`;
      confirmBox.querySelectorAll('[data-confirm]').forEach(btn => {
        btn.onclick = async () => {
          try {
            await api(`/api/track/${token}/confirm`, { body: { received: btn.dataset.confirm === 'yes' } });
            showMsg('תודה על העדכון!', 'success');
            loadTrack(token, true);
          } catch (err) { showMsg(err.message, 'error'); }
        };
      });
    } else {
      const answered = data.offers.find(o => o.chosen && o.customerConfirmed !== null);
      confirmBox.innerHTML = answered
        ? `<div class="msg ${answered.customerConfirmed ? 'success' : 'info'}">${
            answered.customerConfirmed ? 'אישרת שקיבלת את הרכב — תודה!' : 'עדכנת שהעסקה לא יצאה לפועל.'}</div>`
        : '';
    }

    const offers = data.offers.slice();
    const canChoose = r.status === 'ממתין להצעות';
    $('offers-count').textContent = offers.length;

    if (!offers.length) {
      $('offers-toolbar').innerHTML = '';
      $('offers-list').innerHTML = `<div class="card empty">עדיין לא התקבלו הצעות.<br>
        סוכנויות ההשכרה באזור שלך קיבלו את הבקשה — כדאי לבדוק שוב בקרוב.</div>`;
      return;
    }

    // שורת מיון דביקה, כמו בבוקינג
    $('offers-toolbar').innerHTML = `
      <div class="toolbar">
        <button data-sort="price" class="${sortBy === 'price' ? 'on' : ''}">מחיר: מהזול ליקר</button>
        <button data-sort="expensive" class="${sortBy === 'expensive' ? 'on' : ''}">מחיר: מהיקר לזול</button>
        <button data-sort="model" class="${sortBy === 'model' ? 'on' : ''}">דגם</button>
      </div>`;
    document.querySelectorAll('[data-sort]').forEach(b => {
      b.onclick = () => { sortBy = b.dataset.sort; renderTrack(); };
    });

    offers.sort((a, b) => {
      if (a.chosen !== b.chosen) return b.chosen - a.chosen; // ההצעה שנבחרה תמיד ראשונה
      if (sortBy === 'expensive') return b.price - a.price;
      if (sortBy === 'model') return String(a.carModel || '').localeCompare(String(b.carModel || ''), 'he');
      return a.price - b.price;
    });

    const cheapest = Math.min(...offers.map(o => o.price));

    $('offers-list').innerHTML = offers.map(o => {
      let ribbon = null;
      if (o.chosen && r.status === 'נסגר') ribbon = { text: '✓ ההזמנה הושלמה', cls: '' };
      else if (o.chosen && r.status === 'לא נסגר') ribbon = { text: 'העסקה לא נסגרה', cls: 'grey' };
      else if (o.chosen) ribbon = { text: '✓ בחרת בהצעה הזו — הסוכנות תיצור איתך קשר', cls: '' };
      else if (canChoose && o.price === cheapest && offers.length > 1) ribbon = { text: '★ המחיר הזול ביותר', cls: 'gold' };

      return RB.carCard({
        model: o.carModel || o.carType,
        similar: !!o.carModel,
        photo: o.carPhoto,
        chosen: o.chosen,
        ribbon,
        specs: RB.specRows(o, meta.carTypeSpecs),
        place: { title: r.region, sub: 'איסוף באזור ' + r.neighborhood },
        price: RB.priceBlock(o, days),
        actions: canChoose ? `<button class="btn" data-choose="${o.id}">בחירת הצעה זו</button>` : '',
      });
    }).join('');

    if (canChoose) {
      document.querySelectorAll('[data-choose]').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('לבחור את ההצעה הזו? הסוכנות תקבל את מספר הטלפון שלך ותיצור איתך קשר.')) return;
          try {
            await api(`/api/track/${token}/choose`, { body: { offerId: Number(btn.dataset.choose) } });
            showMsg('ההצעה נבחרה! הסוכנות קיבלה את מספר הטלפון שלך ותיצור איתך קשר.', 'success');
            loadTrack(token, true);
          } catch (err) { showMsg(err.message, 'error'); }
        };
      });
    }
  }

  $('new-request-btn').onclick = goHome;
  $('all-orders-btn').onclick = goHome;

  // ---- ניתוב ראשוני ----
  const m = location.pathname.match(/^\/track\/([0-9a-f]+)/);
  initForm().then(() => {
    if (m) openTrack(m[1]);
    else { showView('form'); renderMyOrders(); }
  }).catch(() => showMsg('שגיאה בטעינה, רעננו את הדף', 'error'));
})();
