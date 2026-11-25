/* page-folders.js - "Inventur" (Mein PC): every folder in the places nobody looks at - where it came from, whether it is still needed,
 * what to do. Nothing is deleted here: "Zum Aufräumen vormerken" only puts it on the clean-up list, where every item is confirmed one by one. */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h, fmtBytes } = LC;

  const UI = { filter: 'todo', where: '', minMB: 20, q: '', limit: 60 };
  const STATUS = {
    active: ['ok', 'aktiv'], idle: ['info', 'ungenutzt'], cache: ['ok', 'Cache – unkritisch'], leftover: ['warn', 'Rest'],
    'maybe-leftover': ['warn', 'vermutlich Rest'], unknown: ['info', 'unbekannt'], kept: ['ok', 'behalten'],
  };
  const FILTERS = [
    { id: 'todo', label: 'Zu prüfen', fn: (i) => ['leftover', 'maybe-leftover', 'unknown', 'cache'].includes(i.status) && !i.marked },
    { id: 'leftover', label: 'Reste', fn: (i) => i.status === 'leftover' },
    { id: 'maybe-leftover', label: 'Vermutlich Reste', fn: (i) => i.status === 'maybe-leftover' },
    { id: 'unknown', label: 'Unbekannt', fn: (i) => i.status === 'unknown' },
    { id: 'cache', label: 'Caches', fn: (i) => i.status === 'cache' },
    { id: 'idle', label: 'Ungenutzt', fn: (i) => i.status === 'idle' },
    { id: 'active', label: 'Aktiv', fn: (i) => i.status === 'active' },
    { id: 'kept', label: 'Behalten', fn: (i) => i.status === 'kept' },
    { id: 'all', label: 'Alle', fn: () => true },
  ];
  /** Program folders need administrator rights and are refused by the clean-up server; everything else can be put on the list. */
  const isProgramFolder = (p) => /^[a-z]:\\(windows|program files)/i.test(p);
  const tile = (label, value, sub) => h('div', { class: 'card tile static' }, h('div', { class: 't-head' }, h('span', null, label)), h('div', { class: 't-val' }, value), h('div', { class: 't-sub' }, sub));

  function row(it, max, app) {
    const [sev, label] = STATUS[it.status] || STATUS.unknown;
    const actions = [h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.reveal(it.path) }, LC.icon('folder'), 'Im Explorer zeigen')];
    const cloudProtected = !!(it.owner && it.owner.via === 'provider');                     // the clean-up server never touches a detected cloud folder
    const canMark = ['leftover', 'maybe-leftover', 'unknown', 'cache'].includes(it.status) && !it.marked;
    if (canMark && !isProgramFolder(it.path) && !cloudProtected) {
      actions.push(h('button', { class: 'btn ghost sm', type: 'button', title: 'Setzt den Ordner auf die Aufräumliste. Entfernt wird erst, wenn du dort jedes Objekt einzeln bestätigst – und es geht in den Papierkorb.',
        onclick: () => { app.cleanup.addPath({ path: it.path, kind: 'dir', name: it.name, bytes: it.bytes, reason: 'Inventur: ' + label + '. ' + it.why[0] }); LC.toast('Zum Aufräumen vorgemerkt. Bestätigen kannst du es auf der Seite „Aufräumen“.', 6000); } }, LC.icon('trash'), 'Zum Aufräumen vormerken'));
    }
    if (it.status !== 'active' && it.status !== 'kept' && !it.marked) {
      actions.push(h('button', { class: 'btn ghost sm', type: 'button', title: 'Der Ordner erscheint nicht mehr unter „Zu prüfen“.',
        onclick: () => app.updateCleanup((d) => LC.cleanup.keep(d, { id: it.id, type: 'path', name: it.name, path: it.path, kind: 'dir', bytes: it.bytes })) }, LC.icon('check'), 'Behalten'));
    }
    if (it.status === 'kept') actions.push(h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.updateCleanup((d) => LC.cleanup.drop(d, it.id)) }, LC.icon('refresh'), 'Doch prüfen'));
    return h('div', { class: 'sp-row' },
      h('div', { class: 'sp-top' },
        h('div', { class: 'sp-name' }, h('b', null, it.name), h('span', { class: 'small muted', title: it.path }, ' · ' + it.short)),
        h('div', { class: 'sp-size num' }, (it.partial ? '≥ ' : '') + fmtBytes(it.bytes))),
      LC.meter([{ pct: Math.max(1, (it.bytes / max) * 100), cls: it.status === 'leftover' || it.status === 'maybe-leftover' ? 'sev-warn' : it.status === 'cache' ? 'g3' : '', title: fmtBytes(it.bytes) }]),
      h('div', { class: 'sp-tags' }, LC.badge(it.whereLabel, ''), LC.chip(sev, label, 'Sicherheit der Einstufung: ' + it.conf),
        it.owner ? LC.badge('gehört zu ' + it.owner.name.replace(/ \(Herausgeber\)$/, ''), 'auto') : null,
        it.marked ? LC.badge('vorgemerkt', 'manual') : null,
        h('span', { class: 'sp-actions' }, actions)),
      it.hint ? h('div', { class: 'sp-hint' }, it.hint) : null,
      h('details', { class: 'small' }, h('summary', { class: 'muted' }, 'Warum diese Einstufung?'), h('ul', { class: 'list-plain' }, it.why.map((w) => h('li', null, w))),
        cloudProtected ? h('div', { class: 'small muted' }, 'Dieser Ordner wird vom Tool nicht gelöscht (Schutz für Cloud-Ordner). Lies die Aufgabe „Alter Google-Drive-Ordner“: prüfen, umbenennen, dann selbst löschen.') : null,
        isProgramFolder(it.path) && canMark ? h('div', { class: 'small muted' }, 'Programm-Ordner: bitte über Windows (Einstellungen → Apps) oder von Hand mit Administratorrechten entfernen – das Tool fasst Programm-Ordner nicht an.') : null));
  }

  function afterUninstallCard(fm, app) {
    const items = fm.afterUninstall.filter((i) => i.status === 'leftover');
    if (!items.length) return null;
    const names = [...new Set(items.map((i) => i.owner.name))];
    const max = items[0].bytes || 1;
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('trash', 'lg')), h('h3', null, 'Nach deiner Deinstallation übrig geblieben')),
      h('p', { class: 'small muted' }, 'Diese Programme hast du entfernt, seit LaptopCheck mitschreibt: ' + names.join(', ') + '. Ihre Daten liegen noch auf dem PC (' + fmtBytes(items.reduce((a, i) => a + i.bytes, 0)) + ').'),
      h('div', { class: 'sp-list' }, items.map((i) => row(i, max, app))));
  }

  LC.pages.folders = (S, app) => {
    const m = S.model;
    const fm = m.folders;
    const out = [h('div', { class: 'page-title' }, h('h2', null, 'Inventur'),
      h('p', null, 'Woher kommt dieser Ordner – und brauchst du ihn noch? LaptopCheck sieht dorthin, wo Programme, Entwicklerwerkzeuge und Downloads unbemerkt Dateien anlegen. Nichts wird gelöscht, außer was du bestätigst.'))];
    const scanBtn = (label) => h('button', { class: 'btn primary', type: 'button', disabled: S.filesScanning ? true : null, onclick: () => app.scanFiles() }, LC.icon(S.filesScanning ? 'refresh' : 'search', S.filesScanning ? 'spin' : ''), S.filesScanning ? 'Scanne … (bis zu 3 Min.)' : label);

    if (!fm) {
      out.push(h('div', { class: 'card', style: { textAlign: 'center', padding: '36px 24px' } }, h('h3', null, 'Noch keine Inventur'),
        h('p', { class: 'muted', style: { margin: '8px auto 16px', maxWidth: '520px' } }, 'Dafür liest LaptopCheck einmal deine Ordner (nur lesend, ca. 1–3 Minuten): Namen, Größen und Änderungsdaten – nicht die Inhalte.'), scanBtn('Dateien-Scan starten')));
      return h('div', { class: 'stack' }, ...out);
    }
    if (!fm.hasPlaces) {
      out.push(h('div', { class: 'callout warn' }, h('b', null, 'Dein letzter Dateien-Scan kennt die Inventur-Orte noch nicht. '), 'Neu scannen, damit auch die Hauptordner von C:\\, Programm-Ordner und eigene Ordner im Benutzerverzeichnis geprüft werden. ', scanBtn('Neu scannen')));
    }

    const t = fm.totals;
    out.push(h('div', { class: 'grid tiles' },
      tile('Geprüft', String(t.count) + ' Ordner', fmtBytes(t.bytes) + ' zusammen'),
      tile('Aktiv', fmtBytes(t.sizes.active), t.counts.active + ' Ordner – Programm da und in Benutzung'),
      tile('Caches (unkritisch)', fmtBytes(t.sizes.cache), t.counts.cache + ' Ordner – bauen sich selbst neu auf'),
      tile('Reste', fmtBytes(t.sizes.leftover), t.counts.leftover + ' Ordner – kein Programm braucht sie mehr'),
      tile('Zu klären', fmtBytes(t.sizes['maybe-leftover'] + t.sizes.unknown + t.sizes.idle), (t.counts['maybe-leftover'] + t.counts.unknown) + ' unbekannt, ' + t.counts.idle + ' ungenutzt')));
    const after = afterUninstallCard(fm, app);
    if (after) out.push(after);

    // filters
    const filt = FILTERS.find((f) => f.id === UI.filter) || FILTERS[0];
    const places = [...new Set(fm.items.map((i) => i.where))];
    let list = fm.items.filter(filt.fn).filter((i) => i.bytes >= UI.minMB * 1024 * 1024 || (UI.minMB === 0))
      .filter((i) => !UI.where || i.where === UI.where)
      .filter((i) => { const q = UI.q.trim().toLowerCase(); return !q || (i.name + ' ' + i.path + ' ' + (i.owner ? i.owner.name : '')).toLowerCase().includes(q); });
    const total = list.length;
    const max = list.length ? list[0].bytes || 1 : 1;
    list = list.slice(0, UI.limit);

    const search = h('input', { type: 'search', placeholder: 'Suchen in Name, Pfad, Programm …', value: UI.q, 'aria-label': 'Suchen' });
    search.addEventListener('input', (e) => { UI.q = e.target.value; clearTimeout(search._t); search._t = setTimeout(() => { UI.limit = 60; app.render({ force: true }); const el = document.querySelector('.fi-toolbar input[type=search]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 180); });
    const whereSel = h('select', { 'aria-label': 'Ort', style: { width: 'auto' }, onchange: (e) => { UI.where = e.target.value; UI.limit = 60; app.render(); } },
      h('option', { value: '' }, 'Alle Orte'), places.map((w) => h('option', { value: w, selected: UI.where === w ? true : null }, LC.FOLDER_WHERE[w] || w)));
    const minSel = h('select', { 'aria-label': 'Mindestgröße', style: { width: 'auto' }, onchange: (e) => { UI.minMB = +e.target.value; UI.limit = 60; app.render(); } },
      [[0, 'alle Größen'], [5, 'ab 5 MB'], [20, 'ab 20 MB'], [100, 'ab 100 MB'], [500, 'ab 500 MB'], [1024, 'ab 1 GB']].map(([v, l]) => h('option', { value: v, selected: UI.minMB === v ? true : null }, l)));
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter' }, FILTERS.map((f) => {
      const n = fm.items.filter(f.fn).length;
      return h('button', { class: 'fchip', type: 'button', 'aria-pressed': String(UI.filter === f.id), onclick: () => { UI.filter = f.id; UI.limit = 60; app.render(); } }, f.label, h('span', { class: 'n' }, String(n)));
    }));

    out.push(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('search', 'lg')), h('h3', null, 'Alle Ordner'),
        h('span', { class: 'small muted' }, fm.scannedAt ? 'Stand ' + LC.fmtDateTime(fm.scannedAt) : ''), scanBtn('Neu scannen')),
      h('div', { class: 'fi-toolbar stack', style: { gap: '8px' } }, h('div', { class: 'row' }, h('div', { class: 'search', style: { flex: '1 1 260px' } }, LC.icon('search'), search), whereSel, minSel), chips),
      h('p', { class: 'small muted' }, total + ' Ordner' + (filt.id === 'todo' ? ' – alles, was Aufmerksamkeit braucht' : '') + '. Die Einstufung ist eine Einschätzung: „Rest“ und „unbekannt“ prüfst du, bevor du etwas aufräumst.'),
      list.length ? h('div', { class: 'sp-list' }, list.map((i) => row(i, max, app))) : h('div', { class: 'empty' }, 'Keine Ordner in diesem Filter.'),
      total > list.length ? h('button', { class: 'btn sm', type: 'button', style: { marginTop: '8px' }, onclick: () => { UI.limit += 60; app.render(); } }, 'Mehr anzeigen (' + (total - list.length) + ' weitere)') : null));
    return h('div', { class: 'stack' }, ...out);
  };
})(typeof window !== 'undefined' ? window : globalThis);
