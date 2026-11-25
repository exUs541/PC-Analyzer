/* page-software.js - the software inventory table, inline editing and the detail drawer. */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h } = LC;

  const isFlagged = (a) => { const r = LC.app && LC.app.S.notes.reviews && LC.app.S.notes.reviews['app:' + a.key]; return !!r && r.status !== 'checked'; };
  const SRC_LABEL = {
    UserAssist: 'Windows-Startverlauf',
    AppCompat: 'Windows-Kompatibilitätsverlauf',
    Prefetch: 'Prefetch (kann ein Hintergrundstart sein)',
    MuiCache: 'MuiCache (ohne Datum)',
    manual: 'von dir eingetragen',
    'Cloud-Ordner': 'Letzte Änderung im Cloud-Ordner (Synchronisation)',
  };
  const DATE_SRC = { registry: 'Installationsdatum laut Programm', folder: 'geschätzt: Erstellungsdatum des Programmordners', keytime: 'geschätzt: letzte Änderung des Registry-Eintrags', manual: 'von dir eingetragen' };
  const CLASS_LABEL = { background: 'im Hintergrund', active: 'aktiv', occasional: 'gelegentlich', rare: 'selten', unused: 'ungenutzt', unknown: 'unbekannt', notrace: 'nicht erkennbar', 'n/a': '–' };
  const RANK = LC.LEVEL_RANK;

  const FILTERS = [
    { id: 'programs', label: 'Programme', fn: (a) => a.applicable, always: true, main: true },
    { id: 'all', label: 'Alle', fn: () => true, always: true },
    { id: 'missing', label: 'Info fehlt', fn: (a) => a.missing.length > 0 && (a.applicable || a.missing.some((x) => x !== 'purpose' && x !== 'lastUsed')), always: true },
    { id: 'purpose', label: '„Wofür?“ fehlt', fn: (a) => a.applicable && !a.purpose, always: true },
    { id: 'unused', label: 'Ungenutzt', fn: (a) => a.usageClass === 'unused', main: true },
    { id: 'rare', label: 'Selten', fn: (a) => a.usageClass === 'rare' },
    { id: 'review', label: 'Zu prüfen', fn: (a) => a.reco.level === 'warn' || a.reco.level === 'critical' },
    { id: 'critical', label: 'Unerwünscht', fn: (a) => a.reco.level === 'critical', main: true },
    { id: 'eol', label: 'Veraltet', fn: (a) => a.reco.reasons.some((r) => r.tag === 'eol') },
    { id: 'dups', label: 'Doppelt', fn: (a) => a.isOlderDuplicate },
    { id: 'updates', label: 'Update verfügbar', fn: (a) => !!a.update, main: true },
    { id: 'startup', label: 'Autostart', fn: (a) => !!(a.startup && a.startup.enabled), main: true },
    { id: 'review', label: '⚑ Zur Prüfung markiert', fn: (a) => isFlagged(a) },
    { id: 'remove', label: 'Von mir markiert', fn: (a) => a.decision === 'remove' || a.decision === 'review' },
    { id: 'components', label: 'Komponenten & Treiber', fn: (a) => !a.applicable, always: true },
  ];

  const SORTS = {
    name: { label: 'Name', cmp: (a, b) => a.name.localeCompare(b.name, 'de') },
    size: { label: 'Größe', cmp: (a, b) => (b.sizeKB || 0) - (a.sizeKB || 0), dir: 1 },
    lastUsed: { label: 'Zuletzt genutzt', cmp: (a, b) => (a.lastUsed ? Date.parse(a.lastUsed) : -Infinity) - (b.lastUsed ? Date.parse(b.lastUsed) : -Infinity) },
    installDate: { label: 'Installiert', cmp: (a, b) => (a.installDate ? Date.parse(a.installDate) : -Infinity) - (b.installDate ? Date.parse(b.installDate) : -Infinity) },
    reco: { label: 'Empfehlung', cmp: (a, b) => RANK[b.reco.level] - RANK[a.reco.level] || a.name.localeCompare(b.name, 'de') },
  };

  function matchesQuery(a, q) {
    if (!q) return true;
    const hay = [a.name, a.publisher, a.description, a.purpose, a.category, a.version, a.note].filter(Boolean).join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
  }

  LC.pages.software = (S, app) => {
    const m = S.model;
    const apps = m.inv.apps;
    const sw = S.sw;
    const filter = FILTERS.find((f) => f.id === sw.filter) || FILTERS[0];

    let list = apps.filter(filter.fn).filter((a) => matchesQuery(a, sw.q));
    const cats = [...new Set(list.map((a) => a.category))].sort((a, b) => a.localeCompare(b, 'de'));
    if (sw.cat) list = list.filter((a) => a.category === sw.cat);
    const sorter = SORTS[sw.sort] || SORTS.name;
    list = list.slice().sort((a, b) => sorter.cmp(a, b) * (sw.dir || 1));
    S.swList = list.map((a) => a.id);

    /* ---- toolbar */
    const search = h('input', { type: 'search', placeholder: 'Suchen in Name, Herausgeber, Beschreibung, Zweck …', value: sw.q, 'aria-label': 'Suchen' });
    search.addEventListener('input', (e) => { sw.q = e.target.value; clearTimeout(search._t); search._t = setTimeout(() => { app.render(); const el = document.querySelector('.sw-toolbar input[type=search]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 180); });
    const catSel = h('select', { 'aria-label': 'Kategorie', style: { width: 'auto' }, onchange: (e) => { sw.cat = e.target.value; app.render(); } },
      h('option', { value: '' }, 'Alle Kategorien'), cats.map((c) => h('option', { value: c, selected: sw.cat === c ? true : null }, c)));
    const sortSel = h('select', { 'aria-label': 'Sortierung', style: { width: 'auto' }, onchange: (e) => { sw.sort = e.target.value; sw.dir = e.target.value === 'name' || e.target.value === 'reco' ? 1 : -1; if (e.target.value === 'size') sw.dir = 1; app.render(); } },
      Object.entries(SORTS).map(([id, s]) => h('option', { value: id, selected: sw.sort === id ? true : null }, 'Sortiert nach: ' + s.label)));
    // five filters are always shown; the rest is behind "Weitere Filter" (open while one of them is active)
    const chip = (f) => {
      const n = apps.filter(f.fn).length;
      if (!n && !f.always && sw.filter !== f.id) return null;
      return h('button', { class: 'fchip', type: 'button', 'aria-pressed': String(sw.filter === f.id), onclick: () => { sw.filter = f.id; sw.cat = ''; app.render(); } }, f.label, h('span', { class: 'n' }, String(n)));
    };
    const otherActive = FILTERS.some((f) => !f.main && f.id === sw.filter);
    const chips = h('div', null,
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter' }, FILTERS.filter((f) => f.main).map(chip)),
      h('details', { class: 'more-filters', open: otherActive ? true : null, style: { marginTop: '8px' } },
        h('summary', { class: 'small' }, LC.icon('chevron'), ' Weitere Filter'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Weitere Filter', style: { marginTop: '8px' } }, FILTERS.filter((f) => !f.main).map(chip))));

    const st = m.stats;
    const toolbar = h('div', { class: 'sw-toolbar' },
      h('div', { class: 'line' },
        h('div', { class: 'search' }, LC.icon('search'), search), catSel, sortSel,
        h('span', { class: 'header-spacer', style: { flex: 1 } }),
        h('button', { class: 'btn sm', type: 'button', onclick: () => exportCsv(apps), title: 'Alle Programme mit deinen Angaben als Tabelle (Excel)' }, LC.icon('down'), 'CSV-Export')),
      chips);

    const summary = h('div', { class: 'row small muted', style: { marginBottom: '8px' } },
      h('span', null, 'Zeige ' + list.length + ' von ' + apps.length + ' Einträgen'),
      h('span', null, '· ' + st.programs + ' Programme, ' + st.components + ' Komponenten/Treiber'),
      st.unused ? h('span', null, '· ' + st.unused + ' ungenutzt' + (st.unusedKB ? ' (≈ ' + LC.fmtKB(st.unusedKB) + ')' : '')) : null,
      !m.inv.hasUsageData ? h('span', { class: 'badge warn' }, 'Keine Nutzungsdaten von Windows') : null);

    /* ---- table */
    const th = (id, label, sortable) => {
      const active = sw.sort === id;
      return h('th', { scope: 'col', 'aria-sort': sortable ? (active ? (sw.dir === 1 ? 'ascending' : 'descending') : 'none') : null, onclick: sortable ? () => { if (sw.sort === id) sw.dir = -sw.dir; else { sw.sort = id; sw.dir = id === 'name' || id === 'reco' || id === 'size' ? 1 : -1; } app.render(); } : null },
        label, active ? h('span', { class: 'arrow' }, sw.dir === 1 ? '▲' : '▼') : null);
    };
    const tbody = h('tbody');
    list.forEach((a) => tbody.appendChild(row(a, S, app)));
    const table = h('table', { class: 'sw' },
      h('thead', null, h('tr', null, th('name', 'Programm / Herausgeber', true), th('installDate', 'Installiert', true), th('lastUsed', 'Zuletzt genutzt', true), th('size', 'Größe', true), h('th', { scope: 'col' }, 'Was macht es?'), h('th', { scope: 'col' }, 'Wofür nutze ich es?'), th('reco', 'Empfehlung', true))),
      tbody);

    const empty = h('div', { class: 'empty' }, list.length ? '' : apps.length ? 'Nichts gefunden – Filter oder Suche anpassen.' : 'Keine Software erkannt (siehe Daten → Datenlücken).');

    const startupCard = startupSection(m);

    const intro = h('div', { class: 'page-title' }, h('h2', null, 'Programme'), h('p', null, 'Alles, was installiert ist. Klicke eine Zeile an für Details, oder um ein Programm zum Entfernen vorzumerken.'));
    return h('div', null, intro, toolbar, summary, h('div', { class: 'table-wrap' }, table, list.length ? null : empty), h('div', { style: { marginTop: '16px' } }, startupCard));
  };

  function dateCell(iso, srcKey, estimate) {
    if (!iso) return h('span', { class: 'missing' }, 'unbekannt');
    return h('span', { class: 'num', title: DATE_SRC[srcKey] || '' }, (estimate ? '≈ ' : '') + LC.fmtDate(iso));
  }

  function row(a, S, app) {
    const tr = h('tr', { class: S.drawerId === a.id ? 'sel' : '', tabindex: '0', 'aria-label': a.name + ' – Details öffnen', onclick: (e) => { if (e.target.closest('.cell-edit, button, a, input')) return; openDrawer(a.id, S, app); }, onkeydown: (e) => { if (e.key === 'Enter' && e.target === tr) openDrawer(a.id, S, app); } });
    // name
    tr.appendChild(h('td', { 'data-label': 'Programm' },
      h('div', { class: 'sw-name' }, a.name,
        a.version && a.source === 'registry' && a.applicable ? h('span', { class: 'sw-sub' }, a.version.length > 14 ? a.version.slice(0, 14) + '…' : a.version) : null,
        a.source === 'store' ? LC.badge('Store', '') : null,
        a.update ? LC.badge('Update', 'manual', a.update.from + ' → ' + a.update.to) : null,
        a.startup && a.startup.enabled ? LC.badge('Autostart', '') : null,
        a.decision === 'keep' ? LC.badge('behalten', 'manual') : null,
        isFlagged(a) ? LC.badge('⚑ zu prüfen', 'manual', 'Zur Prüfung markiert – siehe Seite „Prüfen“') : null),
      h('div', { class: 'sw-sub' }, a.publisher || h('span', { class: 'missing' }, 'Herausgeber unbekannt'), ' · ', a.category)));
    // installed
    const est = a.installDateSource === 'folder' || a.installDateSource === 'keytime';
    tr.appendChild(h('td', { 'data-label': 'Installiert' }, dateCell(a.installDate, a.installDateSource, est)));
    // last used
    let lu;
    if (a.lastUsed) {
      const src = a.lastUsedSource === 'manual' ? 'manual' : a.lastUsedSource;
      lu = h('div', { title: (SRC_LABEL[src] || '') + (a.lastUsedConfidence === 'medium' ? ' – Zuordnung wahrscheinlich, nicht sicher' : a.lastUsedConfidence === 'low' ? ' – unsicher' : '') },
        h('span', { class: 'num' }, LC.fmtDate(a.lastUsed)), h('div', { class: 'sw-sub' }, LC.fmtAgo(a.daysUnused), a.lastUsedSource === 'manual' ? ' · von dir' : a.lastUsedConfidence && a.lastUsedConfidence !== 'high' ? ' · unsicher' : ''));
    } else if (!a.applicable) lu = h('span', { class: 'muted' }, '–');
    else if (a.usageClass === 'background') lu = h('span', { class: 'muted', title: 'Arbeitet im Hintergrund – Windows sieht dabei keine Starts' }, 'läuft im Hintergrund');
    else if (a.usageClass === 'notrace') lu = h('span', { class: 'missing', title: 'Wird über die Kommandozeile oder einen Launcher gestartet – das sieht Windows nicht' }, 'nicht erkennbar');
    else lu = h('span', { class: 'missing', title: a.everLaunched ? 'Wurde schon einmal gestartet, aber ohne Zeitpunkt' : 'Windows hat keine Spur einer Nutzung gespeichert' }, a.everLaunched ? 'schon gestartet, Datum fehlt' : 'unbekannt');
    tr.appendChild(h('td', { 'data-label': 'Zuletzt genutzt' }, lu));
    // size
    tr.appendChild(h('td', { 'data-label': 'Größe', class: 'num nowrap' },
      a.sizeSuspect ? h('span', { class: 'badge warn', title: (a.sizeSource === 'registry' ? 'Der Installer meldet ' : 'Der Installationsordner ist ') + LC.fmtKB(a.sizeClaimedKB) + ' groß – das ist für dieses Programm unplausibel (Installer tragen manchmal Bytes statt KB ein; ein Ordner kann zu weit gefasst sein). Wird nicht mitgezählt.' }, 'unplausibel')
        : a.sizeKB ? [(a.sizeApprox ? '≥ ' : '') + LC.fmtKB(a.sizeKB), a.sizeCorrected ? h('span', { class: 'badge warn', style: { marginLeft: '6px' }, title: 'Der Installer meldet ' + LC.fmtKB(a.sizeClaimedKB) + ' – nachgemessen wurde der Installationsordner.' }, 'korrigiert') : null]
        : h('span', { class: 'muted' }, '–')));
    // description
    tr.appendChild(h('td', { 'data-label': 'Was macht es' }, a.description
      ? h('div', { class: 'clamp2', title: a.description + (a.descriptionSource === 'kb' ? '\n(automatisch vermutet)' : '') }, a.description)
      : h('button', { class: 'cell-edit', type: 'button', onclick: (ev) => { ev.stopPropagation(); openDrawer(a.id, S, app, 'description'); } }, h('span', { class: 'missing' }, LC.icon('plus'), 'Beschreibung ergänzen'))));
    // purpose (inline edit)
    tr.appendChild(h('td', { 'data-label': 'Wofür' }, purposeCell(a, app)));
    // recommendation
    const r = a.reco;
    tr.appendChild(h('td', { 'data-label': 'Empfehlung' },
      LC.chip(r.level, r.label, r.primary || ''),
      r.primary && r.level !== 'ok' ? h('div', { class: 'sw-sub clamp2', style: { marginTop: '4px', minWidth: '170px' }, title: r.primary }, r.primary) : null));
    return tr;
  }

  function purposeCell(a, app) {
    const btn = h('button', { class: 'cell-edit', type: 'button', title: 'Klicken zum Bearbeiten' });
    const show = () => {
      btn.replaceChildren(a.purpose ? h('span', null, a.purpose) : h('span', { class: 'missing' }, a.applicable ? [LC.icon('plus'), 'hinzufügen'] : '–'));
    };
    show();
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();                         // the row click would open the drawer
      if (!a.applicable && !a.purpose) return;
      const input = h('input', { type: 'text', value: a.purpose || '', placeholder: 'z. B. Steuererklärung, Uni, Hobby …', 'aria-label': 'Wofür nutze ich ' + a.name });
      let done = false;
      const commit = (save) => {
        if (done) return; done = true;
        if (!input.isConnected) return;                 // removed by a re-render: nothing left to save or restore
        if (save && input.value.trim() !== (a.purpose || '')) app.setAppField(a.key, 'purpose', input.value);
        else show();                                    // unchanged / cancelled: just restore the label (no re-render inside a blur)
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(true); else if (e.key === 'Escape') commit(false); });
      input.addEventListener('blur', () => commit(true));
      btn.replaceChildren(input);
      input.focus();
    });
    return btn;
  }

  /* ------------------------------------------------------------------ startup section */
  function startupSection(m) {
    const items = LC.asArray(m.snap.startup);
    const byItem = new Map();
    m.inv.apps.forEach((a) => { if (a.startup) a.startup.items.forEach((i) => byItem.set(i.name + '|' + i.command, a)); });
    const rows = items.map((s) => {
      const a = byItem.get(s.name + '|' + s.command);
      return h('tr', { style: { cursor: 'default' } },
        h('td', null, h('b', null, s.name)),
        h('td', null, s.enabled ? LC.chip('info', 'aktiv') : LC.chip('ok', 'deaktiviert')),
        h('td', null, a ? a.name : h('span', { class: 'muted' }, 'keinem Programm zugeordnet')),
        h('td', { class: 'small muted' }, s.location + (s.scope === 'machine' ? ' (alle Benutzer)' : '')),
        h('td', null, h('span', { class: 'code' }, s.command)));
    });
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('power', 'lg')), h('h3', null, 'Autostart (' + items.filter((s) => s.enabled).length + ' von ' + items.length + ' aktiv)'),
        h('div', { class: 'row' }, LC.openButton('startup-apps'), LC.openButton('task-manager'))),
      items.length ? [
        h('p', { class: 'small ink2' }, 'Diese Einträge starten mit Windows. Abschalten geht im Task-Manager (Strg + Umschalt + Esc → Autostart); das Programm bleibt installiert.'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'sw', style: { minWidth: '720px' } }, h('thead', null, h('tr', null, ['Eintrag', 'Status', 'Gehört zu', 'Ort', 'Befehl'].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, rows)))]
        : h('div', { class: 'muted' }, 'Keine Autostart-Einträge gefunden.'));
  }

  /* ------------------------------------------------------------------ csv */
  function exportCsv(apps) {
    const head = ['Name', 'Version', 'Herausgeber', 'Installiert am', 'Zuletzt genutzt', 'Quelle (zuletzt genutzt)', 'Größe (MB)', 'Kategorie', 'Art', 'Was macht es?', 'Wofür nutze ich es?', 'Entscheidung', 'Empfehlung', 'Begründung', 'Notiz'];
    const dec = { keep: 'Behalten', review: 'Später prüfen', remove: 'Entfernen' };
    const rows = [head].concat(apps.map((a) => [a.name, a.version, a.publisher, a.installDate ? a.installDate.slice(0, 10) : '', a.lastUsed ? a.lastUsed.slice(0, 10) : '', a.lastUsedSource || '', a.sizeKB ? Math.round(a.sizeKB / 1024) : '', a.category, a.applicable ? 'Programm' : 'Komponente', a.description, a.purpose, dec[a.decision] || '', a.reco.label, a.reco.primary, a.note]));
    LC.download('laptopcheck-software-' + new Date().toISOString().slice(0, 10) + '.csv', LC.csv(rows), 'text/csv;charset=utf-8');
  }

  /* ------------------------------------------------------------------ drawer */
  function openDrawer(id, S, app, focusField) {
    S.drawerId = id;
    S.drawerFocus = focusField || null;
    LC.pages.drawer(S, app);
    document.querySelectorAll('table.sw tbody tr.sel').forEach((r) => r.classList.remove('sel'));
  }

  /** "Wo und wie wird es verwendet? Was hängt daran?" - same component as on the clean-up page. */
  function relationsSection(S, app, a) {
    const rel = S.model.relationsOf(a);
    const sm = rel.summary;
    const notable = sm.breaks + sm.data + sm.degrades + sm.orphan + sm.leftover;
    return h('details', { class: 'rel-details', open: a.decision === 'remove' || sm.breaks > 0 ? true : null },
      h('summary', null, LC.icon('chevron'), ' Wo wird es verwendet? Was hängt daran?', notable ? ' ' : '', notable ? LC.badge(notable + ' relevant', 'warn') : null),
      h('div', { style: { marginTop: '10px' } },
        a.decision === 'remove' ? h('div', { class: 'callout', style: { marginBottom: '10px' } }, 'Dieses Programm steht zum Entfernen auf der Aufräumliste. ', h('button', { class: 'btn sm', type: 'button', onclick: () => { S.drawerId = null; app.go('cleanup', { open: 'app:' + a.key }); } }, LC.icon('trash'), 'Zur Aufräumliste')) : null,
        LC.relationsPanel(rel, {
          onReveal: (p) => app.reveal(p),
          onOpenApp: (key) => { const x = S.model.inv.apps.find((q) => q.key === key); if (x) { S.drawerId = x.id; LC.pages.drawer(S, app); } },
          onOpenProject: (id) => { S.drawerId = null; app.go('projects', { open: id }); },
        })));
  }

  let escBound = false;
  LC.pages.drawer = (S, app) => {
    const root = document.getElementById('drawer-root');
    root.replaceChildren();
    if (!S.drawerId || !S.model) return;
    const getApp = () => S.model.inv.apps.find((x) => x.id === S.drawerId);
    const a0 = getApp();
    if (!a0) { S.drawerId = null; return; }
    const key = a0.key;

    const close = () => { S.drawerId = null; root.replaceChildren(); };
    if (!escBound) { escBound = true; document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.drawerId) { S.drawerId = null; document.getElementById('drawer-root').replaceChildren(); } }); }

    const list = S.swList || [];
    const idx = list.indexOf(S.drawerId);
    const go = (d) => { const n = list[idx + d]; if (n) { S.drawerId = n; LC.pages.drawer(S, app); } };

    const manual = (field) => (S.notes.apps[key] || {})[field];
    const autoOf = {
      publisher: () => getApp().publisherAuto,
      installDate: () => getApp().installDateAuto,
      lastUsed: () => getApp().lastUsedAuto,
      category: () => getApp().categoryAuto,
      description: () => getApp().descriptionAuto,
    };

    /** One editable row with "automatisch / von dir / fehlt" badge and reset. */
    const field = (label, f, type, opts) => {
      opts = opts || {};
      const a = getApp();
      const isManual = manual(f) != null && manual(f) !== '';
      const autoVal = autoOf[f] ? autoOf[f]() : null;
      const effective = isManual ? manual(f) : autoVal;
      let input;
      const toVal = (v) => (type === 'date' ? LC.toDateInput(v) : v || '');
      if (type === 'textarea') input = h('textarea', { rows: opts.rows || 3, placeholder: opts.placeholder || '', 'data-field': f });
      else if (type === 'select') input = h('select', { 'data-field': f }, (opts.options || []).map((o) => h('option', { value: o }, o)));
      else input = h('input', { type: type || 'text', placeholder: opts.placeholder || '', 'data-field': f });
      input.value = toVal(effective);
      const badge = h('span');
      const resetBtn = h('button', { class: 'btn ghost sm', type: 'button', title: 'Auf den automatisch erkannten Wert zurücksetzen', onclick: () => { app.setAppField(key, f, '', { keepDrawer: true }); input.value = toVal(autoOf[f] ? autoOf[f]() : ''); paint(); } }, LC.icon('refresh'), 'zurücksetzen');
      const paint = () => {
        const man = manual(f) != null && manual(f) !== '';
        const auto = autoOf[f] ? autoOf[f]() : null;
        badge.replaceChildren(man ? LC.badge('von dir', 'manual') : auto ? LC.badge(f === 'description' && getApp().descriptionSource === 'kb' ? 'automatisch vermutet' : 'automatisch', 'auto') : opts.optional ? LC.badge('optional', 'auto') : LC.badge('fehlt – bitte ergänzen', 'warn'));
        resetBtn.hidden = !man || !autoOf[f];
      };
      paint();
      input.addEventListener('change', () => {
        let v = input.value;
        if (autoOf[f] && type !== 'date' && v.trim() === (autoVal || '')) v = '';       // same as automatic -> no override
        if (type === 'date' && v && autoVal && LC.toDateInput(autoVal) === v) v = '';
        app.setAppField(key, f, v, { keepDrawer: true });
        paint(); refreshReco();
      });
      return h('label', { class: 'field' }, h('span', { class: 'lab' }, h('span', null, label), h('span', { class: 'row', style: { gap: '6px' } }, badge, resetBtn)), input, opts.hint ? h('span', { class: 'small muted' }, opts.hint) : null);
    };

    const recoBox = h('div');
    const refreshReco = () => {
      const a = getApp();
      recoBox.replaceChildren(...[
        h('div', { class: 'row', style: { marginBottom: '6px' } }, LC.chip(a.reco.level, a.reco.label), a.usageClass !== 'n/a' ? LC.badge('Nutzung: ' + CLASS_LABEL[a.usageClass], '') : LC.badge('Komponente', '')),
        a.reco.reasons.length ? h('ul', { class: 'list-plain' }, a.reco.reasons.map((r) => h('li', { class: 'finding' }, LC.sevIcon(r.level === 'ok' ? 'ok' : r.level), h('div', { class: 'f-detail' }, r.text)))) : h('div', { class: 'muted small' }, a.kbAdvice || 'Keine Auffälligkeiten.'),
        a.update ? h('div', { class: 'codeblock' }, h('span', { class: 'code' }, 'winget upgrade --id ' + a.update.id), LC.copyButton('winget upgrade --id ' + a.update.id),
          h('button', { class: 'btn primary sm', type: 'button', title: 'Startet winget in einem eigenen Fenster', onclick: () => LC.updatesDialog([{ id: a.update.id, name: a.name, from: a.update.from, to: a.update.to }], {}) }, LC.icon('refresh'), 'Jetzt aktualisieren')) : null,
      ].filter(Boolean));
    };
    refreshReco();

    const decisionRow = () => {
      const wrap = h('div', { class: 'decision', role: 'group', 'aria-label': 'Deine Entscheidung' });
      const cur = () => manual('decision');
      const mk = (val, label) => {
        const b = h('button', { class: 'btn sm', type: 'button', 'aria-pressed': String(cur() === val), onclick: () => { app.setAppField(key, 'decision', cur() === val ? '' : val, { keepDrawer: true }); paint(); refreshReco(); } }, label);
        return b;
      };
      const btns = [mk('keep', '✔ Behalten'), mk('review', '? Später prüfen'), mk('remove', '✖ Entfernen')];
      const paint = () => btns.forEach((b, i) => b.setAttribute('aria-pressed', String(cur() === ['keep', 'review', 'remove'][i])));
      btns.forEach((b) => wrap.appendChild(b));
      return wrap;
    };

    const a = getApp();
    const evidence = a.evidence.length
      ? h('div', { class: 'evidence' }, a.evidence.map((e) => h('div', { class: 'ev' },
        h('b', null, SRC_LABEL[e.source] || e.source), e.lastRun ? ' · ' + LC.fmtDateTime(e.lastRun) : ' · ohne Datum',
        e.runCount ? ' · ' + e.runCount + ' Starts' : '', e.focusSec ? ' · ' + LC.fmtNum(e.focusSec / 3600) + ' h im Vordergrund' : '',
        e.confidence !== 'high' ? ' · Zuordnung unsicher' : '', h('div', { class: 'small muted mono' }, e.path))))
      : h('div', { class: 'muted small' }, a.usageClass === 'notrace' ? 'Dieses Programm wird per Kommandozeile oder Launcher gestartet – Windows führt darüber kein Protokoll.' : 'Keine Nutzungsspur gefunden.');

    const tech = LC.kv([
      ['Version', a.version],
      ['Quelle', a.source === 'store' ? 'Microsoft Store' : 'Windows-Programmliste (Registry)'],
      ['Gilt für', a.scope === 'user' ? 'nur dein Benutzerkonto' : 'alle Benutzer'],
      ['Architektur', a.arch],
      ['Installationsordner', a.installLocation ? h('span', { class: 'mono' }, a.installLocation) : null],
      ['Größe', a.sizeSuspect ? h('span', null, h('b', null, 'unplausibel'), (a.sizeSource === 'registry' ? ' – der Installer meldet ' : ' – der gemessene Installationsordner ist ') + LC.fmtKB(a.sizeClaimedKB) + ' groß. Das ist für dieses Programm viel zu viel' + (a.sizeSource === 'registry' ? ' (typisch: Bytes statt Kilobytes eingetragen, also eher ' + LC.fmtKB(a.sizeClaimedKB / 1024) + ')' : ' (der Ordner enthält wohl mehr als das Programm)') + '. Es wird in keiner Summe mitgezählt. Prüfen: Explorer → Installationsordner → Rechtsklick → Eigenschaften.')
        : a.sizeKB ? (a.sizeApprox ? 'mindestens ' : '') + LC.fmtKB(a.sizeKB) + (a.sizeSource === 'registry' ? ' (Angabe des Programms)' : a.sizeCorrected ? ' (Ordner nachgemessen – der Installer meldete ' + LC.fmtKB(a.sizeClaimedKB) + ')' : ' (Ordner nachgemessen)') : 'unbekannt'],
      ['Installationsdatum', a.installDateAuto ? LC.fmtDate(a.installDateAuto) + ' – ' + (DATE_SRC[a.installDateSource] || '') : 'nicht verfügbar'],
      ['Deinstallation', a.uninstallString ? h('span', { class: 'stack', style: { gap: '8px' } },
          h('span', { class: 'row' }, h('span', { class: 'code' }, a.quietUninstall || a.uninstallString), LC.copyButton(a.quietUninstall || a.uninstallString)),
          a.source === 'registry' && !a.isSystemComponent ? h('button', { class: 'btn danger sm', type: 'button', title: 'Zeigt zuerst, was davon abhängt, und öffnet nach deiner Bestätigung das Deinstallationsprogramm', onclick: () => LC.confirmRemoval(LC.cleanup.itemForApp(a, S.model.ix, S.cleanupDoc), S, app, { start: true }) }, LC.icon('trash'), 'Jetzt deinstallieren …') : null)
        : a.source === 'store' ? h('span', { class: 'stack', style: { gap: '8px' } }, 'Einstellungen → Apps → Installierte Apps', LC.openButton('apps-features', { label: 'Windows: Installierte Apps öffnen' })) : null],
      ['Autostart', a.startup ? a.startup.items.map((i) => i.name + (i.enabled ? ' (aktiv)' : ' (aus)')).join(', ') : 'nein'],
    ]);

    const body = h('div', { class: 'drawer-body' },
      h('section', null, h('h4', { style: { marginBottom: '8px' } }, 'Einschätzung'), recoBox, h('div', { style: { marginTop: '10px' } }, h('div', { class: 'small muted', style: { marginBottom: '4px' } }, 'Deine Entscheidung'), decisionRow())),
      h('section', { class: 'stack', style: { gap: '12px' } }, h('h4', null, 'Angaben (du kannst alles überschreiben)'),
        field('Herausgeber', 'publisher', 'text'),
        field('Installiert am', 'installDate', 'date'),
        field('Zuletzt genutzt', 'lastUsed', 'date', { hint: 'Trag das Datum ein, wenn Windows nichts weiß, du es aber weißt.' }),
        field('Was macht dieses Programm?', 'description', 'textarea', { rows: 3, placeholder: 'Kurz beschreiben …' }),
        field('Wofür nutze ich es?', 'purpose', 'textarea', { rows: 2, placeholder: 'z. B. Steuererklärung, Uni, Hobby, Arbeit …' }),
        field('Kategorie', 'category', 'select', { options: LC.CATEGORIES }),
        field('Notiz', 'note', 'textarea', { rows: 2, placeholder: 'Eigene Anmerkung …', optional: true })),
      h('section', null, h('h4', { style: { marginBottom: '8px' } }, 'Woher weiß Windows, wann ich es benutzt habe?'), evidence,
        a.runCount ? h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Mindestens ' + a.runCount + ' Starts' + (a.focusHours ? ', ' + LC.fmtNum(a.focusHours) + ' h im Vordergrund' : '') + ' laut Windows-Startverlauf.') : null),
      relationsSection(S, app, a),
      h('section', null, h('h4', { style: { marginBottom: '8px' } }, 'Technische Details'), tech),
      h('section', { class: 'row' },
        h('a', { class: 'btn sm', href: LC.searchUrl('"' + a.name + '" ' + (a.publisher || '') + ' was ist das'), target: '_blank', rel: 'noopener noreferrer' }, LC.icon('search'), 'Im Web recherchieren'),
        a.aboutUrl ? h('a', { class: 'btn sm', href: a.aboutUrl, target: '_blank', rel: 'noopener noreferrer' }, LC.icon('link'), 'Herstellerseite') : null,
        LC.openButton('apps-features', { label: 'Windows: Installierte Apps öffnen' }),
        a.startup ? LC.openButton('startup-apps') : null));

    const aside = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': 'Details zu ' + a.name },
      h('div', { class: 'drawer-head' },
        h('div', { style: { flex: 1, minWidth: 0 } }, h('h3', null, a.name), h('div', { class: 'small muted' }, [a.version, a.publisher].filter(Boolean).join(' · '))),
        LC.reviewButton({ id: 'app:' + a.key, kind: 'app', title: a.name }, { ghost: true }),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: close, 'aria-label': 'Schließen' }, LC.icon('x'))),
      body,
      h('div', { class: 'drawer-foot' },
        h('button', { class: 'btn sm', type: 'button', disabled: idx <= 0 ? true : null, onclick: () => go(-1) }, LC.icon('left'), 'Zurück'),
        h('button', { class: 'btn sm', type: 'button', disabled: idx < 0 || idx >= list.length - 1 ? true : null, onclick: () => go(1) }, 'Weiter', LC.icon('right')),
        h('span', { class: 'small muted', style: { flex: 1, textAlign: 'right' } }, idx >= 0 ? (idx + 1) + ' / ' + list.length : ''),
        h('button', { class: 'btn primary sm', type: 'button', onclick: close }, 'Fertig')));
    root.appendChild(h('div', { class: 'drawer-scrim', onclick: close }));
    root.appendChild(aside);
    const focusTarget = S.drawerFocus ? aside.querySelector('[data-field="' + S.drawerFocus + '"]') : null;
    S.drawerFocus = null;
    (focusTarget || aside.querySelector('button')).focus();
  };
})(typeof window !== 'undefined' ? window : globalThis);
