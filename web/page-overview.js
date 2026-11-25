/* page-overview.js - "How is my laptop doing?" - score, area tiles, next steps, changes, trends, balance check. */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h, fmtBytes, fmtNum } = LC;

  const AREA_ICON = { ram: 'memory', storage: 'storage', cpu: 'cpu', gpu: 'monitor', battery: 'battery', os: 'windows', security: 'shield', software: 'package', startup: 'power' };

  LC.pages.overview = (S, app) => {
    const m = S.model;
    const { hw, score } = m;
    const sev = score.score >= 85 ? 'ok' : score.score >= 65 ? 'info' : score.score >= 45 ? 'warn' : 'critical';
    const tasks = LC.tasks.compute(m, S.notes).filter((t) => t.status === 'open');
    const important = tasks.filter((t) => t.severity === 'warn' || t.severity === 'critical');

    /* --- hero */
    const topIssue = tasks[0];
    const facts = [
      ['Gerät', hw.device.title],
      ['Windows', hw.os.label + (hw.os.edition ? ' ' + hw.os.edition : '') + (hw.os.supportEnd && hw.os.supportState !== 'unknown' ? (hw.os.supportState === 'ended' ? ' · Support beendet' : ' · Support bis ' + LC.fmtDate(hw.os.supportEnd)) : '')],
      ['Prozessor', hw.cpu.name ? hw.cpu.name.replace(/\(R\)|\(TM\)/g, '').replace(/\s+/g, ' ') : null],
      ['Arbeitsspeicher', hw.ram ? fmtNum(hw.ram.installedBytes / LC.GB, 0) + ' GB ' + hw.ram.type + (hw.ram.soldered.length ? ' (davon ' + fmtNum(hw.ram.soldered.reduce((a, b) => a + b.capGB, 0), 0) + ' GB aufgelötet)' : '') : null],
      ['Speicher', hw.storage.systemDisk ? hw.storage.systemDisk.kind + ' ' + fmtBytes(hw.storage.systemDisk.sizeBytes) : hw.storage.systemVolume ? 'C: ' + fmtBytes(hw.storage.systemVolume.sizeBytes) : null],
    ];
    const hero = h('section', { class: 'card hero' },
      LC.ring(score.score, sev),
      h('div', null,
        h('h2', null, score.verdict),
        h('p', { class: 'ink2' }, important.length
          ? important.length + ' ' + LC.plural(important.length, 'wichtige Aufgabe wartet', 'wichtige Aufgaben warten') + '. Am dringendsten: ' + important[0].title + '.'
          : tasks.length ? 'Nichts Dringendes – ein paar Kleinigkeiten stehen noch an.' : 'Keine offenen Aufgaben.'),
        LC.kv(facts),
        // how the number comes about: for the curious, folded away
        h('details', { class: 'how', style: { marginTop: '10px' } }, h('summary', null, LC.icon('chevron'), ' Wie kommt die Zahl zustande?'),
          h('p', { class: 'small muted' }, 'Eine grobe Orientierung von 0 bis 100: Jeder offene Befund kostet Punkte (dringend 10, Achtung 4, Hinweis 0,5), pro Bereich begrenzt. Ein Klick auf einen Bereich zeigt die zugehörigen Aufgaben.'),
          score.parts.length ? h('div', { class: 'deductions', 'aria-label': 'Abzüge' }, score.parts.slice(0, 6).map((p) =>
            h('button', { class: 'fchip', type: 'button', title: 'Aufgaben in diesem Bereich', onclick: () => app.go('tasks', { area: p.area }) }, (LC.AREAS[p.area] || {}).label + ' −' + fmtNum(p.loss, 1)))) : null)));

    /* --- area tiles */
    const tilesGrid = h('div', { class: 'grid tiles' }, m.areas.map((a) => {
      const page = LC.AREAS[a.area].page;
      const t = h('button', { class: 'card tile', type: 'button', onclick: () => app.go(page, a.area === 'startup' ? { filter: 'startup' } : { area: a.area }) },
        h('div', { class: 't-head' }, LC.sevIcon(a.severity), h('span', null, a.label)),
        h('div', { class: 't-val' }, a.value),
        h('div', { class: 't-sub' }, a.sub),
        a.top ? h('div', { class: 't-top' }, a.top.title) : h('div', { class: 't-top', style: { color: 'var(--muted)' } }, 'Nichts zu tun'));
      return t;
    }));
    const tiles = h('section', { class: 'stack', style: { gap: '10px' } }, h('h3', { class: 'section-h' }, 'Dein PC im Überblick'), tilesGrid);

    /* --- next steps: the three most important things, each with the one button that helps */
    const next = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('tasks', 'lg')), h('h3', null, 'Das solltest du als Nächstes tun'),
        tasks.length > 3 ? h('button', { class: 'btn sm', type: 'button', onclick: () => app.go('tasks') }, 'Alle ' + tasks.length + ' Aufgaben') : null),
      tasks.length ? tasks.slice(0, 3).map((t) => {
        const quick = t.finding && (t.finding.open || [])[0];
        return h('div', { class: 'task-row' }, LC.sevIcon(t.severity === 'ok' ? 'info' : t.severity),
          h('div', null, h('div', { style: { fontWeight: '600' } }, t.title), t.finding && t.finding.action ? h('div', { class: 'small ink2' }, t.finding.action.replace(/:$/, '.').split('\n')[0]) : null),
          h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
            quick ? LC.openButton(quick) : null,
            h('button', { class: 'btn sm' + (quick ? ' ghost' : ''), type: 'button', onclick: () => app.go('tasks', { area: t.area }) }, 'Details')));
      })
        : h('div', { class: 'muted' }, 'Keine offenen Aufgaben – alles in Ordnung. 🎉'));

    /* --- since last scan */
    const d = m.diff;
    const changes = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('refresh', 'lg')), h('h3', null, 'Seit dem letzten Scan')),
      d ? h('div', { class: 'stack', style: { gap: '8px' } },
        h('p', { class: 'small muted', style: { margin: 0 } }, 'Vergleich mit dem Scan vom ' + LC.fmtDateTime(d.since) + ' (' + LC.fmtAgo(d.daysAgo) + ').'),
        d.cFreeDeltaBytes != null ? h('div', null, 'Freier Platz auf C: ', h('b', null, (d.cFreeDeltaBytes >= 0 ? '+' : '−') + fmtBytes(Math.abs(d.cFreeDeltaBytes)))) : null,
        listChange('Neu installiert', d.added), listChange('Entfernt', d.removed), listChange('Aktualisiert', d.updated),
        !d.added.length && !d.removed.length && !d.updated.length ? h('div', { class: 'muted' }, 'Keine Änderungen an der Software.') : null)
        : h('div', { class: 'muted' }, 'Der Vergleich erscheint nach dem zweiten Scan.'));

    /* --- trends */
    const hist = S.history.filter((x) => x.t);
    const lab = (x) => LC.fmtDate(x.t);
    const trend = (title, key, fmt, unit) => {
      const pts = hist.map((x) => ({ label: lab(x), v: x[key] }));
      const last = pts.length ? pts[pts.length - 1].v : null;
      return h('div', null, h('div', { class: 'row between' }, h('span', { class: 'small ink2', style: { fontWeight: '600' } }, title), h('span', { class: 'num', style: { fontWeight: '650' } }, last != null ? fmt(last) : '–')), LC.sparkline(pts, fmt));
    };
    const trends = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('database', 'lg')), h('h3', null, 'Verlauf'), h('span', { class: 'small muted' }, hist.length + ' ' + LC.plural(hist.length, 'Scan', 'Scans') + ' gespeichert')),
      hist.length < 2 ? h('div', { class: 'muted' }, 'Der Verlauf (freier Platz, RAM-Belegung, Programme, Akku, Gesamtwert) erscheint ab dem zweiten Scan. Scanne ruhig regelmäßig – etwa einmal pro Woche reicht.') :
      h('div', { class: 'grid cols-2', style: { gap: '18px' } },
        trend('Gesamtwert', 'score', (v) => Math.round(v) + ' / 100'),
        trend('Freier Platz auf C:', 'cFreeGB', (v) => fmtNum(v) + ' GB'),
        trend('RAM-Belegung beim Scan', 'ramUsedPct', (v) => Math.round(v) + ' %'),
        trend('Programme', 'programs', (v) => String(v)),
        hw.battery ? trend('Akku-Kapazität', 'batteryHealthPct', (v) => Math.round(v) + ' %') : null,
        trend('Ungenutzte Programme', 'unused', (v) => String(v))));

    /* --- balance check */
    const b = m.upgrades.bottlenecks;
    const worst = b[0];
    const balance = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('wrench', 'lg')), h('h3', null, 'Balance-Check: Wo klemmt es am meisten?'), h('button', { class: 'btn sm', type: 'button', onclick: () => app.go('upgrade') }, 'Zu den Upgrade-Tipps')),
      b.length ? [
        h('p', { class: 'ink2' }, worst.score >= 60
          ? 'Größter Engpass: ' + worst.label + ' (' + worst.why + '). ' + (worst.upgradable ? 'Hier bringt ein Upgrade am meisten.' : 'Dieser Teil ist nicht tauschbar – dann zählt, die anderen Teile gut abzustimmen.')
          : 'Deine Komponenten sind gut aufeinander abgestimmt – kein einzelner Teil bremst deutlich.'),
        b.map((x) => h('div', { class: 'bar-row' },
          h('div', null, x.label),
          LC.meter([{ pct: x.score, cls: x.score >= 60 ? 'sev-critical' : x.score >= 40 ? 'sev-warn' : '', title: x.label + ': ' + x.score + ' von 100' }]),
          h('div', { class: 'why' }, (x.score >= 60 ? 'Engpass · ' : x.score >= 40 ? 'Verbesserbar · ' : 'Passt · ') + x.why + (x.upgradable ? '' : ' · fest verbaut'))))]
        : h('div', { class: 'muted' }, 'Nicht genug Hardware-Daten für eine Bewertung.'),
      h('p', { class: 'small muted', style: { marginTop: '10px' } }, 'Heuristik: Länge des Balkens = wie stark der Teil dein System vermutlich bremst (nicht Leistung in Prozent).'));

    // what is not needed every day sits behind one fold
    const more = h('details', { class: 'more-sections' },
      h('summary', { class: 'btn' }, LC.icon('chevron'), 'Mehr anzeigen: Änderungen, Balance-Check, Verlauf'),
      h('div', { class: 'stack', style: { marginTop: '12px' } }, changes, balance, trends));

    return h('div', { class: 'stack' }, hero, next, tiles, more);
  };

  function listChange(title, arr) {
    if (!arr || !arr.length) return null;
    return h('div', null, h('b', null, title + ' (' + arr.length + '): '), h('span', { class: 'ink2' }, arr.slice(0, 8).join(', ') + (arr.length > 8 ? ' …' : '')));
  }
})(typeof window !== 'undefined' ? window : globalThis);
