/* page-tasks.js - the to-do list ("Aufgaben"): findings + your own tasks, with done/ignored state kept in notes. */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h } = LC;

  LC.tasks = {
    /** Merge live findings, stored states and custom tasks. */
    compute(model, notes) {
      const st = (notes && notes.tasks) || {};
      const out = [];
      const live = new Set();
      for (const f of model.findings) {
        if (!f.task) continue;
        live.add(f.id);
        const rec = st[f.id];
        out.push({ id: f.id, kind: 'finding', finding: f, title: f.title, area: f.area, severity: f.severity, impact: f.impact || 1, status: rec ? rec.status : 'open', at: rec && rec.at, note: rec && rec.note, persists: !!rec });
      }
      for (const [id, rec] of Object.entries(st)) {
        if (live.has(id)) continue;
        out.push({ id, kind: 'resolved', title: rec.title || id, area: rec.area || 'system', severity: 'ok', impact: 0, status: rec.status, at: rec.at, note: rec.note, gone: true });
      }
      for (const c of (notes && notes.customTasks) || []) {
        out.push({ id: c.id, kind: 'custom', title: c.title, area: c.area || 'system', severity: 'info', impact: 2, status: c.status || 'open', at: c.doneAt || c.createdAt, note: c.note, custom: c });
      }
      const rank = LC.SEV_RANK;
      out.sort((a, b) => rank[b.severity] - rank[a.severity] || b.impact - a.impact);
      return out;
    },
  };

  LC.pages.tasks = (S, app) => {
    const m = S.model;
    const all = LC.tasks.compute(m, S.notes);
    const count = (st) => all.filter((t) => t.status === st).length;
    const areaSel = S.taskArea;
    let list = all.filter((t) => (S.taskFilter === 'all' ? true : t.status === S.taskFilter));
    if (areaSel) list = list.filter((t) => t.area === areaSel);

    const setStatus = (t, status) => app.updateNotes((n) => {
      if (t.kind === 'custom') {
        const c = n.customTasks.find((x) => x.id === t.id);
        if (c) { c.status = status === 'open' ? 'open' : 'done'; c.doneAt = new Date().toISOString(); }
      } else if (status === 'open') delete n.tasks[t.id];
      else n.tasks[t.id] = { status, at: new Date().toISOString(), title: t.title, area: t.area };
    });

    const head = h('div', { class: 'page-title' }, h('h2', null, 'Aufgaben'), h('p', null, 'Das ist dem Scan aufgefallen – das Wichtigste zuerst. Hake ab, was du erledigt hast.'));

    const filters = h('div', { class: 'filters' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Status' },
        [['open', 'Offen'], ['done', 'Erledigt'], ['ignored', 'Ignoriert'], ['all', 'Alle']].map(([id, label]) =>
          h('button', { type: 'button', 'aria-pressed': String(S.taskFilter === id), onclick: () => { S.taskFilter = id; app.render(); } }, label + (id === 'all' ? '' : ' (' + count(id) + ')')))),
      (() => {
        const sel = h('select', { 'aria-label': 'Bereich', style: { width: 'auto' }, onchange: (e) => { S.taskArea = e.target.value; app.render(); } },
          h('option', { value: '' }, 'Alle Bereiche'),
          Object.entries(LC.AREAS).map(([id, a]) => h('option', { value: id, selected: areaSel === id ? true : null }, a.label)));
        return sel;
      })());

    // add custom task
    const input = h('input', { type: 'text', placeholder: 'Eigene Aufgabe, z. B. „RAM-Riegel bestellen“', 'aria-label': 'Eigene Aufgabe' });
    const areaPick = h('select', { 'aria-label': 'Bereich der Aufgabe', style: { width: 'auto' } }, Object.entries(LC.AREAS).map(([id, a]) => h('option', { value: id }, a.label)));
    const addTask = () => {
      const title = input.value.trim();
      if (!title) return;
      app.updateNotes((n) => n.customTasks.push({ id: 'custom:' + Date.now().toString(36), title, area: areaPick.value, status: 'open', createdAt: new Date().toISOString() }));
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTask(); });
    // the form for your own tasks stays folded away until you want it
    const adder = h('details', { class: 'adder' },
      h('summary', { class: 'btn sm' }, LC.icon('plus'), 'Eigene Aufgabe hinzufügen'),
      h('div', { class: 'card', style: { marginTop: '8px' } }, h('div', { class: 'row' }, h('div', { style: { flex: '1 1 280px' } }, input), areaPick, h('button', { class: 'btn primary', type: 'button', onclick: addTask }, LC.icon('plus'), 'Hinzufügen'))));

    const items = list.length
      ? list.map((t) => taskCard(t, m, S, app, setStatus))
      : [h('div', { class: 'card empty' }, S.taskFilter === 'open' ? 'Keine offenen Aufgaben – alles erledigt. 🎉' : 'Nichts in dieser Ansicht.')];

    return h('div', { class: 'stack' }, head, filters, adder, ...items);
  };

  function taskCard(t, m, S, app, setStatus) {
    const f = t.finding;
    const sev = t.severity;
    const body = h('div', null,
      h('h3', null, t.title),
      h('div', { class: 'meta' },
        LC.chip(sev === 'ok' ? 'ok' : sev, LC.SEV_LABEL[sev]),
        LC.badge(LC.AREAS[t.area] ? LC.AREAS[t.area].label : t.area, ''),
        t.kind === 'custom' ? LC.badge('eigene Aufgabe', 'manual') : null,
        t.gone ? LC.badge('nicht mehr festgestellt', '') : null,
        t.persists && t.status !== 'open' ? LC.badge('Problem besteht laut Scan weiterhin', 'warn') : null,
        t.at && t.status !== 'open' ? h('span', { class: 'small muted' }, (t.status === 'done' ? 'erledigt ' : 'ignoriert ') + LC.fmtDate(t.at)) : null),
      f ? LC.findingBody(f, { noTitle: true }) : null,
      t.note ? h('div', { class: 'callout', style: { marginTop: '8px' } }, t.note) : null,
      // "Erledigt" and one way to look closer stay visible; the rest is behind "Mehr"
      (() => {
        const looks = [];
        if (f && f.filter) looks.push(h('button', { class: 'btn sm', type: 'button', onclick: () => app.go('software', { filter: f.filter }) }, LC.icon('package'), 'In der Programmliste zeigen'));
        if (f && LC.AREAS[f.area] && ['hardware', 'space', 'files', 'projects', 'cleanup', 'folders', 'house'].includes(LC.AREAS[f.area].page)) looks.push(h('button', { class: 'btn sm', type: 'button', onclick: () => app.go(LC.AREAS[f.area].page, { area: f.area }) }, 'Details ansehen'));
        if (f && f.softwareKey) looks.push(h('button', { class: 'btn sm', type: 'button', onclick: () => { const a = m.inv.apps.find((x) => x.key === f.softwareKey); if (a) { S.drawerId = a.id; app.go('software', { filter: 'remove' }); } } }, 'Programm öffnen'));
        const more = LC.moreMenu([
          t.status === 'open' && t.kind !== 'custom' ? h('button', { class: 'btn sm', type: 'button', title: 'Blendet diese Aufgabe aus, bis du sie wieder öffnest', onclick: () => setStatus(t, 'ignored') }, 'Ignorieren (nicht mehr anzeigen)') : null,
          ...looks.slice(1),
          t.kind === 'finding' ? LC.reviewButton({ id: 'task:' + t.id, kind: 'task', title: t.title }) : null,
          t.kind === 'custom' ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => app.updateNotes((n) => { n.customTasks = n.customTasks.filter((x) => x.id !== t.id); }) }, 'Löschen') : null,
        ]);
        return h('div', { class: 'actions' },
          t.status === 'open'
            ? h('button', { class: 'btn primary sm', type: 'button', onclick: () => setStatus(t, 'done') }, LC.icon('tasks'), 'Erledigt')
            : h('button', { class: 'btn sm', type: 'button', onclick: () => setStatus(t, 'open') }, 'Wieder öffnen'),
          looks[0] || null, more);
      })());
    return h('article', { class: 'card task' + (t.status !== 'open' ? ' done' : '') }, LC.sevIcon(sev === 'ok' ? 'ok' : sev, true), body);
  }
})(typeof window !== 'undefined' ? window : globalThis);
