/* page-space.js - "Wo ist der Speicher geblieben?": the storage analysis inside Hardware → Speicher.
 * Shows the biggest items of the system drive, what kind of thing each is, whether it can go, and what to do about it.
 * The measuring is done by POST /api/scan-space (app.scanSpace); the interpretation is LC.analyzeSpace (space.js). */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h, fmtBytes } = LC;

  const SHOW = 12;            // lines before "Alle anzeigen"
  const UI = { all: false };

  /** Where the cleanable folders may be marked: never Windows or program folders (the server refuses them too). */
  const markable = (it) => it.kind === 'folder' && it.safety === 'safe' && !/^[a-z]:\\(windows|program files)/i.test(it.path);

  function overviewBar(sp) {
    const base = sp.used || sp.scanned || 1;
    const other = sp.groups.find((g) => g.id === 'other');
    const otherBytes = (other ? other.bytes : 0) + sp.small;
    const named = sp.groups.filter((g) => g.id !== 'other');
    const segs = named.map((g) => ({ pct: (g.bytes / base) * 100, cls: g.cls, title: g.label + ': ' + fmtBytes(g.bytes) }));
    if (otherBytes > 0) segs.push({ pct: (otherBytes / base) * 100, cls: 'soft', title: 'Sonstiges und viele kleine Dateien: ' + fmtBytes(otherBytes) });
    if (sp.unreadable > 0) segs.push({ pct: (sp.unreadable / base) * 100, cls: 'hatch', title: 'Ohne Administratorrechte nicht lesbar: ' + fmtBytes(sp.unreadable) });
    const legend = named.map((g) => h('span', null, h('i', { class: g.cls }), g.label + ' ' + fmtBytes(g.bytes)));
    if (otherBytes > 0) legend.push(h('span', null, h('i', { class: 'soft' }), 'Sonstiges & Kleinkram ' + fmtBytes(otherBytes)));
    if (sp.unreadable > 0) legend.push(h('span', null, h('i', { class: 'hatch' }), 'nicht lesbar ' + fmtBytes(sp.unreadable)));
    return h('div', { style: { margin: '10px 0 4px' } }, LC.meter(segs, true), h('div', { class: 'legend' }, legend));
  }

  function itemRow(it, max, S, app) {
    const grp = LC.SPACE_GROUPS.find((g) => g.id === it.group) || LC.SPACE_GROUPS[LC.SPACE_GROUPS.length - 1];
    const saf = LC.SPACE_SAFETY[it.safety] || LC.SPACE_SAFETY.check;
    const marked = S.cleanupDoc && S.cleanupDoc.items && S.cleanupDoc.items[LC.cleanup.pathId(it.path)];
    const actions = [];
    if (it.kind !== 'rest') actions.push(h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.reveal(it.path) }, LC.icon('folder'), 'Im Explorer zeigen'));
    if (markable(it) && !marked) {
      actions.push(h('button', { class: 'btn ghost sm', type: 'button', title: 'Setzt den Ordner auf die Aufräumliste. Entfernt wird erst, wenn du dort jedes Objekt einzeln bestätigst – und es geht in den Papierkorb.',
        onclick: () => { app.cleanup.addPath({ path: it.path, kind: 'folder', name: it.label, bytes: it.bytes, reason: it.hint }); LC.toast('Zum Aufräumen vorgemerkt. Bestätigen kannst du es auf der Seite „Aufräumen“.', 6000); } }, LC.icon('trash'), 'Zum Aufräumen vormerken'));
    }
    return h('div', { class: 'sp-row' },
      h('div', { class: 'sp-top' },
        h('div', { class: 'sp-name' }, h('b', null, it.label), it.kind === 'rest' ? null : h('span', { class: 'small muted', title: it.path }, ' · ' + it.short)),
        h('div', { class: 'sp-size num' }, fmtBytes(it.bytes))),
      LC.meter([{ pct: Math.max(1, (it.bytes / max) * 100), cls: grp.cls, title: fmtBytes(it.bytes) }]),
      h('div', { class: 'sp-tags' }, LC.badge(grp.label, ''), LC.chip(saf.sev, saf.label, saf.title), marked ? LC.badge('vorgemerkt', 'manual') : null,
        actions.length ? h('span', { class: 'sp-actions' }, actions) : null),
      it.hint ? h('div', { class: 'sp-hint' }, it.hint) : null);
  }

  function summary(sp) {
    const lev = sp.items.filter((i) => i.safety === 'check' && (['games', 'dev', 'cloud'].includes(i.group) || i.rule === 'hiberfil.sys')).slice(0, 4);
    return h('div', { class: 'callout ' + (sp.safeBytes >= 5 * LC.GB ? 'ok' : '') },
      h('div', null, h('b', null, 'Unkritisch frei räumbar: ca. ' + fmtBytes(sp.safeBytes)), ' – Caches und Reste, die sich selbst neu aufbauen (Zeilen mit „unkritisch“).'),
      lev.length ? h('div', { style: { marginTop: '4px' } }, h('b', null, 'Größere Hebel, die du entscheidest: '), lev.map((i) => i.label + ' (' + fmtBytes(i.bytes) + ')').join(', ') + '.') : null);
  }

  /* ------------------------------------------------------------------ page "Speicher": split by kind + folder tree */
  const T = { view: 'top', open: new Set(), shown: SHOW, auto: false };
  const share = (b, base) => (base > 0 ? LC.fmtNum((b / base) * 100, b / base >= 0.1 ? 0 : 1) + ' %' : '');

  function plainRow(label, bytes, base, depth, note, cls) {
    return h('div', { class: 'tr-row tr-plain', style: { paddingLeft: 8 + depth * 18 + 'px' } },
      h('div', { class: 'tr-main' }, h('span', { class: 'tr-tog none' }), h('div', { class: 'tr-name muted' }, label, note ? h('span', { class: 'small', title: note }, ' ⓘ') : null)),
      h('div', { class: 'tr-size num muted' }, fmtBytes(bytes)), h('div', { class: 'tr-pct' }, share(bytes, base)),
      h('div', { class: 'tr-bar' }, LC.meter([{ pct: Math.max(0.5, (bytes / base) * 100), cls: cls || 'soft' }])));
  }

  function treeRow(node, base, depth, S, app) {
    const it = node.item;
    const grp = it ? LC.SPACE_GROUPS.find((g) => g.id === it.group) || null : null;
    const saf = it && it.kind !== 'rest' ? LC.SPACE_SAFETY[it.safety] : null;
    const open = T.open.has(node.key);
    const canOpen = node.kids.length > 0;
    const marked = it && S.cleanupDoc && S.cleanupDoc.items && S.cleanupDoc.items[LC.cleanup.pathId(it.path)];
    const tog = canOpen
      ? h('button', { class: 'tr-tog' + (open ? ' open' : ''), type: 'button', 'aria-expanded': String(open), 'aria-label': (open ? 'Zuklappen: ' : 'Aufklappen: ') + node.name, onclick: () => { if (open) T.open.delete(node.key); else T.open.add(node.key); app.render(); } }, LC.icon('chevron'))
      : h('span', { class: 'tr-tog none' });
    const label = it && it.kind !== 'rest' ? it.label : node.name;
    const actions = [];
    if (it && node.kind !== 'file') actions.push(h('button', { class: 'btn ghost sm', type: 'button', onclick: () => app.reveal(node.path) }, LC.icon('folder'), 'Im Explorer zeigen'));
    if (it && markable(it) && !marked) {
      actions.push(h('button', { class: 'btn ghost sm', type: 'button', title: 'Setzt den Ordner auf die Aufräumliste. Entfernt wird erst, wenn du dort jedes Objekt einzeln bestätigst – und es geht in den Papierkorb.',
        onclick: () => { app.cleanup.addPath({ path: it.path, kind: 'folder', name: it.label, bytes: it.bytes, reason: it.hint }); LC.toast('Zum Aufräumen vorgemerkt. Bestätigen kannst du es auf der Seite „Aufräumen“.', 6000); } }, LC.icon('trash'), 'Zum Aufräumen vormerken'));
    }
    return h('div', { class: 'tr-row' + (canOpen ? ' has-kids' : ''), style: { paddingLeft: 8 + depth * 18 + 'px' } },
      h('div', { class: 'tr-main' }, tog, h('div', { class: 'tr-name' }, h('b', null, label), label !== node.name || !it ? h('span', { class: 'small muted', title: node.path }, ' · ' + node.short) : null)),
      h('div', { class: 'tr-size num' }, fmtBytes(node.bytes)), h('div', { class: 'tr-pct' }, share(node.bytes, base)),
      h('div', { class: 'tr-bar' }, LC.meter([{ pct: Math.max(0.5, (node.bytes / base) * 100), cls: grp ? grp.cls : '' }])),
      it && (grp || saf) ? h('div', { class: 'tr-tags sp-tags' }, grp ? LC.badge(grp.label, '') : null, saf ? LC.chip(saf.sev, saf.label, saf.title) : null, marked ? LC.badge('vorgemerkt', 'manual') : null, actions.length ? h('span', { class: 'sp-actions' }, actions) : null) : null,
      it && it.hint && (!canOpen || open) ? h('div', { class: 'tr-hint sp-hint' }, it.hint) : null);
  }

  function treeRows(node, base, depth, S, app, out) {
    out.push(treeRow(node, base, depth, S, app));
    if (node.kids.length && T.open.has(node.key)) {
      node.kids.forEach((k) => treeRows(k, base, depth + 1, S, app, out));
      if (node.rest > 0) out.push(plainRow('übrige Dateien und kleinere Ordner', node.rest, base, depth + 1));
    }
  }

  function treeView(sp, S, app) {
    const t = sp.tree, base = t.bytes || 1, rows = [];
    t.kids.forEach((k) => treeRows(k, base, 0, S, app, rows));
    if (t.rest > 0) rows.push(plainRow('lose Dateien und kleinere Ordner direkt auf dem Laufwerk', t.rest, base, 0));
    if (t.unreadable > 0) rows.push(plainRow('ohne Administratorrechte nicht lesbar', t.unreadable, base, 0, 'Wiederherstellungspunkte, Store-Apps, Systemordner. Starte LaptopCheck einmal als Administrator, um sie mitzuzählen.', 'hatch'));
    const total = t.kids.reduce((a, k) => a + k.bytes, 0) + t.rest + t.unreadable;
    return h('div', null,
      h('p', { class: 'small muted' }, 'Klicke auf den Pfeil, um einen Ordner zu öffnen. Die Zeilen eines Ordners ergeben zusammen genau seine Größe (mit „übrige Dateien und kleinere Ordner“). Ganz oben: ' + fmtBytes(total) + ' = alles, was auf dem Laufwerk belegt ist.'),
      h('div', { class: 'tr-list' }, rows),
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: 'btn sm', type: 'button', onclick: () => { t.kids.forEach((k) => { if (k.kids.length) T.open.add(k.key); }); app.render(); } }, 'Oberste Ebene aufklappen'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { T.open.clear(); app.render(); } }, 'Alles zuklappen')));
  }

  function topView(sp, S, app) {
    const max = sp.items.length ? sp.items[0].bytes : 1;
    const shown = sp.items.slice(0, T.shown);
    const sumShown = shown.reduce((a, i) => a + i.bytes, 0);
    const base = sp.used || sp.scanned || 1;
    return h('div', null,
      h('p', { class: 'small muted' }, 'Die größten Einzelposten, jeweils mit Erklärung und Rat. Ein Ordner steht entweder als Ganzes oder aufgeteilt in seine Teile – nichts wird doppelt gezählt.'),
      h('div', { class: 'sp-list' }, shown.map((it) => itemRow(it, max, S, app))),
      h('div', { class: 'callout', style: { marginTop: '10px' } }, h('b', null, 'Diese ' + shown.length + ' Posten zusammen: ' + fmtBytes(sumShown)), ' = ' + share(sumShown, base) + ' von ' + fmtBytes(base) + ' belegt.' + (sp.items.length > shown.length ? ' Der Rest verteilt sich auf ' + (sp.items.length - shown.length) + ' kleinere Posten.' : '')),
      sp.items.length > SHOW ? h('div', { class: 'row', style: { marginTop: '8px' } },
        sp.items.length > T.shown ? h('button', { class: 'btn sm', type: 'button', onclick: () => { T.shown = Math.min(sp.items.length, T.shown + 30); app.render(); } }, 'Mehr anzeigen (' + (sp.items.length - T.shown) + ' weitere)') : null,
        T.shown > SHOW ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { T.shown = SHOW; app.render(); } }, 'Weniger anzeigen') : null) : null);
  }

  LC.pages.space = (S, app) => {
    const m = S.model;
    const sp = m.space;
    const head = h('div', { class: 'page-title' }, h('h2', null, 'Speicher'),
      h('p', null, 'Wo ist mein Speicher geblieben? Jede Zeile ist die Summe der Zeilen darunter, so lässt sich alles bis zur letzten Zahl nachrechnen.'));
    const scanning = !!S.spaceScanning;
    const btn = h('button', { class: 'btn' + (sp ? '' : ' primary'), type: 'button', disabled: scanning ? true : null, onclick: () => app.scanSpace() },
      LC.icon(scanning ? 'refresh' : 'search', scanning ? 'spin' : ''), scanning ? 'Analysiere … (bis zu 2,5 Min.)' : sp ? 'Neu analysieren' : 'Speicher analysieren');
    const vol = m.hw.storage && m.hw.storage.systemVolume;

    // opening this page is the question "where is my space?": start reading the drive right away (once per session)
    // (not before the saved analysis was asked for: it may exist and only be on its way)
    if (!sp && !scanning && !T.auto && S.spaceLoaded) { T.auto = true; setTimeout(() => app.scanSpace(), 0); }

    if (!sp) {
      return h('div', { class: 'stack' }, head, h('section', { class: 'card', style: { textAlign: 'center', padding: '32px 24px' } },
        h('h3', null, 'Noch nicht analysiert'),
        vol ? h('p', { class: 'ink2', style: { margin: '8px auto' } }, 'Laufwerk C: ' + fmtBytes(vol.usedBytes) + ' belegt von ' + fmtBytes(vol.sizeBytes) + ', ' + fmtBytes(vol.freeBytes) + ' frei.') : null,
        h('p', { class: 'muted', style: { margin: '8px auto 16px', maxWidth: '560px' } }, 'LaptopCheck liest dafür einmal alle Ordner deines Laufwerks (nur lesend, ca. 1–2 Minuten) und zeigt dir, was wie viel Platz belegt: als Aufteilung nach Art und als Ordner-Baum, der bis zur letzten Zahl aufgeht. Ohne diese Analyse kennt das Tool nur eine feste Liste bekannter Ordner – meist weniger als ein Viertel dessen, was belegt ist.'),
        btn));
    }

    const base = sp.used || sp.scanned || 1;
    const cover = Math.round(((sp.listed + sp.small) / base) * 100);
    const hero = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('storage', 'lg')), h('h3', null, 'Laufwerk ' + (sp.root || 'C:').replace(/[\\/]+$/, '') + ': ' + fmtBytes(sp.used != null ? sp.used : sp.scanned) + ' belegt'), btn),
      h('div', { class: 'small muted' }, 'Analysiert am ' + LC.fmtDateTime(sp.scannedAt) + (sp.seconds != null ? ' · ' + Math.round(sp.seconds) + ' s' : '') + ' · nur lesend'),
      sp.partial ? h('div', { class: 'callout warn' }, 'Die Analyse wurde wegen der Zeitgrenze abgebrochen – die Werte sind Mindestwerte. „Neu analysieren“ versucht es noch einmal.') : null,
      overviewBar(sp),
      h('div', { class: 'facts' },
        sp.total != null ? h('span', null, h('b', null, fmtBytes(sp.total)), ' Größe') : null, sp.free != null ? h('span', null, h('b', null, fmtBytes(sp.free)), ' frei') : null,
        h('span', null, h('b', null, fmtBytes(sp.listed)), ' in Ordnern erklärt (' + cover + ' % mit Kleinkram)'),
        sp.unreadable > 0.5 * LC.GB ? h('span', null, h('b', null, fmtBytes(sp.unreadable)), ' nicht lesbar') : null),
      summary(sp),
      (() => {
        const safe = LC.apply.cacheItems(sp, S);
        const bytes = safe.reduce((a, i) => a + i.bytes, 0);
        return h('div', { class: 'row', style: { marginTop: '8px' } },
          safe.length ? h('button', { class: 'btn primary', type: 'button', title: 'Zeigt dir vorher, was genau entfernt wird. Alles geht in den Papierkorb.', onclick: () => LC.apply.caches(S, app, sp) }, LC.icon('trash'), 'Unkritisches aufräumen (' + safe.length + ' Ordner, ' + fmtBytes(bytes) + ')') : null,
          h('button', { class: 'btn ghost', type: 'button', onclick: () => app.go('house') }, LC.icon('home'), 'Spar-Plan: Hausordnung'));
      })());

    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Ansicht' },
      [['top', 'Größte Posten'], ['tree', 'Ordner-Baum']].map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(T.view === id), onclick: () => { T.view = id; app.render(); } }, label)));
    const detail = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('folder', 'lg')), h('h3', null, 'Was belegt den Platz?'), seg),
      T.view === 'tree' ? treeView(sp, S, app) : topView(sp, S, app),
      sp.unreadable > 0.5 * LC.GB ? h('p', { class: 'small muted' }, 'Etwa ' + fmtBytes(sp.unreadable) + ' sind ohne Administratorrechte nicht lesbar (z. B. Wiederherstellungspunkte und Store-Apps). Starte LaptopCheck dafür einmal als Administrator (Rechtsklick → „Als Administrator ausführen“); der Scan bleibt rein lesend.') : null,
      h('p', { class: 'small muted' }, 'Gemessen werden die Dateigrößen auf dem Laufwerk. Cloud-Dateien, die nur online liegen, zählen nicht; Verknüpfungen werden nicht verfolgt, damit nichts doppelt zählt. WinSxS wirkt größer, als es wirklich ist (Hardlinks).'));
    return h('div', { class: 'stack' }, head, hero, detail);
  };

  /** @returns a <details> block for the storage card, or null when the model is not there yet. */
  LC.spaceSection = (m, S, app) => {
    const sp = m && m.space;
    const scanning = !!S.spaceScanning;
    const btn = h('button', { class: 'btn' + (sp ? '' : ' primary'), type: 'button', disabled: scanning ? true : null, onclick: () => app.scanSpace() },
      LC.icon(scanning ? 'refresh' : 'search', scanning ? 'spin' : ''), scanning ? 'Analysiere … (bis zu 2,5 Min.)' : sp ? 'Neu analysieren' : 'Speicher analysieren');

    if (!sp) {
      return h('details', { open: true }, h('summary', null, 'Wo ist der Speicher geblieben?'),
        h('div', { class: 'callout', style: { margin: '8px 0' } },
          h('div', null, 'LaptopCheck liest dafür einmal alle Ordner deines Laufwerks (nur lesend, ca. 1–2 Minuten) und erklärt dir die größten Posten: was es ist, ob es weg kann und wie du es entfernst.')),
        btn);
    }

    const max = sp.items.length ? sp.items[0].bytes : 1;
    const shown = UI.all ? sp.items : sp.items.slice(0, SHOW);
    const facts = h('div', { class: 'facts' },
      sp.used != null ? h('span', null, h('b', null, fmtBytes(sp.used)), ' belegt') : null,
      h('span', null, h('b', null, fmtBytes(sp.listed)), ' in den Posten unten'),
      sp.small > 0 ? h('span', null, h('b', null, fmtBytes(sp.small)), ' in vielen kleinen Dateien') : null,
      sp.unreadable > 0.5 * LC.GB ? h('span', null, h('b', null, fmtBytes(sp.unreadable)), ' nicht lesbar') : null);
    return h('details', { open: true }, h('summary', null, 'Wo ist der Speicher geblieben?'),
      h('div', { class: 'row between', style: { margin: '8px 0 4px' } },
        h('span', { class: 'small muted' }, 'Analysiert am ' + LC.fmtDateTime(sp.scannedAt) + (sp.seconds != null ? ' · ' + Math.round(sp.seconds) + ' s' : '') + ' · nur lesend'),
        h('span', { class: 'row', style: { gap: '6px' } }, h('button', { class: 'btn primary', type: 'button', onclick: () => app.go('space') }, LC.icon('folder'), 'Ordner-Baum und Details'), btn)),
      sp.partial ? h('div', { class: 'callout warn' }, 'Die Analyse wurde wegen der Zeitgrenze abgebrochen – die Werte sind Mindestwerte. „Neu analysieren“ versucht es noch einmal.') : null,
      overviewBar(sp), facts, summary(sp),
      h('div', { class: 'sp-list' }, shown.map((it) => itemRow(it, max, S, app))),
      sp.items.length > SHOW ? h('button', { class: 'btn sm', type: 'button', style: { marginTop: '8px' }, onclick: () => { UI.all = !UI.all; app.render(); } }, UI.all ? 'Weniger anzeigen' : 'Alle ' + sp.items.length + ' Posten anzeigen') : null,
      sp.unreadable > 0.5 * LC.GB ? h('p', { class: 'small muted' }, 'Etwa ' + fmtBytes(sp.unreadable) + ' sind ohne Administratorrechte nicht lesbar (z. B. Wiederherstellungspunkte und Store-Apps). Starte LaptopCheck dafür einmal als Administrator (Rechtsklick → „Als Administrator ausführen“); der Scan bleibt rein lesend.') : null,
      h('p', { class: 'small muted' }, 'Gemessen werden die Dateigrößen auf dem Laufwerk. Cloud-Dateien, die nur online liegen, zählen nicht; Verknüpfungen werden nicht verfolgt, damit nichts doppelt zählt. WinSxS wirkt größer, als es wirklich ist (Hardlinks).'));
  };
})(typeof window !== 'undefined' ? window : globalThis);
