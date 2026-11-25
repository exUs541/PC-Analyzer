/* projects.js - your planned projects, what they need (programs, systems, files, ...), and your GitHub repositories.
 *
 *   LC.analyzeProjects(doc, ctx) -> view model for the "Projekte" page + findings (area "projects")
 *   LC.newProject / LC.draftFromRepo / LC.newResource / LC.newId -> helpers for the editor
 *
 * doc = data/projects.json, ctx = { apps (inventory), reposDoc (data/repos.json), filesModel (LC.analyzeFiles result or null), now }
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { asArray } = LC;

  LC.newId = (prefix) => (prefix || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  LC.normalizeProjects = (raw) => {
    const d = raw && typeof raw === 'object' ? raw : {};
    return {
      version: 1,
      projects: asArray(d.projects).filter((p) => p && typeof p === 'object').map((p) => ({
        id: String(p.id || LC.newId('p')),
        name: String(p.name || 'Unbenannt'),
        status: LC.PROJECT_STATUS[p.status] ? p.status : 'idea',
        description: p.description || '',
        goal: p.goal || '',
        due: p.due || '',
        repos: [...new Set([p.repo].concat(asArray(p.repos)).filter((x) => typeof x === 'string' && x.includes('/')))],
        localPath: p.localPath || '',
        cloudPath: p.cloudPath || '',
        resources: asArray(p.resources).filter(Boolean).map((r) => ({ id: String(r.id || LC.newId('r')), kind: LC.RESOURCE_KINDS[r.kind] ? r.kind : 'other', name: String(r.name || ''), state: r.state || 'auto', toolKey: r.toolKey || '', note: r.note || '', path: r.path || '' })),
        tasks: asArray(p.tasks).filter(Boolean).map((t) => ({ id: String(t.id || LC.newId('t')), text: String(t.text || ''), done: !!t.done })),
        createdAt: p.createdAt || null,
        updatedAt: p.updatedAt || null,
      })).map((p) => ({ ...p, repo: p.repos[0] || '' })),     // "repo" = first repository (older documents only have this one)
    };
  };
  LC.normalizeRepos = (raw) => {
    const d = raw && typeof raw === 'object' ? raw : {};
    return { ...d, repos: asArray(d.repos).filter((r) => r && r.fullName), users: asArray(d.users), errors: asArray(d.errors) };
  };

  LC.newResource = (kind, name, extra) => ({ id: LC.newId('r'), kind: kind || 'program', name: name || '', state: 'auto', toolKey: '', note: '', path: '', ...(extra || {}) });
  LC.newProject = (name, extra) => ({
    id: LC.newId('p'), name: name || 'Neues Projekt', status: 'idea', description: '', goal: '', due: '', repo: '', repos: [], localPath: '', cloudPath: '',
    resources: [], tasks: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...(extra || {}),
  });

  /* ------------------------------------------------------------------ program matching */
  const catalogEntry = (nameOrKey, toolKey) => {
    const cat = LC.TOOL_CATALOG;
    if (toolKey) { const k = cat.find((c) => c.key === toolKey); if (k) return k; }
    const n = String(nameOrKey || '').trim();
    return cat.find((c) => c.key === n.toLowerCase() || c.alias.test(n) || c.label.toLowerCase() === n.toLowerCase()) || null;
  };
  LC.catalogEntry = catalogEntry;

  /** Which installed program stands for this need? @returns {{app, via, catalog}|null} */
  LC.matchProgram = (nameOrKey, apps, toolKey) => {
    const cat = catalogEntry(nameOrKey, toolKey);
    if (cat) {
      const app = apps.find((a) => cat.re.test(a.name));
      return app ? { app, via: 'catalog', catalog: cat } : null;
    }
    const want = LC.compact(LC.coreName(nameOrKey));
    if (want.length < 3) return null;
    const app = apps.find((a) => {
      const have = LC.compact(LC.coreName(a.name));
      return have.length >= 3 && (have === want || (want.length >= 4 && have.includes(want)) || (have.length >= 4 && want.includes(have)));
    });
    return app ? { app, via: 'name', catalog: null } : null;
  };

  /* ------------------------------------------------------------------ analysis */
  const RESOURCE_STATES = ['auto', 'have', 'missing', 'later', 'na'];
  LC.RESOURCE_STATES = RESOURCE_STATES;

  function resolveResource(r, apps) {
    const out = { ...r, detected: null, catalog: null, winget: null, effective: 'open', how: '' };
    if (r.kind === 'program') {
      const cat = catalogEntry(r.name, r.toolKey);
      const m = LC.matchProgram(r.name, apps, r.toolKey);
      out.catalog = cat;
      out.winget = cat ? cat.winget : null;
      out.detected = m ? m.app : null;
      if (r.state && r.state !== 'auto') { out.effective = r.state; out.how = 'von dir gesetzt'; }
      else if (m) { out.effective = 'have'; out.how = 'installiert erkannt: ' + m.app.name + (m.app.version ? ' ' + m.app.version : ''); }
      else { out.effective = 'missing'; out.how = 'nicht unter den installierten Programmen gefunden'; }
    } else if (r.state && r.state !== 'auto') { out.effective = r.state; out.how = 'von dir gesetzt'; }
    else { out.effective = 'open'; out.how = 'noch nicht bewertet'; }
    return out;
  }

  /** Tools a repository needs: typical for its language + what the project files in a local clone call for. */
  const toolKeys = (repo, clones) => {
    const keys = (LC.LANG_TOOLS[repo.language] || (repo.language ? ['git', 'vscode'] : ['git'])).slice();
    for (const c of clones || []) for (const m of asArray(c.markers)) for (const k of LC.MARKER_TOOLS[m] || []) if (!keys.includes(k)) keys.push(k);
    return keys;
  };
  function repoTools(repo, apps, clones) {
    const keys = toolKeys(repo, clones);
    return keys.map((k) => {
      const cat = LC.TOOL_CATALOG.find((c) => c.key === k);
      const m = cat ? LC.matchProgram(cat.label, apps, k) : null;
      return { key: k, label: cat ? cat.label : k, winget: cat ? cat.winget : null, have: !!m, app: m ? m.app : null };
    });
  }

  /** Project skeleton from one or several GitHub repositories: tools for their languages / project files become program needs. */
  LC.draftFromRepos = (repoList, opts) => {
    opts = opts || {};
    const now = opts.now || new Date();
    const list = asArray(repoList);
    const first = list[0];
    const days = Math.min(...list.map((r) => (r.pushedAt ? LC.daysBetween(r.pushedAt, now) : 99999)));
    const keys = [];
    for (const r of list) for (const k of toolKeys(r, (opts.cloneOf && opts.cloneOf(r)) || [])) if (!keys.includes(k)) keys.push(k);
    return LC.newProject(opts.name || first.name, {
      description: list.length === 1 ? first.description || '' : list.map((r) => r.name).join(', '),
      status: list.every((r) => r.archived) ? 'done' : days <= 90 ? 'active' : 'paused',
      repos: list.map((r) => r.fullName), repo: first.fullName,
      resources: keys.map((k) => { const c = LC.TOOL_CATALOG.find((x) => x.key === k); return LC.newResource('program', c ? c.label : k, { toolKey: k }); })
        .concat([LC.newResource('account', 'GitHub-Konto', { state: 'have' })]),
    });
  };
  LC.draftFromRepo = (repo, now, clones) => LC.draftFromRepos([repo], { now, cloneOf: () => clones || [] });

  /**
   * @param doc  normalised projects document
   * @param ctx  { apps, reposDoc, filesModel, now }
   */
  LC.analyzeProjects = (doc, ctx) => {
    ctx = ctx || {};
    const now = ctx.now ? new Date(ctx.now) : new Date();
    const apps = asArray(ctx.apps);
    const reposDoc = LC.normalizeRepos(ctx.reposDoc);
    const local = ctx.filesModel ? ctx.filesModel.repos : [];
    const projects = LC.normalizeProjects(doc).projects;

    const localBy = new Map();
    for (const lr of local) if (lr.fullName) { const k = lr.fullName.toLowerCase(); (localBy.get(k) || localBy.set(k, []).get(k)).push(lr); }

    const linked = new Set();
    const vmProjects = projects.map((p) => {
      const resources = p.resources.map((r) => resolveResource(r, apps));
      const count = (s) => resources.filter((r) => r.effective === s).length;
      const required = resources.filter((r) => r.effective !== 'na' && r.effective !== 'later');
      const repoKeys = p.repos.map((x) => x.toLowerCase());
      repoKeys.forEach((k) => linked.add(k));
      const ghAll = repoKeys.map((k) => reposDoc.repos.find((r) => r.fullName.toLowerCase() === k)).filter(Boolean);
      const ghRepo = ghAll[0] || null;
      let clones = repoKeys.flatMap((k) => localBy.get(k) || []);
      if (!clones.length && p.localPath) clones = local.filter((lr) => LC.pathUnder(lr.path, p.localPath));
      const daysDue = p.due ? Math.ceil((Date.parse(p.due) - now.getTime()) / 86400000) : null;
      const lastActivity = [p.updatedAt, ...ghAll.map((r) => r.pushedAt), ...clones.map((c) => c.lastCommit)].filter(Boolean).sort().pop() || null;
      return {
        ...p, resources,
        counts: { have: count('have'), missing: count('missing'), open: count('open'), later: count('later'), na: count('na'), required: required.length },
        readyPct: required.length ? Math.round((count('have') / required.length) * 100) : null,
        tasksOpen: p.tasks.filter((t) => !t.done).length,
        tasksDone: p.tasks.filter((t) => t.done).length,
        repoInfo: { github: ghRepo, githubAll: ghAll, clones, unsaved: clones.some((c) => c.unsaved) },
        daysDue,
        lastActivity,
        idleDays: lastActivity ? LC.daysBetween(lastActivity, now) : null,
        missingPrograms: resources.filter((r) => r.kind === 'program' && r.effective === 'missing'),
      };
    });

    const repos = reposDoc.repos.map((r) => {
      const clones = localBy.get(r.fullName.toLowerCase()) || [];
      const days = r.pushedAt ? LC.daysBetween(r.pushedAt, now) : null;
      return {
        ...r, clones, daysSincePush: days, projectIds: vmProjects.filter((p) => p.repos.some((x) => x.toLowerCase() === r.fullName.toLowerCase())).map((p) => p.id),
        tools: repoTools(r, apps, clones), recent: days != null && days <= 180,
      };
    }).sort((a, b) => (a.pushedAt || '') < (b.pushedAt || '') ? 1 : -1);

    // everything missing, grouped by program (projects in progress + recently active repos without a project)
    const missingMap = new Map();
    const addMissing = (key, label, winget, why) => {
      const e = missingMap.get(key) || { key, label, winget, why: [] };
      if (!e.why.includes(why)) e.why.push(why);
      missingMap.set(key, e);
    };
    for (const p of vmProjects) {
      if (p.status !== 'active' && p.status !== 'planned') continue;   // ideas, paused and finished projects: shown per project only
      for (const r of p.missingPrograms) addMissing(r.catalog ? r.catalog.key : 'x:' + LC.compact(r.name), r.catalog ? r.catalog.label : r.name, r.winget, 'Projekt „' + p.name + '“');
    }
    for (const r of repos) {
      if (!r.recent || r.archived || r.fork || r.projectIds.length) continue;
      for (const t of r.tools) if (!t.have) addMissing(t.key, t.label, t.winget, 'Repo ' + r.name + (r.language ? ' (' + r.language + ')' : ''));
    }
    const missing = [...missingMap.values()].sort((a, b) => b.why.length - a.why.length || a.label.localeCompare(b.label, 'de'));

    const drafts = repos.filter((r) => !r.projectIds.length && !r.archived && !r.fork && r.recent);

    const model = { projects: vmProjects, repos, missing, drafts, reposDoc, hasRepos: reposDoc.repos.length > 0, byStatus: {} };
    Object.keys(LC.PROJECT_STATUS).forEach((s) => { model.byStatus[s] = vmProjects.filter((p) => p.status === s).length; });
    model.findings = buildProjectFindings(model, ctx);
    return model;
  };

  /** Install command for several winget ids. */
  LC.wingetInstallCommands = (items) => items.filter((i) => i.winget).map((i) => 'winget install --id ' + i.winget + ' -e').join('\n');

  /* ------------------------------------------------------------------ findings */
  function buildProjectFindings(m, ctx) {
    const F = [];
    const add = (f) => F.push({ area: 'projects', severity: 'info', detail: '', action: '', steps: [], links: [], task: null, impact: 2, ...f });
    const active = m.projects.filter((p) => p.status === 'active' || p.status === 'planned');

    const withMissing = active.filter((p) => p.missingPrograms.length);
    if (m.missing.length && (withMissing.length || m.drafts.length)) {
      const labels = m.missing.slice(0, 6).map((x) => x.label);
      add({
        id: 'projects.missing-tools', severity: withMissing.some((p) => p.status === 'active') ? 'warn' : 'info', task: true, impact: 3,
        title: m.missing.length + ' ' + LC.plural(m.missing.length, 'Programm', 'Programme') + ' für deine Projekte fehlen',
        detail: labels.join(', ') + (m.missing.length > 6 ? ' …' : '') + '. Gebraucht für: ' + [...new Set(m.missing.flatMap((x) => x.why))].slice(0, 4).join(', ') + '.',
        action: 'Unter „Projekte → Was fehlt?“ stehen fertige Installationsbefehle (winget). Wurde etwas schon installiert, aber nicht erkannt, dort „Habe ich“ wählen.',
        open: { target: 'terminal' },
      });
    }
    for (const p of active) {
      if (p.daysDue != null && p.daysDue < 0) add({ id: 'projects.overdue:' + p.id, severity: 'warn', task: true, impact: 3, title: 'Projekt „' + p.name + '“ ist überfällig', detail: 'Termin war ' + LC.fmtDate(p.due) + '.', action: 'Termin anpassen oder Status auf „Pausiert“/„Fertig“ setzen.' });
      else if (p.daysDue != null && p.daysDue <= 14) add({ id: 'projects.due:' + p.id, severity: 'info', task: true, impact: 2, title: 'Projekt „' + p.name + '“ ist in ' + p.daysDue + ' ' + LC.plural(p.daysDue, 'Tag', 'Tagen') + ' fällig', detail: p.counts.missing ? p.counts.missing + ' benötigte Ressource(n) fehlen noch.' : '', action: '' });
    }
    for (const p of m.projects.filter((x) => x.status === 'active' && x.idleDays != null && x.idleDays > 90)) {
      add({ id: 'projects.stale:' + p.id, severity: 'info', impact: 1, title: 'Projekt „' + p.name + '“ steht auf „In Arbeit“, aber seit ' + p.idleDays + ' Tagen ist nichts passiert', detail: 'Letzte Aktivität: ' + LC.fmtDate(p.lastActivity) + '.', action: 'Status auf „Pausiert“ setzen – oder die nächste Aufgabe eintragen.' });
    }
    if (m.drafts.length >= 3) {
      add({ id: 'projects.drafts', severity: 'info', impact: 1, title: m.drafts.length + ' kürzlich aktive GitHub-Repos gehören zu keinem Projekt', detail: m.drafts.slice(0, 5).map((r) => r.name).join(', ') + (m.drafts.length > 5 ? ' …' : '') + '.', action: 'Unter „Projekte → Entwürfe aus Repos“ per Klick Projekte daraus anlegen (Werkzeug-Liste inklusive).' });
    }
    if (!m.hasRepos) {
      add({ id: 'projects.no-repos', severity: 'info', impact: 1, title: 'Deine GitHub-Repositories sind noch nicht hinterlegt', detail: 'Ohne Liste kann LaptopCheck Repos weder mit Projekten noch mit lokalen Ordnern verknüpfen.', action: 'Unter „Projekte → GitHub“ den Benutzernamen eintragen und „Synchronisieren“ wählen.' });
    }
    return F;
  }
})(typeof window !== 'undefined' ? window : globalThis);
