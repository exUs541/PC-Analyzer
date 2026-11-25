/* page-compare.js - "Ordner vergleichen": pick two folders, see in one view what the difference is.
 * Reading only (POST /api/compare). The calculation is LC.compareModel (compare.js). */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h, fmtBytes, fmtNum } = LC;

  const C = (LC.compareUi = LC.compareUi || { a: '', b: '', deep: false, ignore: true, running: false, error: null, raw: null, view: 'tree', q: '', shown: 50, open: new Set(), loaded: false, model: null, modelOf: null });
  const KINDS = { onlyA: 'Nur in A', onlyB: 'Nur in B', changed: 'Verschieden', moved: 'Verschoben' };

  const model = () => { if (C.raw !== C.modelOf) { C.model = LC.compareModel(C.raw); C.modelOf = C.raw; } return C.model; };

  async function pick(app, key) {
    try {
      const r = await app.api('/api/pick-folder', { method: 'POST', body: JSON.stringify({ title: key === 'a' ? 'Ordner A wählen' : 'Ordner B wählen', start: C[key] || '' }) });
      if (r && r.path) { C[key] = r.path; app.render(); }
      else if (r && r.path === null) LC.toast('Es wurde kein Ordner gewählt. Du kannst den Pfad auch eintippen.', 4000);
    } catch (e) { LC.toast('Die Ordner-Auswahl gibt es nur in der App – tippe den Pfad ein.', 5000); }
  }

  async function run(app) {
    C.error = null; C.running = true; app.render();
    try {
      C.raw = await app.api('/api/compare', { method: 'POST', body: JSON.stringify({ a: C.a, b: C.b, deep: C.deep, ignoreJunk: C.ignore }) });
      C.view = 'tree'; C.open = new Set(); C.shown = 50; C.q = '';
    } catch (e) { C.error = e.message; }
    C.running = false;
    app.render();
  }

  /** Folders worth offering: the Drive (live and old), your standard folders. */
  function places(S) {
    const f = S.model && S.model.files;
    const out = [];
    if (f) {
      for (const p of f.providers) out.push({ label: p.mode === 'leftover' ? 'Alter ' + p.name + '-Ordner' : p.name, path: p.root });
      for (const r of f.localRoots) out.push({ label: r.label, path: r.path });
    }
    return out;
  }

  function folderField(app, key, title, hint) {
    const inp = h('input', { type: 'text', value: C[key], placeholder: 'z. B. C:\\Users\\du\\My Drive', 'aria-label': title, style: { width: '100%' }, spellcheck: 'false' });
    inp.addEventListener('change', () => { C[key] = inp.value.trim(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { C[key] = inp.value.trim(); inp.blur(); } });
    return h('div', { class: 'field' }, h('span', { class: 'lab' }, title), h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, inp, h('button', { class: 'btn', type: 'button', style: { whiteSpace: 'nowrap' }, onclick: () => pick(app, key) }, LC.icon('folder'), 'Wählen …')),
      h('span', { class: 'small muted' }, hint));
  }

  function chooser(S, app) {
    const pl = places(S);
    const old = S.model && S.model.files && S.model.files.providers.find((p) => p.mode === 'leftover');
    const live = old && S.model.files.liveProviders.find((p) => p.id === old.id && p.mode === 'stream') || (old && S.model.files.liveProviders.find((p) => p.id === old.id));
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('search', 'lg')), h('h3', null, 'Welche Ordner vergleichen?')),
      h('div', { class: 'grid cols-2' }, folderField(app, 'a', 'Ordner A', 'z. B. der alte Ordner'), folderField(app, 'b', 'Ordner B', 'z. B. der neue Ordner')),
      h('div', { class: 'row', style: { marginTop: '8px' } },
        old && live ? h('button', { class: 'btn sm', type: 'button', onclick: () => { C.a = old.root; C.b = live.root; app.render(); } }, LC.icon('cloud'), 'Alten und neuen Google Drive wählen') : null,
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { const t = C.a; C.a = C.b; C.b = t; app.render(); } }, 'A und B tauschen')),
      pl.length ? h('div', { class: 'small muted', style: { marginTop: '10px' } }, 'Schnellwahl:') : null,
      pl.length ? h('div', { class: 'chips', style: { marginTop: '4px' } }, pl.map((p) => h('span', { class: 'badge', title: p.path }, p.label + ' ',
        h('button', { class: 'btn ghost sm', type: 'button', style: { padding: '0 6px' }, 'aria-label': p.label + ' als Ordner A', onclick: () => { C.a = p.path; app.render(); } }, 'A'),
        h('button', { class: 'btn ghost sm', type: 'button', style: { padding: '0 6px' }, 'aria-label': p.label + ' als Ordner B', onclick: () => { C.b = p.path; app.render(); } }, 'B')))) : null,
      h('div', { class: 'stack', style: { marginTop: '12px', gap: '6px' } },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: C.ignore ? true : null, onchange: (e) => { C.ignore = e.target.checked; } }), ' Verknüpfungen und Hilfsdateien ignorieren (desktop.ini, Google-Docs-Verknüpfungen, Office-Sperrdateien)'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: C.deep ? true : null, onchange: (e) => { C.deep = e.target.checked; } }), ' Auch den Inhalt prüfen (langsamer: Dateien mit gleicher Größe werden gelesen; auf einem Cloud-Laufwerk wie G: werden sie dafür heruntergeladen)')),
      C.error ? h('div', { class: 'callout critical', style: { marginTop: '10px' } }, C.error) : null,
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn primary', type: 'button', disabled: C.running ? true : null, onclick: () => run(app) }, LC.icon(C.running ? 'refresh' : 'search', C.running ? 'spin' : ''), C.running ? 'Vergleiche … (bis zu 4 Minuten)' : 'Vergleichen'),
        h('span', { class: 'small muted' }, 'Es wird nichts verändert: Das Tool liest nur Namen, Größen und Daten.')));
  }

  /* ------------------------------------------------------------------ result */
  const badge = (cls, text, title) => h('span', { class: 'cmp-b ' + cls, title: title || null }, text);

  function treeRows(node, m, depth, app, out) {
    for (const k of node.kids) {
      const key = k.d;
      const open = C.open.has(key);
      const has = k.kids.length > 0;
      const tog = has ? h('button', { class: 'tr-tog' + (open ? ' open' : ''), type: 'button', 'aria-expanded': String(open), 'aria-label': (open ? 'Zuklappen: ' : 'Aufklappen: ') + k.name, onclick: () => { if (open) C.open.delete(key); else C.open.add(key); app.render(); } }, LC.icon('chevron')) : h('span', { class: 'tr-tog none' });
      const bits = [];
      if (k.onlyA && k.onlyA.n) bits.push(badge('a', 'nur A ' + fmtNum(k.onlyA.n, 0), 'Nur in ' + m.nameA + ': ' + fmtBytes(k.onlyA.bytes)));
      if (k.onlyB && k.onlyB.n) bits.push(badge('b', 'nur B ' + fmtNum(k.onlyB.n, 0), 'Nur in ' + m.nameB + ': ' + fmtBytes(k.onlyB.bytes)));
      if (k.changed && k.changed.n) bits.push(badge('c', 'verschieden ' + fmtNum(k.changed.n, 0), 'In beiden, aber verschieden: ' + fmtBytes(k.changed.bytes)));
      if (k.moved && k.moved.n) bits.push(badge('m', 'verschoben ' + fmtNum(k.moved.n, 0), 'Verschoben oder umbenannt: ' + fmtBytes(k.moved.bytes)));
      const bytes = k.onlyA ? k.onlyA.bytes + k.onlyB.bytes + k.changed.bytes : 0;
      out.push(h('div', { class: 'cmp-row', style: { paddingLeft: 8 + depth * 18 + 'px' } },
        h('div', { class: 'cmp-main' }, tog, h('div', { class: 'tr-name' }, h('b', null, k.name || '(Hauptordner)'), k.same && k.same.n ? h('span', { class: 'small muted' }, ' · ' + fmtNum(k.same.n, 0) + ' gleich') : null)),
        h('div', { class: 'cmp-badges' }, bits, bytes ? h('span', { class: 'small muted num' }, fmtBytes(bytes)) : null)));
      if (has && open) treeRows(k, m, depth + 1, app, out);
    }
  }

  function treeView(m, app) {
    const rows = [];
    treeRows(m.tree, m, 0, app, rows);
    if (!rows.length) return h('div', { class: 'callout ok' }, 'Es gibt in keinem Ordner einen Unterschied.');
    return h('div', null,
      h('p', { class: 'small muted' }, 'Hier stehen nur Ordner, in denen sich etwas unterscheidet. Mit dem Pfeil öffnest du einen Ordner; jede Zeile zählt alles darunter mit. „nur A“ = nur in „' + m.nameA + '“, „nur B“ = nur in „' + m.nameB + '“.'),
      h('div', { class: 'tr-list' }, rows),
      m.cut.dirs ? h('p', { class: 'small muted' }, 'Es werden die ersten 8000 Ordner gezeigt.') : null,
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: 'btn sm', type: 'button', onclick: () => { m.tree.kids.forEach((k) => { if (k.kids.length) C.open.add(k.d); }); app.render(); } }, 'Oberste Ebene aufklappen'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { C.open.clear(); app.render(); } }, 'Alles zuklappen')));
  }

  const dateOf = (iso) => (iso ? LC.fmtDate(iso) : '–');

  function listView(m, kind, S, app) {
    const rows = LC.compareRows(m, kind, C.q);
    const shown = rows.slice(0, C.shown);
    const base = (side) => (side === 'b' ? m.b : m.a);
    const reveal = (side, rel) => app.reveal(LC.joinPath(base(side), ...String(rel).split('\\')));
    const q = h('input', { type: 'search', value: C.q, placeholder: 'In dieser Liste suchen …', 'aria-label': 'Suchen', style: { maxWidth: '320px' } });
    q.addEventListener('change', () => { C.q = q.value; C.shown = 50; app.render(); });
    const items = shown.map((r) => {
      if (kind === 'moved') {
        return h('div', { class: 'sp-row' },
          h('div', { class: 'sp-top' }, h('div', { class: 'sp-name' }, h('b', null, r.nameA), r.nameB !== r.nameA ? h('span', { class: 'small muted' }, ' → ' + r.nameB) : null), h('div', { class: 'sp-size num' }, fmtBytes(r.size))),
          h('div', { class: 'small muted' }, 'In „' + m.nameA + '“: ' + (r.dirA || '(Hauptordner)')), h('div', { class: 'small muted' }, 'In „' + m.nameB + '“: ' + (r.dirB || '(Hauptordner)')),
          h('div', { class: 'sp-tags' }, h('span', { class: 'sp-actions' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => reveal('a', r.a) }, LC.icon('folder'), 'In A zeigen'), h('button', { class: 'btn ghost sm', type: 'button', onclick: () => reveal('b', r.b) }, LC.icon('folder'), 'In B zeigen'))));
      }
      if (kind === 'changed') {
        return h('div', { class: 'sp-row' },
          h('div', { class: 'sp-top' }, h('div', { class: 'sp-name' }, h('b', null, r.name), h('span', { class: 'small muted' }, ' · ' + (r.dir || '(Hauptordner)'))), h('div', { class: 'sp-size num' }, r.why === 'content' ? 'Inhalt anders' : fmtBytes(r.sa) + ' ↔ ' + fmtBytes(r.sb))),
          h('div', { class: 'small muted' }, r.why === 'content' ? 'Gleiche Größe (' + fmtBytes(r.sa) + '), aber anderer Inhalt.' : 'A: ' + fmtBytes(r.sa) + ', geändert ' + dateOf(r.ma) + ' · B: ' + fmtBytes(r.sb) + ', geändert ' + dateOf(r.mb)),
          r.newer ? h('div', { class: 'small' }, 'Neuer ist die Datei in „' + (r.newer === 'A' ? m.nameA : m.nameB) + '“.') : null,
          h('div', { class: 'sp-tags' }, h('span', { class: 'sp-actions' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => reveal('a', r.p) }, LC.icon('folder'), 'In A zeigen'), h('button', { class: 'btn ghost sm', type: 'button', onclick: () => reveal('b', r.p) }, LC.icon('folder'), 'In B zeigen'))));
      }
      const side = kind === 'onlyA' ? 'a' : 'b';
      return h('div', { class: 'sp-row' },
        h('div', { class: 'sp-top' }, h('div', { class: 'sp-name' }, h('b', null, r.name), h('span', { class: 'small muted' }, ' · ' + (r.dir || '(Hauptordner)'))), h('div', { class: 'sp-size num' }, fmtBytes(r.size))),
        h('div', { class: 'small muted' }, 'geändert ' + dateOf(r.m)),
        h('div', { class: 'sp-tags' }, h('span', { class: 'sp-actions' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => reveal(side, r.p) }, LC.icon('folder'), 'Im Explorer zeigen'))));
    });
    const label = kind === 'onlyA' ? 'nur in „' + m.nameA + '“' : kind === 'onlyB' ? 'nur in „' + m.nameB + '“' : kind === 'changed' ? 'in beiden, aber verschieden' : 'nur verschoben oder umbenannt';
    return h('div', null,
      h('div', { class: 'row between', style: { margin: '6px 0' } }, h('span', { class: 'small muted' }, fmtNum(rows.length, 0) + ' Dateien ' + label + (C.q ? ' (gefiltert)' : '')), q),
      items.length ? h('div', { class: 'sp-list' }, items) : h('div', { class: 'callout ok' }, 'Hier ist nichts.'),
      rows.length > shown.length ? h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => { C.shown += 100; app.render(); } }, 'Mehr anzeigen (' + (rows.length - shown.length) + ' weitere)')) : null,
      m.cut[kind] && !C.q ? h('p', { class: 'small muted' }, 'Es werden die 5000 größten Dateien gezeigt; die Zahlen oben sind vollständig.') : null);
  }

  function result(S, app) {
    const m = model();
    if (!m) return null;
    const v = m.verdict;
    const verdict = h('div', { class: 'callout ' + (v.sev === 'ok' ? 'ok' : v.sev === 'warn' ? 'warn' : '') }, h('div', { style: { fontSize: '17px', fontWeight: '650' } }, v.title), v.text ? h('div', { style: { marginTop: '4px' } }, v.text) : null,
      h('div', { class: 'small muted', style: { marginTop: '6px' } }, '„' + m.nameA + '“: ' + fmtNum(m.s.filesA, 0) + ' Dateien (' + fmtBytes(m.s.bytesA) + ') · „' + m.nameB + '“: ' + fmtNum(m.s.filesB, 0) + ' Dateien (' + fmtBytes(m.s.bytesB) + ') · verglichen ' + LC.fmtDateTime(m.scannedAt) + (m.seconds != null ? ' (' + Math.round(m.seconds) + ' s)' : '')));
    const cards = h('div', { class: 'cmp-cards' }, m.cards.map((c) => h('button', { class: 'card tile' + (c.view ? '' : ' static'), type: 'button', disabled: c.view && c.n ? null : (c.view ? true : null),
      onclick: () => { if (c.view && c.n) { C.view = c.view; C.q = ''; C.shown = 50; app.render(); } } },
      h('div', { class: 't-head' }, h('i', { class: 'cmp-dot ' + c.cls }), h('span', null, c.label)), h('div', { class: 't-val' }, fmtNum(c.n, 0) + (c.n === 1 ? ' Datei' : ' Dateien')), h('div', { class: 't-sub' }, fmtBytes(c.bytes) + ' · ' + c.sub))));
    const tabs = [['tree', 'Nach Ordnern'], ...['onlyA', 'onlyB', 'changed', 'moved'].map((k) => [k, (k === 'onlyA' ? 'Nur in A' : k === 'onlyB' ? 'Nur in B' : KINDS[k]) + ' (' + fmtNum(m.s[k].n, 0) + ')'])];
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Ansicht' }, tabs.map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(C.view === id), onclick: () => { C.view = id; C.q = ''; C.shown = 50; app.render(); } }, label)));
    const csv = h('button', { class: 'btn sm', type: 'button', onclick: () => LC.download('Ordner-Vergleich.csv', LC.compareCsv(m), 'text/csv;charset=utf-8') }, LC.icon('file'), 'Unterschiede als CSV speichern');
    return [
      h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon(v.sev === 'ok' ? 'check' : 'search', 'lg')), h('h3', null, 'Ergebnis'), csv), verdict, cards,
        m.notes.length ? h('ul', { class: 'small muted', style: { margin: '8px 0 0 18px' } }, m.notes.map((n) => h('li', null, n))) : null),
      h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('folder', 'lg')), h('h3', null, 'Wo ist der Unterschied?'), seg),
        C.view === 'tree' ? treeView(m, app) : listView(m, C.view, S, app)),
    ];
  }

  LC.pages.compare = (S, app) => {
    if (!C.loaded) {
      C.loaded = true;
      app.api('/api/compare/last').then((r) => { if (r && r.summary && !C.raw) { C.raw = r; C.a = C.a || r.a; C.b = C.b || r.b; C.deep = !!r.deep; C.ignore = r.ignoreJunk !== false; app.render({ background: true }); } }).catch(() => { /* a server without it */ });
    }
    const head = h('div', { class: 'page-title' }, h('h2', null, 'Ordner vergleichen'),
      h('p', null, 'Wähle zwei Ordner und sieh auf einen Blick, was nur im einen liegt, was in beiden anders ist und was nur verschoben wurde. Es wird nichts verändert.'));
    return h('div', { class: 'stack' }, head, chooser(S, app), ...(result(S, app) || []));
  };
})(typeof window !== 'undefined' ? window : globalThis);
