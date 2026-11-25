/* page-projects.js - your projects (planned/active), what each one needs (programs, systems, files, hardware, accounts ...),
 * and your GitHub repositories linked to local clones. */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h, fmtNum, fmtBytes } = LC;

  const UI = (LC.projectsUi = LC.projectsUi || { q: '', onlyRecent: true, onlyUnlinked: false, limit: 60 });
  const STATE_LABEL = { auto: 'Automatisch', have: 'Habe ich', missing: 'Brauche ich noch', later: 'Später', na: 'Nicht nötig' };
  const EFF_CHIP = {
    have: () => LC.chip('ok', 'vorhanden'),
    missing: () => LC.chip('warn', 'fehlt'),
    open: () => LC.badge('noch offen', 'auto'),
    later: () => LC.badge('später', 'auto'),
    na: () => LC.badge('nicht nötig', 'auto'),
  };

  LC.pages.projects = (S, app) => {
    const pm = S.model.projects;
    const head = h('div', { class: 'page-title' }, h('h2', null, 'Projekte & GitHub'),
      h('p', null, 'Was hast du vor, und was brauchst du dafür? LaptopCheck zeigt, was noch fehlt – und deine GitHub-Repositories.'));
    return h('div', { class: 'stack' }, head, projectsSection(S, app, pm), missingCard(S, app, pm), githubCard(S, app, pm), reposCard(S, app, pm));
  };

  /* ------------------------------------------------------------------ projects */
  function projectsSection(S, app, pm) {
    const add = () => {
      const p = LC.newProject('Neues Projekt');
      app.updateProjects((d) => { d.projects.unshift(p); });
      S.projectOpen = p.id;
      app.render();
    };
    const picked = new Set();
    const draftBtn = pm.drafts.length ? h('details', { class: 'drafts' }, h('summary', { class: 'btn sm' }, LC.icon('branch'), pm.drafts.length + ' Entwürfe aus aktiven Repos'),
      h('div', { class: 'card', style: { marginTop: '8px' } },
        h('p', { class: 'small muted' }, 'Kürzlich bearbeitete GitHub-Repos ohne Projekt. Klick = ein Projekt je Repo. Oder Häkchen setzen und mehrere Repos zu EINEM Projekt bündeln (z. B. mehrere Browser-Extensions). Die Werkzeuge ergeben sich aus der Programmiersprache und den Projektdateien (package.json, Unity-/Godot-Projekt, manifest.json …).'),
        h('div', { class: 'draft-list' }, pm.drafts.slice(0, 30).map((r) => {
          const cb = h('input', { type: 'checkbox', 'aria-label': r.name + ' auswählen' });
          cb.addEventListener('change', () => { if (cb.checked) picked.add(r.fullName); else picked.delete(r.fullName); });
          return h('div', { class: 'row', style: { gap: '8px' } }, cb,
            h('button', { class: 'fchip', type: 'button', title: r.description || '', onclick: () => { const p = draft([r]); app.updateProjects((d) => { d.projects.unshift(p); }); S.projectOpen = p.id; app.render(); } }, r.name + (r.language ? ' · ' + r.language : '')),
            r.description ? h('span', { class: 'small muted' }, r.description) : null);
        })),
        h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn sm primary', type: 'button', onclick: () => {
          const list = pm.drafts.filter((r) => picked.has(r.fullName));
          if (list.length < 2) { LC.toast('Bitte mindestens zwei Repos ankreuzen – oder einfach auf ein Repo klicken.', 4000); return; }
          const name = prompt('Name des gemeinsamen Projekts:', 'Browser-Extensions');
          if (!name) return;
          const p = draft(list, name);
          app.updateProjects((d) => { d.projects.unshift(p); });
          S.projectOpen = p.id; app.render();
        } }, LC.icon('plus'), 'Angekreuzte zu einem Projekt bündeln')))) : null;
    const draft = (list, name) => LC.draftFromRepos(list, { name, cloneOf: (r) => r.clones || [] });
    const cards = pm.projects.length
      ? pm.projects.map((p) => projectCard(S, app, p, pm))
      : [h('div', { class: 'card empty' }, 'Noch keine Projekte. Lege eines an – oder erzeuge Entwürfe aus deinen GitHub-Repos.')];
    const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; if (f) { app.importProjects(await f.text()); fileIn.value = ''; } });
    const pasteArea = h('textarea', { rows: 4, placeholder: 'Projekt-JSON einfügen …' });
    const io = h('details', { class: 'card' }, h('summary', null, LC.icon('chevron'), ' Projekte importieren / exportieren'),
      h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Import ergänzt vorhandene Projekte (gleiche Kennung ersetzt, gleicher Name wird übersprungen). Der Export ist eine Sicherungskopie; gespeichert wird ohnehin automatisch in data\\projects.json.'),
      pasteArea,
      h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn', type: 'button', onclick: () => { if (app.importProjects(pasteArea.value)) pasteArea.value = ''; } }, 'Übernehmen'),
        h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, LC.icon('up'), 'Datei wählen …'), fileIn,
        h('button', { class: 'btn', type: 'button', onclick: () => LC.download('projekte.json', JSON.stringify(S.projectsDoc, null, 1), 'application/json') }, LC.icon('down'), 'Exportieren')));
    return h('section', { class: 'stack' },
      h('div', { class: 'row between' }, h('h3', null, 'Deine Projekte (' + pm.projects.length + ')'), h('div', { class: 'row' }, draftBtn, h('button', { class: 'btn primary', type: 'button', onclick: add }, LC.icon('plus'), 'Neues Projekt'))),
      ...cards, io);
  }

  const statusSev = { idea: 'info', planned: 'info', active: 'ok', paused: 'info', done: 'ok' };

  function projectCard(S, app, p, pm) {
    const open = S.projectOpen === p.id;
    const c = p.counts;
    const meter = c.required ? LC.meter([{ pct: (c.have / c.required) * 100, cls: 'sev-ok', title: c.have + ' vorhanden' }, { pct: (c.missing / c.required) * 100, cls: 'sev-warn', title: c.missing + ' fehlen' }, { pct: (c.open / c.required) * 100, cls: 'hatch', title: c.open + ' offen' }]) : null;
    return h('article', { class: 'card project' + (open ? ' open' : ''), id: 'proj-' + p.id },
      h('div', { class: 'ci-head' },
        h('span', { class: 'icon-badge' }, LC.icon('briefcase', 'lg')),
        h('div', { class: 'grow' },
          h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, h('h3', { style: { margin: 0 } }, p.name), LC.chip(statusSev[p.status], LC.PROJECT_STATUS[p.status]),
            p.due ? LC.badge('Termin ' + LC.fmtDate(p.due) + (p.daysDue != null ? (p.daysDue < 0 ? ' (überfällig)' : ' (in ' + p.daysDue + ' T.)') : ''), p.daysDue != null && p.daysDue < 0 ? 'warn' : '') : null,
            p.repos.map((rp) => h('a', { class: 'badge', href: 'https://github.com/' + rp, target: '_blank', rel: 'noopener noreferrer' }, rp))),
          p.description ? h('div', { class: 'small ink2' }, p.description) : null),
        LC.reviewButton({ id: 'project:' + p.id, kind: 'project', title: p.name }, { ghost: true, compact: true }),
        h('button', { class: 'btn sm', type: 'button', 'aria-expanded': String(open), onclick: () => { S.projectOpen = open ? null : p.id; app.render(); } }, open ? 'Zuklappen' : 'Bearbeiten', LC.icon('chevron', open ? 'flip' : ''))),
      c.required || p.tasksOpen || p.tasksDone ? h('div', { class: 'proj-stats' },
        c.required ? h('div', { style: { flex: '1 1 260px' } }, meter, h('div', { class: 'small muted' }, c.have + ' von ' + c.required + ' benötigten Ressourcen vorhanden' + (c.missing ? ', ' + c.missing + ' fehlen' : '') + (c.open ? ', ' + c.open + ' noch nicht bewertet' : ''))) : null,
        p.tasksOpen || p.tasksDone ? h('div', { class: 'small' }, 'Aufgaben: ', h('b', null, p.tasksDone + ' / ' + (p.tasksDone + p.tasksOpen)), ' erledigt') : null,
        p.repoInfo.clones.length ? h('div', { class: 'small' }, p.repoInfo.unsaved ? LC.chip('warn', 'lokale Arbeit nicht gesichert') : LC.chip('ok', 'lokal vorhanden & gesichert')) : p.repos.length ? h('div', { class: 'small muted' }, 'Kein lokaler Klon gefunden') : null) : null,
      p.missingPrograms.length ? h('div', { class: 'small' }, h('b', null, 'Fehlt: '), p.missingPrograms.map((r) => r.name).join(', ')) : null,
      open ? editor(S, app, p, pm) : null);
  }

  /* ------------------------------------------------------------------ editor */
  function editor(S, app, p, pm) {
    const edit = (fn) => app.updateProjects((d) => { const x = d.projects.find((q) => q.id === p.id); if (x) { fn(x); x.updatedAt = new Date().toISOString(); } });
    const text = (label, key, opts) => {
      opts = opts || {};
      const inp = opts.area ? h('textarea', { rows: 2 }) : h('input', { type: opts.type || 'text', placeholder: opts.placeholder || '' });
      inp.value = p[key] || '';
      inp.addEventListener('change', () => edit((x) => { x[key] = inp.value.trim(); }));
      return h('label', { class: 'field' }, h('span', { class: 'lab' }, label), inp, opts.hint ? h('span', { class: 'small muted' }, opts.hint) : null);
    };
    const statusSel = h('select', null, Object.entries(LC.PROJECT_STATUS).map(([id, l]) => h('option', { value: id, selected: p.status === id ? true : null }, l)));
    statusSel.addEventListener('change', () => edit((x) => { x.status = statusSel.value; }));
    // Repository picker: alphabetical by repository name, and searchable (type a part of the name; the list narrows down).
    const repoName = (r) => r.name || String(r.fullName).split('/').slice(1).join('/') || r.fullName;
    const repoOwner = (r) => r.owner || String(r.fullName).split('/')[0];
    const repoLabel = (r) => repoName(r) + ' · ' + repoOwner(r) + (r.private ? ' · privat' : '');
    const freeRepos = pm.repos.filter((r) => !p.repos.some((x) => x.toLowerCase() === r.fullName.toLowerCase()))
      .slice().sort((a, b) => repoName(a).localeCompare(repoName(b), 'de', { sensitivity: 'base', numeric: true }) || repoOwner(a).localeCompare(repoOwner(b), 'de', { sensitivity: 'base' }));
    const repoListId = 'repo-options-' + p.id;
    const repoList = h('datalist', { id: repoListId }, freeRepos.map((r) => h('option', { value: repoLabel(r) })));
    const repoPick = h('input', { type: 'search', list: repoListId, autocomplete: 'off', 'aria-label': 'Repository suchen und hinzufügen',
      placeholder: freeRepos.length ? 'Repository suchen und hinzufügen … (' + freeRepos.length + ' verfügbar, A–Z)' : 'Keine weiteren Repositories verfügbar' });
    if (!freeRepos.length) repoPick.disabled = true;
    // Taken over when the field is left (Enter, Tab, click elsewhere) or an entry of the list is chosen - never while typing.
    repoPick.addEventListener('change', () => {
      const q = repoPick.value.trim().toLowerCase();
      if (!q) return;
      let hit = freeRepos.find((r) => repoLabel(r).toLowerCase() === q);
      if (!hit) {
        const exact = freeRepos.filter((r) => repoName(r).toLowerCase() === q || r.fullName.toLowerCase() === q);
        const part = exact.length ? exact : freeRepos.filter((r) => repoLabel(r).toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q));
        if (part.length !== 1) { LC.toast(part.length ? part.length + ' Treffer für „' + repoPick.value.trim() + '“ – bitte einen aus der Liste wählen.' : 'Kein Repository mit „' + repoPick.value.trim() + '“ gefunden.', 4500); return; }
        hit = part[0];
      }
      edit((x) => { x.repos.push(hit.fullName); x.repo = x.repos[0]; });
    });
    const repoField = h('div', { class: 'field' }, h('span', { class: 'lab' }, 'GitHub-Repositories dieses Projekts'),
      p.repos.length ? h('div', { class: 'chips' }, p.repos.map((rp) => h('span', { class: 'badge manual' }, rp, ' ', h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': rp + ' entfernen', style: { padding: '0 4px' }, onclick: () => edit((x) => { x.repos = x.repos.filter((q) => q !== rp); x.repo = x.repos[0] || ''; }) }, '×')))) : h('span', { class: 'small muted' }, 'keines'),
      repoPick, repoList, pm.hasRepos ? null : h('span', { class: 'small muted' }, 'Erst unten die GitHub-Repos laden, dann erscheint hier eine Auswahl.'));

    const catalog = h('datalist', { id: 'tool-catalog' }, LC.TOOL_CATALOG.map((c) => h('option', { value: c.label })));
    const resRows = p.resources.map((r) => resourceRow(r, edit));
    const quick = LC.TOOL_CATALOG.filter((c) => !p.resources.some((r) => r.toolKey === c.key)).slice(0, 12);

    const taskInput = h('input', { type: 'text', placeholder: 'Nächste Aufgabe, z. B. „Datenbank wählen“', 'aria-label': 'Neue Aufgabe' });
    const addTask = () => { const v = taskInput.value.trim(); if (v) edit((x) => { x.tasks.push({ id: LC.newId('t'), text: v, done: false }); }); };
    taskInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTask(); });

    return h('div', { class: 'proj-editor stack' },
      h('div', { class: 'grid cols-2' },
        text('Name', 'name'),
        h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Status'), statusSel),
        text('Beschreibung', 'description', { area: true, placeholder: 'Worum geht es?' }),
        text('Ziel / Ergebnis', 'goal', { area: true, placeholder: 'Wann ist das Projekt „fertig“?' }),
        text('Termin (optional)', 'due', { type: 'date' }),
        repoField,
        text('Lokaler Arbeitsordner', 'localPath', { placeholder: 'C:\\Dev\\mein-projekt', hint: 'Hilft beim Zuordnen von Git-Repos und beim Aufräumen.' }),
        text('Cloud-Ordner (z. B. 05 Projekte/…)', 'cloudPath', { placeholder: 'G:\\Meine Ablage\\05 Projekte\\Name' })),
      h('section', null, h('h4', null, 'Was brauche ich dafür?'),
        h('p', { class: 'small muted' }, 'Programme werden automatisch mit deinen installierten Programmen abgeglichen. Alles andere (Systeme, Dateien, Hardware, Konten …) setzt du selbst auf „Habe ich“, „Brauche ich noch“, „Später“ oder „Nicht nötig“.'),
        catalog,
        resRows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'sw', style: { minWidth: '860px' } },
          h('thead', null, h('tr', null, ['Art', 'Was', 'Stand', 'Erkannt / Hinweis', 'Notiz', ''].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, resRows))) : h('div', { class: 'muted' }, 'Noch nichts eingetragen.'),
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('button', { class: 'btn sm', type: 'button', onclick: () => edit((x) => { x.resources.push(LC.newResource('program', '')); }) }, LC.icon('plus'), 'Programm'),
          Object.entries(LC.RESOURCE_KINDS).filter(([k]) => k !== 'program').map(([k, l]) => h('button', { class: 'btn sm', type: 'button', onclick: () => edit((x) => { x.resources.push(LC.newResource(k, '')); }) }, LC.icon('plus'), l.split(' / ')[0]))),
        quick.length ? h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Schnell hinzufügen: ', quick.map((c) => h('button', { class: 'fchip', type: 'button', onclick: () => edit((x) => { x.resources.push(LC.newResource('program', c.label, { toolKey: c.key })); }) }, c.label))) : null),
      h('section', null, h('h4', null, 'Aufgaben'),
        p.tasks.map((t) => h('div', { class: 'row task-line' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: t.done ? true : null, onchange: (e) => edit((x) => { const q = x.tasks.find((z) => z.id === t.id); if (q) q.done = e.target.checked; }) }), ' ', h('span', { style: { textDecoration: t.done ? 'line-through' : null, color: t.done ? 'var(--muted)' : null } }, t.text)),
          h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Aufgabe löschen', onclick: () => edit((x) => { x.tasks = x.tasks.filter((z) => z.id !== t.id); }) }, LC.icon('x')))),
        h('div', { class: 'row' }, h('div', { style: { flex: '1 1 300px' } }, taskInput), h('button', { class: 'btn', type: 'button', onclick: addTask }, LC.icon('plus'), 'Aufgabe'))),
      h('div', { class: 'row between' },
        p.missingPrograms.some((r) => r.winget) ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Fehlende Programme installieren:'), LC.copyButton(LC.wingetInstallCommands(p.missingPrograms), 'winget-Befehle kopieren'), LC.openButton('terminal', { copy: LC.wingetInstallCommands(p.missingPrograms), label: 'PowerShell öffnen' })) : h('span'),
        h('button', { class: 'btn danger sm', type: 'button', onclick: () => { if (confirm('Projekt „' + p.name + '“ löschen? (Repos, Dateien und Programme bleiben unberührt.)')) { S.projectOpen = null; app.updateProjects((d) => { d.projects = d.projects.filter((x) => x.id !== p.id); }); } } }, LC.icon('trash'), 'Projekt löschen')));
  }

  function resourceRow(r, edit) {
    const mod = (fn) => edit((x) => { const q = x.resources.find((z) => z.id === r.id); if (q) fn(q); });
    const kindSel = h('select', { 'aria-label': 'Art' }, Object.entries(LC.RESOURCE_KINDS).map(([k, l]) => h('option', { value: k, selected: r.kind === k ? true : null }, l)));
    kindSel.addEventListener('change', () => mod((q) => { q.kind = kindSel.value; if (q.kind !== 'program') q.toolKey = ''; }));
    const name = h('input', { type: 'text', value: r.name, list: r.kind === 'program' ? 'tool-catalog' : null, placeholder: r.kind === 'program' ? 'z. B. Blender, Node.js, Git' : r.kind === 'file' ? 'z. B. Texturen, Lizenzdatei' : 'Bezeichnung', 'aria-label': 'Was wird gebraucht' });
    name.addEventListener('change', () => mod((q) => { q.name = name.value.trim(); const cat = q.kind === 'program' ? LC.catalogEntry(q.name) : null; q.toolKey = cat ? cat.key : ''; }));
    const stateSel = h('select', { 'aria-label': 'Stand' }, Object.entries(STATE_LABEL).map(([k, l]) => h('option', { value: k, selected: (r.state || 'auto') === k ? true : null }, k === 'auto' ? (r.kind === 'program' ? 'Automatisch (installiert?)' : 'Noch offen') : l)));
    stateSel.addEventListener('change', () => mod((q) => { q.state = stateSel.value; }));
    const note = h('input', { type: 'text', value: r.note || '', placeholder: 'Notiz', 'aria-label': 'Notiz' });
    note.addEventListener('change', () => mod((q) => { q.note = note.value.trim(); }));
    const hint = [];
    hint.push(EFF_CHIP[r.effective]());
    if (r.detected) hint.push(h('span', { class: 'small' }, ' ' + r.detected.name + (r.detected.version ? ' ' + r.detected.version : '')));
    else if (r.kind === 'program' && r.effective === 'missing') hint.push(h('div', { class: 'small muted' }, r.state === 'auto' ? 'nicht unter den installierten Programmen gefunden – ist es installiert, wähle „Habe ich“' : ''));
    if (r.kind === 'program' && r.effective === 'missing' && r.winget) hint.push(h('div', { class: 'codeblock' }, h('span', { class: 'code' }, 'winget install --id ' + r.winget + ' -e'), LC.copyButton('winget install --id ' + r.winget + ' -e')));
    return h('tr', { style: { cursor: 'default' } },
      h('td', { 'data-label': 'Art' }, kindSel), h('td', { 'data-label': 'Was' }, name), h('td', { 'data-label': 'Stand' }, stateSel), h('td', { 'data-label': 'Erkannt' }, hint), h('td', { 'data-label': 'Notiz' }, note),
      h('td', null, h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Eintrag löschen', onclick: () => edit((x) => { x.resources = x.resources.filter((z) => z.id !== r.id); }) }, LC.icon('x'))));
  }

  /* ------------------------------------------------------------------ what is missing */
  function missingCard(S, app, pm) {
    const miss = pm.missing;
    return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('wrench', 'lg')), h('h3', null, 'Was fehlt für meine Projekte?'),
      miss.some((m) => m.winget) ? LC.copyButton(LC.wingetInstallCommands(miss), 'Alle winget-Befehle kopieren') : null),
    miss.length ? [h('p', { class: 'small muted' }, 'Aus aktiven/geplanten Projekten und kürzlich bearbeiteten Repos ohne Projekt. Ist etwas schon installiert, aber nicht erkannt (z. B. portable), setze es im Projekt auf „Habe ich“.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'sw', style: { minWidth: '640px' } }, h('thead', null, h('tr', null, ['Programm', 'Gebraucht für', 'Installieren'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, miss.map((m) => h('tr', { style: { cursor: 'default' } }, h('td', { 'data-label': 'Programm' }, h('b', null, m.label)), h('td', { 'data-label': 'Gebraucht für' }, m.why.join(', ')),
          h('td', { 'data-label': 'Installieren' }, m.winget ? h('div', { class: 'codeblock' }, h('span', { class: 'code' }, 'winget install --id ' + m.winget + ' -e'), LC.copyButton('winget install --id ' + m.winget + ' -e')) : h('a', { href: LC.searchUrl(m.label + ' download'), target: '_blank', rel: 'noopener noreferrer' }, 'Im Web suchen ↗'))))))),
      h('div', { class: 'row', style: { marginTop: '8px' } }, LC.openButton('terminal', { label: 'PowerShell öffnen' }), h('span', { class: 'small muted' }, 'winget ist in Windows 10/11 meist schon dabei.'))]
      : h('div', { class: 'callout ok' }, pm.projects.length ? 'Alles Nötige für deine aktiven Projekte ist installiert.' : 'Sobald du Projekte mit benötigten Programmen anlegst, erscheint hier, was noch fehlt.'));
  }

  /* ------------------------------------------------------------------ GitHub */
  function githubCard(S, app, pm) {
    const doc = pm.reposDoc;
    const users = h('textarea', { rows: 2, 'aria-label': 'GitHub-Benutzernamen', placeholder: 'Ein Benutzername pro Zeile' });
    users.value = (Array.isArray(S.config.githubUsers) ? S.config.githubUsers : []).join('\n');
    users.addEventListener('change', () => app.updateConfig((c) => { c.githubUsers = users.value.split('\n').map((x) => x.trim()).filter(Boolean); }));
    const paste = h('textarea', { rows: 5, placeholder: 'JSON einfügen: Ausgabe von  gh repo list <Name> --limit 200 --json name,owner,isPrivate,description,primaryLanguage,pushedAt,url   oder eine zuvor gespeicherte LaptopCheck-Liste' });
    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    file.addEventListener('change', async () => { const f = file.files[0]; if (f) { app.importRepos(await f.text()); file.value = ''; } });
    const gh = (S.raw && S.raw.meta && S.raw.meta.github) || {};
    const srcLabel = doc.source === 'public' ? 'nur öffentliche Repos' : doc.source === 'import' ? 'importierte Liste' : LC.ghSourceLabel(doc.source);
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('branch', 'lg')), h('h3', null, 'GitHub'),
        gh.connected
          ? h('button', { class: 'btn', type: 'button', disabled: S.ghSyncing ? true : null, onclick: () => app.syncRepos() }, LC.icon('refresh', S.ghSyncing ? 'spin' : ''), S.ghSyncing ? 'Lade …' : 'Jetzt abgleichen')
          : h('button', { class: 'btn primary', type: 'button', disabled: S.ghConnecting ? true : null, onclick: () => app.connectGitHub() }, LC.icon('branch'), S.ghConnecting ? 'Warte auf Anmeldung im Browser …' : 'Mit GitHub verbinden')),
      gh.connected
        ? h('p', { class: 'ink2' }, LC.badge('verbunden', 'ok'), ' ', gh.login ? 'als ' : '', gh.login ? h('b', null, gh.login) : null, ' über ' + LC.ghSourceLabel(gh.source) + ' – die Liste wird automatisch aktuell gehalten (alle 12 Stunden beim Öffnen).')
        : h('p', { class: 'ink2' }, 'Ein Klick auf ', h('b', null, '„Mit GitHub verbinden“'), ' öffnet GitHub im Browser: anmelden, „Authorize“ bestätigen – fertig. Danach erscheinen auch deine privaten Repositories, und LaptopCheck aktualisiert sich selbst.'),
      doc.repos.length ? h('p', { class: 'small muted' }, doc.repos.length + ' Repositories hinterlegt' + (doc.repos.filter((r) => r.private).length ? ' (' + doc.repos.filter((r) => r.private).length + ' privat)' : '') + (doc.syncedAt ? ' · zuletzt abgeglichen ' + LC.fmtDateTime(doc.syncedAt) : '') + (srcLabel ? ' · Quelle: ' + srcLabel : ''))
        : h('p', { class: 'small muted' }, 'Noch keine Repositories hinterlegt.'),
      doc.errors.length && !gh.connected ? h('div', { class: 'callout warn' }, h('b', null, 'Beim letzten Abgleich: '), doc.errors.join(' · ')) : null,
      h('details', { class: 'how' }, h('summary', null, LC.icon('chevron'), ' Weitere Möglichkeiten (nur falls nötig)'),
        h('label', { class: 'field', style: { maxWidth: '420px' } }, h('span', { class: 'lab' }, 'Öffentliche Repos weiterer GitHub-Konten (Benutzernamen)'), users),
        h('p', { class: 'small muted' }, 'Gelesen werden ausschließlich Name, Sprache, Beschreibung und letzter Push – nie der Code. Liste von Hand einfügen (z. B. aus ', h('span', { class: 'code' }, 'gh repo list'), '):'),
        paste, h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn', type: 'button', onclick: () => { if (app.importRepos(paste.value)) paste.value = ''; } }, 'Liste übernehmen'), h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, LC.icon('up'), 'Datei wählen …'), file)));
  }

  function repoRow(S, app, pm, r) {
    const nameCell = h('td', { 'data-label': 'Repository' },
      h('div', { class: 'sw-name' },
        h('a', { href: r.url || 'https://github.com/' + r.fullName, target: '_blank', rel: 'noopener noreferrer' }, r.fullName),
        r.private ? LC.badge('privat', '') : LC.badge('öffentlich', 'auto'), r.fork ? LC.badge('Fork', 'auto') : null, r.archived ? LC.badge('archiviert', 'auto') : null),
      r.description ? h('div', { class: 'sw-sub' }, r.description) : null);
    const pushCell = h('td', { 'data-label': 'Letzter Push', class: 'nowrap' }, r.pushedAt ? LC.fmtDate(r.pushedAt) : '–', r.daysSincePush != null ? h('div', { class: 'sw-sub' }, LC.fmtAgo(r.daysSincePush)) : null);
    const localCell = h('td', { 'data-label': 'Lokal' }, r.clones.length
      ? r.clones.map((c) => h('div', null, h('span', { class: 'mono small' }, c.path), c.unsaved ? h('div', null, LC.chip('warn', 'nicht gesichert')) : null))
      : h('span', { class: 'muted small' }, 'kein lokaler Klon'));
    const toolCell = h('td', { 'data-label': 'Werkzeuge' }, r.recent
      ? r.tools.map((t) => h('span', { class: 'tool ' + (t.have ? 'have' : 'miss'), title: t.have ? 'installiert: ' + t.app.name : 'nicht gefunden' + (t.winget ? ' – winget install --id ' + t.winget : '') }, (t.have ? '✔ ' : '✖ ') + t.label))
      : h('span', { class: 'muted small' }, '–'));
    const openProject = (id) => { S.projectOpen = id; app.render(); window.scrollTo(0, 0); };
    const projCell = h('td', { 'data-label': 'Projekt' }, r.projectIds.length
      ? r.projectIds.map((id) => { const p = pm.projects.find((x) => x.id === id); return h('button', { class: 'btn ghost sm', type: 'button', onclick: () => openProject(id) }, p ? p.name : id); })
      : h('button', { class: 'btn sm', type: 'button', onclick: () => { const p = LC.draftFromRepo(r, undefined, r.clones); app.updateProjects((d) => { d.projects.unshift(p); }); openProject(p.id); } }, LC.icon('plus'), 'Projekt anlegen'));
    return h('tr', { style: { cursor: 'default' } }, nameCell, h('td', { 'data-label': 'Sprache' }, r.language || '–'), pushCell, localCell, toolCell, projCell);
  }

  function reposCard(S, app, pm) {
    if (!pm.repos.length) return null;
    const q = LC.norm(UI.q);
    let rows = pm.repos.filter((r) => (!UI.onlyRecent || r.recent) && (!UI.onlyUnlinked || !r.projectIds.length) && (!q || LC.norm(r.fullName + ' ' + (r.description || '') + ' ' + (r.language || '')).includes(q)));
    const total = rows.length;
    rows = rows.slice(0, UI.limit);
    const inp = h('input', { type: 'search', value: UI.q, placeholder: 'Repos durchsuchen …', 'aria-label': 'Repos durchsuchen', style: { maxWidth: '300px' } });
    inp.addEventListener('change', () => { UI.q = inp.value; app.render(); });
    const cb = (label, key) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: UI[key] ? true : null, onchange: (e) => { UI[key] = e.target.checked; app.render(); } }), ' ' + label);
    const head = h('thead', null, h('tr', null, ['Repository', 'Sprache', 'Letzter Push', 'Lokal', 'Werkzeuge', 'Projekt'].map((x) => h('th', { scope: 'col' }, x))));
    const table = h('div', { class: 'table-wrap' }, h('table', { class: 'sw', style: { minWidth: '900px' } }, head, h('tbody', null, rows.map((r) => repoRow(S, app, pm, r)))));
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'icon-badge' }, LC.icon('branch', 'lg')), h('h3', null, 'Meine Repositories (' + pm.repos.length + ')')),
      h('div', { class: 'filters' }, inp, cb('nur in den letzten 6 Monaten aktive', 'onlyRecent'), cb('nur ohne Projekt', 'onlyUnlinked'), h('span', { class: 'small muted' }, total + ' angezeigt')),
      rows.length ? table : h('div', { class: 'empty' }, 'Keine Repositories für diesen Filter.'),
      total > rows.length ? h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => { UI.limit += 60; app.render(); } }, 'Mehr anzeigen (' + (total - rows.length) + ')')) : null);
  }
})(typeof window !== 'undefined' ? window : globalThis);
