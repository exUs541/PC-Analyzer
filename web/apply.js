/* apply.js - "Empfehlung umsetzen": one click (and one dialog that lists exactly what will happen) instead of many steps.
 *
 *   LC.apply.plan(hs, S, only)     what the recommendation would do now: { steps[] }   only = 'restore' | 'move' | 'cleanup' | null (all)
 *   LC.apply.open(S, app, hs, only) dialog -> runs the steps
 *   LC.apply.caches(S, app, sp)     dialog for the uncritical caches of the storage analysis
 *   LC.apply.panels(S, app)         progress of a running/finished copy to the Drive
 *
 * Nothing here gets around the safety rules; it only saves the clicking:
 *  - restore  copies the files that only the old Drive folder has into the Drive (same path, nothing overwritten, every file verified)
 *  - move     the verified copy of the "Dateien & Cloud" move; the originals stay until you remove them there (after the Drive says "synchronisiert")
 *  - cleanup  marks and confirms the listed items, then the server checks them again and Windows opens its own window where
 *             ENTFERNEN is typed once; everything goes to the Recycle Bin.
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  // loaded before ui.js: look the helpers up when they are used
  const h = (...a) => LC.h(...a);
  const fmtBytes = (b) => LC.fmtBytes(b);
  const A = (LC.apply = {});

  // state shared with the pages (the proposals you un-ticked, the copy job)
  const houseUi = (LC.houseUi = LC.houseUi || { off: new Set() });
  const filesUi = () => (LC.filesUi = LC.filesUi || { selected: new Set(), targets: new Map(), job: null, polling: false });

  const onList = (S, path) => { const it = S.cleanupDoc && S.cleanupDoc.items && S.cleanupDoc.items[LC.cleanup.pathId(path)]; return !!it && (it.state === 'confirmed' || it.state === 'started'); };
  const inProfile = (p) => /^[a-z]:\\users\\[^\\]+\\/i.test(String(p));

  /** What the recommendation would do right now. */
  A.plan = (hs, S, only) => {
    const steps = [];
    const want = (id) => !only || only === id;
    const d = hs && hs.drive && hs.drive.compare;
    if (want('restore') && hs.hasCloud && d && d.onlyFiles > 0 && !d.partial && hs.drive.liveRoot) {
      steps.push({ id: 'restore', title: 'Fehlende Dateien ins Drive kopieren', count: d.onlyFiles, bytes: d.onlyBytes,
        text: d.onlyFiles + ' Dateien aus dem alten Drive-Ordner kommen in dein Drive (' + hs.drive.liveRoot + '), jeweils an denselben Pfad. Nichts wird überschrieben, jede Datei wird danach per Prüfsumme geprüft, der alte Ordner bleibt unverändert.',
        rows: d.dirs.slice(0, 6).map((x) => ({ name: x.dir.slice(hs.drive.root.length).replace(/^[\\/]+/, '') || '(Hauptordner)', detail: x.files + ' ' + LC.plural(x.files, 'Datei', 'Dateien'), bytes: x.bytes })) });
    }
    if (want('move') && hs && hs.hasCloud && hs.cloud && hs.cloud.mode !== 'mirror') {
      const items = hs.by.archive.items.filter((i) => !houseUi.off.has(i.id));
      if (items.length) {
        steps.push({ id: 'move', title: 'Alte Ordner ins Drive-Archiv kopieren', count: items.length, bytes: items.reduce((a, i) => a + i.bytes, 0), items,
          text: items.length + ' Ordner werden nach ' + hs.cloud.root + ' kopiert und Datei für Datei geprüft. Die Originale bleiben, bis du sie unter „Dateien & Cloud“ entfernst (nachdem Drive „synchronisiert“ meldet).',
          rows: items.slice(0, 8).map((i) => ({ name: i.name, detail: '→ ' + (i.target || ''), bytes: i.bytes })) });
      }
    }
    if (want('cleanup') && hs) {
      const items = hs.by.cleanup.items.filter((i) => inProfile(i.path) && !onList(S, i.path));
      if (items.length) {
        steps.push({ id: 'cleanup', title: 'Installer und Kopien in den Papierkorb', count: items.length, bytes: items.reduce((a, i) => a + i.bytes, 0), items,
          text: items.length + ' Einträge werden bestätigt und an den Papierkorb übergeben. Danach öffnet Windows ein Fenster: Dort tippst du einmal ENTFERNEN, erst dann passiert etwas.',
          rows: items.slice(0, 8).map((i) => ({ name: i.name, detail: i.root, bytes: i.bytes })) });
      }
    }
    return { steps };
  };

  const rowsTable = (rows) => h('div', { class: 'stack', style: { gap: '2px', marginTop: '4px' } }, rows.map((r) => h('div', { class: 'row between small' }, h('span', null, h('b', null, r.name), r.detail ? h('span', { class: 'muted' }, ' · ' + r.detail) : null), h('span', { class: 'num' }, fmtBytes(r.bytes)))));

  function dialog(title, steps, confirmLabel, note, onConfirm) {
    const dlg = LC.modal({
      title, wide: true,
      body: h('div', { class: 'stack' },
        steps.map((s, i) => h('section', { class: 'callout' }, h('b', null, (steps.length > 1 ? (i + 1) + '. ' : '') + s.title + ' (' + s.count + ', ' + fmtBytes(s.bytes) + ')'), h('p', { class: 'small', style: { margin: '4px 0' } }, s.text), s.rows && s.rows.length ? rowsTable(s.rows) : null)),
        h('p', { class: 'small muted' }, note)),
      actions: [h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Abbrechen'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { dlg.close(); onConfirm(); } }, LC.icon('check'), confirmLabel)],
    });
  }

  /* ------------------------------------------------------------------ the steps */
  async function runRestore(S, app) {
    const r = await app.api('/api/restore/start', { method: 'POST', body: '{}' });
    filesUi().restore = { id: r.id, result: null, progress: null, startedAt: Date.now() };
    pollRestore(S, app);
    return 'Das Kopieren der fehlenden Dateien läuft.';
  }

  function pollRestore(S, app) {
    const R = filesUi().restore;
    if (!R || R.polling) return;
    R.polling = true;
    const tick = async () => {
      try {
        const st = await app.api('/api/restore/status?id=' + encodeURIComponent(R.id));
        R.result = st.result; R.progress = st.progress;
        if (S.route === 'house') app.render({ background: true });
        if (st.result) {
          R.polling = false;
          LC.toast(st.result.state === 'done' ? st.result.copied + ' Dateien ins Drive kopiert und geprüft. Ein neuer Dateien-Scan gleicht den alten Ordner jetzt noch einmal ab.' : 'Kopieren nicht möglich: ' + st.result.error, 9000);
          if (st.result.state === 'done' && !S.filesScanning) app.scanFiles();       // the comparison then shows whether anything is still missing
          return;
        }
      } catch (e) { /* server busy: try again */ }
      setTimeout(tick, 2500);
    };
    setTimeout(tick, 1500);
  }

  async function runMove(S, app, hs, items) {
    const P = filesUi();
    const mv = items.map((i) => ({ name: i.name, bytes: i.bytes, src: i.path, dst: LC.joinPath(hs.cloud.root, ...String(i.target).split(/[\\/]+/).filter(Boolean)) }));
    const r = await app.api('/api/move/start', { method: 'POST', body: JSON.stringify({ cloudRoot: hs.cloud.root, items: mv.map((i) => ({ src: i.src, dst: i.dst })) }) });
    P.job = { id: r.id, items: mv, state: 'running', result: null, cleanup: null };
    if (LC.pollMoveJob) LC.pollMoveJob(S, app);
    return 'Das Kopieren der Ordner ins Drive läuft.';
  }

  /** Mark + confirm + hand over to the server (which checks everything again) and Windows' own ENTFERNEN window. */
  async function runCleanup(app, items, why) {
    const specs = items.map((i) => ({ path: i.path, kind: i.kind === 'file' ? 'file' : 'dir', name: i.name, bytes: i.bytes, reason: why + ': ' + (i.reason || '') }));
    app.updateCleanup((d) => specs.forEach((s) => {
      LC.cleanup.addPath(d, s);
      LC.cleanup.confirm(d, { id: LC.cleanup.pathId(s.path), type: 'path' }, { ack: true, note: 'Per Klick auf „Umsetzen“ bestätigt (Liste im Dialog).' });
    }));
    await app.cleanup.deletePaths(specs.map((s) => ({ id: LC.cleanup.pathId(s.path) })));
    return 'Das Fenster zum Entfernen ist offen: Tippe dort ENTFERNEN.';
  }

  /** Dialog + run for the recommendation of the house rules (all steps, or one of them). */
  A.open = (S, app, hs, only) => {
    const { steps } = A.plan(hs, S, only);
    if (!steps.length) { LC.toast('Dafür gibt es im Moment nichts umzusetzen.', 4000); return; }
    const total = steps.reduce((a, s) => a + s.bytes, 0);
    dialog(only ? steps[0].title : 'Empfehlung umsetzen', steps, only ? 'Jetzt umsetzen' : 'Alles umsetzen (' + steps.length + ' ' + LC.plural(steps.length, 'Schritt', 'Schritte') + ')',
      'Nichts davon löscht etwas im Drive. Zusammen geht es um ' + fmtBytes(total) + '. Den alten Drive-Ordner selbst legst du danach im Explorer in den Papierkorb (er enthält u. a. ein Git-Repository, das das Tool nicht anfasst).',
      async () => {
        const done = [], failed = [];
        for (const s of steps) {
          try {
            if (s.id === 'restore') done.push(await runRestore(S, app));
            else if (s.id === 'move') done.push(await runMove(S, app, hs, s.items));
            else if (s.id === 'cleanup') done.push(await runCleanup(app, s.items, 'Hausordnung'));
          } catch (e) { failed.push(s.title + ': ' + e.message); }
        }
        if (done.length) LC.toast(done.join(' '), 9000);
        if (failed.length) LC.toast('Nicht gestartet – ' + failed.join(' | '), 12000);
        app.render();
      });
  };

  /** The uncritical caches of the storage analysis (rebuild themselves): only inside your profile, never system-managed temp folders. */
  const SYSTEM_MANAGED = new Set(['user-temp', 'win-temp', 'wu-download', 'windows-old']);
  A.cacheItems = (sp, S) => (sp ? sp.items.filter((i) => i.safety === 'safe' && i.kind === 'folder' && inProfile(i.path) && !SYSTEM_MANAGED.has(i.rule) && !onList(S, i.path)) : []);

  A.caches = (S, app, sp) => {
    const items = A.cacheItems(sp, S);
    if (!items.length) { LC.toast('Keine unkritischen Caches zum Aufräumen gefunden.', 4000); return; }
    const step = { id: 'cleanup', title: 'Caches und Reste aufräumen', count: items.length, bytes: items.reduce((a, i) => a + i.bytes, 0),
      text: 'Diese Ordner bauen sich von selbst neu auf (Zwischenspeicher, Build-Caches). Danach öffnet Windows ein Fenster: Dort tippst du einmal ENTFERNEN, erst dann geht alles in den Papierkorb.',
      rows: items.slice(0, 10).map((i) => ({ name: i.label, detail: i.short, bytes: i.bytes })) };
    dialog('Unkritisches aufräumen', [step], 'Jetzt aufräumen', 'Windows- und Programmordner, Temp-Ordner (dafür gibt es „Speicher → Temporäre Dateien“ in den Windows-Einstellungen) und Ordner außerhalb deines Benutzerordners fasst das Tool nicht an.',
      async () => { try { LC.toast(await runCleanup(app, items.map((i) => ({ path: i.path, kind: 'dir', name: i.label, bytes: i.bytes, reason: i.hint })), 'Speicher-Analyse'), 9000); } catch (e) { LC.toast('Nicht gestartet: ' + e.message, 10000); } app.render(); });
  };

  /* ------------------------------------------------------------------ progress of the copy to the Drive (shown on the house page) */
  A.panels = (S, app) => {
    const P = filesUi();
    const out = [];
    const R = P.restore;
    if (R) {
      if (!R.polling && !R.result) pollRestore(S, app);
      const r = R.result;
      let body;
      if (!r) body = h('p', null, (R.progress && R.progress.phase === 'compare' ? 'Vergleiche den alten Ordner mit dem Drive …' : 'Kopiere ' + (R.progress && R.progress.total ? LC.fmtNum(R.progress.done, 0) + ' von ' + LC.fmtNum(R.progress.total, 0) + ' Dateien' : '…')) + ' (diese Anzeige aktualisiert sich selbst)');
      else if (r.state === 'error') body = h('div', { class: 'callout critical' }, 'Nicht kopiert: ' + r.error);
      else body = [h('div', { class: 'facts' }, h('span', null, h('b', null, LC.fmtNum(r.copied, 0) + ' kopiert und geprüft'), ' (' + fmtBytes(r.copiedBytes) + ')'), r.existing ? h('span', null, r.existing + ' lagen im Drive schon anders vor (nicht überschrieben)') : null, r.failed ? h('span', null, h('b', null, r.failed + ' Fehler')) : null),
        r.failures && r.failures.length ? h('div', { class: 'callout warn' }, r.failures.slice(0, 5).map((f) => h('div', { class: 'small' }, f.path + ': ' + f.error))) : null,
        h('p', { class: 'small muted' }, 'Ein neuer Dateien-Scan gleicht den alten Ordner danach noch einmal ab. Steht dort „Im Drive fehlt nichts“, kannst du ihn im Explorer in den Papierkorb legen.')];
      out.push(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('cloud', 'lg')), h('h3', null, 'Kopieren der fehlenden Dateien ins Drive')), body));
    }
    if (P.job && LC.moveJobPanel) out.push(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('cloud', 'lg')), h('h3', null, 'Umzug ins Drive-Archiv')), LC.moveJobPanel(S, app)));
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
