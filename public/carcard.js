// רכיב כרטיס רכב משותף בסגנון בוקינג — משמש גם את הלקוח וגם את הספק
window.RB = (function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICONS = {
    seats: '<circle cx="12" cy="7" r="3.2"/><path d="M5.5 20v-1.5A4.5 4.5 0 0 1 10 14h4a4.5 4.5 0 0 1 4.5 4.5V20"/>',
    doors: '<rect x="4" y="3" width="14" height="18" rx="1.6"/><circle cx="8" cy="12" r="1.1"/>',
    gearbox: '<path d="M6 4v16M12 4v10M18 4v16M6 8h12"/><circle cx="12" cy="17" r="2.4"/>',
    bags: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    road: '<path d="M4 20 8 4M20 20 16 4M12 5v3M12 11v3M12 17v3"/>',
    pin: '<path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    note: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    car: '<path d="M5 16.5h14M6.5 16.5V19M17.5 16.5V19"/><path d="M4 16.5v-3l2-4.5a2 2 0 0 1 1.8-1.2h8.4A2 2 0 0 1 18 9l2 4.5v3z"/>',
  };

  const icon = (name) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;

  const spec = (name, text, cls) => `<div class="spec ${cls || ''}">${icon(name)}<span>${text}</span></div>`;

  // שורות המפרט של הרכב — מושבים/דלתות, תיבת הילוכים, מזוודות, ק"מ, והערת הספק
  function specRows(o, typeSpecs) {
    const s = (typeSpecs && typeSpecs[o.carType]) || null;
    let html = '';
    if (s) html += spec('seats', `${s.seats} מושבים · ${s.doors} דלתות`);
    if (o.gearbox) html += spec('gearbox', o.gearbox);
    if (s) html += spec('bags', `${s.bags} מזוודות`);
    if (o.note) html += spec('note', esc(o.note), 'note');
    return html;
  }

  // כרטיס רכב מלא. ribbon/place/price/actions הם אופציונליים
  function carCard(cfg) {
    const ribbon = cfg.ribbon
      ? `<div class="rcard-ribbon ${cfg.ribbon.cls || ''}">${cfg.ribbon.text}</div>` : '';
    const photo = cfg.photo
      ? `<img class="rcard-photo" src="${esc(cfg.photo)}" alt="${esc(cfg.model || '')}" loading="lazy">` : '';
    const foot = (cfg.place || cfg.price) ? `
      <div class="rcard-foot">
        <div class="rcard-place">
          ${cfg.place ? `<strong>${esc(cfg.place.title)}</strong>${cfg.place.sub ? `<span>${esc(cfg.place.sub)}</span>` : ''}` : ''}
        </div>
        ${cfg.price ? `
        <div class="rcard-price">
          ${cfg.price.label ? `<span class="label">${esc(cfg.price.label)}</span>` : ''}
          <span class="amount">${esc(cfg.price.amount)}</span>
          ${cfg.price.per ? `<span class="per">${esc(cfg.price.per)}</span>` : ''}
        </div>` : ''}
      </div>` : '';

    return `
      <article class="rcard ${cfg.chosen ? 'is-chosen' : ''}">
        ${ribbon}
        <div class="rcard-body">
          <h3 class="rcard-title">${esc(cfg.model || cfg.carType || 'רכב')}
            ${cfg.similar ? '<span class="similar">או רכב דומה</span>' : ''}</h3>
          <div class="rcard-main">
            <div class="rcard-specs">${cfg.specs || ''}</div>
            ${photo}
          </div>
          ${cfg.extra || ''}
        </div>
        ${foot}
        ${cfg.actions ? `<div class="rcard-actions">${cfg.actions}</div>` : ''}
      </article>`;
  }

  // תיבת סיכום החיפוש בראש העמוד (מסגרת צהובה)
  function searchBox(title, sub) {
    return `
      <div class="searchbar">
        <div class="searchbox">
          <div class="sb-icon">${icon('car')}</div>
          <div class="sb-text">
            <div class="sb-title">${esc(title)}</div>
            <div class="sb-sub">${esc(sub)}</div>
          </div>
          <div class="sb-arrow">›</div>
        </div>
      </div>`;
  }

  const fmtDate = (iso) => { const [y, m, d] = String(iso).split('-'); return `${d}.${m}.${y}`; };

  // מספר ימי ההשכרה בין שני תאריכים (לפחות יום אחד)
  function rentalDays(startISO, endISO) {
    const a = new Date(startISO), b = new Date(endISO);
    const d = Math.round((b - a) / 86400000);
    return d > 0 ? d : 1;
  }
  const daysText = (n) => n === 1 ? 'יום אחד' : (n === 2 ? 'יומיים' : `${n} ימים`);

  // חישוב תצוגת המחיר: ליום → סה"כ לתקופה, אחרת המחיר כפי שהוא
  function priceBlock(offer, days) {
    if (offer.priceUnit === 'ליום' && days) {
      return { label: 'מחיר ל' + daysText(days), amount: '₪' + (offer.price * days), per: '₪' + offer.price + ' ליום' };
    }
    if (offer.priceUnit === 'לעסקה') {
      return { label: 'מחיר לכל התקופה', amount: '₪' + offer.price };
    }
    return { label: 'מחיר ' + (offer.priceUnit || ''), amount: '₪' + offer.price };
  }

  return { esc, icon, spec, specRows, carCard, searchBox, fmtDate, rentalDays, daysText, priceBlock };
})();
