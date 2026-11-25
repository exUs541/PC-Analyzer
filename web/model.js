/* model.js - ties the modules together:
 *   LC.normalizeSnapshot  -> defensive shape fixes (PowerShell turns 1-element arrays into objects)
 *   LC.analyze            -> hardware + inventory + findings + score in one call
 *   LC.diffSnapshots      -> what changed since the previous scan
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { asArray } = LC;

  LC.normalizeSnapshot = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const s = { ...raw };
    ['cpu', 'gpu', 'disks', 'volumes', 'network', 'startup', 'processes', 'folders', 'software', 'shortcuts', 'usage', 'warnings'].forEach((k) => { s[k] = asArray(raw[k]); });
    s.updates = raw.updates == null ? null : asArray(raw.updates);
    if (raw.memory) s.memory = { ...raw.memory, modules: asArray(raw.memory.modules), arrays: asArray(raw.memory.arrays), pageFiles: asArray(raw.memory.pageFiles) };
    if (raw.system) s.system = { ...raw.system, chassisTypes: asArray(raw.system.chassisTypes) };
    if (raw.security) s.security = { ...raw.security, antivirus: asArray(raw.security.antivirus), firewall: asArray(raw.security.firewall), bitlocker: asArray(raw.security.bitlocker) };
    s.system = s.system || {};
    s.os = s.os || {};
    s.collector = s.collector || {};
    return s;
  };

  LC.normalizeNotes = (raw) => {
    const n = raw && typeof raw === 'object' ? raw : {};
    return {
      version: 1,
      apps: n.apps || {},
      hardware: n.hardware || {},
      tasks: n.tasks || {},
      customTasks: asArray(n.customTasks),
      reviews: n.reviews && typeof n.reviews === 'object' ? n.reviews : {},
      // programs that were uninstalled while LaptopCheck was watching: [{ name, removedAt }] (so their leftovers are recognised in later scans too)
      removedApps: asArray(n.removedApps).filter((r) => r && r.name),
      settings: { unusedDays: 365, ...(n.settings || {}) },
    };
  };

  LC.diffSnapshots = (snap, prev) => {
    if (!prev || !snap || prev.collectedAt === snap.collectedAt) return null;
    const key = (a) => LC.appKey(a);
    const cur = new Map(asArray(snap.software).map((a) => [key(a), a]));
    const old = new Map(asArray(prev.software).map((a) => [key(a), a]));
    const added = [], removed = [], updated = [];
    for (const [k, a] of cur) {
      if (!old.has(k)) added.push(a.name);
      else if (old.get(k).version && a.version && old.get(k).version !== a.version) updated.push(a.name + ' ' + old.get(k).version + ' → ' + a.version);
    }
    for (const [k, a] of old) if (!cur.has(k)) removed.push(a.name);
    const cOf = (s) => asArray(s.volumes).find((v) => String(v.letter).toUpperCase() === 'C');
    const c1 = cOf(snap), c0 = cOf(prev);
    const freeDelta = c1 && c0 && c1.freeBytes != null && c0.freeBytes != null ? c1.freeBytes - c0.freeBytes : null;
    return { since: prev.collectedAt, daysAgo: LC.daysBetween(prev.collectedAt, snap.collectedAt), added, removed, updated, cFreeDeltaBytes: freeDelta };
  };

  /** Overview tiles for the three newer areas. */
  function extraAreaTiles(findings, files, projects, cleanup) {
    const worst = (area) => findings.filter((f) => f.area === area).reduce((w, f) => (LC.SEV_RANK[f.severity] > LC.SEV_RANK[w] ? f.severity : w), 'ok');
    const top = (area) => findings.filter((f) => f.area === area && f.severity !== 'ok')[0] || null;
    const t = cleanup.totals;
    const pending = t.marked + t.confirmed + t.started;
    const live = projects.projects.filter((p) => p.status === 'active' || p.status === 'planned').length;
    return [
      files
        ? { area: 'files', label: 'Dateien & Cloud', severity: worst('files'), value: files.totals.freeableBytes ? 'bis ' + LC.fmtBytes(files.totals.freeableBytes) + ' auslagerbar' : LC.fmtBytes(files.totals.localBytes) + ' lokal',
          sub: files.liveProviders.length ? [...new Set(files.liveProviders.map((p) => p.name))].join(', ') : 'kein Cloud-Ordner gefunden', top: top('files') }
        : { area: 'files', label: 'Dateien & Cloud', severity: 'info', value: 'nicht gescannt', sub: 'Dateien-Scan starten', top: top('files') },
      { area: 'projects', label: 'Projekte', severity: worst('projects'), value: projects.projects.length ? projects.projects.length + ' ' + LC.plural(projects.projects.length, 'Projekt', 'Projekte') + (live ? ' · ' + live + ' aktiv' : '') : 'keine angelegt',
        sub: projects.hasRepos ? projects.repos.length + ' GitHub-Repos' : 'GitHub noch nicht hinterlegt', top: top('projects') },
      { area: 'cleanup', label: 'Aufräumen', severity: worst('cleanup'), value: pending ? pending + ' ' + LC.plural(pending, 'Objekt', 'Objekte') + ' markiert' : t.suggested ? t.suggested + ' ' + LC.plural(t.suggested, 'Vorschlag', 'Vorschläge') : 'Nichts markiert',
        sub: pending ? 'zusammen ' + LC.fmtBytes(t.pendingBytes) : t.suggested ? 'bis ' + LC.fmtBytes(t.suggestedBytes) : 'Liste ist leer', top: top('cleanup') },
    ];
  }

  /**
   * @param raw   snapshot as delivered by the server
   * @param opts  { notes, history, prev, now, files (raw files.json), projects, repos, cleanup, space (raw space.json), config (house rules) }
   */
  LC.analyze = (raw, opts) => {
    opts = opts || {};
    const snap = LC.normalizeSnapshot(raw);
    if (!snap) return null;
    const notes = LC.normalizeNotes(opts.notes);
    const history = asArray(opts.history);
    const now = opts.now ? new Date(opts.now) : new Date();
    const hw = LC.analyzeHardware(snap, notes, history, { now });
    // files scan first: it also tells how active the cloud folders are (used for "last used" of sync clients)
    const filesRaw = opts.files && typeof opts.files === 'object' ? opts.files : null;
    const reposDoc = LC.normalizeRepos(opts.repos);
    const projDoc = LC.normalizeProjects(opts.projects);
    const vol = hw.storage && hw.storage.systemVolume;
    // storage analysis (separate scan, optional): explains WHAT fills the drive; the storage findings quote it.
    // It learns from the files scan which cloud folders are streamed/mirrored/leftovers; the files model gets the size of a leftover folder back.
    const space = opts.space && typeof opts.space === 'object' ? LC.analyzeSpace(opts.space, { providers: filesRaw ? asArray(filesRaw.providers) : [] }) : null;
    const sizeAt = (path) => { const i = space && space.items.find((x) => x.kind === 'folder' && LC.pathUnder(x.path, path) && LC.pathUnder(path, x.path)); return i ? i.bytes : null; };
    const filesModel = filesRaw ? LC.analyzeFiles(filesRaw, { now, projectNames: projDoc.projects.map((p) => p.name), reposDoc, cFree: vol ? { pct: vol.freePct, bytes: vol.freeBytes } : null, sizeAt }) : null;
    const cloudActivity = {};
    if (filesModel) for (const p of filesModel.providers) {
      const root = filesModel.cloudRoots.find((r) => LC.pathUnder(r.path, p.root) && LC.pathUnder(p.root, r.path));
      const agg = filesModel.folders.find((f) => f.depth === 0 && root && f.root === root.label && f.newest);
      if (agg) cloudActivity[p.id] = { newest: agg.newest, files: root.files, bytes: root.bytes };
    }
    const inv = LC.buildInventory(snap, notes, { now, unusedDays: notes.settings.unusedDays, cloudActivity });
    const stats = LC.inventoryStats(inv);
    const base = LC.buildFindings(snap, hw, inv, stats, notes, { space });

    // files / cloud, projects, clean-up list (each optional: they work from separate scans and stores)
    const projects = LC.analyzeProjects(projDoc, { apps: inv.apps, reposDoc, filesModel, now });
    const ix = LC.buildRelationIndex({ apps: inv.apps, snap, filesRaw, filesModel, projects, now });
    const cleanupDoc = LC.normalizeCleanup(opts.cleanup);
    const cleanup = LC.buildCleanup({ inv, doc: cleanupDoc, ix, filesModel, filesRaw, now });
    // folder inventory: where did each folder come from, is it still needed (needs the files scan)
    const folders = filesRaw ? LC.analyzeFolders(filesRaw, { apps: inv.apps, now, removed: notes.removedApps, cleanupDoc, providers: filesModel ? filesModel.providers : [], sizeAt }) : null;
    // house rules: what stays local, what moves to the cloud drive, what can go (needs the files scan)
    const house = filesModel ? LC.analyzeHouse(filesModel, { config: opts.config, now, raw: filesRaw }) : null;
    const extra = [].concat(
      filesModel ? filesModel.findings : [{ id: 'files.not-scanned', area: 'files', severity: 'info', task: true, impact: 2, title: 'Deine Dateien wurden noch nicht gescannt', detail: 'Für die Cloud-Auslagerung (Google Drive), die Aufräumliste mit „betroffenen Objekten“ und die Git-Übersicht liest LaptopCheck einmalig deine Ordner (nur lesend).', action: 'Unter „Dateien & Cloud“ den Dateien-Scan starten.', steps: [], links: [] }],
      projects.findings, cleanup.findings, folders ? LC.folderFindings(folders) : [], LC.houseFindings(house)
    ).map((f) => ({ severity: 'info', detail: '', action: '', steps: [], links: [], task: null, impact: 2, ...f }));
    const findings = base.concat(extra);
    findings.sort((a, b) => LC.SEV_RANK[b.severity] - LC.SEV_RANK[a.severity] || b.impact - a.impact);
    for (const f of findings) if (f.task == null) f.task = f.severity === 'warn' || f.severity === 'critical';
    const score = LC.computeScore(findings);
    const areas = LC.areaSummaries(findings, hw, inv, stats).concat(extraAreaTiles(findings, filesModel, projects, cleanup));
    const upgrades = LC.buildUpgrades(hw, notes);
    const diff = LC.diffSnapshots(snap, LC.normalizeSnapshot(opts.prev));
    const relationsOf = (app) => LC.relationsOfApp(app, ix);
    const model = { snap, notes, hw, inv, stats, findings, score, areas, upgrades, diff, now, files: filesModel, filesRaw, projects, cleanup, space, folders, house, ix, relationsOf };
    model.savings = LC.savingsPlan(model);
    return model;
  };
})(typeof window !== 'undefined' ? window : globalThis);
