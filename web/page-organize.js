/* page-organize.js - "Ordnen": deep look at chosen folders, tags, a proposed folder structure you can adjust and apply (nothing is
 * deleted unless you mark it; every run can be undone). The server does the work and re-checks everything (/api/organize/*). */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h, fmtBytes } = LC;

  const O = { folders: null, sel: new Set(), custom: '', plan: null, busy: false, map: {}, skip: new Set(), del: new Set(), open: new Set(), result: null, runs: null, tag: '' };
  const ZONES = ['Wichtig', 'Aktuell', 'Archiv', 'Duplikat'];
  const ZONE_HINT = { Wichtig: 'Wichtige Dokumente (Rechnungen, Verträge …), egal wie alt', Aktuell: 'In den letzten 90 Tagen benutzt', Archiv: 'Älter, selten gebraucht', Duplikat: 'Gleicher Inhalt wie eine andere Datei – wird nur verschoben, nicht gelöscht' };
  const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
  const keyOf = (it) => it.root + '|' + it.target;
  const targetOf = (it) => (Object.prototype.hasOwnProperty.call(O.map, keyOf(it)) ? O.map[keyOf(it)] : it.target);
  const moves = (it) => (it.action === 'move' || it.action === 'duplicate') && !O.skip.has(it.id) && !O.del.has(it.id) && !!targetOf(it);

  async function load(app) {
    if (O.folders === null) {
      O.folders = [];
      try { O.folders = await app.api('/api/organize/folders'); } catch (e) { /* shown as empty list */ }
      try { O.runs = await app.api('/api/organize/runs'); } catch (e) { O.runs = []; }
      app.render();
    }
  }

  async function analyze(app) {
    const roots = [...O.sel];
    if (O.custom.trim()) roots.push(O.custom.trim());
    if (!roots.length) { LC.toast('Wähle mindestens einen Ordner.'); return; }
    O.busy = true; O.result = null; app.render();
    try {
      O.plan = await app.api('/api/organize/analyze', { method: 'POST', body: JSON.stringify({ roots }) });
      O.map = {}; O.skip = new Set(); O.del = new Set(); O.open = new Set(); O.tag = '';
    } catch (e) { LC.toast('Analyse nicht möglich: ' + e.message, 8000); }
    O.busy = false; app.render();
  }

  function confirmApply(app) {
    const items = O.plan.items;
    const nMove = items.filter(moves).length;
    const nDel = items.filter((i) => O.del.has(i.id)).length;
    let dlg;
    dlg = LC.modal({
      title: 'Struktur übernehmen?',
      body: h('div', { class: 'stack' },
        h('p', null, h('b', null, nMove + ' Dateien/Ordner'), ' werden in die vorgeschlagene Struktur verschoben.'),
        h('p', null, 'Es wird nichts gelöscht, nichts überschrieben, und du kannst alles danach mit einem Klick rückgängig machen.'),
        nDel ? h('div', { class: 'callout warn' }, nDel + ' Element(e) hast du zum Löschen markiert. Dafür öffnet sich ein eigenes Fenster, in dem du „ENTFERNEN“ tippen musst; sie gehen in den Papierkorb.') : null),
      actions: [h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Abbrechen'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { dlg.close(); apply(app); } }, 'Jetzt übernehmen')],
    });
  }

  async function apply(app) {
    O.busy = true; app.render();
    try {
      await app.flushSave();
      const map = {};
      for (const [k, v] of Object.entries(O.map)) map[k] = v;
      O.result = await app.api('/api/organize/apply', { method: 'POST', body: JSON.stringify({ planId: O.plan.id, folderMap: map, skipIds: [...O.skip], deleteIds: [...O.del] }) });
      O.plan = null;
      O.runs = await app.api('/api/organize/runs');
    } catch (e) { LC.toast('Übernehmen nicht möglich: ' + e.message, 8000); }
    O.busy = false; app.render();
  }

  async function undo(app, id) {
    if (!confirm('Diesen Durchlauf rückgängig machen? Alles wird an seinen alten Platz zurückgelegt.')) return;
    try {
      const r = await app.api('/api/organize/undo', { method: 'POST', body: JSON.stringify({ runId: id }) });
      LC.toast(r.restored + ' zurückgelegt' + (r.skipped ? ', ' + r.skipped + ' übersprungen (inzwischen verändert)' : '') + '.', 6000);
      O.runs = await app.api('/api/organize/runs');
    } catch (e) { LC.toast('Rückgängig nicht möglich: ' + e.message, 6000); }
    app.render();
  }

  function chooser(app) {
    const exist = (O.folders || []).filter((f) => f.exists);
    const all = exist.length > 0 && exist.every((f) => O.sel.has(f.path));
    const custom = h('input', { type: 'text', placeholder: 'Anderer Ordner, z. B. D:\\Daten', value: O.custom, 'aria-label': 'Anderer Ordner', style: { flex: '1 1 260px' } });
    custom.addEventListener('input', () => { O.custom = custom.value; });
    return LC.card('1. Was soll geprüft werden?', 'folder', [
      h('p', { class: 'small muted' }, 'LaptopCheck liest alle Dateien (auch tief in Unterordnern), vergibt Schlagwörter und erkennt Duplikate. Dabei wird nichts verändert.'),
      h('div', { class: 'chips' }, exist.map((f) => h('button', { class: 'fchip', type: 'button', 'aria-pressed': String(O.sel.has(f.path)), onclick: () => { if (O.sel.has(f.path)) O.sel.delete(f.path); else O.sel.add(f.path); app.render(); } }, f.label)),
        exist.length ? h('button', { class: 'fchip', type: 'button', title: 'Alle Benutzerordner auf einmal', 'aria-pressed': String(all), onclick: () => { if (all) O.sel.clear(); else exist.forEach((f) => O.sel.add(f.path)); app.render(); } }, 'Ganzer PC (alle Benutzerordner)') : null),
      h('div', { class: 'row', style: { marginTop: '10px' } }, custom,
        h('button', { class: 'btn primary', type: 'button', disabled: O.busy ? true : null, onclick: () => analyze(app) }, LC.icon('search'), O.busy ? 'Analysiere …' : 'Analysieren')),
      O.busy && !O.plan ? h('div', { class: 'callout', style: { marginTop: '10px' } }, 'Die Analyse läuft. Bei vielen Dateien kann das bis zu eineinhalb Minuten dauern.') : null,
      h('p', { class: 'small muted', style: { marginTop: '10px' } }, 'Windows, Programme und der gesamte Benutzerordner werden nie umgeordnet – dafür wählst du einzelne Ordner.')]);
  }

  function proposal(app) {
    const plan = O.plan;
    const items = plan.items;
    const tagCount = {};
    items.forEach((i) => i.tags.forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
    const tags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 16);
    const visible = (i) => !O.tag || i.tags.includes(O.tag);

    const groups = new Map();
    for (const it of items.filter(visible)) {
      const k = it.action === 'keep' || !it.target ? 'keep' : keyOf(it);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    const order = (k) => (k === 'keep' ? 99 : ZONES.indexOf(groups.get(k)[0].zone));
    const keys = [...groups.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b, 'de'));

    const nMove = items.filter(moves).length;
    const nDel = items.filter((i) => O.del.has(i.id)).length;
    const bar = h('div', { class: 'row', style: { justifyContent: 'space-between', margin: '8px 0' } },
      h('span', null, h('b', null, nMove), ' werden verschoben' + (nDel ? ', ' + nDel + ' zum Löschen markiert' : '') + '.'),
      h('button', { class: 'btn primary', type: 'button', disabled: (O.busy || (!nMove && !nDel)) ? true : null, onclick: () => confirmApply(app) }, LC.icon('check'), 'Struktur übernehmen'));

    const rows = keys.map((k) => {
      const list = groups.get(k);
      const first = list[0];
      const isKeep = k === 'keep';
      const size = list.reduce((a, i) => a + i.size, 0);
      const skipped = !isKeep && !targetOf(first);
      const open = O.open.has(k);
      const head = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn ghost sm', type: 'button', 'aria-expanded': String(open), onclick: () => { if (open) O.open.delete(k); else O.open.add(k); app.render(); } }, LC.icon('chevron'), isKeep ? 'Bleibt wo es ist' : base(first.root) + '\\' + (targetOf(first) || first.target)),
        LC.badge(list.length + ' · ' + fmtBytes(size), ''),
        !isKeep ? LC.badge(first.zone, first.zone === 'Duplikat' ? 'warn' : first.zone === 'Wichtig' ? 'ok' : '') : null);
      const edit = isKeep ? null : (() => {
        const inp = h('input', { type: 'text', value: skipped ? '' : targetOf(first), 'aria-label': 'Zielordner', style: { flex: '1 1 240px', minWidth: '0' }, disabled: skipped ? true : null });
        inp.addEventListener('change', () => { O.map[keyOf(first)] = inp.value.trim() || null; app.render(); });
        return h('div', { class: 'row', style: { margin: '6px 0 0 30px' } }, inp,
          h('label', { class: 'row', style: { gap: '6px' } }, h('input', { type: 'checkbox', checked: skipped ? true : null, onchange: (e) => { O.map[keyOf(first)] = e.target.checked ? null : first.target; app.render(); } }), 'nicht verschieben'),
          h('span', { class: 'small muted' }, ZONE_HINT[first.zone] || ''));
      })();
      const body = open ? h('div', { style: { margin: '6px 0 0 30px' } }, list.slice(0, 200).map((it) => h('div', { class: 'task-row', style: { gridTemplateColumns: '1fr auto auto' } },
        h('div', null, h('div', { style: { fontWeight: '600', wordBreak: 'break-all' } }, (it.isDir ? '📁 ' : '') + it.name),
          h('div', { class: 'small muted' }, fmtBytes(it.size) + ' · ' + LC.fmtDate(it.modified) + (it.isDir ? ' · ' + it.files + ' Dateien' : '') + (it.duplicateOf ? ' · gleicher Inhalt wie ' + base(it.duplicateOf) : '')),
          h('div', { class: 'row', style: { gap: '4px', marginTop: '2px' } }, it.tags.map((t) => h('button', { class: 'fchip', type: 'button', style: { padding: '0 8px', fontSize: '12px' }, onclick: () => { O.tag = O.tag === t ? '' : t; app.render(); } }, t)))),
        isKeep ? h('span') : h('label', { class: 'row small', style: { gap: '4px' } }, h('input', { type: 'checkbox', checked: O.skip.has(it.id) ? true : null, onchange: (e) => { if (e.target.checked) O.skip.add(it.id); else O.skip.delete(it.id); app.render(); } }), 'bleibt'),
        h('label', { class: 'row small', style: { gap: '4px', color: 'var(--critical)' } }, h('input', { type: 'checkbox', checked: O.del.has(it.id) ? true : null, onchange: (e) => { if (e.target.checked) O.del.add(it.id); else O.del.delete(it.id); app.render(); } }), 'löschen'))),
      list.length > 200 ? h('div', { class: 'small muted' }, '… und ' + (list.length - 200) + ' weitere') : null) : null;
      return h('div', { class: 'card', style: { padding: '10px 14px' } }, head, edit, body);
    });

    return LC.card('2. Vorgeschlagene Struktur', 'tasks', [
      h('p', { class: 'ink2' }, plan.totalFiles + ' Dateien (' + fmtBytes(plan.totalBytes) + ') geprüft, ' + items.length + ' Einträge im Vorschlag'
        + (plan.duplicates ? ', ' + plan.duplicates + ' Duplikate (' + fmtBytes(plan.duplicateBytes) + ')' : '') + '. ' + (plan.truncated ? 'Die Analyse war zu groß und wurde gekürzt – wähle kleinere Ordner für ein vollständiges Bild.' : '')),
      h('p', { class: 'small muted' }, 'Aufbau: Wichtig / Aktuell / Archiv, darunter die Art der Datei (Dokumente nach Thema, Bilder und Videos nach Jahr). Ändere einen Zielordner, setze „nicht verschieben“ oder markiere einzelne Einträge.'),
      tags.length ? h('div', { class: 'chips', 'aria-label': 'Schlagwörter' }, tags.map(([t, n]) => h('button', { class: 'fchip', type: 'button', 'aria-pressed': String(O.tag === t), onclick: () => { O.tag = O.tag === t ? '' : t; app.render(); } }, t, h('span', { class: 'n' }, String(n))))) : null,
      bar, h('div', { class: 'stack', style: { gap: '8px' } }, rows)]);
  }

  LC.pages.organize = (S, app) => {
    load(app);
    const out = [h('div', { class: 'page-title' }, h('h2', null, 'Ordnen'), h('p', null, 'Prüft deine Ordner gründlich und schlägt eine Struktur vor, damit du alles schnell wiederfindest. Gelöscht wird nichts – außer, was du ausdrücklich markierst.'))];
    if (O.result) {
      const r = O.result;
      out.push(h('div', { class: 'callout ' + (r.errors.length ? 'warn' : 'ok') },
        h('b', null, r.moved + ' verschoben'), (r.deleted ? ', ' + r.deleted + ' in den Papierkorb' : '') + (r.skipped ? ', ' + r.skipped + ' übersprungen' : '') + (r.deleteDeclined ? '. Das Löschen hast du nicht bestätigt – diese Elemente blieben unberührt' : '') + '. ',
        h('button', { class: 'btn sm', type: 'button', onclick: () => undo(app, r.runId) }, 'Rückgängig machen'),
        r.errors.length ? h('ul', { class: 'small' }, r.errors.slice(0, 8).map((e) => h('li', null, e.name + ': ' + e.message))) : null));
    }
    out.push(chooser(app));
    if (O.plan) out.push(proposal(app));
    const runs = (O.runs || []).filter((x) => x && x.moved + x.deleted > 0);
    if (runs.length) {
      out.push(LC.card('Frühere Durchläufe', 'refresh', runs.map((x) => h('div', { class: 'task-row', style: { gridTemplateColumns: '1fr auto' } },
        h('div', null, LC.fmtDateTime(x.at) + ' – ' + x.moved + ' verschoben' + (x.deleted ? ', ' + x.deleted + ' gelöscht' : '')),
        x.undone ? LC.badge('rückgängig gemacht', '') : h('button', { class: 'btn sm', type: 'button', onclick: () => undo(app, x.id) }, 'Rückgängig')))));
    }
    return h('div', { class: 'stack' }, ...out);
  };
})(typeof window !== 'undefined' ? window : globalThis);
