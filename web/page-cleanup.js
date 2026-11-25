/* page-cleanup.js - "Aufräumen": everything marked for uninstall/delete, why, what else is affected, explicit confirmation.
 * Also exports LC.relationsPanel (used by the software drawer too). */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h, fmtBytes } = LC;

  const IMPACT_SEV = { breaks: 'critical', data: 'warn', degrades: 'warn', orphan: 'info', leftover: 'info', info: 'info' };
  const impactChip = (impact) => LC.chip(IMPACT_SEV[impact] || 'info', LC.IMPACT[impact].label);
  const STATE_CHIP = {
    suggested: () => LC.badge('Vorschlag des Tools', 'auto'),
    marked: () => LC.chip('warn', 'Zu bestätigen'),
    confirmed: () => LC.chip('critical', 'Bestätigt – bereit zum Entfernen'),
    started: () => LC.chip('info', 'Gestartet'),
    done: () => LC.chip('ok', 'Erledigt'),
  };

  /* ------------------------------------------------------------------ affected objects */
  /**
   * @param rel    result of LC.relationsOfApp / relationsOfPath
   * @param opts   { picked: Map (id -> relation item) -> shows checkboxes "ebenfalls auf die Liste",
   *                 onOpenApp(key), onReveal(path), onAdd(item) -> shows an "Auch markieren" button }
   */
  LC.relationsPanel = (rel, opts) => {
    opts = opts || {};
    const wrap = h('div', { class: 'rel stack', style: { gap: '12px' } });
    if (rel.protect) wrap.appendChild(h('div', { class: 'callout critical' }, h('b', null, 'Systemnah: '), 'Dieses Programm gehört zur Grundfunktion deines PCs (z. B. Grafiktreiber). Entferne es nur, wenn du genau weißt warum.'));
    for (const t of rel.tips || []) wrap.appendChild(h('div', { class: 'callout' }, h('b', null, 'Gut zu wissen: '), t));
    if (rel.needsFilesScan) {
      wrap.appendChild(h('div', { class: 'callout' }, h('b', null, 'Dateien & Datenordner unbekannt: '), 'Ohne Dateien-Scan weiß LaptopCheck nicht, welche Dateien und Ordner zu diesem Programm gehören. ',
        h('button', { class: 'btn sm', type: 'button', onclick: () => LC.app.go('files') }, LC.icon('cloud'), 'Zum Dateien-Scan')));
    }
    if (!rel.groups.length) wrap.appendChild(h('div', { class: 'muted' }, rel.needsFilesScan ? 'Nach dem Dateien-Scan erscheinen hier betroffene Dateien und Ordner.' : 'Nichts weiter gefunden, das an diesem Objekt hängt.'));
    for (const g of rel.groups) {
      const head = [h('h5', null, g.label, ' ', h('span', { class: 'muted small' }, '(' + g.items.length + ')')), h('div', { class: 'small muted', style: { marginBottom: '4px' } }, g.help)];
      const list = h('ul', { class: 'rel-list' }, g.items.map((i) => relRow(i, opts)));
      // "similar programs" is only a hint: keep it folded
      wrap.appendChild(g.id === 'peers'
        ? h('details', { class: 'rel-group' }, h('summary', null, LC.icon('chevron'), ' ', g.label + ' (' + g.items.length + ')'), h('div', { class: 'small muted', style: { margin: '4px 0' } }, g.help), list)
        : h('section', { class: 'rel-group' }, head, list));
    }
    return wrap;
  };

  function relRow(i, opts) {
    const canAddApp = i.app && i.group !== 'dependants' && i.group !== 'peers' && opts.picked;
    const canAddPath = i.add && opts.picked;
    const left = [];
    if (canAddApp || canAddPath) {
      const cb = h('input', { type: 'checkbox', 'aria-label': 'Ebenfalls auf die Aufräumliste setzen: ' + i.title });
      cb.addEventListener('change', () => { if (cb.checked) opts.picked.set(i.id, i); else opts.picked.delete(i.id); });
      left.push(h('label', { class: 'rel-pick', title: 'Ebenfalls auf die Aufräumliste setzen (wird danach separat bestätigt)' }, cb));
    }
    return h('li', { class: 'rel-item impact-' + i.impact },
      left,
      h('div', { class: 'grow' },
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, impactChip(i.impact), h('b', null, i.title),
          i.bytes ? LC.badge(fmtBytes(i.bytes), '') : null,
          i.confidence !== 'sicher' ? LC.badge(i.confidence, 'auto', 'Wie sicher die Zuordnung ist') : null),
        i.detail ? h('div', { class: 'small ink2' }, i.detail) : null,
        h('div', { class: 'row', style: { gap: '6px', marginTop: '4px' } },
          i.path && opts.onReveal ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => opts.onReveal(i.path) }, LC.icon('folder'), 'Im Explorer zeigen') : null,
          i.app && opts.onOpenApp ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => opts.onOpenApp(i.app) }, 'Programm ansehen') : null,
          i.projectId && opts.onOpenProject ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => opts.onOpenProject(i.projectId) }, 'Projekt ansehen') : null,
          opts.onAdd && (i.add || (i.app && i.group !== 'dependants' && i.group !== 'peers')) ? h('button', { class: 'btn sm', type: 'button', onclick: () => opts.onAdd(i) }, LC.icon('plus'), 'Auch entfernen?') : null)));
  }

  const summaryChips = (rel) => {
    if (!rel) return null;
    const s = rel.summary;
    const parts = [];
    if (s.breaks) parts.push(LC.chip('critical', s.breaks + ' ' + LC.plural(s.breaks, 'Abhängigkeit', 'Abhängigkeiten') + ' brechen'));
    if (s.data) parts.push(LC.chip('warn', s.data + ' mit deinen Daten'));
    if (s.degrades) parts.push(LC.chip('warn', s.degrades + ' eingeschränkt'));
    if (s.orphan) parts.push(LC.chip('info', s.orphan + ' danach überflüssig'));
    if (s.leftover) parts.push(LC.chip('info', s.leftover + ' Rest' + (s.leftoverBytes ? ' (' + fmtBytes(s.leftoverBytes) + ')' : '') + ' bleibt liegen'));
    return parts.length ? h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, parts) : h('span', { class: 'small muted' }, rel.needsFilesScan ? 'Dateien & Datenordner noch nicht geprüft' : 'Nichts weiter betroffen');
  };

  /* ------------------------------------------------------------------ page */
  const FILTERS = [['todo', 'Zu erledigen'], ['suggested', 'Vorschläge'], ['done', 'Erledigt'], ['all', 'Alle']];

  LC.pages.cleanup = (S, app) => {
    const m = S.model;
    const c = m.cleanup;
    const t = c.totals;
    S.cleanupFilter = S.cleanupFilter || 'todo';
    const inFilter = (i) => (S.cleanupFilter === 'todo' ? ['marked', 'confirmed', 'started'].includes(i.state) : S.cleanupFilter === 'suggested' ? i.state === 'suggested' : S.cleanupFilter === 'done' ? i.state === 'done' : true);
    const list = c.items.filter(inFilter);
    const count = (id) => c.items.filter((i) => (id === 'todo' ? ['marked', 'confirmed', 'started'].includes(i.state) : id === 'suggested' ? i.state === 'suggested' : id === 'done' ? i.state === 'done' : true)).length;

    const head = h('div', { class: 'page-title' }, h('h2', null, 'Aufräumen'),
      h('p', null, 'Hier legst du fest, was entfernt werden soll. Nichts passiert ohne deine Bestätigung, und Dateien landen im Papierkorb.'));

    const how = h('details', { class: 'card how' }, h('summary', null, LC.icon('chevron'), ' So läuft das Entfernen ab'),
      h('ol', { class: 'steps' },
        h('li', null, h('b', null, 'Markieren: '), 'Du setzt ein Programm auf „Entfernen“ (Programmliste) oder übernimmst einen Vorschlag. Das ändert nichts am PC.'),
        h('li', null, h('b', null, 'Prüfen & bestätigen: '), 'LaptopCheck zeigt, wie und wo das Objekt benutzt wird und was sonst betroffen ist (Dateien, Programmdaten, Projekte, Begleitprogramme). Du bestätigst jedes Objekt einzeln.'),
        h('li', null, h('b', null, 'Entfernen starten: '), 'Programme: das eigene Deinstallationsprogramm öffnet sich und fragt noch einmal. Dateien/Ordner: ein Fenster listet alles auf; erst nach Eintippen von „ENTFERNEN“ wandert es in den Papierkorb (wiederherstellbar).'),
        h('li', null, h('b', null, 'Neu scannen: '), 'Danach prüft ein Scan, ob es wirklich weg ist; erledigte Objekte wandern in den Verlauf.')),
      h('p', { class: 'small muted' }, 'Geschützt sind u. a. Windows-Ordner, Programme-Ordner, Cloud-Ordner (ein Löschen dort würde auch die Cloud-Kopie löschen) und Ordner mit Git-Repositories.'));

    const stats = h('div', { class: 'grid tiles small' },
      stat('Zu bestätigen', t.marked, 'Objekte, die du markiert hast'),
      stat('Bestätigt', t.confirmed, 'bereit zum Entfernen'),
      stat('Vorschläge', t.suggested, t.suggestedBytes ? 'bis ' + fmtBytes(t.suggestedBytes) : 'nichts offen'),
      stat('Platz (markiert)', t.pendingBytes ? fmtBytes(t.pendingBytes) : '–', t.leftoverBytes ? '+ ' + fmtBytes(t.leftoverBytes) + ' Reste' : 'Programmgröße lt. Windows'));

    const filters = h('div', { class: 'filters' }, h('div', { class: 'seg', role: 'group', 'aria-label': 'Ansicht' },
      FILTERS.map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(S.cleanupFilter === id), onclick: () => { S.cleanupFilter = id; app.render(); } }, label + ' (' + count(id) + ')'))),
      t.done ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => app.cleanup.clearHistory() }, 'Verlauf leeren') : null);

    const confirmedPaths = c.by.confirmed.filter((i) => i.type === 'path');
    const bulk = confirmedPaths.length && S.cleanupFilter !== 'suggested' && S.cleanupFilter !== 'done'
      ? h('div', { class: 'card bulk' }, LC.sevIcon('warn', true), h('div', { class: 'grow' },
        h('b', null, confirmedPaths.length + ' bestätigte(s) ' + LC.plural(confirmedPaths.length, 'Objekt', 'Objekte') + ' (' + fmtBytes(confirmedPaths.reduce((s, i) => s + i.bytes, 0)) + ') liegen bereit.'),
        h('div', { class: 'small ink2' }, 'Ein Fenster listet alles auf. Nichts passiert, bevor du dort „ENTFERNEN“ tippst. Alles geht in den Papierkorb.')),
        h('button', { class: 'btn danger', type: 'button', onclick: () => app.cleanup.deletePaths(confirmedPaths) }, LC.icon('trash'), 'Papierkorb-Fenster öffnen'))
      : null;

    const empty = h('div', { class: 'card empty' }, S.cleanupFilter === 'todo'
      ? ['Nichts zum Entfernen markiert. ', t.suggested ? h('button', { class: 'btn sm', type: 'button', onclick: () => { S.cleanupFilter = 'suggested'; app.render(); } }, t.suggested + ' ' + LC.plural(t.suggested, 'Vorschlag', 'Vorschläge') + ' ansehen') : 'Markiere Programme in der Programmliste mit „✖ Entfernen“.']
      : 'Nichts in dieser Ansicht.');

    return h('div', { class: 'stack' }, head, how, stats, filters, bulk, ...(list.length ? list.map((i) => itemCard(i, S, app)) : [empty]), manualAdd(app));
  };

  function stat(label, value, sub) {
    return h('div', { class: 'card tile' }, h('div', { class: 't-head' }, h('span', null, label)), h('div', { class: 't-val' }, String(value)), h('div', { class: 't-sub' }, sub));
  }

  function itemCard(item, S, app) {
    const open = !!S.cleanupOpen[item.id];
    const rel = item.rel;
    const icon = item.type === 'app' ? 'package' : item.kind === 'file' ? 'file' : 'folder';
    const toggle = () => { S.cleanupOpen[item.id] = !open; app.render(); };
    const reasons = item.reasons.length
      ? h('ul', { class: 'reasons' }, item.reasons.map((r) => h('li', null, LC.badge(r.by === 'du' ? 'von dir' : 'Tool', r.by === 'du' ? 'manual' : 'auto'), ' ', r.text)))
      : h('div', { class: 'small muted' }, 'Keine Begründung gespeichert.');

    const actions = [];
    if (item.state === 'suggested') {
      actions.push(h('button', { class: 'btn primary sm', type: 'button', onclick: () => app.cleanup.mark(item) }, LC.icon('plus'), 'Zur Aufräumliste'));
      actions.push(h('button', { class: 'btn sm', type: 'button', title: 'Das Tool schlägt dieses Objekt nicht mehr vor', onclick: () => app.cleanup.keep(item) }, 'Behalten'));
    } else if (item.state === 'marked') {
      actions.push(h('button', { class: 'btn primary sm', type: 'button', onclick: () => confirmDialog(item, S, app) }, LC.icon('check'), 'Prüfen & bestätigen …'));
      actions.push(h('button', { class: 'btn sm', type: 'button', onclick: () => app.cleanup.unmark(item) }, 'Von der Liste nehmen'));
      actions.push(h('button', { class: 'btn sm', type: 'button', onclick: () => app.cleanup.keep(item) }, 'Behalten'));
    } else if (item.state === 'confirmed') {
      if (item.type === 'app') {
        if (item.via === 'store' || !item.canUninstall) actions.push(LC.openButton('apps-features', { label: 'Windows: Installierte Apps öffnen' }), h('span', { class: 'small muted' }, 'Dieses Programm hat kein klassisches Deinstallationsprogramm – dort „Deinstallieren“ wählen.'));
        else actions.push(h('button', { class: 'btn danger sm', type: 'button', onclick: () => app.cleanup.uninstall(item) }, LC.icon('trash'), 'Deinstallationsprogramm öffnen'));
      } else actions.push(h('span', { class: 'small ink2' }, 'Wird gemeinsam über „Papierkorb-Fenster öffnen“ (oben) entfernt.'), h('button', { class: 'btn sm', type: 'button', onclick: () => app.cleanup.deletePaths([item]) }, LC.icon('trash'), 'Nur dieses entfernen …'));
      actions.push(h('button', { class: 'btn sm', type: 'button', onclick: () => app.cleanup.revoke(item) }, 'Bestätigung zurücknehmen'));
    } else if (item.state === 'started') {
      actions.push(h('span', { class: 'small ink2' }, item.type === 'app' ? 'Deinstallationsprogramm wurde geöffnet' + (item.startedAt ? ' (' + LC.fmtDateTime(item.startedAt) + ')' : '') + '. Danach neu scannen.' : 'Papierkorb-Fenster wurde geöffnet. Hast du dort nichts bestätigt, bleibt alles unverändert.'));
      actions.push(h('button', { class: 'btn sm', type: 'button', onclick: () => app.cleanup.revoke(item) }, 'Zurücksetzen'));
      if (item.type === 'app') actions.push(h('button', { class: 'btn sm', type: 'button', onclick: () => app.scan(false) }, LC.icon('refresh'), 'Jetzt neu scannen'));
    }
    if (item.type === 'path' && item.path) actions.push(h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.reveal(item.path) }, LC.icon('folder'), 'Im Explorer zeigen'));
    actions.push(LC.reviewButton({ id: 'cleanup:' + item.id, kind: 'cleanup', title: item.name }, { ghost: true }));
    if (item.type === 'app' && item.app && item.state !== 'done') actions.push(h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { S.drawerId = item.app.id; app.go('software', { filter: 'remove' }); } }, 'Programm-Details'));

    return h('article', { class: 'card clean-item state-' + item.state, id: 'ci-' + item.id.replace(/\W+/g, '_') },
      h('div', { class: 'ci-head' },
        h('span', { class: 'icon-badge' }, LC.icon(icon, 'lg')),
        h('div', { class: 'grow' },
          h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, h('h3', { style: { margin: 0 } }, item.name), STATE_CHIP[item.state](),
            item.bytes ? LC.badge((item.bytesApprox ? 'mind. ' : '') + fmtBytes(item.bytes), '') : null,
            item.type === 'app' ? LC.badge(item.via === 'store' ? 'Store-App' : 'Programm', '') : LC.badge(item.kind === 'file' ? 'Datei' : 'Ordner', '')),
          item.subtitle ? h('div', { class: 'small muted ' + (item.type === 'path' ? 'mono' : '') }, item.subtitle) : null),
        item.state !== 'done' ? h('button', { class: 'btn ghost sm', type: 'button', 'aria-expanded': String(open), onclick: toggle }, 'Betroffen & Verwendung', LC.icon('chevron', open ? 'flip' : '')) : null),
      item.state === 'done' ? h('div', { class: 'small muted' }, item.doneAt ? 'Erledigt ' + LC.fmtDate(item.doneAt) : 'Beim letzten Scan nicht mehr vorhanden.') : [
        h('div', { class: 'ci-why' }, h('h4', null, 'Warum steht es auf der Liste?'), reasons),
        item.rec && item.rec.lastResult ? h('div', { class: 'callout warn' }, h('b', null, 'Beim letzten Versuch nicht entfernt: '), item.rec.lastResult) : null,
        h('div', { class: 'ci-affected' }, h('h4', null, 'Was ist sonst betroffen?'), summaryChips(rel)),
        open && rel ? h('div', { class: 'ci-detail' },
          rel.usage.length ? h('div', null, h('h4', null, 'Wie wurde es verwendet?'), LC.kv(rel.usage.map((u) => [u.label, u.value + (u.hint ? ' · ' + u.hint : '')]))) : null,
          LC.relationsPanel(rel, relOpts(S, app))) : null,
        h('div', { class: 'actions' }, actions)]);
  }

  const relOpts = (S, app) => ({
    onReveal: (p) => app.reveal(p),
    onOpenApp: (key) => { const a = S.model.inv.apps.find((x) => x.key === key); if (a) { S.drawerId = a.id; app.go('software'); } },
    onOpenProject: (id) => app.go('projects', { open: id }),
  });

  /* ------------------------------------------------------------------ confirmation */
  /** opts.start: after the confirmation open the uninstaller / recycle window right away ("direkt deinstallieren"). */
  LC.confirmRemoval = (item, S, app, opts) => confirmDialog(item, S, app, opts);
  function confirmDialog(item, S, app, opts) {
    opts = opts || {};
    const rel = item.rel;
    const picked = new Map();
    const isApp = item.type === 'app';
    const ack = h('input', { type: 'checkbox', id: 'cd-ack' });
    const prot = h('input', { type: 'checkbox', id: 'cd-prot' });
    const ok = h('button', { class: 'btn danger', type: 'button', disabled: true }, LC.icon(opts.start ? 'trash' : 'check'), opts.start ? (isApp ? 'Bestätigen & Deinstallationsprogramm öffnen' : 'Bestätigen & Papierkorb-Fenster öffnen') : 'Entfernen bestätigen');
    const refresh = () => { ok.disabled = !(ack.checked && (!rel.protect || prot.checked)); };
    ack.addEventListener('change', refresh); prot.addEventListener('change', refresh);
    let dlg;
    ok.addEventListener('click', async () => {
      for (const r of picked.values()) {
        if (r.add) app.cleanup.addPath(r.add);
        else if (r.app) { const a = S.model.inv.apps.find((x) => x.key === r.app); if (a) app.setAppField(a.key, 'decision', 'remove', { keepDrawer: true }); }
      }
      if (isApp) app.setAppField(item.app.key, 'decision', 'remove', { keepDrawer: true });   // so it shows up on the clean-up list (and as "gestartet")
      app.cleanup.confirm(item, { ack: true });
      dlg.close();
      if (opts.start) { if (isApp) await app.cleanup.uninstall(item); else await app.cleanup.deletePaths([item]); }
      else LC.toast(picked.size ? 'Bestätigt – ' + picked.size + ' weitere(s) Objekt(e) stehen jetzt zur Bestätigung auf der Liste.' : 'Bestätigt. Als Nächstes: „Entfernen starten“.', 5000);
    });
    const what = opts.start && isApp ? 'Nach deiner Bestätigung öffnet sich sofort das Deinstallationsprogramm des Herstellers. Es fragt noch einmal nach; LaptopCheck entfernt nichts im Hintergrund.' : isApp
      ? (item.via === 'store' || !item.canUninstall ? 'Dieses Programm musst du anschließend in den Windows-Einstellungen (Apps) deinstallieren.' : 'Danach öffnest du das Deinstallationsprogramm. Es ist das normale Programm des Herstellers und fragt noch einmal nach.')
      : 'Danach öffnet sich ein Fenster mit der Liste. Erst wenn du dort „ENTFERNEN“ tippst, wird es in den Papierkorb gelegt (wiederherstellbar).';
    const body = h('div', { class: 'stack', style: { gap: '14px' } },
      h('p', null, h('b', null, item.name), item.bytes ? ' (' + fmtBytes(item.bytes) + ')' : '', ' – ', what),
      h('div', null, h('h4', null, 'Warum steht es auf der Liste?'), h('ul', { class: 'reasons' }, item.reasons.map((r) => h('li', null, LC.badge(r.by === 'du' ? 'von dir' : 'Tool', r.by === 'du' ? 'manual' : 'auto'), ' ', r.text)))),
      rel.usage.length ? h('div', null, h('h4', null, 'Wie wurde es verwendet?'), LC.kv(rel.usage.map((u) => [u.label, u.value + (u.hint ? ' · ' + u.hint : '')]))) : null,
      h('div', null, h('h4', null, 'Was ist sonst betroffen?'), summaryChips(rel),
        h('div', { class: 'small muted', style: { margin: '4px 0 8px' } }, 'Häkchen = ebenfalls auf die Aufräumliste setzen. Auch das wird danach noch einmal einzeln bestätigt.'),
        LC.relationsPanel(rel, { ...relOpts(S, app), picked })),
      rel.protect ? h('label', { class: 'check' }, prot, ' Mir ist klar, dass dieses Programm zur Grundfunktion des PCs gehört.') : null,
      h('label', { class: 'check strong' }, ack, ' ', rel.summary.needsAck
        ? 'Ich habe die betroffenen Objekte gelesen (insbesondere Abhängigkeiten und eigene Daten) und möchte „' + item.name + '“ trotzdem entfernen.'
        : 'Ich möchte „' + item.name + '“ entfernen.'));
    dlg = LC.modal({ title: 'Entfernen bestätigen', body, wide: true, actions: [h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Abbrechen'), ok] });
  }

  /* ------------------------------------------------------------------ manual add */
  function manualAdd(app) {
    const path = h('input', { type: 'text', placeholder: 'C:\\Users\\…\\Ordner oder Datei', 'aria-label': 'Pfad' });
    const kind = h('select', { 'aria-label': 'Art', style: { width: 'auto' } }, h('option', { value: 'dir' }, 'Ordner'), h('option', { value: 'file' }, 'Datei'));
    const add = () => {
      const p = path.value.trim().replace(/^"+|"+$/g, '');
      if (!p) return;
      if (!/^[a-zA-Z]:[\\/]|^\\\\|^\//.test(p)) { LC.toast('Bitte einen vollständigen Pfad angeben, z. B. C:\\Users\\Name\\Downloads\\alt.', 5000); return; }
      app.cleanup.addPath({ path: p, kind: kind.value, name: p.split(/[\\/]/).filter(Boolean).pop(), bytes: 0, reason: 'Von dir von Hand hinzugefügt.' });
      path.value = '';
    };
    path.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    return h('details', { class: 'card' }, h('summary', null, LC.icon('chevron'), ' Datei oder Ordner von Hand hinzufügen'),
      h('p', { class: 'small muted' }, 'Der Pfad wird nur vorgemerkt. Beim Entfernen prüft LaptopCheck ihn erneut und verweigert Windows-, Programme- und Cloud-Ordner sowie Ordner mit Git-Repositories.'),
      h('div', { class: 'row' }, h('div', { style: { flex: '1 1 320px' } }, path), kind, h('button', { class: 'btn primary', type: 'button', onclick: add }, LC.icon('plus'), 'Vormerken')));
  }
})(typeof window !== 'undefined' ? window : globalThis);
