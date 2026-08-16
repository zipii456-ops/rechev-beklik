// אפליקציית לקוח — טופס בקשה, אזור אישי (היסטוריית הזמנות מהמכשיר), מעקב ובחירת הצעה
(function () {
  const $ = (id) => document.getElementById(id);
  const LIST_KEY = 'rb_track_list';
  const msgEl = $('msg');
  let pollTimer = null;

  function showMsg(text, kind) {
    msgEl.innerHTML = text ? `<div class="msg ${kind}">${text}</div>` : '';
    if (text) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showView(name) {
    for (const v of ['view-form', 'view-success', 'view-track']) {
      $(v).classList.toggle('hidden', v !== 'view-' + name);
    }
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

  const fmtDate = (iso) => {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  };

  const statusBadge = (status) => {
    const cls = { 'ממתין להצעות': 'waiting', 'נבחרה הצעה': 'chosen', 'נסגר': 'closed', 'לא נסגר': 'lost' }[status] || 'waiting';
    return `<span class="badge ${cls}">${status}</span>`;
  };

  // ---- האזור האישי: רשימת הזמנות ששמורה במכשיר ----
  function getList() {
    try { return JSON.parse(localStorage.getItem(LIST_KEY)) || []; } catch (e) { return []; }
  }
  function saveList(list) { localStorage.setItem(LIST_KEY, JSON.stringify(list)); }
  function addToList(token) {
    const list = getList();
    if (!list.includes(token)) { list.unshift(token); saveList(list); }
  }
  // תאימות לגרסה קודמת ששמרה בקשה אחת בלבד
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
              <strong>${r.publicId}</strong> · ${r.carType} · ${r.region}
              <div class="order-sub">${fmtDate(r.startDate)}–${fmtDate(r.endDate)} · ${data.offers.length} הצעות</div>
            </div>
            ${statusBadge(r.status)}
          </div>`);
      } catch (e) {
        // בקשה שכבר לא קיימת (למשל אחרי ניקוי נתונים) — מוסרת מהרשימה
        if (e.status !== 404) stillValid.push(token);
      }
    }
    saveList(stillValid);

    box.innerHTML = rows.length ? `
      <div class="card">
        <h2>ההזמנות שלי</h2>
        <p class="hint">ההזמנות ששלחת מהמכשיר הזה — לחצי על הזמנה לצפייה בהצעות ובסטטוס.</p>
        ${rows.join('')}
      </div>` : '';

    box.querySelectorAll('[data-open]').forEach(el => {
      el.onclick = () => openTrack(el.dataset.open);
    });
  }

  // ---- טופס ----
  async function initForm() {
    const meta = await api('/api/meta');
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
        shabbat: $('f-shabbat').checked,
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
      addToList(token); // קישור שנפתח ממכשיר חדש נשמר גם בו
      renderTrack(token, data);
    } catch (err) {
      if (!silent) {
        goHome();
        showMsg(err.message, 'error');
      }
    }
  }

  function renderTrack(token, data) {
    const r = data.request;
    $('track-status').innerHTML = statusBadge(r.status);
    $('track-id').textContent = 'מספר בקשה: ' + r.publicId;
    $('track-details').innerHTML = `
      <dt>אזור</dt><dd>${r.region} — ${r.neighborhood}</dd>
      <dt>תאריכים</dt><dd>${fmtDate(r.startDate)} עד ${fmtDate(r.endDate)}</dd>
      <dt>סוג רכב</dt><dd>${r.carType}</dd>` +
      (r.urgent ? '<dt>דחיפות</dt><dd><span class="tag urgent">דרוש מיידי</span></dd>' : '');

    const offers = data.offers;
    $('offers-count').textContent = offers.length;
    const canChoose = r.status === 'ממתין להצעות';

    if (!offers.length) {
      $('offers-list').innerHTML = `<div class="card empty">עדיין לא התקבלו הצעות.<br>הסוכנויות באזור שלך קיבלו את הבקשה — כדאי לבדוק שוב בקרוב.</div>`;
      return;
    }

    $('offers-list').innerHTML = offers.map(o => `
      <div class="offer-card ${o.chosen ? 'chosen' : ''}">
        <div class="req-head">
          <div class="offer-price">₪${o.price} <small>${o.priceUnit || ''}</small></div>
          ${o.chosen ? '<span class="badge chosen">ההצעה שנבחרה</span>' : ''}
        </div>
        <div class="kv" style="margin-top:6px">
          <dt>סוג רכב</dt><dd>${o.carType}</dd>
          ${o.note ? `<dt>תנאים</dt><dd>${o.note}</dd>` : ''}
        </div>
        ${o.chosen && r.status === 'נבחרה הצעה' ? '<p class="hint" style="margin-top:8px">הסוכנות קיבלה את פרטיך ותיצור איתך קשר בהקדם.</p>' : ''}
        ${o.chosen && ['נסגר', 'לא נסגר'].includes(r.status) ? `<div style="margin-top:8px">${statusBadge(r.status)}</div>` : ''}
        ${canChoose ? `<div class="btn-row"><button class="btn small" data-choose="${o.id}">בחר הצעה</button></div>` : ''}
      </div>`).join('');

    if (canChoose) {
      document.querySelectorAll('[data-choose]').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('לבחור את ההצעה הזו?')) return;
          try {
            await api(`/api/track/${token}/choose`, { body: { offerId: Number(btn.dataset.choose) } });
            showMsg('ההצעה נבחרה! הסוכנות קיבלה את מספר הטלפון שלך ותיצור איתך קשר.', 'success');
            loadTrack(token, true);
          } catch (err) {
            showMsg(err.message, 'error');
          }
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
