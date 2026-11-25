/* app.js - state, routing, server API, rendering lifecycle. Pages live in page-*.js and register in LC.pages. */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h } = LC;
  LC.pages = LC.pages || {};

  const ROUTES = [
    { id: 'overview', label: 'Übersicht', icon: 'home' },
    { id: 'tasks', label: 'Aufgaben', icon: 'tasks' },
    { id: 'cleanup', label: 'Aufräumen', icon: 'trash' },
    { id: 'software', label: 'Software', icon: 'package' },
    { id: 'hardware', label: 'Hardware', icon: 'cpu' },
    { id: 'space', label: 'Speicher', icon: 'storage' },
    { id: 'upgrade', label: 'Upgrade-Tipps', icon: 'wrench' },
    { id: 'files', label: 'Dateien & Cloud', icon: 'cloud' },
    { id: 'folders', label: 'Inventur', icon: 'search' },
    { id: 'house', label: 'Hausordnung', icon: 'home' },
    { id: 'organize', label: 'Ordnen', icon: 'folder' },
    { id: 'compare', label: 'Ordner vergleichen', icon: 'search' },
    { id: 'projects', label: 'Projekte', icon: 'briefcase' },
    { id: 'review', label: 'Prüfen', icon: 'flag' },
    { id: 'data', label: 'Daten', icon: 'database' },
  ];

  /* The menu has five entries. Pages that belong together share one entry and show a tab strip on top (route id, tab label). */
  const GROUPS = [
    { id: 'start', label: 'Start', sub: 'Wie geht es meinem PC?', icon: 'home', routes: [['overview', 'Start']] },
    { id: 'todo', label: 'Aufgaben', sub: 'Was soll ich tun?', icon: 'tasks', routes: [['tasks', 'Zu erledigen'], ['cleanup', 'Aufräumen']] },
    { id: 'pc', label: 'Mein PC', sub: 'Programme, Hardware, Dateien', icon: 'laptop', routes: [['software', 'Programme'], ['hardware', 'Hardware'], ['space', 'Speicher'], ['files', 'Dateien & Cloud'], ['folders', 'Inventur'], ['house', 'Hausordnung'], ['organize', 'Ordnen'], ['compare', 'Ordner vergleichen'], ['upgrade', 'Upgrade-Tipps']] },
    { id: 'projects', label: 'Projekte', sub: 'Was brauche ich dafür?', icon: 'briefcase', routes: [['projects', 'Projekte']] },
    { id: 'settings', label: 'Einstellungen', sub: 'Updates, Scan, Sicherung', icon: 'settings', routes: [['data', 'Einstellungen'], ['review', 'Prüfen']] },
  ];
  const groupOf = (route) => GROUPS.find((g) => g.routes.some((r) => r[0] === route)) || GROUPS[0];
  const lastInGroup = {};

  const TOKEN = (document.querySelector('meta[name="lc-token"]') || {}).content || '';

  const S = {
    raw: null,        // { snapshot, prev, notes, history, meta }
    notes: LC.normalizeNotes(null),
    history: [],
    model: null,
    route: 'overview',
    params: {},
    scanning: false,
    save: 'idle',     // idle | pending | saving | saved | error
    offline: false,
    sw: { q: '', filter: 'programs', cat: '', sort: 'name', dir: 1, components: false },
    drawerKey: null,
    taskFilter: 'open',
    taskArea: '',
    // files / cloud / projects / clean-up
    filesRaw: null,       // data/files.json (loaded on demand, can be large)
    filesMeta: null,      // { exists, bytes, modified } from /api/state
    filesScanning: false,
    config: {},           // data/config.json
    projectsDoc: LC.normalizeProjects(null),
    reposDoc: LC.normalizeRepos(null),
    cleanupDoc: LC.normalizeCleanup(null),
    ghSyncing: false,
    space: null,          // raw space.json: the storage analysis (Hardware -> Speicher)
    spaceScanning: false,
    spaceLoaded: false,   // the saved storage analysis has been asked for (found or not)
    cleanupOpen: {},      // expanded items on the clean-up page
    projectOpen: null,
  };

  /* ------------------------------------------------------------------ api */
  async function api(path, opts) {
    opts = opts || {};
    const headers = { 'X-LC-Token': TOKEN };
    if (opts.body != null) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body });
    if (!res.ok) {
      let msg = path + ' → HTTP ' + res.status;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* no json body */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /* ------------------------------------------------------------------ state */
  function recompute() {
    if (!S.raw || !S.raw.snapshot) { S.model = null; return; }
    const t0 = performance.now();
    S.model = LC.analyze(S.raw.snapshot, { notes: S.notes, history: S.history, prev: S.raw.prev, files: S.filesRaw, projects: S.projectsDoc, repos: S.reposDoc, cleanup: S.cleanupDoc, space: S.space, config: S.config });
    S.timing = Math.round(performance.now() - t0);
  }

  function applyState(st) {
    S.raw = st;
    S.notes = LC.normalizeNotes(st.notes);
    S.history = Array.isArray(st.history) ? st.history : [];
    S.config = st.config && typeof st.config === 'object' ? st.config : {};
    S.projectsDoc = LC.normalizeProjects(st.projects);
    S.reposDoc = LC.normalizeRepos(st.repos);
    S.cleanupDoc = LC.normalizeCleanup(st.cleanup);
    const newMeta = st.files || null;
    if (!newMeta || !newMeta.exists) S.filesRaw = null;
    const stale = newMeta && newMeta.exists && (!S.filesMeta || S.filesMeta.modified !== newMeta.modified);
    S.filesMeta = newMeta;
    recompute();
    trackRemoved();
    ensureHistory();
    if (stale || (newMeta && newMeta.exists && !S.filesRaw)) loadFiles();
    resumeDeletePolls();
    announceUpdate(st.update);
  }

  function announceUpdate(u) {
    if (!u || u.result !== 'updated' || !u.updatedAt) return;
    try {
      if (localStorage.getItem('lc-seen-update') === u.updatedAt) return;
      localStorage.setItem('lc-seen-update', u.updatedAt);
    } catch (e) { return; }
    setTimeout(() => LC.toast('LaptopCheck wurde automatisch aktualisiert' + (u.version ? ' – jetzt Version ' + u.version : '') + '.', 6000), 400);
  }

  /** Programs that vanished since the previous scan are remembered (name + date): their leftovers are then recognised in every later scan, too. */
  const COMPONENT_NAME = /redistributable|runtime|driver|update|hotfix|\bKB\d{5,}|\.net\b|visual c\+\+|\bsdk\b|webview|language pack|vc_redist|microsoft edge/i;
  function trackRemoved() {
    const m = S.model;
    if (!m || !S.notes) return;
    const compactCore = (n) => LC.compact(LC.coreName(n));
    const installed = new Set(m.inv.apps.map((a) => compactCore(a.name)));
    const had = S.notes.removedApps || [];
    // a program that is installed again is no longer "removed"
    let list = had.filter((r) => !installed.has(compactCore(r.name)));
    const known = new Set(list.map((r) => compactCore(r.name)));
    const fresh = (m.diff ? m.diff.removed : []).filter((n) => !COMPONENT_NAME.test(n) && !known.has(compactCore(n)) && !installed.has(compactCore(n)));
    if (fresh.length) list = list.concat(fresh.map((name) => ({ name, removedAt: m.snap.collectedAt }))).slice(-150);
    if (fresh.length || list.length !== had.length) {
      S.notes.removedApps = list;
      scheduleSave();
      S.model = LC.analyze(S.raw.snapshot, { notes: S.notes, history: S.history, prev: S.raw.prev, files: S.filesRaw, projects: S.projectsDoc, repos: S.reposDoc, cleanup: S.cleanupDoc, space: S.space, config: S.config });
    }
  }

  async function loadFiles() {
    try {
      const f = await api('/api/files');
      if (f && typeof f === 'object') { S.filesRaw = f; recompute(); render({ background: true }); }
    } catch (e) { console.error(e); }
  }

  function ensureHistory() {
    const m = S.model;
    if (!m) return;
    if (S.history.some((x) => x.t === m.snap.collectedAt)) return;
    S.history = S.history.concat(LC.summaryMetrics(m.snap, m.hw, m.inv, m.stats, m.score.score)).slice(-200);
    api('/api/store/history', { method: 'PUT', body: JSON.stringify(S.history) }).catch(() => {});
  }

  async function loadState() {
    try {
      applyState(await api('/api/state'));
      S.offline = false;
    } catch (e) {
      S.offline = true;
      console.error(e);
    }
  }

  /* ------------------------------------------------------------------ saving of manual entries */
  const STORES = { notes: () => S.notes, projects: () => S.projectsDoc, config: () => S.config, repos: () => S.reposDoc, cleanup: () => S.cleanupDoc };
  const dirty = new Set();
  let saveTimer = null;
  function scheduleSave(name) {
    dirty.add(name || 'notes');
    S.save = 'pending';
    renderSaveState();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 500);
  }
  async function flushSave() {
    clearTimeout(saveTimer);
    if (!dirty.size) { if (S.save === 'error') S.save = 'idle'; renderSaveState(); return; }
    S.save = 'saving';
    renderSaveState();
    let ok = true;
    for (const name of [...dirty]) {
      dirty.delete(name);          // edits made while the request is in flight mark it dirty again
      const payload = JSON.stringify(STORES[name]());
      if (name === 'notes') { try { localStorage.setItem('lc-notes-backup', payload); } catch (e) { /* storage may be unavailable */ } }
      try {
        await api('/api/store/' + name, { method: 'PUT', body: payload });
        S.offline = false;
      } catch (e) {
        ok = false;
        dirty.add(name);
        console.error(e);
      }
    }
    S.save = ok ? (dirty.size ? 'pending' : 'saved') : 'error';
    renderSaveState();
    renderBanners();
  }
  window.addEventListener('beforeunload', (e) => {
    if (S.save === 'pending' || S.save === 'saving' || S.save === 'error') { e.preventDefault(); e.returnValue = ''; }
  });

  /** Apply a change to the notes object, re-analyse and persist. */
  function updateNotes(mutator, opts) {
    mutator(S.notes);
    recompute();
    scheduleSave();
    render(opts);
  }

  /** Same pattern for the other stores. */
  function updateStore(name, mutator, opts) {
    mutator(STORES[name]());
    recompute();
    scheduleSave(name);
    render(opts);
  }
  const updateProjects = (m, o) => updateStore('projects', m, o);
  const updateConfig = (m, o) => updateStore('config', m, o);
  const updateCleanup = (m, o) => updateStore('cleanup', m, o);

  const APP_FIELDS = ['purpose', 'description', 'publisher', 'installDate', 'lastUsed', 'category', 'decision', 'note', 'kind'];
  function setAppField(key, field, value, opts) {
    updateNotes((n) => {
      const cur = Object.assign({}, n.apps[key] || {});
      const v = typeof value === 'string' ? value.trim() : value;
      if (v === '' || v == null) delete cur[field]; else cur[field] = v;
      const has = APP_FIELDS.some((f) => cur[f] != null && cur[f] !== '');
      if (has) { cur.updatedAt = new Date().toISOString(); n.apps[key] = cur; } else delete n.apps[key];
    }, opts);
  }

  /* ------------------------------------------------------------------ scan */
  async function scan(quick) {
    if (S.scanning) return;
    S.scanning = true;
    renderHeader();
    try {
      applyState(await api('/api/scan' + (quick ? '?quick=1' : ''), { method: 'POST' }));
      LC.toast('Scan abgeschlossen' + (S.model && S.model.snap.warnings.length ? ' – ' + S.model.snap.warnings.length + ' Bereich(e) mit Lücken' : ''));
    } catch (e) {
      LC.toast('Scan fehlgeschlagen: ' + e.message, 5000);
    }
    S.scanning = false;
    render({ background: true });
    // the complete picture of the drive should not need an extra click: read it after a scan when there is none yet or it is a day old
    const sp = S.model && S.model.space;
    const spAge = sp && sp.scannedAt ? (Date.now() - Date.parse(sp.scannedAt)) / 86400000 : Infinity;
    if (S.model && S.spaceLoaded && !S.spaceScanning && !(spAge < 1)) scanSpace();
  }


  /* ------------------------------------------------------------------ files scan, GitHub */
  async function scanFiles() {
    if (S.filesScanning) return;
    S.filesScanning = true;
    render();
    try {
      const f = await api('/api/scan-files', { method: 'POST' });
      S.filesRaw = f;
      S.filesMeta = { exists: true, modified: new Date().toISOString() };
      recompute();
      LC.toast('Dateien-Scan abgeschlossen (' + Math.round(f.seconds || 0) + ' s)');
    } catch (e) {
      LC.toast('Dateien-Scan fehlgeschlagen: ' + e.message, 6000);
    }
    S.filesScanning = false;
    render({ background: true });
  }

  /** The last storage analysis (if there is one): shown right away, no new scan needed. */
  async function loadSpace() {
    try {
      const sp = await api('/api/space');
      if (sp && typeof sp === 'object') { S.space = sp; recompute(); }
    } catch (e) { /* a server without the storage analysis: the card then offers nothing to show */ }
    // only now is it known whether there is a saved analysis: the page may start a new one on its own when there is none
    S.spaceLoaded = true;
    render({ background: true });
  }

  /** Reads the whole system drive (one or two minutes, read-only) and explains the biggest items. */
  async function scanSpace() {
    if (S.spaceScanning) return;
    S.spaceScanning = true;
    render();
    try {
      S.space = await api('/api/scan-space', { method: 'POST' });
      recompute();
      const sp = S.model && S.model.space;
      LC.toast('Speicher-Analyse abgeschlossen' + (sp ? ' – ' + fmtBytesSafe(sp.safeBytes) + ' davon unkritisch räumbar' : '') + (sp && sp.partial ? ' (wegen der Zeitgrenze unvollständig)' : ''), 6000);
    } catch (e) {
      LC.toast('Speicher-Analyse nicht möglich: ' + e.message, 8000);
    }
    S.spaceScanning = false;
    render({ background: true });
  }
  const fmtBytesSafe = (b) => LC.fmtBytes(b);

  async function syncRepos(quiet) {
    if (S.ghSyncing) return;
    S.ghSyncing = true;
    render({ background: quiet === true });
    try {
      const d = await api('/api/github/sync', { method: 'POST' });
      S.reposDoc = LC.normalizeRepos(d);
      recompute();
      const errs = asArrayLocal(d.errors);
      if (quiet !== true || errs.length) LC.toast(d.fetched + ' Repositories geladen (' + (d.source === 'public' ? 'nur öffentliche' : 'über ' + LC.ghSourceLabel(d.source)) + ')' + (errs.length ? ' – Fehler: ' + errs[0] : ''), errs.length ? 8000 : 3500);
    } catch (e) {
      if (quiet !== true) LC.toast('GitHub-Abgleich fehlgeschlagen: ' + e.message, 6000);
    }
    S.ghSyncing = false;
    render({ background: true });
  }
  const asArrayLocal = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

  /** Accepts our own store format, a plain array, or the output of `gh repo list --json ...`. */
  function importRepos(text) {
    let j;
    try { j = JSON.parse(text); } catch (e) { LC.toast('Das ist kein gültiges JSON.', 4000); return false; }
    const list = Array.isArray(j) ? j : asArrayLocal(j && j.repos);
    const repos = list.map((r) => {
      if (!r || typeof r !== 'object') return null;
      const owner = (r.owner && (r.owner.login || r.owner)) || r.owner || (String(r.fullName || '').split('/')[0]);
      const name = r.name || String(r.fullName || '').split('/')[1];
      if (!owner || !name) return null;
      return { fullName: r.fullName || owner + '/' + name, name, owner: String(owner), private: !!(r.private != null ? r.private : r.isPrivate), url: r.url || r.html_url || 'https://github.com/' + owner + '/' + name,
        description: r.description || null, language: r.language || (r.primaryLanguage && r.primaryLanguage.name) || null, pushedAt: r.pushedAt || r.pushed_at || null, archived: !!(r.archived || r.isArchived), fork: !!(r.fork || r.isFork), topics: asArrayLocal(r.topics), source: 'import' };
    }).filter(Boolean);
    if (!repos.length) { LC.toast('Keine Repositories in der Datei gefunden.', 4000); return false; }
    const known = new Map(S.reposDoc.repos.map((r) => [r.fullName.toLowerCase(), r]));
    for (const r of repos) known.set(r.fullName.toLowerCase(), { ...known.get(r.fullName.toLowerCase()), ...r });
    S.reposDoc = LC.normalizeRepos({ ...S.reposDoc, source: S.reposDoc.source || 'import', repos: [...known.values()] });
    recompute();
    scheduleSave('repos');
    render();
    LC.toast(repos.length + ' Repositories übernommen');
    return true;
  }

  /** Import projects from JSON ({projects:[...]} or a plain array). Same id replaces, same name is skipped (no duplicates). */
  function importProjects(text) {
    let j;
    try { j = JSON.parse(text); } catch (e) { LC.toast('Das ist kein gültiges JSON.', 4000); return false; }
    const incoming = LC.normalizeProjects(Array.isArray(j) ? { projects: j } : j).projects;
    if (!incoming.length) { LC.toast('Keine Projekte in der Datei gefunden.', 4000); return false; }
    let added = 0, replaced = 0, skipped = 0;
    updateProjects((d) => {
      for (const p of incoming) {
        const byId = d.projects.findIndex((x) => x.id === p.id);
        if (byId >= 0) { d.projects[byId] = p; replaced++; continue; }
        if (d.projects.some((x) => LC.norm(x.name) === LC.norm(p.name))) { skipped++; continue; }
        p.createdAt = p.createdAt || new Date().toISOString();
        d.projects.push(p); added++;
      }
    });
    LC.toast(added + ' Projekt(e) übernommen' + (replaced ? ', ' + replaced + ' ersetzt' : '') + (skipped ? ', ' + skipped + ' mit gleichem Namen übersprungen' : ''), 5000);
    return true;
  }

  /** Runs winget in its own window (the server only accepts packages from the last scan). */
  async function wingetUpgrade(req) {
    try {
      await api('/api/winget/upgrade', { method: 'POST', body: JSON.stringify(req) });
      LC.toast('Ein Fenster zeigt den Fortschritt von winget. Danach „Neu scannen“, damit die Liste stimmt.', 9000);
      return true;
    } catch (e) { LC.toast('Konnte nicht gestartet werden: ' + e.message, 7000); return false; }
  }

  /* ------------------------------------------------------------------ self-update */
  /** Start.bat again (it updates from GitHub first), then reload this tab once the new instance answers. */
  async function restartUpdate() {
    await flushSave();
    let r;
    try { r = await api('/api/update/restart', { method: 'POST' }); }
    catch (e) { LC.toast('Neustart nicht möglich: ' + e.message, 7000); return; }
    if (r && r.dryRun) { LC.toast('Testmodus: Neustart würde jetzt ausgeführt.'); return; }
    if (r && r.noUpdate) { LC.toast('Du hast bereits die neueste Version.', 6000); return; }
    const meta = document.querySelector('meta[name="lc-token"]');
    const oldToken = meta ? meta.content : '';
    document.body.replaceChildren(h('div', { style: { padding: '60px 20px', textAlign: 'center' } },
      h('h2', null, 'LaptopCheck wird aktualisiert …'), h('p', { class: 'muted' }, 'Das dauert meist unter einer Minute. Diese Seite lädt sich danach von selbst neu.')));
    const started = Date.now();
    const poll = async () => {
      try {
        const res = await fetch('/', { cache: 'no-store' });
        const m = /lc-token" content="([a-f0-9]+)/.exec(await res.text());
        if (res.ok && m && m[1] !== oldToken) { location.reload(); return; }
      } catch (e) { /* old instance gone, new one not up yet */ }
      if (Date.now() - started < 180000) setTimeout(poll, 1500);
      else document.body.appendChild(h('p', { style: { textAlign: 'center' } }, 'Dauert ungewöhnlich lange – öffne LaptopCheck im Startmenü, falls sich das Fenster nicht von selbst erneuert.'));
    };
    setTimeout(poll, 2500);
  }

  /* The app loads a new version quietly in the background. Here the dashboard notices it (looks every minute), says so, and - when you
     have not touched the window for two minutes and nothing is running - restarts into it by itself, once per page. Switch it off with
     "autoUpdate": false in config.json (the tick on the page "Daten"). */
  const IDLE_BEFORE_RESTART_MS = 2 * 60 * 1000;
  let lastInput = Date.now();
  let autoRestartTried = false;
  if (typeof document !== 'undefined') ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true }));
  const somethingRuns = () => S.scanning || S.filesScanning || S.spaceScanning || S.ghSyncing || S.save === 'pending' || S.save === 'saving' || deletePolls.size > 0
    || !!(LC.filesUi && (LC.filesUi.polling || (LC.filesUi.restore && !LC.filesUi.restore.result))) || isTyping() || !!document.querySelector('#modal-root .modal');
  async function pollUpdate() {
    try {
      const st = await api('/api/update/state');
      const key = (u) => (u ? u.result + '|' + (u.available || '') + '|' + (u.version || '') : '');
      const changed = key(st) !== key(S.raw && S.raw.update);
      if (S.raw) S.raw.update = st;
      if (changed) renderBanners();
      if (st && st.result === 'ready' && !autoRestartTried && (!S.config || S.config.autoUpdate !== false) && Date.now() - lastInput > IDLE_BEFORE_RESTART_MS && !somethingRuns()) {
        autoRestartTried = true;
        restartUpdate();
      }
    } catch (e) { /* the server is busy or gone: try again next minute */ }
  }

  /* ------------------------------------------------------------------ GitHub connection */
  const GH_SOURCES = { 'git-credential-manager': 'Git-Anmeldung (Git Credential Manager)', 'github-desktop': 'GitHub Desktop', gh: 'GitHub CLI', git: 'Git-Anmeldung', 'token-file': 'Zugangsschlüssel', token: 'Zugangsschlüssel' };
  LC.ghSourceLabel = (s) => GH_SOURCES[s] || s || '';
  /** Live check (one call to GitHub): who is signed in on this PC. */
  async function refreshGithub() {
    try {
      const st = await api('/api/github/status');
      if (S.raw && S.raw.meta) S.raw.meta.github = st;
      return st;
    } catch (e) { return null; }
  }
  /** One click: a window signs this PC in to GitHub via the browser; afterwards repos + updates just work. */
  async function connectGitHub() {
    let r;
    try { r = await api('/api/github/connect', { method: 'POST' }); }
    catch (e) { LC.toast('Konnte nicht gestartet werden: ' + e.message, 7000); return; }
    if (r && r.dryRun) { LC.toast('Testmodus: Anmeldefenster würde jetzt geöffnet.'); return; }
    S.ghConnecting = true; render();
    LC.toast('Ein Fenster öffnet GitHub im Browser – dort anmelden und „Authorize“ bestätigen. Diese Seite merkt es von selbst.', 10000);
    const started = Date.now();
    const poll = async () => {
      const st = await refreshGithub();
      if (st && st.connected) {
        S.ghConnecting = false;
        LC.toast('Mit GitHub verbunden' + (st.login ? ' als ' + st.login : '') + '. Repositories werden geladen …', 5000);
        render({ background: true });
        syncRepos(true);
        return;
      }
      if (Date.now() - started < 600000) setTimeout(poll, 4000); else { S.ghConnecting = false; render({ background: true }); }
    };
    setTimeout(poll, 6000);
  }
  /** After start: refresh the repo list by itself when a login exists and the list is older than 12 hours. */
  async function autoSyncRepos() {
    const gh = await refreshGithub();
    render({ background: true });
    if (!gh || !gh.connected || S.ghSyncing) return;
    const last = S.reposDoc && S.reposDoc.syncedAt ? Date.parse(S.reposDoc.syncedAt) : 0;
    if (last && Date.now() - last < 12 * 3600 * 1000 && S.reposDoc.source !== 'public') return;
    await syncRepos(true);
  }

  async function saveGithubToken(token) {
    try {
      await api('/api/github/token', { method: 'POST', body: JSON.stringify({ token }) });
      if (S.raw && S.raw.meta) S.raw.meta.hasGithubToken = !!token;
      await refreshGithub();
      LC.toast(token ? 'Zugangsschlüssel gespeichert (nur auf diesem PC, data\\github-token.txt).' : 'Zugangsschlüssel entfernt.', 5000);
      render();
      return true;
    } catch (e) { LC.toast('Nicht gespeichert: ' + e.message, 7000); return false; }
  }

  async function reveal(path) {
    try { await api('/api/reveal', { method: 'POST', body: JSON.stringify({ path }) }); }
    catch (e) { LC.toast('Konnte nicht im Explorer gezeigt werden: ' + e.message, 5000); }
  }

  /* ------------------------------------------------------------------ clean-up actions (every removal needs its own confirmation) */
  const deletePolls = new Map();
  function pollDelete(jobId, ids) {
    if (deletePolls.has(jobId)) return;
    const started = Date.now();
    const tick = async () => {
      try {
        const st = await api('/api/delete/status?id=' + encodeURIComponent(jobId));
        if (st.result) {
          deletePolls.delete(jobId);
          applyDeleteResult(st.result, ids);
          return;
        }
      } catch (e) { console.error(e); }
      if (Date.now() - started > 20 * 60 * 1000) { deletePolls.delete(jobId); return; }
      deletePolls.set(jobId, setTimeout(tick, 3000));
    };
    deletePolls.set(jobId, setTimeout(tick, 2500));
  }
  function applyDeleteResult(result, ids) {
    const removed = new Set(asArrayLocal(result.removed).map((r) => String(r.path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()));
    const skipped = new Map(asArrayLocal(result.skipped).concat(asArrayLocal(result.failed)).map((r) => [String(r.path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(), r.reason || r.error || 'nicht entfernt']));
    let done = 0, back = 0;
    updateCleanup((d) => {
      for (const id of ids) {
        const it = d.items[id];
        if (!it || it.state !== 'started') continue;
        const k = String(it.path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        if (removed.has(k)) { LC.cleanup.done(d, id); done++; }
        else {
          // not removed (typed confirmation missing, refused, changed ...): back to "marked", keep the reason visible
          it.state = 'marked'; delete it.confirmedAt; delete it.confirmedMs; it.lastResult = skipped.get(k) || 'Es wurde nichts entfernt (Bestätigung im Fenster nicht erteilt?).'; back++;
        }
      }
    }, { background: true });
    LC.toast(done + ' ' + LC.plural(done, 'Objekt', 'Objekte') + ' in den Papierkorb gelegt' + (back ? ', ' + back + ' nicht entfernt (siehe Aufräumen)' : ''), back ? 7000 : 4000);
  }
  function resumeDeletePolls() {
    const byJob = new Map();
    for (const [id, it] of Object.entries(S.cleanupDoc.items)) if (it.type === 'path' && it.state === 'started' && it.jobId) (byJob.get(it.jobId) || byJob.set(it.jobId, []).get(it.jobId)).push(id);
    for (const [job, ids] of byJob) pollDelete(job, ids);
  }

  const cleanupApi = {
    mark(item) {
      if (item.type === 'app') setAppField(item.app.key, 'decision', 'remove');
      else updateCleanup((d) => LC.cleanup.addPath(d, { path: item.path, kind: item.kind, name: item.name, bytes: item.bytes, reason: (item.reasons[0] && item.reasons[0].text) || '' }));
    },
    /** Add something found in the "affected objects" list (a data folder, ...) to the clean-up list. */
    addPath(spec) { updateCleanup((d) => LC.cleanup.addPath(d, spec)); },
    keep(item) {
      if (item.type === 'app') setAppField(item.app.key, 'decision', 'keep');
      else updateCleanup((d) => LC.cleanup.keep(d, item));
    },
    unmark(item) {
      if (item.type === 'app') { updateCleanup((d) => LC.cleanup.drop(d, item.id)); setAppField(item.app.key, 'decision', ''); }
      else updateCleanup((d) => LC.cleanup.drop(d, item.id));
    },
    confirm(item, opts) { updateCleanup((d) => LC.cleanup.confirm(d, item, opts)); },
    revoke(item) { updateCleanup((d) => LC.cleanup.revoke(d, item.id)); },
    clearHistory() { updateCleanup((d) => { for (const [id, it] of Object.entries(d.items)) if (it.state === 'done') delete d.items[id]; }); },
    async uninstall(item) {
      try {
        await flushSave();   // the server re-reads the confirmation from disk: it must be saved first
        const r = await api('/api/uninstall', { method: 'POST', body: JSON.stringify({ id: item.id }) });
        updateCleanup((d) => LC.cleanup.started(d, item.id));
        LC.toast('Das Deinstallationsprogramm von „' + (r.name || item.name) + '“ wurde geöffnet. Folge dort den Anweisungen; danach neu scannen.', 8000);
      } catch (e) { LC.toast('Konnte nicht gestartet werden: ' + e.message, 8000); }
    },
    async deletePaths(items) {
      const ids = items.map((i) => i.id);
      try {
        await flushSave();
        const r = await api('/api/delete/start', { method: 'POST', body: JSON.stringify({ ids }) });
        updateCleanup((d) => { for (const id of ids) { LC.cleanup.started(d, id); d.items[id].jobId = r.id; } });
        pollDelete(r.id, ids);
        LC.toast('Ein Fenster wurde geöffnet. Dort siehst du die Liste und musst „ENTFERNEN“ tippen – erst dann wird etwas in den Papierkorb gelegt.', 9000);
      } catch (e) { LC.toast('Konnte nicht gestartet werden: ' + e.message, 8000); }
    },
    /** Programs that were uninstalled before the last scan are detected by the model; nothing to do here. */
  };

  /* ------------------------------------------------------------------ routing */
  function parseHash() {
    const raw = (location.hash || '#/overview').slice(2);
    const [r, q] = raw.split('?');
    const params = {};
    new URLSearchParams(q || '').forEach((v, k) => { params[k] = v; });
    return { route: ROUTES.some((x) => x.id === r) ? r : 'overview', params };
  }
  function go(route, params) {
    const q = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    const target = '#/' + route + q;
    if (location.hash === target) onRoute(); else location.hash = target;
  }
  function onRoute() {
    const { route, params } = parseHash();
    S.route = route; S.params = params;
    lastInGroup[groupOf(route).id] = route;
    setMenu(false);
    if (route !== 'software') S.drawerId = null;
    if (route === 'software' && params.filter) { S.sw.filter = params.filter; S.sw.q = params.q || ''; }
    if (route === 'tasks' && params.area != null) S.taskArea = params.area;
    if (route === 'cleanup' && params.open) S.cleanupOpen[params.open] = true;
    if (route === 'projects' && params.open) S.projectOpen = params.open;
    render();
    window.scrollTo(0, 0);
    const mainEl = document.getElementById('main');
    if (mainEl) mainEl.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', onRoute);

  /* ------------------------------------------------------------------ chrome */
  function renderSaveState() {
    const el = document.getElementById('savestate');
    if (!el) return;
    el.replaceChildren();
    const t = { pending: 'Änderungen …', saving: 'Speichere …', saved: 'Gespeichert ✓', error: 'Nicht gespeichert!' }[S.save];
    if (t) el.appendChild(h('span', { style: S.save === 'error' ? { color: 'var(--critical)', fontWeight: '700' } : null }, t));
  }

  function renderHeader() {
    const m = S.model;
    const sub = document.getElementById('brand-sub');
    const meta = document.getElementById('scan-meta');
    sub.textContent = m ? m.hw.device.title + ' · ' + m.hw.os.label + (S.raw && S.raw.meta && S.raw.meta.version ? ' · v' + S.raw.meta.version : '') : 'Noch kein Scan vorhanden';
    meta.replaceChildren();
    if (m) {
      const age = LC.daysBetween(m.snap.collectedAt, new Date());
      meta.appendChild(h('div', null, 'Letzter Scan: ' + LC.fmtDateTime(m.snap.collectedAt)));
      meta.appendChild(h('div', null, LC.fmtAgo(age) + ' · ' + (m.snap.durationSec != null ? Math.round(m.snap.durationSec) + ' s' : '')));
    }
    const btn = document.getElementById('btn-scan');
    btn.replaceChildren(LC.icon('refresh', S.scanning ? 'spin' : ''), S.scanning ? 'Scanne … (bis zu 2 Min.)' : 'Neu scannen');
    btn.disabled = S.scanning;
    btn.title = 'Alles neu einlesen (nur lesend). Der Scan ändert nichts an deinem Rechner.';
    const mark = document.getElementById('brand-mark');
    if (!mark.firstChild) mark.appendChild(LC.icon('laptop', 'lg'));
    const th = document.getElementById('btn-theme');
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    th.replaceChildren(LC.icon(dark ? 'sun' : 'moon'));
  }

  /** "Experten-Funktionen" (Markieren zur Prüfung, Prüfpaket) are off unless switched on or something was already marked. */
  LC.expertOn = () => !!(S.config && S.config.expert) || (S.model ? LC.reviewCount(S) > 0 : false);

  const visibleRoutes = (g) => g.routes.filter((r) => r[0] !== 'review' || LC.expertOn());

  /** Counters: important open tasks, objects waiting in "Aufräumen", marked entries. */
  function counters() {
    if (!S.model) return { open: 0, clean: 0, review: 0 };
    return {
      open: LC.tasks.compute(S.model, S.notes).filter((t) => t.status === 'open' && (t.severity === 'warn' || t.severity === 'critical')).length,
      clean: S.model.cleanup.totals.marked + S.model.cleanup.totals.confirmed,
      review: LC.reviewCount(S),
    };
  }

  function renderNav() {
    const nav = document.getElementById('nav');
    nav.replaceChildren();
    const c = counters();
    const cur = groupOf(S.route);
    GROUPS.forEach((g) => {
      const badges = g.id === 'todo'
        ? [c.open ? h('span', { class: 'count', title: c.open + ' offene wichtige Aufgaben' }, String(c.open)) : null,
           c.clean ? h('span', { class: 'count neutral', title: c.clean + ' Objekte zum Entfernen markiert' }, String(c.clean)) : null]
        : g.id === 'settings' && c.review && LC.expertOn() ? [h('span', { class: 'count neutral', title: c.review + ' Einträge zur Prüfung markiert' }, String(c.review))] : [];
      nav.appendChild(h('button', { class: 'tab', type: 'button', 'aria-current': cur.id === g.id ? 'page' : null, onclick: () => go(lastInGroup[g.id] || g.routes[0][0]) },
        LC.icon(g.icon), h('span', { class: 'tab-text' }, h('span', null, g.label), h('span', { class: 'tab-sub' }, g.sub)), badges));
    });
  }

  /** The tab strip above the page for entries that hold several pages. */
  function renderSubTabs() {
    const g = groupOf(S.route);
    const routes = visibleRoutes(g);
    if (routes.length < 2) return null;
    const c = counters();
    return h('div', { class: 'subtabs', role: 'tablist', 'aria-label': g.label },
      routes.map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-current': S.route === id ? 'page' : null, 'aria-selected': String(S.route === id), onclick: () => go(id) },
        label,
        id === 'tasks' && c.open ? h('span', { class: 'count' }, String(c.open)) : null,
        id === 'cleanup' && c.clean ? h('span', { class: 'count neutral' }, String(c.clean)) : null,
        id === 'review' && c.review ? h('span', { class: 'count neutral' }, String(c.review)) : null)));
  }

  function renderBanners() {
    const el = document.getElementById('banners');
    el.replaceChildren();
    if (S.offline) {
      el.appendChild(h('div', { class: 'banner critical', role: 'alert' }, LC.sevIcon('critical'), h('div', { class: 'grow' }, h('b', null, 'Keine Verbindung zu LaptopCheck. '), 'Wurde die App beendet? Starte LaptopCheck neu (Startmenü) und lade diese Seite dann neu. Bereits eingegebene Angaben sind im Browser zwischengespeichert.'), h('button', { class: 'btn sm', onclick: () => location.reload() }, 'Neu laden')));
    }
    if (S.save === 'error') {
      el.appendChild(h('div', { class: 'banner critical', role: 'alert' }, LC.sevIcon('critical'), h('div', { class: 'grow' }, h('b', null, 'Deine Angaben konnten nicht gespeichert werden. '), 'Der lokale Server antwortet nicht. Eine Sicherheitskopie liegt im Browser; sobald der Server wieder läuft, „Erneut speichern“ klicken.'), h('button', { class: 'btn sm', onclick: flushSave }, 'Erneut speichern')));
    }
    const upd = S.raw && S.raw.update;
    if (upd && upd.result === 'ready') {
      el.appendChild(h('div', { class: 'banner info', role: 'status' }, LC.sevIcon('info'), h('div', { class: 'grow' }, h('b', null, 'Neue Version ' + (upd.available || '') + ' ist geladen. '), 'Sie wird beim Schließen installiert' + (S.config && S.config.autoUpdate === false ? '.' : ' oder von selbst, wenn du das Fenster zwei Minuten nicht benutzt.')),
        h('button', { class: 'btn sm primary', onclick: () => restartUpdate() }, 'Jetzt neu starten')));
    }
    const ghConn = S.raw && S.raw.meta && S.raw.meta.github && S.raw.meta.github.connected;
    if (upd && upd.result === 'no-access' && !ghConn) {
      el.appendChild(h('div', { class: 'banner warn' }, LC.sevIcon('warn'), h('div', { class: 'grow' }, h('b', null, 'Noch nicht mit GitHub verbunden. '), 'Ein Klick – danach aktualisiert sich LaptopCheck selbst und zeigt deine privaten Repositories.'),
        h('button', { class: 'btn sm primary', disabled: S.ghConnecting ? true : null, onclick: connectGitHub }, S.ghConnecting ? 'Warte auf Anmeldung …' : 'Mit GitHub verbinden')));
    }
    const m = S.model;
    if (m) {
      const age = LC.daysBetween(m.snap.collectedAt, new Date());
      if (age >= 7) el.appendChild(h('div', { class: 'banner warn' }, LC.sevIcon('warn'), h('div', { class: 'grow' }, 'Die Daten sind ' + age + ' Tage alt – Empfehlungen können überholt sein.'), h('button', { class: 'btn sm primary', onclick: () => scan(false) }, 'Jetzt neu scannen')));
    }
  }

  /* A full redraw replaces the whole page - and with it the field the user is typing in: the text vanishes and the cursor is gone.
     So while a text field has the focus, redraws that nobody asked for just now (scan finished, GitHub sync, file jobs, ...) wait
     until the field is left (Enter, Tab or a click elsewhere). Entries are saved when the field is left (change/blur), never per key. */
  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'url', 'email', 'tel', 'password']);
  const isTextEntry = (el) => !!el && el.nodeType === 1 && el.isConnected
    && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_INPUT_TYPES.has((el.getAttribute('type') || 'text').toLowerCase())) || el.isContentEditable === true);
  let movingTo = null;        // the element that is about to get the focus while a field is being left (known during blur)
  let deferred = null;        // the redraw that waited for the user to finish typing
  const isTyping = () => typeof document !== 'undefined' && (isTextEntry(document.activeElement) || isTextEntry(movingTo));
  if (typeof document !== 'undefined') {
    document.addEventListener('blur', (e) => { movingTo = e.relatedTarget; setTimeout(() => { movingTo = null; }, 0); }, true);
    document.addEventListener('focusout', () => setTimeout(() => {
      if (deferred && !isTyping()) { const o = deferred; deferred = null; render(o); }
    }, 0));
  }

  let rendering = false;
  let renderAgain = null;
  /** opts.background: nobody asked for this redraw right now (async result) - it waits while a text field has the focus.
      Leaving one field for another also waits (the saved entry shows up once focus is outside every field). opts.force never waits. */
  function render(opts) {
    opts = opts || {};
    if (!opts.force && (opts.background ? isTyping() : isTextEntry(movingTo))) {
      deferred = deferred ? { keepDrawer: deferred.keepDrawer && !!opts.keepDrawer } : { keepDrawer: !!opts.keepDrawer };
      return;
    }
    // Removing a focused input fires blur/change handlers that may ask for another render: defer those.
    if (rendering) { renderAgain = renderAgain ? { keepDrawer: renderAgain.keepDrawer && opts.keepDrawer } : { keepDrawer: !!opts.keepDrawer }; return; }
    rendering = true;
    try { renderNow(opts); } finally { rendering = false; }
    if (renderAgain) { const o = renderAgain; renderAgain = null; setTimeout(() => render(o), 0); }
  }
  function renderNow(opts) {
    deferred = null;
    const y = window.scrollY;
    renderHeader();
    renderNav();
    renderBanners();
    renderSaveState();
    const main = document.getElementById('main');
    main.replaceChildren();
    if (!S.model) {
      main.appendChild(emptyState());
    } else {
      const page = LC.pages[S.route] || LC.pages.overview;
      const tabs = renderSubTabs();
      if (tabs) main.appendChild(tabs);
      try {
        main.appendChild(page(S, app));
        LC.enhanceCards(main, S.route);
      } catch (e) {
        console.error(e);
        main.appendChild(h('div', { class: 'callout critical' }, h('b', null, 'Diese Seite konnte nicht angezeigt werden: '), String(e && e.message), h('div', { class: 'small', style: { marginTop: '6px' } }, 'Bitte unter „Einstellungen“ → „Technische Details“ → „Diagnose kopieren“ weitergeben.')));
      }
    }
    if (LC.pages.drawer && !opts.keepDrawer) LC.pages.drawer(S, app);
    if (y) window.scrollTo(0, y);
  }

  function emptyState() {
    return h('div', { class: 'card', style: { textAlign: 'center', padding: '48px 24px' } },
      h('h2', null, S.offline ? 'Keine Verbindung' : 'Willkommen bei LaptopCheck'),
      h('p', { class: 'muted', style: { margin: '10px auto 18px', maxWidth: '520px' } }, S.offline ? 'Der lokale Server ist nicht erreichbar.' : 'Es gibt noch keine Messdaten. Der Scan liest nur und verändert nichts an deinem Rechner.'),
      S.offline ? null : h('button', { class: 'btn primary', onclick: () => scan(false) }, LC.icon('refresh'), 'Jetzt scannen'));
  }

  /* ------------------------------------------------------------------ boot */
  const app = { S, api, go, render, updateNotes, setAppField, scan, flushSave, recompute, ROUTES, updateProjects, updateConfig, updateCleanup, scanFiles, scanSpace, loadSpace, syncRepos, importRepos, importProjects, wingetUpgrade, reveal, cleanup: cleanupApi, loadFiles, restartUpdate, saveGithubToken, connectGitHub, refreshGithub };
  LC.app = app;

  function setTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    try { if (t) localStorage.setItem('lc-theme', t); } catch (e) { /* ignore */ }
    renderHeader();
  }

  /* left menu: always visible on wide screens, a slide-in panel (button in the header) on narrow ones */
  function setMenu(open) {
    document.body.classList.toggle('nav-open', open);
    const btn = document.getElementById('btn-menu');
    if (btn) btn.setAttribute('aria-expanded', String(open));
    const bd = document.getElementById('nav-backdrop');
    if (bd) bd.hidden = !open || !matchMedia('(max-width: 1000px)').matches;
  }

  async function boot() {
    try { const t = localStorage.getItem('lc-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
    const menuBtn = document.getElementById('btn-menu');
    menuBtn.replaceChildren(LC.icon('menu'));
    menuBtn.addEventListener('click', () => setMenu(!document.body.classList.contains('nav-open')));
    document.getElementById('nav-backdrop').addEventListener('click', () => setMenu(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setMenu(false); });
    const header = document.querySelector('.app-header');
    const setHdr = () => document.documentElement.style.setProperty('--hdr', header.offsetHeight + 'px');
    setHdr();
    if (window.ResizeObserver) new ResizeObserver(setHdr).observe(header); else window.addEventListener('resize', setHdr);
    document.getElementById('btn-scan').addEventListener('click', () => scan(false));
    document.getElementById('btn-theme').addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      setTheme(cur === 'dark' ? 'light' : 'dark');
    });
    const { route, params } = parseHash();
    S.route = route; S.params = params;
    if (params.filter) S.sw.filter = params.filter;
    render();
    await loadState();
    if (!S.offline) setInterval(pollUpdate, 60 * 1000);   // a new version that the app loaded in the background shows up here
    if (!S.offline && !S.raw.snapshot) { render({ background: true }); scan(false); return; }   // first start: nothing to show yet, so scan right away
    render({ background: true });
    if (!S.offline) { loadSpace(); autoSyncRepos(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
