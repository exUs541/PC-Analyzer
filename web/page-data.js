/* page-data.js - scan details, data gaps, settings, backup/restore of your entries, how things are measured. */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h } = LC;

  LC.pages.data = (S, app) => {
    const m = S.model;
    const snap = m.snap;
    const meta = (S.raw && S.raw.meta) || {};
    const col = snap.collector || {};
    const warnings = snap.warnings || [];
    const notes = S.notes;

    const noteCount = Object.keys(notes.apps).length;

    /* ---- scan */
    const scanCard = LC.card('Scan', 'refresh', [
      LC.kv([
        ['Letzter Scan', LC.fmtDateTime(snap.collectedAt) + ' (' + LC.fmtAgo(LC.daysBetween(snap.collectedAt, new Date())) + ')'],
        ['Dauer', snap.durationSec != null ? Math.round(snap.durationSec) + ' Sekunden' : null],
        ['Umfang', col.options && col.options.quick ? 'Schnell-Scan (ohne Ordnergrößen, Programmgrößen, Updates)' : 'vollständig'],
        ['Rechte', col.isAdmin ? 'Administrator (alle Details)' : 'normaler Benutzer (einige Details fehlen)'],
      ]),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn primary', type: 'button', disabled: S.scanning ? true : null, onclick: () => app.scan(false) }, LC.icon('refresh'), 'Vollständig neu scannen'),
        h('button', { class: 'btn', type: 'button', disabled: S.scanning ? true : null, onclick: () => app.scan(true), title: 'Überspringt Ordnergrößen, Programmgrößen und die Update-Prüfung' }, 'Schnell-Scan (≈ 20 s)')),
      !col.isAdmin ? h('p', { class: 'small muted', style: { marginTop: '12px' } }, 'Mehr Details (SSD-Verschleiß und -Temperatur, BitLocker, TPM) gibt es, wenn LaptopCheck als Administrator läuft: Rechtsklick auf die Verknüpfung → „Als Administrator ausführen“. Der Scan bleibt immer rein lesend.') : null]);

    /* ---- technical facts about the scan (folded away below) */
    const scanFacts = LC.card('Technische Angaben zum Scan', 'database', [LC.kv([
      ['Gerät / Benutzer', [col.computerName, col.userName].filter(Boolean).join(' / ')],
      ['Scanner', [col.runtime || (col.psVersion ? 'PowerShell ' + col.psVersion : null), col.version].filter(Boolean).join(' / ')],
      ['Ignorierte Windows-Updates', snap.ignoredUpdates != null ? snap.ignoredUpdates + ' Einträge (KB-Pakete werden nicht als Programme gezählt)' : null],
      ['Quellen für „zuletzt benutzt“', snap.usageCounts ? Object.entries(snap.usageCounts).map(([k, v]) => k + ': ' + v).join(' · ') : null],
    ])]);

    /* ---- data gaps */
    const gapCard = LC.card('Datenlücken', 'database', [
      warnings.length ? [
        h('p', { class: 'ink2' }, 'Diese Bereiche konnten nicht (vollständig) gelesen werden. Das ist oft harmlos (fehlende Rechte, Funktion nicht vorhanden), kann aber auch auf einen Fehler im Tool hinweisen.'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'sw', style: { minWidth: '0' } }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Bereich'), h('th', { scope: 'col' }, 'Meldung'))), h('tbody', null, warnings.map((w) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'nowrap' }, h('b', null, w.area)), h('td', { class: 'mono' }, w.message)))))),
      ] : h('div', { class: 'callout ok' }, 'Alle Bereiche wurden gelesen.'),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn', type: 'button', onclick: () => LC.copyText(diagnostics(S)) }, LC.icon('copy'), 'Diagnose kopieren'),
        h('span', { class: 'small muted' }, 'Enthält Tool-Version, Windows-Build, Meldungen und Zähler – keine Programmliste und keine Dateinamen.'))]);

    /* ---- settings */
    const unusedInput = h('input', { type: 'number', min: '30', max: '1500', step: '30', value: notes.settings.unusedDays, style: { width: '110px' }, 'aria-label': 'Tage bis ungenutzt' });
    unusedInput.addEventListener('change', () => app.updateNotes((n) => { n.settings.unusedDays = Math.max(30, +unusedInput.value || 365); }));
    const expertBox = h('input', { type: 'checkbox', checked: (S.config && S.config.expert) ? true : null });
    expertBox.addEventListener('change', () => app.updateConfig((c) => { if (expertBox.checked) c.expert = true; else delete c.expert; }));
    const settingsCard = LC.card('Anzeige & Regeln', 'wrench', [
      h('label', { class: 'field', style: { maxWidth: '420px' } }, h('span', { class: 'lab' }, 'Ein Programm gilt als „ungenutzt“ nach … Tagen'), h('div', { class: 'row' }, unusedInput, h('span', null, 'Tage (Standard 365)'))),
      h('p', { class: 'small muted' }, 'Aktuell erkannt: ' + m.stats.unused + ' ungenutzte und ' + m.stats.rare + ' selten genutzte Programme.'),
      h('label', { class: 'row', style: { gap: '8px', marginTop: '6px' } }, expertBox, 'Experten-Funktionen anzeigen'),
      h('p', { class: 'small muted', style: { margin: '2px 0 0' } }, 'Zeigt bei Einträgen „Wichtig – bitte prüfen“ und die Seite „Prüfen“ (Rohdaten und Prüfpaket zum Weitergeben).'),
    ]);

    /* ---- backup */
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0];
      if (!f) return;
      try {
        const parsed = JSON.parse(await f.text());
        if (!parsed || typeof parsed !== 'object' || (!parsed.apps && !parsed.hardware && !parsed.tasks)) throw new Error('Das sieht nicht wie eine LaptopCheck-Datei aus.');
        if (!confirm('Deine aktuellen Angaben (' + noteCount + ' Programme) werden durch die Datei ersetzt. Fortfahren?')) return;
        app.updateNotes((n) => { const nn = LC.normalizeNotes(parsed); Object.assign(n, nn); });
        LC.toast('Angaben importiert');
      } catch (e) { LC.toast('Import fehlgeschlagen: ' + e.message, 5000); }
    });
    const backupCard = LC.card('Deine Angaben sichern', 'down', [
      h('p', { class: 'ink2' }, 'Alles, was du eingibst (Zweck, Beschreibungen, Entscheidungen, Aufgaben), liegt in ', h('span', { class: 'code' }, (meta.dataDir || 'data') + '\\notes.json'), ' – Sicherungskopie daneben als notes.json.bak. Die Datei überlebt neue Scans und Updates des Tools.'),
      LC.kv([['Gespeichert', noteCount + ' Programme mit eigenen Angaben, ' + Object.keys(notes.tasks).length + ' Aufgaben-Zustände, ' + notes.customTasks.length + ' eigene Aufgaben']]),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn', type: 'button', onclick: () => LC.download('laptopcheck-notes-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(notes, null, 2), 'application/json') }, LC.icon('down'), 'Angaben exportieren (JSON)'),
        h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, LC.icon('up'), 'Angaben importieren'), fileInput,
        h('button', { class: 'btn', type: 'button', onclick: () => LC.download('laptopcheck-snapshot-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(snap, null, 2), 'application/json') }, LC.icon('down'), 'Rohdaten des Scans (JSON)'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => { if (confirm('Wirklich ALLE eigenen Angaben löschen? (Eine Sicherungskopie notes.json.bak bleibt im Datenordner.)')) app.updateNotes((n) => { n.apps = {}; n.tasks = {}; n.customTasks = []; n.hardware = {}; }); } }, 'Alle Angaben löschen'))]);

    /* ---- explanations */
    const howCard = LC.card('Wie zuverlässig sind die Angaben?', 'tasks', [
      h('dl', { class: 'kv', style: { gridTemplateColumns: '1fr' } },
        h('dt', null, 'Zuletzt benutzt'), h('dd', null, 'Windows merkt sich (Registry „UserAssist“), welche Programme über Startmenü, Taskleiste oder Explorer gestartet wurden – mit Datum, Anzahl und Vordergrundzeit. Programme, die per Kommandozeile, von anderen Programmen oder im Hintergrund starten, tauchen dort nicht auf. „Unbekannt“ heißt deshalb nicht „nie benutzt“. Aufräum-Tools löschen diesen Verlauf manchmal. Mit Administratorrechten kommt der Prefetch-Verlauf hinzu (kann Hintergrundstarts enthalten und ist als unsicher markiert).'),
        h('dt', null, 'Installiert am'), h('dd', null, 'Wenn das Programm ein Installationsdatum meldet, wird es verwendet. Sonst wird das Erstellungsdatum des Programmordners (≈) oder die letzte Änderung des Registry-Eintrags geschätzt. Updates und Reparaturen können Daten verschieben.'),
        h('dt', null, 'Was macht es? / Kategorie'), h('dd', null, 'Stammt aus einer eingebauten Liste häufiger Programme (automatisch vermutet). Unbekannte Programme bleiben leer – du kannst sie selbst beschreiben, eigene Texte haben immer Vorrang.'),
        h('dt', null, 'Größe'), h('dd', null, 'Angabe des Programms oder nachgemessener Installationsordner (mit ≥ markiert, wenn die Messung abgebrochen wurde). Nutzerdaten (z. B. Spielstände, Caches) sind nicht enthalten.'),
        h('dt', null, 'Was nicht erfasst wird'), h('dd', null, 'Portable Programme ohne Installer, Browser-Erweiterungen, Python-/npm-Pakete.'),
        h('dt', null, 'Datenschutz'), h('dd', null, 'Alles bleibt auf diesem Rechner. Das Dashboard lädt nichts aus dem Internet. Netzwerkzugriff entsteht nur durch die Update-Prüfung (winget, Microsoft-Server) und wenn du selbst auf einen Recherche-Link klickst.'))]);

    /* ---- server */
    const serverCard = LC.card('LaptopCheck beenden', 'power', [
      LC.kv([['Datenordner', meta.dataDir ? h('span', { class: 'mono' }, meta.dataDir) : null], ['Programmordner', meta.programDir ? h('span', { class: 'mono' }, meta.programDir) : null], ['Adresse', meta.port ? 'http://localhost:' + meta.port + ' (nur dieser Rechner)' : null], ['Version', meta.version]]),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (!confirm(meta.engine === 'native' ? 'LaptopCheck jetzt beenden? Du kannst es jederzeit über das Startmenü wieder starten.' : 'LaptopCheck jetzt beenden? Du kannst es jederzeit mit Start.bat wieder starten.')) return; await app.flushSave(); try { await app.api('/api/shutdown', { method: 'POST' }); } catch (e) { /* server closes the connection */ } document.body.replaceChildren(h('div', { style: { padding: '60px 20px', textAlign: 'center' } }, h('h2', null, 'LaptopCheck wurde beendet.'), h('p', { class: 'muted' }, meta.engine === 'native' ? 'Du kannst dieses Fenster schließen. Zum Wiedereinsteigen: LaptopCheck im Startmenü öffnen.' : 'Du kannst diesen Tab schließen. Zum Wiedereinsteigen: Start.bat doppelklicken.'))); } }, LC.icon('stop'), 'LaptopCheck beenden')),
    ]);

    const ver = meta.version || col.version || '?';
    const upd = (S.raw && S.raw.update) || null;
    const auto = !(S.config && S.config.autoUpdate === false);
    const UPD = {
      updated: ['ok', 'Aktualisiert'], current: ['ok', 'Aktuell'], 'no-access': ['warn', 'Kein Zugriff – mit GitHub verbinden'],
      offline: ['info', 'GitHub nicht erreichbar'], error: ['warn', 'Fehlgeschlagen'], disabled: ['info', 'Ausgeschaltet'],
      downloading: ['info', 'Wird geladen …'], ready: ['ok', 'Neue Version bereit'],
    };
    const native = meta.engine === 'native';
    const st = upd ? UPD[upd.result] || ['info', upd.result] : ['info', 'Noch nie geprüft'];
    const gh = meta.github || {};
    const tokenIn = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…', style: { flex: '1 1 260px', minWidth: '0' }, 'aria-label': 'GitHub-Zugangsschlüssel' });
    const autoBox = h('input', { type: 'checkbox', checked: auto ? true : null });
    autoBox.addEventListener('change', () => app.updateConfig((c) => { if (autoBox.checked) delete c.autoUpdate; else c.autoUpdate = false; }));
    const updateCard = LC.card('Updates', 'refresh', [
      LC.kv([
        ['Version', 'LaptopCheck ' + ver + (upd && upd.sha ? ' (Stand ' + String(upd.sha).slice(0, 7) + ')' : '')],
        ['Status', h('span', null, h('span', { class: 'badge ' + st[0] }, st[1]), upd && upd.checkedAt ? h('span', { class: 'small muted' }, ' zuletzt geprüft ' + LC.fmtDateTime(upd.checkedAt)) : null)],
        ['GitHub', gh.connected
          ? h('span', null, LC.badge('verbunden', 'ok'), ' ', gh.login ? h('b', null, gh.login) : null, h('span', { class: 'small muted' }, ' über ' + LC.ghSourceLabel(gh.source)))
          : h('button', { class: 'btn primary sm', type: 'button', disabled: S.ghConnecting ? true : null, onclick: () => app.connectGitHub() }, LC.icon('branch'), S.ghConnecting ? 'Warte auf Anmeldung im Browser …' : 'Mit GitHub verbinden')],
      ]),
      upd && upd.message && !['current', 'no-access', 'updated'].includes(upd.result) ? h('p', { class: 'small ink2' }, upd.message) : null,
      native
        ? h('p', null, 'LaptopCheck prüft im Hintergrund, ob es eine neue Version gibt, lädt sie leise und installiert sie, sobald du die App das nächste Mal schließt. Du musst nichts tun. Deine Angaben im Datenordner bleiben dabei unverändert.')
        : h('p', null, 'Bei jedem Start über ', h('b', null, 'Start.bat'), ' holt sich LaptopCheck selbst die neueste Version und beendet ein noch offenes altes Fenster. Deine Angaben im Ordner ', h('span', { class: 'code' }, 'data\\'), ' bleiben unverändert.'),
      h('label', { class: 'row', style: { gap: '8px' } }, autoBox, native ? 'Automatisch im Hintergrund aktualisieren' : 'Beim Start automatisch aktualisieren'),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn', type: 'button', onclick: () => { if (confirm('LaptopCheck jetzt aktualisieren und neu starten? Diese Seite lädt sich danach von selbst neu.')) app.restartUpdate(); } }, LC.icon('refresh'), 'Jetzt aktualisieren & neu starten')),
      h('details', { class: 'how', style: { marginTop: '12px' }, open: meta.hasGithubToken ? true : null }, h('summary', null, LC.icon('chevron'), ' Fortgeschritten: Zugangsschlüssel von Hand'),
        h('p', { class: 'small muted' }, 'Normalerweise nicht nötig – LaptopCheck nutzt die GitHub-Anmeldung, die auf diesem PC schon besteht (Git, GitHub Desktop oder GitHub CLI). Ein hier eingetragener Schlüssel hat Vorrang und liegt nur in ', h('span', { class: 'code' }, 'data\\github-token.txt'), '.'),
        h('div', { class: 'row' }, tokenIn,
          h('button', { class: 'btn', type: 'button', onclick: async () => { const v = tokenIn.value.trim(); if (!v) { tokenIn.focus(); return; } if (await app.saveGithubToken(v)) tokenIn.value = ''; } }, 'Speichern'),
          meta.hasGithubToken ? h('button', { class: 'btn', type: 'button', onclick: () => { if (confirm('Zugangsschlüssel von diesem PC entfernen?')) app.saveGithubToken(''); } }, 'Entfernen') : null))]);
    // what most people never need sits behind one fold
    const tech = h('details', { class: 'more-sections' },
      h('summary', { class: 'btn' }, LC.icon('chevron'), 'Technische Details anzeigen (Datenlücken, Diagnose, Genauigkeit)'),
      h('div', { class: 'stack', style: { marginTop: '12px' } }, scanFacts, gapCard, howCard));
    return h('div', { class: 'stack' },
      h('div', { class: 'page-title' }, h('h2', null, 'Einstellungen'), h('p', null, 'Updates, Scan und die Sicherung deiner Angaben.')),
      updateCard, scanCard, settingsCard, backupCard, tech, serverCard);
  };

  function diagnostics(S) {
    const m = S.model;
    const snap = m.snap;
    return JSON.stringify({
      tool: (S.raw.meta || {}).version,
      collector: snap.collector,
      os: { build: snap.os && snap.os.build, ubr: snap.os && snap.os.ubr, edition: snap.os && snap.os.edition, locale: snap.os && snap.os.locale },
      counts: { software: snap.software.length, usage: snap.usage.length, shortcuts: snap.shortcuts.length, startup: snap.startup.length, disks: snap.disks.length, volumes: snap.volumes.length, modules: snap.memory ? LC.asArray(snap.memory.modules).length : null, updates: snap.updates ? snap.updates.length : null },
      usageCounts: snap.usageCounts,
      warnings: snap.warnings,
      analysisMs: S.timing,
    }, null, 2);
  }
})(typeof window !== 'undefined' ? window : globalThis);
