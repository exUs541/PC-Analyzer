/* page-review.js - "Wichtig – bitte prüfen": mark any entry you find suspicious (a size that cannot be right, a wrong date, a
 * finding that does not fit ...). The page collects the marked entries with their raw data, commands to re-check by hand,
 * a live re-measurement for programs, and a "Prüfpaket" (text) that can be pasted into a chat to have it checked. */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h, fmtBytes } = LC;

  const KIND_LABEL = { app: 'Programm', task: 'Aufgabe / Befund', project: 'Projekt', cleanup: 'Aufräum-Objekt', hardware: 'Hardware' };

  const redact = (text) => String(text).replace(/([A-Za-z]:\\Users\\)[^\\"\s]+/gi, '$1<Benutzer>').replace(/(\/Users\/|\/home\/)[^/"\s]+/g, '$1<Benutzer>');
  LC.redactPaths = redact;
  const reviews = (S) => S.notes.reviews || {};
  LC.reviewCount = (S) => Object.values(reviews(S)).filter((r) => r.status !== 'checked').length;

  /* ------------------------------------------------------------------ the flag button + dialog */
  LC.reviewButton = (spec, opts) => {
    opts = opts || {};
    const S = LC.app.S;
    const rev = reviews(S)[spec.id];
    const flagged = !!rev && rev.status !== 'checked';
    if (!(S.config && S.config.expert) && !rev) return null;   // an expert function: off until switched on (Einstellungen)
    return h('button', { class: 'btn sm' + (opts.ghost ? ' ghost' : ''), type: 'button', 'aria-pressed': String(flagged),
      title: 'Als wichtig markieren – der Eintrag landet auf der Seite „Prüfen“, und du kannst ihn mir zur Kontrolle geben', onclick: (e) => { e.stopPropagation(); reviewDialog(spec); } },
    LC.icon('flag'), opts.compact ? null : flagged ? 'Zur Prüfung markiert' : 'Wichtig – bitte prüfen');
  };

  function reviewDialog(spec) {
    const S = LC.app.S;
    const rev = reviews(S)[spec.id];
    const note = h('textarea', { rows: 3, placeholder: 'Was kommt dir komisch vor? z. B. „62 GB kann nicht stimmen“' });
    note.value = rev ? rev.note || '' : '';
    let dlg;
    const save = (status) => {
      LC.app.updateNotes((n) => {
        n.reviews = n.reviews || {};
        n.reviews[spec.id] = { ...(n.reviews[spec.id] || {}), kind: spec.kind, title: spec.title, note: note.value.trim(), at: (n.reviews[spec.id] && n.reviews[spec.id].at) || new Date().toISOString(), status };
        if (status === 'checked') n.reviews[spec.id].checkedAt = new Date().toISOString();
      });
      dlg.close();
      LC.toast(status === 'checked' ? 'Als geprüft abgehakt.' : 'Markiert – zu sehen unter „Prüfen“.', 3500);
    };
    dlg = LC.modal({
      title: 'Wichtig – bitte prüfen', onClose: () => {},
      body: h('div', { class: 'stack' }, h('p', null, h('b', null, spec.title), ' (' + (KIND_LABEL[spec.kind] || spec.kind) + ')'),
        h('p', { class: 'small muted' }, 'Der Eintrag erscheint unter „Prüfen“ – mit allen Rohdaten aus dem Scan und einem Prüfpaket, das du kopieren und mir geben kannst.'),
        h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Deine Anmerkung'), note)),
      actions: [rev ? h('button', { class: 'btn danger', type: 'button', onclick: () => { LC.app.updateNotes((n) => { delete n.reviews[spec.id]; }); dlg.close(); } }, 'Markierung entfernen') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Abbrechen'),
        rev && rev.status !== 'checked' ? h('button', { class: 'btn', type: 'button', onclick: () => save('checked') }, LC.icon('check'), 'Als geprüft abhaken') : null,
        h('button', { class: 'btn primary', type: 'button', onclick: () => save('open') }, LC.icon('flag'), rev ? 'Speichern' : 'Markieren')],
    });
  }

  /* ------------------------------------------------------------------ evidence per kind */
  const regPath = (id) => {
    const m = /^reg:(HKLM|HKCU):(x64|x86):(.+)$/.exec(id || '');
    if (!m) return null;
    const base = m[1] === 'HKCU' && m[2] === 'x86' ? 'SOFTWARE\\WOW6432Node' : m[1] === 'HKLM' && m[2] === 'x86' ? 'SOFTWARE\\WOW6432Node' : 'SOFTWARE';
    return m[1] + ':\\' + base + '\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + m[3];
  };

  function appEvidence(S, key) {
    const m = S.model;
    const a = m.inv.apps.find((x) => x.key === key);
    if (!a) return null;
    const rawSw = (m.snap.software || []).find((x) => x.id === a.id) || null;
    const facts = [
      ['Name / Version', a.name + (a.version ? ' ' + a.version : '')], ['Hersteller', a.publisher || '–'],
      ['Größe im Dashboard', a.sizeSuspect ? 'unplausibel (nicht gezählt)' : a.sizeKB ? (a.sizeApprox ? 'mind. ' : '') + LC.fmtKB(a.sizeKB) : 'unbekannt'],
      ['Quelle der Größe', { registry: 'Angabe des Installers (Registry EstimatedSize, in KB)', folder: 'Installationsordner gemessen', 'folder-partial': 'Installationsordner (Messung abgebrochen)', 'folder-corrected': 'Ordner nachgemessen – Installer meldete ' + LC.fmtKB(a.sizeClaimedKB) }[a.sizeSource] || a.sizeSource || '–'],
      ['Angabe des Installers', a.sizeClaimedKB ? LC.fmtKB(a.sizeClaimedKB) : '–'],
      ['Installationsordner', a.installLocation || '–'],
      ['Zuletzt benutzt', a.lastUsed ? LC.fmtDate(a.lastUsed) + ' (' + (a.lastUsedSource || '?') + ', Zuordnung ' + (a.lastUsedConfidence || '?') + ')' : 'keine Spur'],
      ['Nutzungsklasse', a.usageClass], ['Installiert am', a.installDate ? LC.fmtDate(a.installDate) + ' (' + (a.installDateSource || '?') + ')' : '–'],
      ['Autostart', a.startup ? a.startup.items.map((i) => i.name + (i.enabled ? ' (an)' : ' (aus)')).join(', ') : 'nein'],
      ['Einschätzung', a.reco.label + (a.reco.reasons.length ? ': ' + a.reco.reasons.map((r) => r.text).join(' | ') : '')],
      ['Deine Angaben', [a.decision && 'Entscheidung: ' + a.decision, a.purpose && 'Zweck: ' + a.purpose, a.note && 'Notiz: ' + a.note].filter(Boolean).join(' · ') || '–'],
      ['Nutzungsspuren', a.evidence.length ? a.evidence.map((e) => e.source + ' ' + (e.lastRun || 'ohne Datum') + ' ' + e.path).join(' | ') : 'keine'],
    ];
    const cmds = [];
    const rp = regPath(a.id);
    if (rp) cmds.push({ label: 'Eintrag in der Programmliste (Registry) ansehen', cmd: "Get-ItemProperty -LiteralPath 'Registry::" + rp.replace(/^(HKLM|HKCU):/, (x, h2) => (h2 === 'HKLM' ? 'HKEY_LOCAL_MACHINE' : 'HKEY_CURRENT_USER')) + "' | Select-Object DisplayName, DisplayVersion, EstimatedSize, InstallLocation, UninstallString | Format-List" });
    if (a.installLocation) cmds.push({ label: 'Größe des Installationsordners nachmessen (MB)', cmd: "'{0:N1} MB' -f ((Get-ChildItem -LiteralPath '" + a.installLocation.replace(/"/g, '') + "' -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB)" });
    return { title: a.name, facts, raw: rawSw, commands: cmds, canMeasure: a.source === 'registry' && /^reg:/.test(a.id), appId: a.id };
  }

  function evidenceFor(S, id) {
    const m = S.model;
    const [kind, ...rest] = id.split(':');
    const ref = rest.join(':');
    if (kind === 'app') return appEvidence(S, ref);
    if (kind === 'task') {
      const f = m.findings.find((x) => x.id === ref);
      return f ? { title: f.title, facts: [['Bereich', (LC.AREAS[f.area] || {}).label || f.area], ['Stufe', f.severity], ['Detail', f.detail], ['Empfehlung', f.action]], raw: { id: f.id, area: f.area, severity: f.severity, title: f.title, detail: f.detail, action: f.action }, commands: [] } : null;
    }
    if (kind === 'project') {
      const p = m.projects.projects.find((x) => x.id === ref);
      return p ? { title: p.name, facts: [['Status', p.status], ['Repos', p.repos.join(', ') || '–'], ['Ressourcen', p.resources.map((r) => r.name + ' = ' + r.effective + (r.how ? ' (' + r.how + ')' : '')).join('; ') || '–']], raw: { id: p.id, name: p.name, status: p.status, repos: p.repos, resources: p.resources.map((r) => ({ kind: r.kind, name: r.name, state: r.state, effective: r.effective })), tasks: p.tasks }, commands: [] } : null;
    }
    if (kind === 'cleanup') {
      const it = m.cleanup.items.find((x) => x.id === ref);
      return it ? { title: it.name, facts: [['Art', it.type === 'app' ? 'Programm' : it.kind], ['Status', it.state], ['Größe', it.bytes ? fmtBytes(it.bytes) : '–'], ['Begründungen', it.reasons.map((r) => r.text).join(' | ')], ['Betroffen', it.rel ? it.rel.groups.map((g) => g.label + ': ' + g.items.map((i) => i.title).join(', ')).join(' || ') : '–']], raw: { id: it.id, state: it.state, path: it.path || null }, commands: [] } : null;
    }
    if (kind === 'hardware') {
      const hw = m.hw;
      const section = { system: hw.device, os: hw.os, cpu: hw.cpu, ram: hw.ram, storage: hw.storage, gpu: hw.gpu, battery: hw.battery, network: hw.network, security: hw.security }[ref];
      const s = JSON.stringify(section, (k, v) => (k === 'serial' || k === 'serialNumber' ? undefined : v));
      return { title: 'Hardware: ' + ref, facts: [['Bereich', ref]], raw: s ? JSON.parse(s) : null, commands: [] };
    }
    return null;
  }

  /* ------------------------------------------------------------------ the pack */
  LC.reviewPack = (S) => {
    const m = S.model;
    const col = m.snap.collector || {};
    const entries = Object.entries(reviews(S)).filter(([, r]) => r.status !== 'checked');
    const lines = ['# LaptopCheck – Prüfpaket', '', 'Erstellt: ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' · Tool-Version ' + (col.version || '?') + ' · Scan vom ' + LC.fmtDateTime(m.snap.collectedAt) + ' · ' + (m.hw.os && m.hw.os.label) + (col.isAdmin ? ' (Admin-Scan)' : ' (ohne Admin)'),
      'Hinweis: Benutzername in Pfaden und Seriennummern sind entfernt.', '', 'Bitte jeden Eintrag auf Plausibilität prüfen (stimmen Zahlen, Zuordnungen, Empfehlungen?) und sagen, was falsch ist und wie es korrigiert werden sollte.', ''];
    entries.forEach(([id, r], i) => {
      const ev = evidenceFor(S, id);
      lines.push('## ' + (i + 1) + '. [' + (KIND_LABEL[r.kind] || r.kind) + '] ' + (ev ? ev.title : r.title), '');
      lines.push('**Meine Anmerkung:** ' + (r.note || '(keine)'), '');
      if (!ev) { lines.push('(Eintrag ist im aktuellen Scan nicht mehr vorhanden.)', ''); return; }
      ev.facts.forEach(([k, v]) => lines.push('- ' + k + ': ' + (v == null || v === '' ? '–' : v)));
      if (r.live) lines.push('- Live-Nachmessung: ' + JSON.stringify(r.live));
      if (ev.raw) lines.push('', 'Rohdaten aus dem Scan:', '```json', JSON.stringify(ev.raw, null, 1).slice(0, 4000), '```');
      lines.push('');
    });
    if (!entries.length) lines.push('(Keine Einträge markiert.)');
    return redact(lines.join('\n'));
  };

  /* ------------------------------------------------------------------ page */
  LC.pages.review = (S, app) => {
    const rev = Object.entries(reviews(S));
    const open = rev.filter(([, r]) => r.status !== 'checked').sort((a, b) => (b[1].at || '').localeCompare(a[1].at || ''));
    const done = rev.filter(([, r]) => r.status === 'checked');
    const head = h('div', { class: 'page-title' }, h('h2', null, 'Prüfen'), h('p', null, 'Experten-Funktion: Einträge, die komisch aussehen, sammeln und samt Rohdaten zur Kontrolle weitergeben.'));
    const how = h('div', { class: 'callout' }, h('b', null, 'So lässt du prüfen: '), '1. „Prüfpaket kopieren“. 2. In den Chat mit mir einfügen und „Bitte prüfe diese markierten Einträge“ schreiben. 3. Mein Ergebnis kannst du unten beim Eintrag notieren und ihn abhaken. Das Paket enthält keine Seriennummer; der Benutzername in Pfaden ist geschwärzt.');
    const actions = h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', disabled: open.length ? null : true, onclick: () => LC.copyText(LC.reviewPack(S)) }, LC.icon('copy'), 'Prüfpaket kopieren (' + open.length + ')'),
      h('button', { class: 'btn', type: 'button', disabled: open.length ? null : true, onclick: () => LC.download('pruefpaket.md', LC.reviewPack(S), 'text/markdown;charset=utf-8') }, LC.icon('down'), 'Als Datei speichern'));
    const cards = open.map(([id, r]) => entryCard(S, app, id, r, false));
    return h('div', { class: 'stack' }, head, how, actions,
      ...(cards.length ? cards : [h('div', { class: 'card empty' }, 'Nichts markiert. Auf jeder Karte, in Programm-Details, bei Aufgaben und Projekten gibt es den Knopf „⚑ Wichtig – bitte prüfen“.')]),
      done.length ? h('details', { class: 'card' }, h('summary', null, LC.icon('chevron'), ' Geprüft (' + done.length + ')'), h('div', { class: 'stack', style: { marginTop: '10px' } }, done.map(([id, r]) => entryCard(S, app, id, r, true)))) : null);
  };

  function entryCard(S, app, id, r, checked) {
    const ev = evidenceFor(S, id);
    const live = h('div');
    const paintLive = () => {
      const l = (S.notes.reviews[id] || {}).live;
      live.replaceChildren(l ? h('div', { class: 'callout' }, h('b', null, 'Live-Nachmessung: '),
        l.error ? l.error : [(l.registryEstimatedSizeKB != null ? 'Registry-Angabe: ' + LC.fmtKB(l.registryEstimatedSizeKB) : 'Registry: keine Größenangabe'), ' · ', (l.folderBytes != null ? 'Ordner gemessen: ' + fmtBytes(l.folderBytes) + (l.folderPartial ? ' (mindestens)' : '') : l.measurable === false ? 'Ordner nicht messbar (' + (l.installLocation || 'kein Ordner') + ')' : 'Ordner: –'),
          l.registryEstimatedSizeKB != null && l.folderBytes != null && !l.folderPartial && l.registryEstimatedSizeKB * 1024 > 8 * Math.max(l.folderBytes, 1048576) ? h('div', { class: 'small' }, h('b', null, 'Auffällig: '), 'Die Registry-Angabe ist mehr als 8× so groß wie der Ordner – vermutlich Bytes statt KB.') : null]) : null);
    };
    paintLive();
    const result = h('textarea', { rows: 2, placeholder: 'Ergebnis der Prüfung (z. B. Antwort von Claude hier hineinkopieren)' });
    result.value = r.result || '';
    result.addEventListener('change', () => app.updateNotes((n) => { if (n.reviews[id]) n.reviews[id].result = result.value.trim(); }, { keepDrawer: true }));
    return h('article', { class: 'card review-entry' + (checked ? ' done' : '') },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('flag', 'lg')), h('h3', null, ev ? ev.title : r.title), LC.badge(KIND_LABEL[r.kind] || r.kind, ''),
        h('div', { class: 'row' }, !checked ? h('button', { class: 'btn sm', type: 'button', onclick: () => app.updateNotes((n) => { n.reviews[id].status = 'checked'; n.reviews[id].checkedAt = new Date().toISOString(); }) }, LC.icon('check'), 'Als geprüft abhaken')
          : h('button', { class: 'btn sm', type: 'button', onclick: () => app.updateNotes((n) => { n.reviews[id].status = 'open'; }) }, 'Wieder öffnen'),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.updateNotes((n) => { delete n.reviews[id]; }) }, LC.icon('x'), 'Entfernen'))),
      r.note ? h('div', { class: 'callout warn' }, h('b', null, 'Deine Anmerkung: '), r.note) : null,
      ev ? [LC.kv(ev.facts.map(([k, v]) => [k, v == null || v === '' ? null : String(v)])),
        live,
        ev.canMeasure ? h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: async () => {
          try { const res = await app.api('/api/check/app', { method: 'POST', body: JSON.stringify({ id: ev.appId }) }); app.updateNotes((n) => { n.reviews[id].live = res; }, { keepDrawer: true, background: true }); }
          catch (e) { app.updateNotes((n) => { n.reviews[id].live = { error: e.message }; }, { keepDrawer: true }); }
        } }, LC.icon('refresh'), 'Jetzt live nachmessen'), h('span', { class: 'small muted' }, 'liest die Registry neu und misst den Installationsordner (bis 15 s)')) : null,
        ev.commands.length ? h('details', null, h('summary', null, LC.icon('chevron'), ' Selbst nachprüfen (PowerShell)'), ev.commands.map((c) => h('div', null, h('div', { class: 'small muted', style: { marginTop: '6px' } }, c.label), h('div', { class: 'codeblock' }, h('span', { class: 'code' }, c.cmd), LC.copyButton(c.cmd))))) : null,
        ev.raw ? h('details', null, h('summary', null, LC.icon('chevron'), ' Rohdaten aus dem Scan'), h('pre', { class: 'raw mono' }, redact(JSON.stringify(ev.raw, null, 1)))) : null]
        : h('div', { class: 'muted' }, 'Dieser Eintrag ist im aktuellen Scan nicht mehr vorhanden.'),
      h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Ergebnis'), result));
  }
})(typeof window !== 'undefined' ? window : globalThis);
