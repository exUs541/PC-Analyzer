/* ui.js - tiny DOM toolkit + shared components. No innerHTML with data: everything user/PC-derived goes through text nodes. */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  LC.pages = LC.pages || {};

  /* ------------------------------------------------------------------ DOM builder */
  const add = (el, c) => {
    if (c == null || c === false || c === true) return;
    if (Array.isArray(c)) c.forEach((x) => add(el, x));
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  LC.h = (tag, props, ...children) => {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') el.value = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    children.forEach((c) => add(el, c));
    return el;
  };
  const h = LC.h;

  /* ------------------------------------------------------------------ icons (constant markup only) */
  const ICONS = {
    laptop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
    memory: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    storage: '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
    battery: '<rect x="1" y="6" width="18" height="12" rx="2"/><line x1="23" y1="13" x2="23" y2="11"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    package: '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    sun: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    link: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    left: '<polyline points="15 18 9 12 15 6"/>',
    right: '<polyline points="9 18 15 12 9 6"/>',
    down: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    up: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    tasks: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    windows: '<rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    branch: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    chevron: '<polyline points="6 9 12 15 18 9"/>',
    menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    flag: '<path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/>',
  };
  LC.icon = (name, cls) => {
    const t = document.createElement('template');
    t.innerHTML = '<svg class="icon ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
    return t.content.firstChild;
  };

  const SEV_SHAPE = {
    ok: '<circle class="shape" cx="12" cy="12" r="10.5"/><path class="glyph" d="M7 12.5l3.5 3.5 6.5-7.5"/>',
    info: '<circle class="shape" cx="12" cy="12" r="10.5"/><path class="glyph" d="M12 11v6M12 7.3h.01"/>',
    warn: '<path class="shape" d="M12 2.5L22.5 21H1.5z"/><path class="glyph" d="M12 9.5v5.5M12 18.3h.01"/>',
    critical: '<path class="shape" d="M8 1.5h8l6.5 6.5v8L16 22.5H8L1.5 16V8z"/><path class="glyph" d="M12 7v6.5M12 17h.01"/>',
  };
  /** Severity marker: shape AND glyph differ per level, so colour is never the only signal. */
  LC.sevIcon = (sev, big) => {
    const t = document.createElement('template');
    const label = LC.SEV_LABEL ? LC.SEV_LABEL[sev] : sev;
    t.innerHTML = '<svg class="sev sev-' + sev + (big ? ' lg' : '') + '" viewBox="0 0 24 24" role="img" aria-label="' + label + '">' + (SEV_SHAPE[sev] || SEV_SHAPE.info) + '</svg>';
    return t.content.firstChild;
  };
  LC.chip = (sev, text, title) => h('span', { class: 'chip', title: title || null }, LC.sevIcon(sev), text);
  LC.badge = (text, cls, title) => h('span', { class: 'badge ' + (cls || ''), title: title || null }, text);

  /* ------------------------------------------------------------------ components */
  LC.card = (title, icon, children, extras) =>
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        icon ? h('span', { class: 'icon-badge' }, LC.icon(icon, 'lg')) : null,
        h('h3', null, title),
        extras || null),
      children);

  /* Every card with a heading can be folded away; what you folded stays folded (per page, in this browser). */
  const COLL_KEY = 'lc-collapsed';
  let collSet = null;
  const collapsedSet = () => {
    if (!collSet) { try { collSet = new Set(JSON.parse(localStorage.getItem(COLL_KEY) || '[]')); } catch (e) { collSet = new Set(); } }
    return collSet;
  };
  const saveCollapsed = () => { try { localStorage.setItem(COLL_KEY, JSON.stringify([...collapsedSet()])); } catch (e) { /* storage may be unavailable */ } };
  let collSeq = 0;
  LC.enhanceCards = (root, route) => {
    const set = collapsedSet();
    const cards = [...root.querySelectorAll('.card')].filter((c) => {
      const head = c.firstElementChild;
      return head && head.classList.contains('card-head') && head.querySelector('h3') && !c.classList.contains('hero') && !c.classList.contains('collapsible');
    });
    const setters = [];
    for (const card of cards) {
      const head = card.firstElementChild;
      const title = head.querySelector('h3').textContent.trim();
      const key = route + ':' + title.replace(/[\d.,]+/g, '#');
      const body = h('div', { class: 'card-body', id: 'cb-' + (++collSeq) });
      while (head.nextSibling) body.appendChild(head.nextSibling);
      card.appendChild(body);
      const btn = h('button', { class: 'card-toggle', type: 'button', 'aria-controls': body.id }, LC.icon('chevron'));
      head.appendChild(btn);
      card.classList.add('collapsible');
      const apply = (c) => {
        card.classList.toggle('collapsed', c);
        btn.setAttribute('aria-expanded', String(!c));
        btn.setAttribute('aria-label', (c ? 'Aufklappen: ' : 'Einklappen: ') + title);
        btn.title = c ? 'Aufklappen' : 'Einklappen';
      };
      const set1 = (c) => { if (c) set.add(key); else set.delete(key); apply(c); };
      apply(set.has(key));
      setters.push(set1);
      const toggle = () => { set1(!card.classList.contains('collapsed')); saveCollapsed(); };
      btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
      head.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, select, textarea, label, summary, [role="button"]')) toggle(); });
    }
    // (no "collapse all / expand all" buttons any more: every card has its own fold button, and fewer buttons are easier to read)
  };

  /** A "Mehr" button that opens a small list of the rarely needed actions. items: buttons; empty -> null. */
  LC.moreMenu = (items, opts) => {
    items = items.filter(Boolean);
    if (!items.length) return null;
    opts = opts || {};
    const menu = h('div', { class: 'more-menu' }, items);
    menu.addEventListener('click', (e) => { if (e.target.closest('button, a')) menu.parentElement.open = false; });
    return h('details', { class: 'more' }, h('summary', { class: 'btn sm' + (opts.ghost ? ' ghost' : ''), title: 'Weitere Aktionen' }, LC.icon('more'), opts.label || 'Mehr'), menu);
  };
  // a menu closes when you click elsewhere or press Esc
  if (typeof document !== 'undefined') {
    const closeMenus = (except) => document.querySelectorAll('details.more[open]').forEach((d) => { if (d !== except) d.open = false; });
    document.addEventListener('click', (e) => closeMenus(e.target.closest('details.more')));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(null); });
  }

  LC.kv = (pairs) => {
    const dl = h('dl', { class: 'kv' });
    pairs.filter(Boolean).forEach(([k, v]) => {
      if (v == null || v === '') v = h('span', { class: 'muted' }, '–');
      dl.appendChild(h('dt', null, k));
      dl.appendChild(h('dd', null, v));
    });
    return dl;
  };

  /** Segmented horizontal bar. segs: [{pct, cls, title}] */
  LC.meter = (segs, tall) => {
    const m = h('div', { class: 'meter' + (tall ? ' tall' : ''), role: 'img', 'aria-label': segs.map((s) => s.title).filter(Boolean).join(', ') });
    segs.forEach((s) => {
      if (!(s.pct > 0)) return;
      const i = h('i', { class: s.cls || '', title: s.title || null });
      i.style.width = Math.max(0.5, Math.min(100, s.pct)) + '%';
      m.appendChild(i);
    });
    return m;
  };

  /** Score donut. */
  LC.ring = (score, sev) => {
    const r = 64, c = 2 * Math.PI * r;
    const col = sev === 'critical' ? 'var(--critical)' : sev === 'warn' ? 'var(--warning)' : sev === 'ok' ? 'var(--good)' : 'var(--accent)';
    const t = document.createElement('template');
    t.innerHTML = '<svg viewBox="0 0 156 156" aria-hidden="true"><circle class="track" cx="78" cy="78" r="' + r + '" fill="none" stroke-width="14"/><circle class="val" cx="78" cy="78" r="' + r + '" fill="none" stroke-width="14" stroke-linecap="round" stroke="' + col + '" stroke-dasharray="' + (c * score) / 100 + ' ' + c + '"/></svg>';
    return h('div', { class: 'ring', role: 'img', 'aria-label': 'Gesamtwert ' + score + ' von 100' },
      t.content.firstChild,
      h('div', { class: 'center' }, h('div', null, h('div', { class: 'big num' }, String(score)), h('div', { class: 'cap' }, 'von 100'))));
  };

  /** Sparkline with hover tooltip. points: [{label, v}] */
  LC.sparkline = (points, fmt) => {
    const pts = points.filter((p) => p.v != null);
    const wrap = h('div', { class: 'spark-wrap' });
    if (pts.length < 2) {
      wrap.appendChild(h('div', { class: 'muted small' }, 'Verlauf erscheint ab dem zweiten Scan.'));
      return wrap;
    }
    const W = 240, H = 56, pad = 6;
    const vs = pts.map((p) => p.v);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi === lo) { hi += 1; lo -= 1; }
    const x = (i) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
    const y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
    const area = line + ' L' + x(pts.length - 1).toFixed(1) + ' ' + H + ' L' + x(0).toFixed(1) + ' ' + H + ' Z';
    const t = document.createElement('template');
    t.innerHTML = '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Verlauf"><path class="area" d="' + area + '"/><path class="line" d="' + line + '"/></svg>';
    const svg = t.content.firstChild;
    const tip = h('div', { class: 'tooltip', hidden: true });
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'dot'); dot.setAttribute('r', '4'); dot.setAttribute('cx', x(pts.length - 1)); dot.setAttribute('cy', y(pts[pts.length - 1].v));
    svg.appendChild(dot);
    svg.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const rel = (e.clientX - rect.left) / rect.width;
      const i = LC.clamp(Math.round(rel * (pts.length - 1)), 0, pts.length - 1);
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(pts[i].v));
      tip.hidden = false;
      tip.textContent = pts[i].label + ': ' + (fmt ? fmt(pts[i].v) : pts[i].v);
      tip.style.left = (x(i) / W) * 100 + '%';
      tip.style.top = (y(pts[i].v) / H) * 56 + 'px';
    });
    svg.addEventListener('mouseleave', () => { tip.hidden = true; dot.setAttribute('cx', x(pts.length - 1)); dot.setAttribute('cy', y(pts[pts.length - 1].v)); });
    wrap.appendChild(svg);
    wrap.appendChild(tip);
    return wrap;
  };

  /* ------------------------------------------------------------------ findings */
  LC.copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      ta.remove();
    }
    LC.toast('In die Zwischenablage kopiert');
  };
  LC.copyButton = (text, label) => h('button', { class: 'btn sm', type: 'button', onclick: () => LC.copyText(text) }, LC.icon('copy'), label || 'Kopieren');

  /* "Open this place in Windows" - the local server starts a fixed set of harmless Windows tools / settings pages. */
  LC.openWindows = async (id, copy) => {
    const t = LC.OPEN_TARGETS[id];
    if (!t) return;
    if (copy) { try { await navigator.clipboard.writeText(copy); } catch (e) { /* ignore */ } }
    try {
      await LC.app.api('/api/open?target=' + encodeURIComponent(id), { method: 'POST' });
      LC.toast(t.label.replace(/ öffnen$/, '') + ' wird geöffnet …' + (copy ? ' (Befehl liegt in der Zwischenablage: Rechtsklick/Strg+V zum Einfügen)' : ''), copy ? 5000 : 2600);
    } catch (e) {
      LC.toast('Konnte nicht automatisch geöffnet werden. Drücke Win + R und gib ein: ' + t.uri, 7000);
    }
  };
  LC.openButton = (id, opts) => {
    opts = opts || {};
    const t = LC.OPEN_TARGETS[id];
    if (!t) return null;
    return h('button', { class: 'btn sm' + (opts.ghost ? ' ghost' : ''), type: 'button', title: 'Öffnet das direkt in Windows', onclick: () => LC.openWindows(id, opts.copy) }, LC.icon('link'), opts.label || t.label);
  };

  /** "Update now": lists what will be updated, then starts winget (own window) on request. updates: [{id,name,from,to}] */
  LC.updatesDialog = (updates, opts) => {
    opts = opts || {};
    const list = updates.slice(0, 80);
    let dlg;
    const go = h('button', { class: 'btn primary', type: 'button', onclick: async () => { dlg.close(); await LC.app.wingetUpgrade(opts.all ? { all: true } : { ids: updates.map((u) => u.id) }); } }, LC.icon('refresh'), opts.all ? 'Alle aktualisieren' : 'Jetzt aktualisieren');
    dlg = LC.modal({
      title: opts.all ? updates.length + ' Programme aktualisieren' : (updates[0] ? updates[0].name + ' aktualisieren' : 'Aktualisieren'),
      body: h('div', { class: 'stack', style: { gap: '10px' } },
        h('p', null, 'Ein eigenes Fenster startet ', h('span', { class: 'code' }, opts.all ? 'winget upgrade --all' : 'winget upgrade --id …'), ' und zeigt den Fortschritt. Windows fragt bei Programmen mit Admin-Bedarf selbst nach. Laufende Programme werden dabei ggf. geschlossen – speichere vorher deine Arbeit.'),
        h('ul', { class: 'reasons' }, list.map((u) => h('li', null, h('b', null, u.name), (u.from || u.to) ? ' ' + (u.from || '?') + ' → ' + (u.to || '?') : ''))),
        updates.length > list.length ? h('div', { class: 'small muted' }, '… und ' + (updates.length - list.length) + ' weitere') : null),
      actions: [h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Abbrechen'), go],
    });
  };

  /** Body of a finding (title, detail, action, steps, command, links) without the severity icon. */
  LC.findingBody = (f, opts) => {
    opts = opts || {};
    return h('div', null,
      opts.noTitle ? null : h('div', { class: 'f-title' }, f.title),
      f.detail ? h('div', { class: 'f-detail' }, f.detail) : null,
      f.action ? h('div', { class: 'f-action' }, h('b', null, 'Empfehlung: '), f.action) : null,
      f.steps && f.steps.length ? h('ol', { class: 'steps' }, f.steps.map((s) => h('li', null, s))) : null,
      f.command ? h('div', { class: 'codeblock' }, h('span', { class: 'code' }, f.command), LC.copyButton(f.command, 'Kopieren')) : null,
      (f.links || []).length ? h('div', { class: 'row', style: { marginTop: '6px' } }, f.links.map((l) => h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.label, ' ↗'))) : null,
      f.run && f.run.type === 'winget' ? h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn primary sm', type: 'button', title: 'Startet winget in einem eigenen Fenster', onclick: () => LC.updatesDialog(f.run.items, { all: true }) }, LC.icon('refresh'), 'Jetzt alle aktualisieren')) : null,
      (f.open || []).length ? h('div', { class: 'row', style: { marginTop: '8px' } }, f.open.map((id) => LC.openButton(id, { copy: id === 'terminal' ? f.command : null }))) : null,
      opts.extra || null);
  };
  LC.findingBlock = (f, opts) => h('div', { class: 'finding' }, LC.sevIcon(f.severity, true), LC.findingBody(f, opts));

  /** "Handlungsempfehlung" box shown at the bottom of every hardware card. */
  LC.recoBox = (findings, okText) => {
    const open = findings.filter((f) => f.severity !== 'ok');
    const oks = findings.filter((f) => f.severity === 'ok');
    const box = h('div', { class: 'reco' }, h('h4', null, 'Handlungsempfehlung'));
    if (!open.length) {
      box.appendChild(oks.length ? LC.findingBlock({ severity: 'ok', title: oks[0].title, detail: oks[0].detail, action: oks[0].action }) : LC.findingBlock({ severity: 'ok', title: 'Nichts zu tun', detail: okText || '', action: '' }));
    } else open.forEach((f) => box.appendChild(LC.findingBlock(f)));
    return box;
  };

  /* ------------------------------------------------------------------ modal */
  /** opts: { title, body (Node), actions: [Node], wide, onClose } -> { close, el } . Esc / backdrop close it. */
  LC.modal = (opts) => {
    const rootEl = document.getElementById('modal-root');
    const prevFocus = document.activeElement;
    const close = () => { rootEl.replaceChildren(); document.removeEventListener('keydown', onKey, true); if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus(); if (opts.onClose) opts.onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    const dlg = h('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
      h('div', { class: 'modal-head' }, h('h3', null, opts.title), h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Schließen', onclick: close }, LC.icon('x'))),
      h('div', { class: 'modal-body' }, opts.body),
      h('div', { class: 'modal-foot' }, opts.actions || []));
    rootEl.replaceChildren(h('div', { class: 'modal-scrim', onclick: close }), dlg);
    dlg.setAttribute('tabindex', '-1');
    dlg.focus({ preventScroll: true });
    return { close, el: dlg };
  };

  /* ------------------------------------------------------------------ toast, download, csv */
  LC.toast = (msg, ms) => {
    const root = document.getElementById('toasts');
    if (!root) return;
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    root.appendChild(t);
    setTimeout(() => t.remove(), ms || 2600);
  };
  LC.download = (name, text, mime) => {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
})(typeof window !== 'undefined' ? window : globalThis);
