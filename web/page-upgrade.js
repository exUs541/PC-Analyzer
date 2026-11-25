/* page-upgrade.js - upgrade advisor: what is worth changing, what to buy, what to check first. */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h } = LC;

  const VERDICT_TEXT = { empfohlen: 'Empfohlen', optional: 'Optional', 'nicht nötig': 'Nicht nötig', 'nicht möglich': 'Nicht möglich' };

  const stars = (n) => h('span', { class: 'stars', title: 'Nutzen: ' + n + ' von 5', 'aria-label': 'Nutzen ' + n + ' von 5' }, '●'.repeat(n), h('span', { class: 'off' }, '●'.repeat(5 - n)));

  LC.pages.upgrade = (S, app) => {
    const m = S.model;
    const up = m.upgrades;
    const rec = up.items.filter((i) => i.verdict === 'empfohlen');
    const profile = (S.notes.hardware || {}).usageProfile || 'mixed';

    const profileSel = h('select', { 'aria-label': 'Nutzungsprofil', style: { width: 'auto' }, onchange: (e) => app.updateNotes((n) => { n.hardware = n.hardware || {}; n.hardware.usageProfile = e.target.value; }) },
      Object.entries(LC.USAGE_PROFILES).map(([id, label]) => h('option', { value: id, selected: profile === id ? true : null }, label)));

    const head = h('div', { class: 'page-title' }, h('h2', null, 'Upgrade-Tipps'), h('p', null, 'Was lohnt sich wirklich? Nach Nutzen sortiert, mit dem, was du vor dem Kauf prüfen solltest.'));

    const summary = h('section', { class: 'card' },
      h('div', { class: 'row between' },
        h('div', null,
          h('h3', null, rec.length ? rec.length + ' ' + LC.plural(rec.length, 'Upgrade lohnt', 'Upgrades lohnen') + ' sich' : 'Aktuell lohnt sich kein Upgrade'),
          h('p', { class: 'ink2', style: { margin: '6px 0 0' } }, rec.length ? 'Beste Reihenfolge: ' + rec.map((r) => r.title).join(' → ') + '.' : 'Dein Laptop ist für dein Nutzungsprofil gut ausgestattet. Wenn er sich trotzdem langsam anfühlt, schau bei den Aufgaben nach (Autostart, volle SSD, Windows-Updates).')),
        h('label', { class: 'field', style: { minWidth: '260px' } }, h('span', { class: 'lab' }, 'Wofür nutzt du den Laptop?'), profileSel)),
      h('p', { class: 'small muted', style: { margin: '10px 0 0' } }, 'Das Profil bestimmt, wie viel RAM als „ausreichend“ gilt (Büro 16 GB, Entwicklung/Bildbearbeitung 32 GB).'));

    const b = up.bottlenecks;
    const balance = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('wrench', 'lg')), h('h3', null, 'Passen die Teile zusammen?')),
      b.length ? [
        h('p', { class: 'ink2' }, 'Ein starker Prozessor nützt wenig mit zu wenig RAM oder einer Festplatte – hier siehst du, welcher Teil dein System am meisten bremst (länger = größerer Engpass).'),
        b.map((x) => h('div', { class: 'bar-row' }, h('div', null, x.label), LC.meter([{ pct: x.score, cls: x.score >= 60 ? 'sev-critical' : x.score >= 40 ? 'sev-warn' : '', title: x.score + ' von 100' }]),
          h('div', { class: 'why' }, (x.score >= 60 ? 'Engpass' : x.score >= 40 ? 'Verbesserbar' : 'Passt') + ' · ' + x.why + (x.upgradable ? ' · tauschbar' : ' · fest verbaut'))))]
        : h('div', { class: 'muted' }, 'Zu wenig Daten.'));

    const cards = up.items.map((u) => upgradeCard(u));
    const fixed = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('cpu', 'lg')), h('h3', null, 'Fest verbaute Teile')),
      up.fixed.map((u) => h('div', { class: 'finding', style: { marginBottom: '10px' } }, LC.sevIcon('info', true), h('div', null, h('div', { class: 'f-title' }, u.title + ' – ' + u.current), h('div', { class: 'f-detail' }, u.why), h('div', { class: 'f-action' }, u.advice)))));

    const tips = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('tasks', 'lg')), h('h3', null, 'Allgemeine Regeln für Upgrades')),
      h('ul', { class: 'steps', style: { marginTop: 0 } },
        h('li', null, 'Erst messen, dann kaufen: Dieser Bericht zeigt, wo es hakt – kaufe nur, was einen Engpass löst.'),
        h('li', null, 'Typ, Bauform und Geschwindigkeit müssen exakt zu deinem Gerät passen (z. B. DDR4 ≠ DDR5, SO-DIMM ≠ DIMM). Im Zweifel den Hersteller-Konfigurator (Crucial, Kingston) mit deinem exakten Modellnamen nutzen.'),
        h('li', null, 'Backup vor jedem Eingriff in Laufwerke – und BitLocker-Wiederherstellungsschlüssel sichern.'),
        h('li', null, 'Gehäuse öffnen: Gerät ausschalten, Netzteil abziehen, Akku (falls möglich) trennen, erden. Garantie-Bedingungen vorher lesen.'),
        h('li', null, 'Nach dem Einbau neu scannen: Dieses Tool zeigt dir dann, ob alles erkannt wurde und wie sich die Werte verändert haben.')));

    return h('div', { class: 'stack' }, head, summary, balance, ...cards, fixed, tips);
  };

  function upgradeCard(u) {
    // buying advice is shown openly when an upgrade makes sense, folded away otherwise
    const detailBody = [
      u.shopping && u.shopping.length ? h('div', { style: { marginTop: '12px' } }, h('h4', null, 'Das musst du besorgen'), h('ul', { class: 'steps' }, u.shopping.map((s) => h('li', null, s)))) : null,
      u.checks && u.checks.length ? h('div', { style: { marginTop: '12px' } }, h('h4', null, 'Vor dem Kauf prüfen'), h('ul', { class: 'steps' }, u.checks.map((s) => h('li', null, s)))) : null,
      u.steps && u.steps.length ? h('div', { style: { marginTop: '12px' } }, h('h4', null, 'Danach'), h('ul', { class: 'steps' }, u.steps.map((s) => h('li', null, s)))) : null,
      u.links && u.links.length ? h('div', { class: 'row', style: { marginTop: '12px' } }, u.links.map((l) => h('a', { class: 'btn sm', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, LC.icon('link'), l.label))) : null,
    ].filter(Boolean);
    const detail = !detailBody.length ? null
      : u.verdict === 'empfohlen' || u.verdict === 'optional' ? h('div', null, ...detailBody)
      : h('details', { style: { marginTop: '12px' } }, h('summary', null, 'Trotzdem aufrüsten? Einkaufsliste und Hinweise'), ...detailBody);
    const sev = u.verdict === 'empfohlen' ? 'warn' : u.verdict === 'optional' ? 'info' : 'ok';
    return h('section', { class: 'card', id: 'upg-' + u.id },
      h('div', { class: 'card-head' },
        h('span', { class: 'icon-badge' }, LC.icon(u.area === 'ram' ? 'memory' : u.area === 'storage' ? 'storage' : u.area === 'battery' ? 'battery' : u.area === 'network' ? 'wifi' : 'wrench', 'lg')),
        h('h3', null, u.title),
        h('span', { class: 'verdict ' + (u.verdict === 'empfohlen' ? 'empfohlen' : u.verdict === 'optional' ? 'optional' : '') }, VERDICT_TEXT[u.verdict])),
      h('div', { class: 'facts' },
        h('span', null, 'Jetzt: ', h('b', null, u.current)),
        u.benefit ? h('span', null, 'Nutzen: ', stars(u.benefit)) : null,
        u.cost && u.cost !== '–' ? h('span', null, 'Kosten: ', h('b', null, u.cost)) : null,
        u.difficulty && u.difficulty !== '–' ? h('span', null, 'Aufwand: ', h('b', null, u.difficulty)) : null),
      h('p', null, u.why),
      u.advice ? h('div', { class: 'callout ' + (u.verdict === 'empfohlen' ? 'warn' : u.verdict === 'nicht nötig' ? 'ok' : '') }, h('b', null, 'Empfehlung: '), u.advice) : null,
      u.options && u.options.length > 1 && u.verdict !== 'nicht möglich' ? h('div', { style: { marginTop: '12px' } }, h('h4', null, 'Möglichkeiten'), h('ul', { class: 'steps' }, u.options.map((o) => h('li', null, o.text + (o === u.best ? ' ← Empfehlung' : ''))))) : null,
      detail);
  }
})(typeof window !== 'undefined' ? window : globalThis);
