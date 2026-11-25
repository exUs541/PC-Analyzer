/* page-house.js - "Hausordnung" (Mein PC): what stays on this PC, what moves to Google Drive, what can go - and the "Spar-Plan" with every way to save space.
 * Nothing is moved or deleted here. Moving goes through the verified cloud move of "Dateien & Cloud" (the proposals are only pre-selected there),
 * deleting through the clean-up list (every item confirmed one by one, Recycle Bin). */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h, fmtBytes } = LC;

  const UI = (LC.houseUi = LC.houseUi || { off: new Set() });          // proposals you un-ticked (everything else is ticked); shared with apply.js
  const fmtAge = (d) => (d == null ? '–' : d >= 365 ? 'vor ' + (d / 365).toFixed(1).replace('.', ',') + ' Jahren' : 'vor ' + d + ' Tagen');

  function ruleField(app, label, key, unit, hint, min, max, value) {
    const inp = h('input', { type: 'number', min: String(min), max: String(max), step: '1', value: String(value), style: { width: '90px' }, 'aria-label': label });
    inp.addEventListener('change', () => app.updateConfig((c) => { c.house = Object.assign({}, c.house, { [key]: +inp.value }); }));
    return h('label', { class: 'field' }, h('span', { class: 'lab' }, label), h('span', { class: 'row', style: { gap: '6px' } }, inp, unit), h('span', { class: 'small muted' }, hint));
  }

  function keepButton(app, it) {
    return h('button', { class: 'btn ghost sm', type: 'button', title: 'Dieser Ordner bleibt immer lokal und taucht hier nicht mehr als Vorschlag auf.',
      onclick: () => app.updateConfig((c) => { const k = (c.house && c.house.keepLocal) || []; c.house = Object.assign({}, c.house, { keepLocal: k.concat([it.path]) }); }) }, LC.icon('check'), 'Lokal behalten');
  }

  function savingsCard(m, app) {
    const sp = m.savings;
    if (!sp || !sp.levers.length) return null;
    const max = sp.levers[0].bytes || 1;
    const used = m.hw.storage.systemVolume && m.hw.storage.systemVolume.usedBytes;
    const rows = sp.levers.map((l) => h('div', { class: 'bar-row wide' },
      h('div', null, h('b', null, l.label), h('div', { class: 'small muted' }, l.detail)),
      LC.meter([{ pct: (l.bytes / max) * 100, cls: l.id === 'house' ? 'g1' : l.id === 'drive' ? 'g4' : l.id === 'inventory' ? 'g3' : 'g2', title: fmtBytes(l.bytes) }], true),
      h('div', { class: 'why small row', style: { gap: '8px' } }, h('b', null, fmtBytes(l.bytes)), h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.go(l.page, l.params) }, 'Ansehen'))));
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('storage', 'lg')), h('h3', null, 'Spar-Plan: wo du Speicher zurückholen kannst')),
      rows,
      h('div', { class: 'callout ok', style: { marginTop: '10px' } }, h('b', null, 'Zusammen etwa ' + fmtBytes(sp.totalBytes)), used ? ' – das sind rund ' + Math.round((sp.totalBytes / used) * 100) + ' % deines belegten Speichers.' : '.',
        ' Die Posten liegen an verschiedenen Orten und überschneiden sich nicht. Größen ungenutzter Programme sind Näherungen. Nichts davon passiert von selbst: Du bestätigst jeden Schritt.'));
  }

  function rulesCard(hs, app) {
    const r = hs.rules;
    const keepChips = r.keepLocal.length
      ? h('div', { class: 'chips' }, r.keepLocal.map((p) => h('span', { class: 'badge manual' }, LC.spaceShortPath ? LC.spaceShortPath(p) : p, ' ',
        h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': p + ' entfernen', style: { padding: '0 4px' }, onclick: () => app.updateConfig((c) => { c.house = Object.assign({}, c.house, { keepLocal: r.keepLocal.filter((x) => x !== p) }); }) }, '×'))))
      : h('span', { class: 'small muted' }, 'noch keine – bei jedem Vorschlag gibt es „Lokal behalten“');
    const root = h('input', { type: 'text', value: r.archiveRoot, 'aria-label': 'Archiv-Ordner im Drive', style: { width: '220px' } });
    root.addEventListener('change', () => app.updateConfig((c) => { c.house = Object.assign({}, c.house, { archiveRoot: root.value }); }));
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('settings', 'lg')), h('h3', null, 'Deine Regeln')),
      h('p', { class: 'small muted' }, 'Was du brauchst, bleibt lokal. Was länger niemand angefasst hat, ist ein Kandidat für Google Drive. Die Grenzen bestimmst du; eine Änderung wirkt sofort.'),
      h('div', { class: 'grid cols-2' },
        ruleField(app, 'Dokumente, Desktop, Bilder, Videos', 'archiveAfterDays', 'Tage unberührt', 'Danach schlägt die Hausordnung vor, den Ordner nach Drive zu verschieben.', 30, 3650, r.archiveAfterDays),
        ruleField(app, 'Downloads', 'downloadsAfterDays', 'Tage unberührt', 'Downloads sind ein Eingang, kein Lager: hier gilt eine kürzere Frist.', 7, 3650, r.downloadsAfterDays),
        ruleField(app, 'Erst ab dieser Größe', 'minMB', 'MB', 'Kleinkram ist die Mühe nicht wert.', 5, 10240, r.minMB),
        h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Archiv-Ordner im Drive'), root, h('span', { class: 'small muted' }, 'Dorthin zieht alles Alte um: Archiv-Ordner / Jahr / Ordnername.')),
        h('div', { style: { display: 'grid', gap: '4px', fontSize: '13px', alignContent: 'start' } }, h('span', { style: { fontWeight: '600' } }, 'Immer lokal behalten'), keepChips)));
  }

  function archiveSection(hs, S, app) {
    const L = hs.by.archive.items;
    if (!L.length) return null;
    const on = (i) => !UI.off.has(i.id);
    const picked = L.filter(on);
    const pickedBytes = picked.reduce((a, i) => a + i.bytes, 0);
    const rows = L.map((i) => {
      const cb = h('input', { type: 'checkbox', checked: on(i) ? true : null, 'aria-label': i.name + ' auswählen' });
      cb.addEventListener('change', () => { if (cb.checked) UI.off.delete(i.id); else UI.off.add(i.id); app.render(); });
      const target = h('input', { type: 'text', value: i.target, 'aria-label': 'Ziel im Drive für ' + i.name, style: { minWidth: '0', width: '100%' } });
      target.addEventListener('change', () => { i.target = target.value.trim().replace(/^[\\/]+|[\\/]+$/g, ''); LC.filesUi.targets.set(i.path, i.target); });
      return h('div', { class: 'sp-row' },
        h('div', { class: 'sp-top' }, h('label', { class: 'row', style: { gap: '8px' } }, cb, h('span', { class: 'sp-name' }, h('b', null, i.name), h('span', { class: 'small muted', title: i.path }, ' · ' + i.root))), h('div', { class: 'sp-size num' }, fmtBytes(i.bytes))),
        h('div', { class: 'sp-tags' }, LC.badge(fmtAge(i.ageDays) + ' zuletzt benutzt', ''), LC.badge(LC.fmtNum(i.files, 0) + ' Dateien', ''), h('span', { class: 'sp-actions' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.reveal(i.path) }, LC.icon('folder'), 'Im Explorer zeigen'), keepButton(app, i))),
        h('div', { class: 'small muted' }, 'Ziel im Drive: '), target,
        h('div', { class: 'sp-hint' }, i.reason));
    });
    const go = () => {
      const P = LC.filesUi;
      for (const i of picked) { P.selected.add(i.path); P.targets.set(i.path, i.target); }
      LC.toast(picked.length + ' Ordner sind im Umzugsplan vorgemerkt. Dort startest du das Kopieren und Prüfen.', 6000);
      app.go('files');
    };
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('cloud', 'lg')), h('h3', null, 'Nach Google Drive verschieben: ' + L.length + ' Ordner (' + fmtBytes(hs.by.archive.bytes) + ')')),
      h('p', { class: 'small muted' }, 'Diese Ordner hat seit langem niemand angefasst. Im gestreamten Drive belegen sie auf diesem PC fast keinen Platz mehr, bleiben aber erreichbar. Der Umzug kopiert, prüft jede Datei per Prüfsumme und entfernt Originale erst nach deiner Bestätigung.'),
      !hs.hasCloud ? h('div', { class: 'callout warn' }, 'Es wurde kein Cloud-Ordner gefunden. Ohne Google Drive für Desktop lässt sich nichts verschieben.') : null,
      h('div', { class: 'sp-list' }, rows),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn primary', type: 'button', disabled: !picked.length || !hs.hasCloud || (hs.cloud && hs.cloud.mode === 'mirror') ? true : null, onclick: () => LC.apply.open(S, app, hs, 'move') }, LC.icon('cloud'), 'Jetzt ins Drive kopieren (' + picked.length + ' Ordner, ' + fmtBytes(pickedBytes) + ')'),
        h('button', { class: 'btn ghost', type: 'button', disabled: !picked.length || !hs.hasCloud ? true : null, onclick: go }, LC.icon('folder'), 'Im Umzugsplan ansehen')));
  }

  function cleanupSection(hs, S, app) {
    const L = hs.by.cleanup.items;
    if (!L.length) return null;
    // already on the clean-up list (and not yet done)? Then there is nothing to mark again.
    const onList = (i) => { const it = S.cleanupDoc && S.cleanupDoc.items && S.cleanupDoc.items[LC.cleanup.pathId(i.path)]; return !!it && it.state !== 'done'; };
    const todo = L.filter((i) => !onList(i));
    const mark = (list) => {
      app.updateCleanup((d) => list.forEach((i) => LC.cleanup.addPath(d, { path: i.path, kind: i.kind === 'file' ? 'file' : 'dir', name: i.name, bytes: i.bytes, reason: 'Hausordnung: ' + i.reason })));
      LC.toast(list.length + ' Eintrag/Einträge zum Aufräumen vorgemerkt. Bestätigen kannst du sie auf der Seite „Aufräumen“.', 6000);
    };
    const rows = L.map((i) => h('div', { class: 'sp-row' },
      h('div', { class: 'sp-top' }, h('div', { class: 'sp-name' }, h('b', null, i.name), h('span', { class: 'small muted', title: i.path }, ' · ' + i.root + (i.kind === 'file' ? ' (Datei)' : ''))), h('div', { class: 'sp-size num' }, fmtBytes(i.bytes))),
      h('div', { class: 'sp-hint' }, i.reason),
      h('div', { class: 'sp-tags' }, h('span', { class: 'sp-actions' },
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.reveal(i.path) }, LC.icon('folder'), 'Im Explorer zeigen'),
        onList(i)
          ? h('button', { class: 'btn ghost sm', type: 'button', title: 'Dort bestätigst du jeden Eintrag einzeln.', onclick: () => app.go('cleanup') }, LC.icon('check'), 'Vorgemerkt – zur Aufräumliste')
          : h('button', { class: 'btn ghost sm', type: 'button', onclick: () => mark([i]) }, LC.icon('trash'), 'Zum Aufräumen vormerken'),
        keepButton(app, i)))));
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('trash', 'lg')), h('h3', null, 'Kann weg: ' + L.length + ' Einträge (' + fmtBytes(hs.by.cleanup.bytes) + ')')),
      h('p', { class: 'small muted' }, 'Installer, die sich neu laden lassen, und Kopien, die schon in der Cloud liegen. Archive (.zip, .7z …) stehen nie hier, denn darin können eigene Sachen stecken. „Vormerken“ setzt sie nur auf die Aufräumliste: Entfernt wird erst, wenn du dort jeden Eintrag einzeln bestätigst, und es geht in den Papierkorb.'),
      h('div', { class: 'sp-list' }, rows),
      h('div', { class: 'row', style: { marginTop: '10px' } }, todo.length ? h('button', { class: 'btn primary', type: 'button', onclick: () => LC.apply.open(S, app, hs, 'cleanup') }, LC.icon('trash'), 'Jetzt in den Papierkorb (' + todo.length + ' Einträge, ' + fmtBytes(todo.reduce((a, i) => a + i.bytes, 0)) + ')') : null, todo.length
        ? h('button', { class: 'btn', type: 'button', onclick: () => mark(todo) }, LC.icon('trash'), todo.length === L.length ? 'Alle ' + L.length + ' zur Aufräumliste vormerken' : 'Die übrigen ' + todo.length + ' zur Aufräumliste vormerken')
        : h('button', { class: 'btn', type: 'button', onclick: () => app.go('cleanup') }, LC.icon('check'), 'Alle vorgemerkt – zur Aufräumliste')));
  }

  function looksSection(hs, app) {
    const L = hs.by.git.items.concat(hs.by.manual.items);
    if (!L.length) return null;
    const rows = L.map((i) => h('div', { class: 'sp-row' },
      h('div', { class: 'sp-top' }, h('div', { class: 'sp-name' }, h('b', null, i.name), h('span', { class: 'small muted', title: i.path }, ' · ' + i.root + (i.kind === 'file' ? ' (Datei)' : ''))), h('div', { class: 'sp-size num' }, fmtBytes(i.bytes))),
      h('div', { class: 'sp-hint' }, i.reason),
      h('div', { class: 'sp-tags' }, h('span', { class: 'sp-actions' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.reveal(i.path) }, LC.icon('folder'), 'Im Explorer zeigen'), keepButton(app, i)))));
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('search', 'lg')), h('h3', null, 'Selbst ansehen: ' + L.length + ' Einträge (' + fmtBytes(hs.by.git.bytes + hs.by.manual.bytes) + ')')),
      h('p', { class: 'small muted' }, 'Code gehört in ein Git-Repository, einzelne große Dateien verschiebt der Umzug nicht (er arbeitet mit Ordnern). Hier entscheidest du selbst.'), h('div', { class: 'sp-list' }, rows));
  }

  function keepSection(hs, app) {
    const L = hs.by.keep.items;
    if (!L.length) return null;
    return h('details', { class: 'card' }, h('summary', null, 'Bleibt lokal: ' + L.length + ' Einträge (' + fmtBytes(hs.by.keep.bytes) + ') – benutzt oder von dir behalten'),
      h('div', { class: 'stack', style: { marginTop: '8px', gap: '4px' } }, L.slice(0, 40).map((i) => h('div', { class: 'row between small' },
        h('span', null, h('b', null, i.name), h('span', { class: 'muted' }, ' · ' + i.root + ' · ' + i.reason)), h('span', { class: 'num' }, fmtBytes(i.bytes))))));
  }

  /** Short and first: what should go to Google Drive (and what should leave the PC), in the order that frees the most - each step with its own button. */
  function recommendCard(hs, S, app) {
    const d = hs.drive && hs.drive.compare;
    const plan = LC.apply.plan(hs, S, null);
    const can = (id) => plan.steps.some((x) => x.id === id);
    const steps = [];   // { title, detail, id (apply step), extra: button }
    if (hs.drive && d && d.onlyFiles) steps.push({ id: 'restore', title: 'Fehlende Dateien ins Drive kopieren', detail: d.onlyFiles + ' Dateien (' + fmtBytes(d.onlyBytes) + ') liegen nur im alten Drive-Ordner auf dem PC und fehlen im echten Drive. Sind sie dort, kann der alte Ordner ganz weg (' + fmtBytes(hs.drive.bytes) + ' auf dem PC).' });
    else if (hs.drive && d) steps.push({ title: 'Alten Drive-Ordner in den Papierkorb legen', detail: 'Alles darin (' + fmtBytes(hs.drive.bytes) + ') liegt schon im Drive. Das ist der größte Hebel. Das legst du selbst im Explorer in den Papierkorb (er enthält u. a. ein Git-Repository, das das Tool nicht anfasst).',
      extra: h('button', { class: 'btn sm', type: 'button', onclick: () => app.reveal(hs.drive.root) }, LC.icon('folder'), 'Ordner im Explorer zeigen') });
    else if (hs.drive) steps.push({ title: 'Alten Drive-Ordner mit dem Drive abgleichen', detail: 'Auf dem PC liegt noch eine Kopie (' + fmtBytes(hs.drive.bytes) + '). Ein neuer Dateien-Scan zeigt, was davon im Drive fehlt.',
      extra: h('button', { class: 'btn sm', type: 'button', disabled: S.filesScanning ? true : null, onclick: () => app.scanFiles() }, LC.icon('search'), S.filesScanning ? 'Scanne …' : 'Dateien-Scan starten') });
    if (hs.hasCloud && hs.by.archive.count) steps.push({ id: 'move', title: 'Alte Ordner ins Drive-Archiv verschieben', detail: hs.by.archive.count + ' Ordner (' + fmtBytes(hs.by.archive.bytes) + '), z. B. ' + hs.by.archive.items.slice(0, 3).map((i) => i.name).join(', ') + '. Im Drive belegen sie auf dem PC fast nichts mehr.' });
    if (hs.by.cleanup.count) steps.push({ id: 'cleanup', title: 'Installer und Kopien entfernen', detail: hs.by.cleanup.count + ' Einträge (' + fmtBytes(hs.by.cleanup.bytes) + '): Installer, die sich neu laden lassen, und Kopien, die schon in der Cloud liegen.' });
    if (hs.by.manual.count) steps.push({ title: 'Große lose Dateien ansehen', detail: hs.by.manual.count + ' Dateien (' + fmtBytes(hs.by.manual.bytes) + ') seit langem unberührt: ins Drive legen oder löschen. Das entscheidest du selbst (siehe „Selbst ansehen“ weiter unten).' });
    const all = plan.steps.length
      ? h('button', { class: 'btn primary', type: 'button', onclick: () => LC.apply.open(S, app, hs, null) }, LC.icon('check'), 'Alles umsetzen (' + plan.steps.length + ' ' + LC.plural(plan.steps.length, 'Schritt', 'Schritte') + ', ' + fmtBytes(plan.steps.reduce((x, y) => x + y.bytes, 0)) + ')') : null;
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('cloud', 'lg')), h('h3', null, 'Meine Empfehlung: Das gehört in dein Google Drive'), all),
      h('p', { class: 'small muted' }, 'Alles, was in Google Drive liegt, bleibt dort: Das Tool holt nichts auf den PC und löscht nichts im Drive. Auf dem PC bleibt, was du brauchst. Jeder Schritt zeigt dir vorher in einem Fenster, was genau passiert.'),
      steps.length ? h('ol', { class: 'list-plain' }, steps.map((x, i) => h('li', null, h('b', null, (i + 1) + '. ' + x.title), h('div', { class: 'small ink2' }, x.detail),
        x.id && can(x.id) ? h('div', { style: { marginTop: '6px' } }, h('button', { class: 'btn sm primary', type: 'button', onclick: () => LC.apply.open(S, app, hs, x.id) }, LC.icon('check'), 'Jetzt umsetzen')) : x.extra ? h('div', { style: { marginTop: '6px' } }, x.extra) : null)))
        : h('div', { class: 'callout ok' }, 'Im Moment gibt es nichts, was nach Google Drive gehört.'));
  }

  /** The old local copy of the Drive: what is already in the real Drive, what is missing there, and what to do. */
  function driveSection(hs, S, app) {
    const dv = hs.drive;
    if (!dv) return null;
    const c = dv.compare;
    const head = h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('cloud', 'lg')), h('h3', null, 'Alter Drive-Ordner: ' + fmtBytes(dv.bytes) + ' auf dem PC'));
    if (!c) {
      return h('section', { class: 'card' }, head,
        h('p', { class: 'small muted' }, h('span', { class: 'mono' }, dv.root), ' ist ein Rest einer früheren Spiegelung. Dein Drive läuft gestreamt' + (dv.liveRoot ? ' (' + dv.liveRoot + ')' : '') + ', dieser Ordner wird nicht mehr synchronisiert.'),
        h('div', { class: 'callout' }, 'Noch nicht abgeglichen. Der Dateien-Scan vergleicht jede Datei (Pfad und Größe, nur lesend) mit dem Drive und zeigt, ob etwas nur hier liegt.'),
        h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn primary', type: 'button', disabled: S.filesScanning ? true : null, onclick: () => app.scanFiles() }, LC.icon(S.filesScanning ? 'refresh' : 'search', S.filesScanning ? 'spin' : ''), S.filesScanning ? 'Scanne …' : 'Dateien-Scan starten (mit Abgleich)'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => app.reveal(dv.root) }, LC.icon('folder'), 'Im Explorer zeigen')));
    }
    const base = c.bytes || 1;
    const rel = (p) => String(p).slice(dv.root.length).replace(/^[\\/]+/, '');
    const dirs = c.dirs.map((d) => h('div', { class: 'sp-row' },
      h('div', { class: 'sp-top' }, h('div', { class: 'sp-name' }, h('b', null, rel(d.dir) || '(direkt im Hauptordner)'), h('span', { class: 'small muted' }, ' · ' + d.files + ' ' + LC.plural(d.files, 'Datei', 'Dateien'))), h('div', { class: 'sp-size num' }, fmtBytes(d.bytes))),
      h('div', { class: 'sp-hint' }, 'Ziel im Drive: ' + (dv.liveRoot || 'Drive') + '\\' + rel(d.dir)),
      h('div', { class: 'sp-tags' }, h('span', { class: 'sp-actions' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.reveal(d.dir) }, LC.icon('folder'), 'Im Explorer zeigen')))));
    const top = c.top.slice(0, 15);
    return h('section', { class: 'card' }, head,
      h('p', { class: 'small muted' }, h('span', { class: 'mono' }, dv.root), ' ist ein Rest einer früheren Spiegelung und wird nicht mehr synchronisiert. Verglichen wurde mit ' + (dv.liveRoot || 'dem Drive') + ' (Pfad und Größe, nur lesend' + (c.files ? ', ' + LC.fmtNum(c.files, 0) + ' Dateien' : '') + ').'),
      c.partial ? h('div', { class: 'callout warn' }, 'Der Abgleich wurde wegen der Zeitgrenze abgebrochen: Die Zahlen sind unvollständig. Prüfe vor dem Löschen noch einmal mit einem neuen Dateien-Scan.') : null,
      LC.meter([{ pct: (c.inDriveBytes / base) * 100, cls: 'g1', title: 'Liegt schon im Drive: ' + fmtBytes(c.inDriveBytes) }, { pct: (c.onlyBytes / base) * 100, cls: 'sev-warn', title: 'Fehlt im Drive: ' + fmtBytes(c.onlyBytes) }, { pct: (c.junkBytes / base) * 100, cls: 'soft', title: 'Verknüpfungen und Hilfsdateien: ' + fmtBytes(c.junkBytes) }], true),
      h('div', { class: 'facts', style: { marginTop: '6px' } },
        h('span', null, h('b', null, fmtBytes(c.inDriveBytes) + ' (' + c.pct + ' %)'), ' liegen unverändert im Drive – die Kopie hier ist überflüssig'),
        h('span', null, h('b', null, LC.fmtNum(c.onlyFiles, 0) + ' ' + LC.plural(c.onlyFiles, 'Datei', 'Dateien') + ' (' + fmtBytes(c.onlyBytes) + ')'), ' fehlen im Drive'),
        c.junkFiles ? h('span', null, c.junkFiles + ' Verknüpfungen und Hilfsdateien (zählen nicht)') : null),
      c.onlyFiles
        ? h('div', null,
          h('div', { class: 'callout warn', style: { margin: '10px 0' } }, h('b', null, 'Nicht löschen, solange diese Dateien fehlen. '), 'Kopiere sie in den gleichen Unterordner im Drive, starte danach einen neuen Dateien-Scan und prüfe, dass hier „Im Drive fehlt nichts“ steht.'),
          !c.partial && dv.liveRoot ? h('div', { class: 'row', style: { marginBottom: '10px' } }, h('button', { class: 'btn primary', type: 'button', onclick: () => LC.apply.open(S, app, hs, 'restore') }, LC.icon('cloud'), 'Fehlende Dateien jetzt ins Drive kopieren (' + c.onlyFiles + ', ' + fmtBytes(c.onlyBytes) + ')')) : null,
          h('div', { class: 'sp-list' }, dirs), c.dirsMore ? h('p', { class: 'small muted' }, '… und ' + c.dirsMore + ' weitere Ordner mit kleineren Mengen.') : null,
          top.length ? h('details', { style: { marginTop: '8px' } }, h('summary', null, 'Die größten fehlenden Dateien'),
            h('div', { class: 'stack', style: { gap: '4px', marginTop: '6px' } }, top.map((f) => h('div', { class: 'row between small' }, h('span', { title: f.p }, rel(f.p)), h('span', { class: 'num' }, fmtBytes(f.s)))))) : null)
        : h('div', { class: 'callout ok', style: { margin: '10px 0' } }, h('b', null, 'Im Drive fehlt nichts. '), 'Du kannst den Ordner im Explorer in den Papierkorb legen: Rechtsklick auf den Ordner → Löschen. Das Drive-Laufwerk und die Cloud bleiben unberührt.'),
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn', type: 'button', onclick: () => app.reveal(dv.root) }, LC.icon('folder'), 'Alten Ordner im Explorer zeigen'),
        h('button', { class: 'btn ghost', type: 'button', disabled: S.filesScanning ? true : null, onclick: () => app.scanFiles() }, LC.icon(S.filesScanning ? 'refresh' : 'search', S.filesScanning ? 'spin' : ''), S.filesScanning ? 'Scanne …' : 'Neu abgleichen')),
      h('p', { class: 'small muted' }, 'Das Tool löscht in Cloud-Ordnern nichts, damit nie versehentlich etwas aus dem Drive verschwindet. Das Löschen des alten Ordners machst du deshalb selbst im Explorer (er landet im Papierkorb).'));
  }

  const habits = () => h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('tasks', 'lg')), h('h3', null, 'So bleibt es ordentlich')),
    h('ul', { class: 'list-plain' },
      h('li', null, h('b', null, 'Downloads sind ein Eingang. '), 'Was du brauchst, legst du in einen Projekt- oder Dokumentenordner; alles andere räumt die Hausordnung nach der kurzen Frist weg.'),
      h('li', null, h('b', null, 'Programme über Windows entfernen und danach hier nachsehen. '), 'Unter „Inventur“ erscheinen die Reste eines deinstallierten Programms ab dem nächsten Scan als sicherer Rest.'),
      h('li', null, h('b', null, 'Projekte in einen eigenen Ordner, Code zu GitHub. '), 'Dann bleibt sofort klar, was lebt, und alte Projekte lassen sich als Ganzes ins Archiv ziehen.'),
      h('li', null, h('b', null, 'Google Drive bleibt auf „Dateien streamen“. '), 'Dann kostet alles, was du ins Archiv legst, auf dem PC fast nichts.'),
      h('li', null, h('b', null, 'Einmal im Monat neu scannen. '), 'Der Spar-Plan oben zeigt, was sich angesammelt hat.')));

  LC.pages.house = (S, app) => {
    const m = S.model;
    const hs = m.house;
    const out = [h('div', { class: 'page-title' }, h('h2', null, 'Hausordnung'),
      h('p', null, 'Was du brauchst, bleibt auf dem PC. Was seit langem niemand anfasst, zieht nach Google Drive. Installer und Kopien in der Cloud können weg. So sparst du Speicher – ohne dass etwas ohne dein Zutun verschwindet.'))];
    if (!hs) {
      out.push(h('div', { class: 'card', style: { textAlign: 'center', padding: '36px 24px' } }, h('h3', null, 'Noch keine Hausordnung'),
        h('p', { class: 'muted', style: { margin: '8px auto 16px', maxWidth: '520px' } }, 'Dafür liest LaptopCheck einmal deine Ordner (nur lesend, ca. 1–3 Minuten): Namen, Größen und Änderungsdaten.'),
        h('button', { class: 'btn primary', type: 'button', disabled: S.filesScanning ? true : null, onclick: () => app.scanFiles() }, LC.icon(S.filesScanning ? 'refresh' : 'search', S.filesScanning ? 'spin' : ''), S.filesScanning ? 'Scanne …' : 'Dateien-Scan starten')));
      const sp0 = savingsCard(m, app);
      return h('div', { class: 'stack' }, out[0], sp0, out[1]);
    }
    const nothing = !hs.by.archive.count && !hs.by.cleanup.count
      ? h('div', { class: 'callout ok' }, h('b', null, 'Nach deinen Regeln ist bei deinen Ordnern nichts zu tun. '), 'Alles, was größer als ' + hs.rules.minMB + ' MB ist, wurde in den letzten ' + hs.rules.archiveAfterDays + ' Tagen benutzt (Downloads: ' + hs.rules.downloadsAfterDays + ' Tage) oder liegt schon in der Cloud. Strengere Grenzen stellst du unter „Deine Regeln“ ein.')
      : null;
    const sections = [recommendCard(hs, S, app), ...LC.apply.panels(S, app), savingsCard(m, app), driveSection(hs, S, app), rulesCard(hs, app), nothing, archiveSection(hs, S, app), cleanupSection(hs, S, app), looksSection(hs, app), keepSection(hs, app), habits()].filter(Boolean);
    return h('div', { class: 'stack' }, ...out, ...sections);
  };
})(typeof window !== 'undefined' ? window : globalThis);
