/* page-files.js - "Dateien & Cloud": what lives where, what could move to the cloud (Google Drive ...), how well the cloud
 * drive is organised, big files, duplicates, local git repositories. Moving is a 3-step process (copy+verify, wait, remove). */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h, fmtBytes, fmtNum } = LC;

  const GROUP_CLASS = { docs: 'g1', images: 'g2', video: 'g3', audio: 'g4', archives: 'g5', code: 'g6', other: 'g7' };
  const GBYTES = 1024 ** 3;
  const quotaOf = (S, p) => (S.config && S.config.cloudQuotaGB && +S.config.cloudQuotaGB[p.id]) || 0;
  const MODE_LABEL = { stream: 'streamt (spart Platz)', mirror: 'gespiegelt (kein Platzgewinn)', sync: 'synchronisiert', leftover: 'alter Rest – nicht mehr synchronisiert' };

  // UI state of this page (survives re-renders, not reloads)
  const P = (LC.filesUi = LC.filesUi || { selected: new Set(), targets: new Map(), minMB: 100, level: 'top', docQ: '', docLocalOnly: false, docLimit: 100, provider: null, job: null, jobHistory: null, polling: false, cat: 'all' });

  LC.pages.files = (S, app) => {
    const m = S.model;
    const f = m.files;
    const head = h('div', { class: 'page-title' }, h('h2', null, 'Dateien & Cloud'),
      h('p', null, 'Was belegt Platz, und was kann in die Cloud umziehen? Gelesen wird nur; verschoben wird erst, wenn du es ausdrücklich startest.'));
    const out = [head, scanCard(S, app, f)];
    if (!f) return h('div', { class: 'stack' }, ...out);
    out.push(providersCard(S, app, f));
    out.push(summaryTiles(f));
    out.push(usageCard(S, app, f));
    out.push(moveCard(S, app, f));
    out.push(cloudCards(S, app, f));
    out.push(docsCard(S, app, f));
    out.push(bigCard(S, app, f));
    out.push(dupesCard(S, app, f));
    out.push(reposCard(S, app, f));
    return h('div', { class: 'stack' }, ...out.filter(Boolean));
  };

  /* ------------------------------------------------------------------ scan + settings */
  function listEditor(S, app, key, label, hint) {
    const ta = h('textarea', { rows: 3, 'aria-label': label, placeholder: 'Ein Pfad pro Zeile' });
    ta.value = (Array.isArray(S.config[key]) ? S.config[key] : []).join('\n');
    ta.addEventListener('change', () => app.updateConfig((c) => { c[key] = ta.value.split('\n').map((x) => x.trim().replace(/^"+|"+$/g, '')).filter(Boolean); }));
    return h('label', { class: 'field' }, h('span', { class: 'lab' }, label), ta, hint ? h('span', { class: 'small muted' }, hint) : null);
  }

  function scanCard(S, app, f) {
    const sec = h('input', { type: 'number', min: '5', max: '300', step: '5', style: { width: '90px' }, value: S.config.filesSecondsPerRoot || 40, 'aria-label': 'Sekunden pro Ordner' });
    sec.addEventListener('change', () => app.updateConfig((c) => { c.filesSecondsPerRoot = Math.max(5, Math.min(300, +sec.value || 40)); }));
    const settings = h('details', { class: 'card' }, h('summary', null, LC.icon('chevron'), ' Einstellungen: welche Ordner werden gelesen?'),
      h('div', { class: 'stack', style: { marginTop: '10px' } },
        h('p', { class: 'small muted' }, 'Standard: Dokumente, Desktop, Downloads, Bilder, Videos, Musik und alle erkannten Cloud-Ordner. Weitere Ordner kannst du hier ergänzen. Es wird nichts verändert.'),
        listEditor(S, app, 'extraRoots', 'Zusätzliche lokale Ordner', 'z. B. D:\\Projekte oder C:\\Dev'),
        listEditor(S, app, 'extraCloudRoots', 'Zusätzliche Cloud-Ordner', 'Falls dein Cloud-Ordner nicht automatisch erkannt wird, z. B. G:\\Meine Ablage'),
        h('label', { class: 'field', style: { maxWidth: '360px' } }, h('span', { class: 'lab' }, 'Zeitlimit pro Ordner'), h('div', { class: 'row' }, sec, h('span', null, 'Sekunden (Standard 40)')))));
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('cloud', 'lg')), h('h3', null, 'Dateien-Scan'),
        h('button', { class: 'btn primary', type: 'button', disabled: S.filesScanning ? true : null, onclick: () => app.scanFiles() }, LC.icon('refresh', S.filesScanning ? 'spin' : ''), S.filesScanning ? 'Scanne … (kann einige Minuten dauern)' : f ? 'Dateien neu scannen' : 'Dateien jetzt scannen')),
      f ? h('p', { class: 'ink2' }, 'Letzter Dateien-Scan: ' + LC.fmtDateTime(f.scannedAt) + ' (' + LC.fmtAgo(f.ageDays) + ') · ' + Math.round(f.seconds || 0) + ' s · ' + fmtNum(f.roots.reduce((a, r) => a + (r.files || 0), 0), 0) + ' Dateien gesehen.')
        : h('p', { class: 'ink2' }, 'Noch nicht gescannt. Der Scan liest deine Ordner (Namen, Größen, Änderungsdaten – nicht die Inhalte), erkennt Cloud-Ordner und sucht Git-Repositories.'),
      S.filesScanning ? h('div', { class: 'callout' }, 'Der Scan läuft gerade. Das kann einige Minuten dauern; diese Seite aktualisiert sich danach von selbst.') : null,
      settings);
  }

  /* ------------------------------------------------------------------ cloud providers */
  function providersCard(S, app, f) {
    if (!f.providers.length) {
      return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('cloud', 'lg')), h('h3', null, 'Cloud-Ordner')),
        h('div', { class: 'callout warn' }, h('b', null, 'Kein Cloud-Ordner gefunden. '), 'LaptopCheck sieht dein Google Drive nur über „Google Drive für Desktop“ (erscheint als Laufwerk, meist G:, oder als Ordner). Installiere und melde dich an – oder gib den Ordner oben unter „Zusätzliche Cloud-Ordner“ an.'),
        h('div', { class: 'row', style: { marginTop: '10px' } }, h('a', { class: 'btn sm', href: 'https://www.google.com/drive/download/', target: '_blank', rel: 'noopener noreferrer' }, LC.icon('link'), 'Google Drive für Desktop')));
    }
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('cloud', 'lg')), h('h3', null, 'Erkannte Cloud-Ordner')),
      h('div', { class: 'grid tiles' }, f.providers.map((p) => {
        const r = f.cloudRoots.find((x) => LC.pathUnder(x.path, p.root) && LC.pathUnder(p.root, x.path));
        const ct = f.cloud.find((c) => LC.pathUnder(c.root, p.root));
        const mirror = p.mode === 'mirror';
        if (p.mode === 'leftover') {
          // an old mirror folder: no cloud at all (not scanned, no tariff, no target for moves) - explain it and say how to get the space back
          const live = f.liveProviders.find((x) => x.id === p.id && x.mode === 'stream');
          return h('div', { class: 'card tile static' },
            h('div', { class: 't-head' }, LC.icon('folder'), h('span', null, p.name + ' – alter Ordner'), LC.badge(MODE_LABEL.leftover, 'warn')),
            h('div', { class: 't-val' }, p.localBytes != null ? fmtBytes(p.localBytes) : '–'),
            h('div', { class: 't-sub mono' }, p.root),
            h('div', { class: 't-sub' }, p.localBytes != null ? 'belegt noch Platz auf deiner SSD' : 'Größe: unter „Hardware → Speicher“ die Speicher-Analyse starten'),
            (() => {
              const lc = LC.leftoverCompare(p);
              if (!lc) return h('div', { class: 'small', style: { color: 'var(--ink-2)', marginTop: '6px' } }, 'Dein Drive läuft gestreamt' + (live ? ' (' + live.root + ')' : '') + '. Dieser Ordner ist ein Rest einer früheren Spiegelung: Änderungen hier erreichen die Cloud nicht mehr. Ein neuer Dateien-Scan gleicht ihn mit dem Drive ab und zeigt, was dort fehlt.');
              return h('div', { class: 'small', style: { color: 'var(--ink-2)', marginTop: '6px' } },
                h('b', null, lc.pct + ' % (' + fmtBytes(lc.inDriveBytes) + ') liegen schon unverändert im Drive. '),
                lc.onlyFiles ? lc.onlyFiles + ' Dateien (' + fmtBytes(lc.onlyBytes) + ') fehlen dort – siehe „Hausordnung“.' : 'Im Drive fehlt nichts: der Ordner kann in den Papierkorb.',
                lc.partial ? ' (Abgleich unvollständig: Zeitgrenze erreicht.)' : '');
            })(),
            h('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.reveal(p.root) }, LC.icon('folder'), 'Im Explorer zeigen')),
            h('div', { class: 'small muted' }, 'Erkannt über: ' + p.detectedBy));
        }
        const quotaGB = quotaOf(S, p);
        const used = r ? r.bytes : 0;
        const quotaBox = h('div', { class: 'quota' },
          h('label', { class: 'small' }, 'Dein Speicher-Tarif: ', h('input', { type: 'number', min: '0', step: '1', style: { width: '80px' }, 'aria-label': 'Tarif von ' + p.name, value: quotaGB ? (quotaGB >= 1024 && quotaGB % 1024 === 0 ? quotaGB / 1024 : quotaGB) : '' }), ' ',
            h('select', { 'aria-label': 'Einheit', style: { width: 'auto' } }, h('option', { value: 'GB', selected: !(quotaGB >= 1024 && quotaGB % 1024 === 0) ? true : null }, 'GB'), h('option', { value: 'TB', selected: quotaGB >= 1024 && quotaGB % 1024 === 0 ? true : null }, 'TB'))),
          quotaGB ? h('div', null, LC.meter([{ pct: (used / (quotaGB * GBYTES)) * 100, cls: used / (quotaGB * GBYTES) > 0.9 ? 'sev-warn' : '', title: fmtBytes(used) + ' belegt' }]),
            h('div', { class: 'small muted' }, fmtBytes(used) + ' sichtbar belegt von ' + fmtNum(quotaGB / (quotaGB >= 1024 ? 1024 : 1), quotaGB >= 1024 ? 1 : 0) + (quotaGB >= 1024 ? ' TB' : ' GB') + ' – ca. ' + fmtBytes(Math.max(0, quotaGB * GBYTES - used)) + ' frei (Dateien aus „Geteilt mit mir“/Papierkorb zählt Google evtl. anders)')) : h('div', { class: 'small muted' }, 'Trag deinen Tarif ein (z. B. 2 TB), dann zeigt LaptopCheck die Belegung und prüft vor dem Umzug, ob alles hineinpasst.'));
        const [numIn, unitSel] = [quotaBox.querySelector('input'), quotaBox.querySelector('select')];
        const saveQuota = () => app.updateConfig((c) => { c.cloudQuotaGB = c.cloudQuotaGB || {}; const v = Math.max(0, +numIn.value || 0) * (unitSel.value === 'TB' ? 1024 : 1); if (v) c.cloudQuotaGB[p.id] = v; else delete c.cloudQuotaGB[p.id]; });
        numIn.addEventListener('change', saveQuota); unitSel.addEventListener('change', saveQuota);
        return h('div', { class: 'card tile static' },
          h('div', { class: 't-head' }, LC.icon('cloud'), h('span', null, p.name), LC.badge(MODE_LABEL[p.mode] || p.mode, mirror ? 'warn' : 'auto')),
          h('div', { class: 't-val' }, r ? fmtBytes(r.bytes) : '–'),
          h('div', { class: 't-sub mono' }, p.root),
          r ? h('div', { class: 't-sub' }, fmtNum(r.files, 0) + ' Dateien' + (r.onlineBytes ? ' · ' + fmtBytes(r.onlineBytes) + ' nur online' : '') + (r.partial ? ' · Scan abgebrochen (Zeitlimit)' : '')) : null,
          ct ? h('div', { class: 't-sub' }, 'Ordnung: ', h('b', null, ct.score + ' / 100')) : null,
          quotaBox,
          mirror ? h('div', { class: 'small', style: { color: 'var(--ink-2)' } }, 'Im Spiegel-Modus liegt alles auch lokal. Stelle in den Drive-Einstellungen auf „Dateien streamen“ um, sonst spart Auslagern keinen Platz.') : null,
          h('div', { class: 'small muted' }, 'Erkannt über: ' + p.detectedBy));
      })));
  }

  function summaryTiles(f) {
    const t = f.totals;
    const tile = (label, value, sub) => h('div', { class: 'card tile static' }, h('div', { class: 't-head' }, h('span', null, label)), h('div', { class: 't-val' }, value), h('div', { class: 't-sub' }, sub));
    return h('div', { class: 'grid tiles' },
      tile('Lokal belegt (gescannte Ordner)', fmtBytes(t.localBytes), fmtNum(t.localFiles, 0) + ' Dateien' + (t.onlineBytes ? ' · ' + fmtBytes(t.onlineBytes) + ' sind nur online' : '')),
      tile('In die Cloud auslagerbar', t.freeableBytes ? 'bis ' + fmtBytes(t.freeableBytes) : '–', f.liveProviders.length ? 'nach Namensregeln vorsortiert' : 'ohne Cloud-Ordner nicht möglich'),
      tile('Nur lokal vorhandene Dokumente', fmtNum(t.docsLocalOnlyCount, 0) + (t.docsListTruncated ? '+' : ''), fmtBytes(t.docsLocalOnlyBytes) + ' ohne Kopie in der Cloud'),
      tile('Lokal und in der Cloud', fmtBytes(f.localCloudDupes.reduce((a, d) => a + d.size, 0)), f.localCloudDupes.length + ' Datei(en) doppelt – lokale Kopie ersetzbar'));
  }

  /* ------------------------------------------------------------------ what takes space */
  function usageCard(S, app, f) {
    const roots = f.folders.filter((x) => x.depth === 0 && f.localRoots.some((r) => r.label === x.root && LC.pathUnder(x.path, r.path) && LC.pathUnder(r.path, x.path)));
    const legend = LC.CAT_GROUPS.map((g) => h('span', { class: 'legend-item' }, h('i', { class: 'swatch ' + GROUP_CLASS[g.id] }), g.label));
    const rows = roots.sort((a, b) => b.bytes - a.bytes).map((r) => {
      const total = Math.max(1, r.bytes);
      const segs = LC.CAT_GROUPS.map((g) => ({ pct: (r.groups[g.id] / total) * 100, cls: GROUP_CLASS[g.id], title: g.label + ': ' + fmtBytes(r.groups[g.id]) }));
      return h('div', { class: 'bar-row wide' }, h('div', null, h('b', null, r.root), h('div', { class: 'small muted' }, fmtBytes(r.bytes) + ' · ' + fmtNum(r.files, 0) + ' Dateien')),
        LC.meter(segs, true),
        h('div', { class: 'why small' }, LC.CAT_GROUPS.filter((g) => r.groups[g.id] > 0).sort((a, b) => r.groups[b.id] - r.groups[a.id]).slice(0, 3).map((g) => g.label + ' ' + fmtBytes(r.groups[g.id])).join(' · ')));
    });
    // these are only your own folders: say how much of the used space that is, and where the rest is explained
    const vol = S.model && S.model.hw.storage && S.model.hw.storage.systemVolume;
    const mine = roots.reduce((a, r) => a + r.bytes, 0);
    const coverage = vol && vol.usedBytes > 0
      ? h('div', { class: 'callout', style: { margin: '8px 0' } },
        h('div', null, h('b', null, 'Das sind nur deine Ordner (Dokumente, Downloads, Desktop …): ' + fmtBytes(mine) + ' von ' + fmtBytes(vol.usedBytes) + ' belegtem Speicher auf C: (' + Math.round((mine / vol.usedBytes) * 100) + ' %).'),
          ' Programme, Spiele, Windows, Entwickler-Daten und Caches stehen auf der Seite „Speicher“, Ordner für Ordner und bis zur letzten Zahl nachrechenbar.'),
        h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn primary sm', type: 'button', onclick: () => app.go('space') }, LC.icon('storage'), 'Zum vollständigen Speicher-Überblick')))
      : null;
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('storage', 'lg')), h('h3', null, 'Deine Ordner nach Dateityp')),
      coverage, h('div', { class: 'legend' }, legend), rows.length ? rows : h('div', { class: 'muted' }, 'Keine lokalen Ordner gescannt.'));
  }

  /* ------------------------------------------------------------------ move to cloud */
  const overlaps = (a, b) => LC.pathUnder(a, b) || LC.pathUnder(b, a);

  function moveCard(S, app, f) {
    // an old mirror leftover is no target: nothing in it is synced
    const prov = f.liveProviders.filter((p) => p.mode !== 'mirror').concat(f.liveProviders.filter((p) => p.mode === 'mirror'));
    if (!prov.length) return null;
    if (!P.provider || !prov.some((p) => p.root === P.provider)) P.provider = prov[0].root;
    const p = prov.find((x) => x.root === P.provider);
    const minB = P.minMB * 1024 * 1024;
    let rows = f.candidates.filter((c) => c.localBytes >= minB && (P.level === 'all' || c.depth === 1));
    if (P.cat !== 'all') rows = rows.filter((c) => c.dominant === P.cat);
    rows = rows.slice(0, 120);

    const targetOf = (c) => (P.targets.has(c.path) ? P.targets.get(c.path) : c.suggestion.target || '00 Eingang/' + LC.safeFolderName(c.name));
    const picked = f.candidates.filter((c) => P.selected.has(c.path));
    const pickedBytes = picked.reduce((a, c) => a + c.localBytes, 0);

    const toggle = (c, on) => {
      if (on) { for (const q of [...P.selected]) if (overlaps(q, c.path)) P.selected.delete(q); P.selected.add(c.path); } else P.selected.delete(c.path);
      app.render();
    };
    const tbody = h('tbody', null, rows.map((c) => {
      const blocked = !P.selected.has(c.path) && [...P.selected].some((q) => overlaps(q, c.path));
      const isCloud = c.suggestion.action === 'cloud';
      const cb = h('input', { type: 'checkbox', checked: P.selected.has(c.path) ? true : null, disabled: blocked || !isCloud ? true : null, 'aria-label': c.name + ' auswählen' });
      cb.addEventListener('change', () => toggle(c, cb.checked));
      const target = h('input', { type: 'text', value: targetOf(c), 'aria-label': 'Ziel in der Cloud für ' + c.name, disabled: !isCloud ? true : null, style: { minWidth: '220px' } });
      target.addEventListener('change', () => { P.targets.set(c.path, target.value.trim().replace(/^[\\/]+|[\\/]+$/g, '')); });
      const act = c.suggestion.action;
      return h('tr', { class: P.selected.has(c.path) ? 'sel' : '', style: { cursor: 'default' } },
        h('td', null, cb),
        h('td', { 'data-label': 'Ordner' }, h('div', { class: 'sw-name' }, c.depth === 2 ? h('span', { class: 'muted' }, c.parent + ' ▸') : null, c.name), h('div', { class: 'sw-sub mono' }, c.path)),
        h('td', { 'data-label': 'Größe', class: 'num nowrap' }, fmtBytes(c.localBytes), c.onlineBytes ? h('div', { class: 'sw-sub' }, fmtBytes(c.onlineBytes) + ' online') : null),
        h('td', { 'data-label': 'Schon in Cloud' }, c.files ? Math.round(c.matchPct) + ' %' : '–'),
        h('td', { 'data-label': 'Zuletzt geändert', class: 'nowrap' }, c.newest ? LC.fmtDate(c.newest) : '–'),
        h('td', { 'data-label': 'Empfehlung' },
          act === 'cloud' ? LC.badge('In die Cloud', 'manual') : act === 'delete' ? LC.badge('Prüfen & löschen', 'warn') : LC.badge('Git statt Cloud', 'auto'),
          h('div', { class: 'sw-sub' }, c.suggestion.reason)),
        h('td', { 'data-label': 'Ziel in der Cloud' }, isCloud ? target : act === 'delete' ? h('button', { class: 'btn sm', type: 'button', onclick: () => app.cleanup.addPath({ path: c.path, kind: 'dir', name: c.name, bytes: c.localBytes, reason: c.suggestion.reason }) }, LC.icon('trash'), 'Zur Aufräumliste') : h('span', { class: 'sw-sub' }, 'Als Git-Repository sichern (GitHub)')));
    }));

    const minSel = h('select', { 'aria-label': 'Mindestgröße', style: { width: 'auto' }, onchange: (e) => { P.minMB = +e.target.value; app.render(); } },
      [[10, 'ab 10 MB'], [100, 'ab 100 MB'], [500, 'ab 500 MB'], [1024, 'ab 1 GB']].map(([v, l]) => h('option', { value: v, selected: P.minMB === v ? true : null }, l)));
    const levelSel = h('select', { 'aria-label': 'Ebene', style: { width: 'auto' }, onchange: (e) => { P.level = e.target.value; app.render(); } },
      h('option', { value: 'top', selected: P.level === 'top' ? true : null }, 'nur oberste Ebene'), h('option', { value: 'all', selected: P.level === 'all' ? true : null }, 'auch Unterordner'));
    const catSel = h('select', { 'aria-label': 'Inhalt', style: { width: 'auto' }, onchange: (e) => { P.cat = e.target.value; app.render(); } },
      h('option', { value: 'all' }, 'alle Inhalte'), LC.CAT_GROUPS.map((g) => h('option', { value: g.id, selected: P.cat === g.id ? true : null }, 'überwiegend ' + g.label)));
    const provSel = prov.length > 1 ? h('select', { 'aria-label': 'Cloud-Ordner', style: { width: 'auto' }, onchange: (e) => { P.provider = e.target.value; app.render(); } }, prov.map((x) => h('option', { value: x.root, selected: x.root === P.provider ? true : null }, x.name + ' – ' + x.root))) : null;

    const startBtn = h('button', { class: 'btn primary', type: 'button', disabled: !picked.length ? true : null, onclick: () => planDialog(S, app, f, p, picked, targetOf) }, LC.icon('cloud'), picked.length ? 'Umzug planen: ' + picked.length + ' Ordner (' + fmtBytes(pickedBytes) + ')' : 'Ordner auswählen');

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('cloud', 'lg')), h('h3', null, 'In die Cloud auslagern'), startBtn),
      p.mode === 'mirror' ? h('div', { class: 'callout warn' }, h('b', null, 'Kein Platzgewinn: '), 'Dein Google Drive spiegelt alles auf diesen PC. Stelle es zuerst auf „Dateien streamen“ um (Drive-Symbol in der Taskleiste → Zahnrad → Einstellungen → Google Drive → „Dateien streamen“).') : null,
      h('ol', { class: 'steps' },
        h('li', null, h('b', null, 'Kopieren & prüfen: '), 'Die Ordner werden in dein Cloud-Laufwerk kopiert und Datei für Datei per Prüfsumme (SHA-256) verglichen. Nichts wird überschrieben, die Originale bleiben unberührt.'),
        h('li', null, h('b', null, 'Warten & ansehen: '), 'Warte, bis Google Drive „synchronisiert“ meldet, und öffne ein paar Dateien im Browser.'),
        h('li', null, h('b', null, 'Originale entfernen (optional): '), 'Erst auf deinen Klick und nach Eintippen von „ENTFERNEN“ wandern die geprüften Originale in den Papierkorb.')),
      S.move && S.move.error ? h('div', { class: 'callout critical' }, S.move.error) : null,
      jobPanel(S, app, f),
      h('div', { class: 'filters', style: { marginTop: '12px' } }, provSel, minSel, levelSel, catSel, h('span', { class: 'small muted' }, rows.length + ' Ordner angezeigt')),
      rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'sw', style: { minWidth: '980px' } },
        h('thead', null, h('tr', null, ['', 'Ordner', 'Größe lokal', 'Schon in Cloud', 'Zuletzt geändert', 'Empfehlung', 'Ziel in der Cloud'].map((x) => h('th', { scope: 'col' }, x)))), tbody))
        : h('div', { class: 'empty' }, 'Keine Ordner in dieser Größe.'));
  }

  function planDialog(S, app, f, p, picked, targetOf) {
    const items = picked.map((c) => ({ src: c.path, dst: LC.joinPath(p.root, ...targetOf(c).split(/[\\/]+/)), bytes: c.localBytes, name: c.name }));
    const total = items.reduce((a, i) => a + i.bytes, 0);
    const quota = quotaOf(S, p);
    const cloudRoot = f.cloudRoots.find((r) => LC.pathUnder(r.path, p.root) && LC.pathUnder(p.root, r.path));
    const freeBytes = quota ? quota * GBYTES - (cloudRoot ? cloudRoot.bytes : 0) : null;
    const dlg = LC.modal({
      title: 'Umzug in die Cloud starten', wide: true,
      body: h('div', { class: 'stack' },
        freeBytes != null ? (total > freeBytes ? h('div', { class: 'callout critical' }, h('b', null, 'Passt nicht in deinen Tarif: '), 'Der Umzug braucht ' + fmtBytes(total) + ', laut deiner Angabe sind nur ca. ' + fmtBytes(Math.max(0, freeBytes)) + ' frei.') : h('div', { class: 'callout ok' }, 'Passt in deinen Tarif: ' + fmtBytes(total) + ' von ca. ' + fmtBytes(freeBytes) + ' freiem Speicher.')) : null,
        h('p', null, items.length + ' Ordner (' + fmtBytes(total) + ') werden nach ', h('b', null, p.name), ' (', h('span', { class: 'mono' }, p.root), ') ', h('b', null, 'kopiert und geprüft'), '. Es wird nichts gelöscht und nichts überschrieben.'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'sw', style: { minWidth: '0' } }, h('tbody', null, items.map((i) => h('tr', { style: { cursor: 'default' } }, h('td', null, h('b', null, i.name), h('div', { class: 'sw-sub mono' }, i.src)), h('td', { class: 'nowrap' }, fmtBytes(i.bytes)), h('td', null, h('span', { class: 'mono' }, '→ ' + i.dst))))))),
        h('p', { class: 'small muted' }, 'Die Arbeit läuft im Hintergrund, hier siehst du den Fortschritt. Jede Datei wird nach dem Kopieren per SHA-256 mit dem Original verglichen. Große Ordner brauchen etwas Zeit; Google Drive lädt anschließend im Hintergrund hoch.')),
      actions: [h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Abbrechen'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          dlg.close();
          try {
            const r = await app.api('/api/move/start', { method: 'POST', body: JSON.stringify({ cloudRoot: p.root, items: items.map((i) => ({ src: i.src, dst: i.dst })) }) });
            S.move = { error: null };
            P.job = { id: r.id, items, state: 'running', result: null, cleanup: null };
            P.selected.clear();
            pollJob(S, app);
            LC.toast('Das Kopieren läuft.', 5000);
          } catch (e) { S.move = { error: 'Umzug konnte nicht gestartet werden: ' + e.message }; }
          app.render();
        } }, LC.icon('cloud'), 'Kopieren & prüfen starten')],
    });
  }

  function pollJob(S, app) {
    if (P.polling || !P.job) return;
    P.polling = true;
    const tick = async () => {
      const job = P.job;
      if (!job) { P.polling = false; return; }
      try {
        const st = await app.api('/api/move/status?id=' + encodeURIComponent(job.id));
        const before = JSON.stringify([job.result && job.result.state, job.cleanup && job.cleanup.state]);
        job.result = st.result; job.cleanup = st.cleanup; job.progress = st.progress;
        const done = (st.cleanup && st.cleanup.state) || (st.result && st.result.state === 'error') || (st.result && st.result.state === 'copied' && !job.waitCleanup);
        if (JSON.stringify([job.result && job.result.state, job.cleanup && job.cleanup.state]) !== before && S.route === 'files') app.render({ background: true });
        if (done) { P.polling = false; return; }
      } catch (e) { /* server busy; try again */ }
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 2500);
  }

  function jobPanel(S, app, f) {
    const job = P.job;
    if (!job) return null;
    if (!P.polling && (!job.result || (job.waitCleanup && !(job.cleanup && job.cleanup.state)))) pollJob(S, app);
    const r = job.result, c = job.cleanup;
    const t = r && r.totals;
    let body;
    if (!r) body = h('p', null, 'Das Kopieren läuft … ' + (job.progress && job.progress.total ? fmtNum(job.progress.done, 0) + ' von ' + fmtNum(job.progress.total, 0) + ' Dateien ' : '') + '(diese Anzeige aktualisiert sich selbst)');
    else if (r.state === 'error') body = h('div', { class: 'callout critical' }, 'Fehler: ' + r.error);
    else {
      const clean = c && c.state === 'cleaned';
      body = [
        h('div', { class: 'kv-inline' }, kvi('Dateien geprüft', fmtNum(t.verified, 0) + ' (' + fmtBytes(t.verifiedBytes) + ')'), kvi('Bereits vorhanden', fmtNum(t.skipped, 0)), kvi('Konflikte (Original behalten)', fmtNum(t.conflicts, 0)), kvi('Fehler', fmtNum(t.failed + t.mismatched, 0))),
        t.conflicts || t.failed || t.mismatched ? h('div', { class: 'callout warn' }, 'Bei Konflikten/Fehlern bleibt das Original unangetastet. Details stehen in data\\moves\\' + job.id + '\\log.txt.') : null,
        clean ? h('div', { class: 'callout ok' }, fmtNum(c.removed, 0) + ' Dateien (' + fmtBytes(c.removedBytes) + ') liegen jetzt im Papierkorb. Nach einem neuen Dateien-Scan siehst du den freien Platz.')
          : h('div', { class: 'stack', style: { gap: '8px' } },
            h('div', { class: 'callout' }, h('b', null, 'Schritt 2: '), 'Warte, bis Google Drive „synchronisiert“ meldet, und öffne ein paar Dateien auf drive.google.com. Erst danach Schritt 3.'),
            t.verified > 0 ? cleanupStep(S, app, job) : null)];
    }
    return h('div', { class: 'job callout' }, h('b', null, 'Letzter Umzug (' + job.id + '): '), job.items.map((i) => i.name).join(', '), h('div', { style: { marginTop: '8px' } }, body));
  }
  const kvi = (k, v) => h('div', null, h('div', { class: 'small muted' }, k), h('div', { style: { fontWeight: '650' } }, v));

  function cleanupStep(S, app, job) {
    const ok = h('input', { type: 'checkbox', id: 'synced' });
    const btn = h('button', { class: 'btn danger', type: 'button', disabled: true, onclick: async () => {
      try { await app.api('/api/move/cleanup?id=' + encodeURIComponent(job.id), { method: 'POST' }); job.waitCleanup = true; P.polling = false; pollJob(S, app); LC.toast('Ein Bestätigungsfenster ist aufgegangen: Dort das Häkchen setzen und „ENTFERNEN“ eintippen, um die Originale in den Papierkorb zu legen.', 8000); }
      catch (e) { LC.toast('Konnte nicht gestartet werden: ' + e.message, 6000); }
    } }, LC.icon('trash'), 'Originale in den Papierkorb legen …');
    ok.addEventListener('change', () => { btn.disabled = !ok.checked; });
    return h('div', { class: 'row' }, h('label', { class: 'check' }, ok, ' Google Drive meldet „synchronisiert“ und ich habe Stichproben im Browser geprüft.'), btn);
  }

  /* ------------------------------------------------------------------ drive analysis */
  function cloudCards(S, app, f) {
    if (!f.cloud.length) return null;
    return f.cloud.map((c) => {
      const present = new Set(c.topFolders.map((t) => (t.name.match(/^(\d{2})/) || [])[1]).filter(Boolean));
      const sev = c.score >= 85 ? 'ok' : c.score >= 65 ? 'info' : c.score >= 45 ? 'warn' : 'critical';
      return h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('folder', 'lg')), h('h3', null, 'Ordnung in ' + c.provider), LC.chip(sev, 'Ordnung ' + c.score + ' / 100')),
        h('p', { class: 'ink2' }, fmtNum(c.files, 0) + ' Dateien, ' + fmtBytes(c.bytes) + ', ' + c.topFolders.length + ' Ordner im Hauptordner, bis zu ' + c.maxDepth + ' Ebenen tief' + (c.nativeDocs ? ', ' + fmtNum(c.nativeDocs, 0) + ' Google-Docs-Dateien' : '') + '.'),
        c.issues.length ? c.issues.map((i) => LC.findingBlock({ severity: i.severity, title: i.title, detail: i.detail, action: i.action, steps: i.steps })) : h('div', { class: 'callout ok' }, 'Keine strukturellen Auffälligkeiten.'),
        h('div', { class: 'grid cols-2', style: { marginTop: '14px' } },
          h('div', null, h('h4', null, 'Empfohlene Struktur (oberste Ebene)'),
            h('ul', { class: 'struct' }, LC.DRIVE_STRUCTURE.map((s) => h('li', null, present.has(s.name.slice(0, 2)) ? LC.badge('vorhanden', 'manual') : LC.badge('fehlt', 'auto'), ' ', h('b', null, s.name), h('div', { class: 'small muted' }, s.desc)))),
            h('p', { class: 'small muted' }, 'Nummern halten die Reihenfolge stabil. Innerhalb von „02 Finanzen“ lohnt sich ein Ordner pro Jahr, Dateinamen als „JJJJ-MM Thema.ext“.')),
          h('div', null, h('h4', null, 'Deine Ordner → Vorschlag'),
            c.map.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'sw', style: { minWidth: '0' } }, h('tbody', null, c.map.slice(0, 25).map((x) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'nowrap' }, h('b', null, x.existing)), h('td', null, '→ ' + x.suggested, h('div', { class: 'sw-sub' }, x.why)))))))
              : h('div', { class: 'muted' }, c.numberedTop ? 'Deine Ordner folgen schon der Nummerierung.' : 'Keine automatische Zuordnung möglich – ordne die Ordner von Hand den Themen links zu.'))));
    });
  }

  /* ------------------------------------------------------------------ documents, big files, duplicates */
  function docsCard(S, app, f) {
    const holder = h('div');
    const info = h('span', { class: 'small muted' });
    const more = h('div', { style: { marginTop: '8px' } });
    let rowsAll = [];
    // only the result table is rebuilt while typing, so the search box keeps its focus
    const paint = () => {
      const q = LC.norm(P.docQ);
      rowsAll = f.docs.filter((d) => (!P.docLocalOnly || !d.cloud) && (!q || LC.norm(d.p).includes(q))).sort((a, b) => (b.m || '').localeCompare(a.m || ''));
      const shown = rowsAll.slice(0, P.docLimit);
      info.textContent = fmtNum(rowsAll.length, 0) + ' Treffer';
      holder.replaceChildren(shown.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'sw', style: { minWidth: '720px' } },
        h('thead', null, h('tr', null, ['Datei', 'Größe', 'Geändert', 'Cloud'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, shown.map((d) => h('tr', { style: { cursor: 'default' } },
          h('td', { 'data-label': 'Datei' }, h('div', { class: 'sw-name' }, baseName(d.p)), h('div', { class: 'sw-sub mono' }, dirName(d.p))),
          h('td', { 'data-label': 'Größe', class: 'nowrap num' }, fmtBytes(d.s)), h('td', { 'data-label': 'Geändert', class: 'nowrap' }, d.m ? LC.fmtDate(d.m) : '–'),
          h('td', { 'data-label': 'Cloud' }, d.cloud ? LC.chip('ok', 'in der Cloud') : LC.badge('nur lokal', 'warn'), d.cloud ? h('div', { class: 'sw-sub mono' }, d.cloud) : null)))))) : h('div', { class: 'empty' }, 'Keine Treffer.'));
      more.replaceChildren(rowsAll.length > shown.length ? h('button', { class: 'btn sm', type: 'button', onclick: () => { P.docLimit += 200; paint(); } }, 'Mehr anzeigen (' + (rowsAll.length - shown.length) + ' weitere)') : '');
    };
    const inp = h('input', { type: 'search', placeholder: 'Dokumente durchsuchen (Name oder Ordner) …', 'aria-label': 'Dokumente durchsuchen', value: P.docQ, style: { maxWidth: '360px' } });
    inp.addEventListener('input', LC.debounce(() => { P.docQ = inp.value; P.docLimit = 100; paint(); }, 200));
    const only = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: P.docLocalOnly ? true : null, onchange: (e) => { P.docLocalOnly = e.target.checked; P.docLimit = 100; paint(); } }), ' nur ohne Kopie in der Cloud');
    paint();
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('file', 'lg')), h('h3', null, 'Deine Dokumente'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => LC.download('dokumente.csv', LC.csv([['Pfad', 'Größe (Bytes)', 'Geändert', 'Typ', 'Kopie in der Cloud']].concat(rowsAll.map((d) => [d.p, d.s, d.m, d.c, d.cloud || '']))), 'text/csv;charset=utf-8') }, LC.icon('down'), 'Als CSV')),
      h('p', { class: 'small muted' }, 'Textdokumente, Tabellen, Präsentationen und PDFs aus den gescannten Ordnern (die neuesten ' + fmtNum(f.docs.length, 0) + '). „In der Cloud“ heißt: Es gibt dort eine Datei mit gleichem Namen und gleicher Größe.'),
      h('div', { class: 'filters' }, inp, only, info), holder, more);
  }
  const baseName = (p) => String(p).split(/[\\/]/).pop();
  const dirName = (p) => String(p).replace(/[\\/][^\\/]*$/, '');

  function bigCard(S, app, f) {
    const rows = f.big.slice(0, 40);
    if (!rows.length) return null;
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('storage', 'lg')), h('h3', null, 'Größte Dateien (ab 25 MB)')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'sw', style: { minWidth: '720px' } },
        h('thead', null, h('tr', null, ['Datei', 'Größe', 'Geändert', 'Cloud', ''].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, rows.map((b) => h('tr', { style: { cursor: 'default' } },
          h('td', { 'data-label': 'Datei' }, h('div', { class: 'sw-name' }, b.name), h('div', { class: 'sw-sub mono' }, dirName(b.p))),
          h('td', { 'data-label': 'Größe', class: 'nowrap num' }, fmtBytes(b.s)), h('td', { 'data-label': 'Geändert', class: 'nowrap' }, b.m ? LC.fmtDate(b.m) : '–'),
          h('td', { 'data-label': 'Cloud' }, b.cloud ? LC.chip('ok', 'in der Cloud') : LC.badge('nur lokal', 'warn')),
          h('td', null, h('div', { class: 'row', style: { gap: '4px' } }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.reveal(b.p) }, LC.icon('folder'), 'Zeigen'),
            h('button', { class: 'btn sm', type: 'button', title: b.cloud ? '' : 'Diese Datei ist nur lokal vorhanden – vor dem Entfernen sichern!', onclick: () => app.cleanup.addPath({ path: b.p, kind: 'file', name: b.name, bytes: b.s, reason: 'Große Datei (' + fmtBytes(b.s) + ')' + (b.cloud ? ', Kopie liegt in der Cloud.' : ', nur lokal vorhanden.') }) }, LC.icon('trash'), 'Zur Aufräumliste')))))))));
  }

  function dupesCard(S, app, f) {
    const rows = f.dupes.slice(0, 40);
    if (!rows.length) return null;
    const cloudRoots = f.cloudRoots.map((r) => r.path);
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('copy', 'lg')), h('h3', null, 'Doppelte Dateien')),
      h('p', { class: 'small muted' }, 'Gleicher Name und gleiche Größe = sehr wahrscheinlich dieselbe Datei. „Lokal und Cloud“ heißt: Die lokale Kopie kannst du entfernen, die Cloud-Kopie bleibt.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'sw', style: { minWidth: '720px' } },
        h('thead', null, h('tr', null, ['Datei', 'Größe', 'Anzahl', 'Wo', ''].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, rows.map((d) => {
          const localCopy = d.paths.find((p) => !cloudRoots.some((r) => LC.pathUnder(p, r)));
          return h('tr', { style: { cursor: 'default' } },
            h('td', { 'data-label': 'Datei' }, h('div', { class: 'sw-name' }, d.name), h('div', { class: 'sw-sub mono' }, d.paths.slice(0, 3).join('  ·  '))),
            h('td', { 'data-label': 'Größe', class: 'nowrap num' }, fmtBytes(d.size)), h('td', { 'data-label': 'Anzahl', class: 'num' }, d.count + '×'),
            h('td', { 'data-label': 'Wo' }, d.inCloud && d.inLocal ? LC.chip('ok', 'lokal und Cloud') : d.inCloud ? LC.badge('mehrfach in der Cloud', 'warn') : LC.badge('mehrfach lokal', 'warn')),
            h('td', null, d.inCloud && d.inLocal && localCopy ? h('button', { class: 'btn sm', type: 'button', onclick: () => app.cleanup.addPath({ path: localCopy, kind: 'file', name: d.name, bytes: d.size, reason: 'Dieselbe Datei liegt schon in der Cloud – die lokale Kopie ist ersetzbar.' }) }, LC.icon('trash'), 'Lokale Kopie → Aufräumliste') : null));
        })))));
  }

  /* ------------------------------------------------------------------ git */
  function reposCard(S, app, f) {
    if (!f.repos.length && !f.gitAvailable) return null;
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('branch', 'lg')), h('h3', null, 'Lokale Git-Repositories'), h('button', { class: 'btn sm', type: 'button', onclick: () => app.go('projects') }, 'Zu Projekte & GitHub')),
      h('p', { class: 'small muted' }, 'Code gehört in Git/GitHub, nicht in die Cloud-Ablage. Hier siehst du, welche Repos auf diesem PC liegen und ob darin Arbeit nicht gesichert ist.'),
      !f.gitAvailable ? h('div', { class: 'callout warn' }, 'Git ist nicht installiert oder nicht im Pfad – der Status (geändert/ungepusht) konnte nicht geprüft werden.') : null,
      f.repos.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'sw', style: { minWidth: '820px' } },
        h('thead', null, h('tr', null, ['Repository', 'GitHub', 'Branch', 'Letzter Commit', 'Status', ''].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, f.repos.map((r) => h('tr', { style: { cursor: 'default' } },
          h('td', { 'data-label': 'Repository' }, h('div', { class: 'sw-name' }, r.name), h('div', { class: 'sw-sub mono' }, r.path), r.nodeModulesBytes ? h('div', { class: 'sw-sub' }, 'node_modules: ' + fmtBytes(r.nodeModulesBytes)) : null),
          h('td', { 'data-label': 'GitHub' }, r.fullName ? h('a', { href: 'https://github.com/' + r.fullName, target: '_blank', rel: 'noopener noreferrer' }, r.fullName) : h('span', { class: 'muted' }, r.remote ? 'anderer Anbieter' : 'kein Remote'), r.fullName && !r.github && S.reposDoc.repos.length ? h('div', { class: 'sw-sub' }, 'nicht in deiner GitHub-Liste') : null),
          h('td', { 'data-label': 'Branch' }, r.branch || '–'),
          h('td', { 'data-label': 'Letzter Commit', class: 'nowrap' }, r.lastCommit ? LC.fmtDate(r.lastCommit) : '–'),
          h('td', { 'data-label': 'Status' }, r.problems.length ? r.problems.map((p) => h('div', null, LC.chip(['no-remote', 'dirty', 'no-upstream', 'ahead'].includes(p.id) ? 'warn' : 'info', p.text))) : LC.chip('ok', 'gesichert')),
          h('td', null, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.reveal(r.path) }, LC.icon('folder'), 'Zeigen'))))))) : h('div', { class: 'empty' }, 'Keine Repositories gefunden.'));
  }

  // other pages (Hausordnung) start the same verified move and show its progress
  LC.pollMoveJob = (S, app) => pollJob(S, app);
  LC.moveJobPanel = (S, app) => jobPanel(S, app, S.model.files);
})(typeof window !== 'undefined' ? window : globalThis);
