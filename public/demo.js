// כניסה מהירה — בחירת משתמש בלחיצה, בלי סיסמאות
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function showMsg(text, kind) {
    $('msg').innerHTML = text ? `<div class="msg ${kind}">${text}</div>` : '';
  }

  async function enter(role, id, label) {
    // פותחים את החלון מיד (בתוך אירוע הלחיצה) כדי שחוסם החלונות הקופצים לא יעצור אותנו
    const win = window.open('', '_blank');
    try {
      const res = await fetch('/api/demo/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה');
      // הטוקן עובר בכתובת; כל טאב שומר אותו לעצמו — כך אפשר כמה משתמשים במקביל
      const url = (role === 'admin' ? '/admin' : '/supplier') + '#token=' + data.token;
      if (win) {
        win.location = url;
        showMsg(`נפתח טאב חדש: ${label}`, 'success');
      } else {
        location.href = url; // חוסם חלונות קופצים — נכנסים באותו עמוד
      }
    } catch (err) {
      if (win) win.close();
      showMsg(err.message, 'error');
    }
  }

  (async () => {
    try {
      const res = await fetch('/api/demo/accounts');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה');

      const byRegion = {};
      for (const s of data.suppliers) (byRegion[s.region] = byRegion[s.region] || []).push(s);

      $('suppliers').innerHTML = Object.keys(byRegion).length
        ? Object.entries(byRegion).map(([region, list]) => `
            <div class="card">
              <h3>${esc(region)}</h3>
              ${list.map(s => `
                <div class="order-row" data-supplier="${s.id}" data-name="${esc(s.name)}">
                  <div><strong>${esc(s.name)}</strong><div class="order-sub">כניסה כספק</div></div>
                  <span class="badge waiting">כניסה ←</span>
                </div>`).join('')}
            </div>`).join('')
        : '<div class="card empty">אין ספקים פעילים במערכת</div>';

      $('admin').innerHTML = data.admin ? `
        <div class="card">
          <div class="order-row" id="admin-row">
            <div><strong>${esc(data.admin.name)}</strong><div class="order-sub">לוח ניהול — כל הבקשות, ההצעות והספקים</div></div>
            <span class="badge chosen">כניסה ←</span>
          </div>
        </div>` : '<div class="card empty">לא נמצא מנהל</div>';

      document.querySelectorAll('[data-supplier]').forEach(el => {
        el.onclick = () => enter('supplier', Number(el.dataset.supplier), el.dataset.name);
      });
      const adminRow = $('admin-row');
      if (adminRow) adminRow.onclick = () => enter('admin', null, 'מנהל');
    } catch (err) {
      $('suppliers').innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
      $('admin').innerHTML = '';
    }
  })();
})();
