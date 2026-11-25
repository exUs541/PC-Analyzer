/* relations.js - "what hangs on this object?" For a program or a folder/file: how and where it is used and what
 * else is affected when it is removed. Answers the question before every uninstall/delete:
 * "Do I still need the things I only had for this?"
 *
 *   LC.buildRelationIndex(ctx)             -> index (build once per render, cheap)
 *   LC.relationsOfApp(app, ix, opts)       -> { groups, summary, usage, needsFilesScan }
 *   LC.relationsOfPath(item, ix, opts)     -> same shape for a file/folder
 *
 * ctx = { apps (inventory), snap, filesRaw (raw files.json | null), filesModel (LC.analyzeFiles | null),
 *         projects (LC.analyzeProjects | null), now }
 * Every relation item: { id, group, impact (breaks|data|degrades|orphan|leftover|info), confidence (sicher|wahrscheinlich|möglich),
 *   title, detail, bytes?, path?, app?, add? : what the user may add to the clean-up list with one click }
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { asArray, fmtBytes, fmtNum } = LC;

  const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  const lower = (s) => String(s || '').toLowerCase();
  const PUB_SUFFIX = /\b(inc|llc|ltd|gmbh|corp|corporation|co|company|limited|ag|sa|s\.a\.|software|technologies|technology|foundation|project|team|the)\b\.?/g;
  const pubCompact = (p) => LC.compact(String(p || '').toLowerCase().replace(PUB_SUFFIX, ' ').replace(/[,.]/g, ' '));
  LC.pubCompact = pubCompact;
  const GENERIC_DIR = new Set(['google', 'microsoft', 'adobe', 'intel', 'nvidia', 'amd', 'apple', 'mozilla', 'cache', 'logs', 'temp', 'packages', 'programs', 'common', 'data', 'config', 'local', 'roaming', 'windows', 'app', 'apps', 'user', 'users', 'default', 'tools']);

  /* ------------------------------------------------------------------ knowledge base lookup */
  function kbEntries(app) {
    return LC.RELATIONS.filter((e) => e.re.test(app.name));
  }
  function mergeKb(entries) {
    const m = { exts: [], data: [], uses: [], helpers: [], servesFor: [], hw: null, cloud: null, tips: [], protect: false, sharedData: false, repoTool: null, ids: [] };
    for (const e of entries) {
      m.ids.push(e.id);
      m.exts.push(...(e.exts || [])); m.data.push(...(e.data || [])); m.uses.push(...(e.uses || [])); m.helpers.push(...(e.helpers || [])); m.servesFor.push(...(e.servesFor || []));
      if (e.hw && !m.hw) m.hw = e.hw;
      if (e.cloud && !m.cloud) m.cloud = e.cloud;
      if (e.tip) m.tips.push(e.tip);
      if (e.protect) m.protect = true;
      if (e.sharedData) m.sharedData = true;
      if (e.repoTool && !m.repoTool) m.repoTool = e.repoTool;
    }
    return m;
  }

  /* ------------------------------------------------------------------ index */
  LC.buildRelationIndex = (ctx) => {
    const apps = asArray(ctx.apps);
    const now = ctx.now ? new Date(ctx.now) : new Date();
    const raw = ctx.filesRaw || null;
    const ix = {
      ctx, now, apps, snap: ctx.snap || {}, raw, fm: ctx.filesModel || null, projects: ctx.projects || null,
      hasFiles: !!raw, kb: new Map(), byKey: new Map(), extByName: new Map(), extOwner: new Map(),
      dataDirs: asArray(raw && raw.dataDirs), removing: new Set(apps.filter((a) => a.decision === 'remove').map((a) => a.key)),
    };
    for (const a of apps) { ix.byKey.set(a.key, a); ix.kb.set(a.key, mergeKb(kbEntries(a))); }
    for (const e of asArray(raw && raw.exts)) ix.extByName.set(lower(e.ext), e);

    // which program opens which file type? Registry association (handler) first, the knowledge base wins on conflicts
    for (const e of ix.extByName.values()) {
      if (!e.handler) continue;
      const h = LC.normPath(e.handler);
      const owner = apps.find((a) => a.match && (a.match.exact.includes(h) || a.match.roots.some((r) => h.startsWith(r + '\\')) || a.match.names.includes(h.slice(h.lastIndexOf('\\') + 1))));
      if (owner) ix.extOwner.set(lower(e.ext), { key: owner.key, via: 'handler' });
    }
    for (const a of apps) if (a.applicable) for (const x of ix.kb.get(a.key).exts) ix.extOwner.set(lower(x), { key: a.key, via: 'kb' });

    // helper graph: serves(C -> A)  "C exists for A".  hard = A cannot work without C.
    ix.serves = new Map();   // C.key -> Map(A.key -> {why, hard, maybe})
    // components, launchers and drivers are no "real" users of a helper (a "Benchmark Launcher" does not need a tablet driver)
    const REAL_APP = (o) => o.applicable && !/\b(launcher|benchmark|updater?|installer|helper|service|runtime|redistributable|driver|sdk)\b/i.test(o.name);
    const addServe = (c, a, why, hard, maybe) => {
      if (c.key === a.key) return;
      if (!hard && !REAL_APP(a)) return;
      const m = ix.serves.get(c.key) || ix.serves.set(c.key, new Map()).get(c.key);
      if (!m.has(a.key) || hard) m.set(a.key, { why, hard: !!hard, maybe: !!maybe });
    };
    for (const a of apps) {
      const k = ix.kb.get(a.key);
      for (const u of k.uses) for (const c of apps) if (u.re.test(c.name)) addServe(c, a, u.why, true, u.maybe);
      for (const h of k.helpers) for (const c of apps) if (h.re.test(c.name)) addServe(c, a, h.why, false, h.maybe);
      for (const s of k.servesFor) for (const b of apps) if (s.re.test(b.name)) addServe(a, b, s.why, false, false);
    }
    return ix;
  };

  /* ------------------------------------------------------------------ pieces */
  /** Does a folder NAME belong to this program, judged by the program's name/publisher alone (no knowledge base)? -> { conf, via, shared } | null */
  LC.dirNameMatch = (dirName, app) => {
    const d = LC.compact(dirName);
    if (d.length < 4 || GENERIC_DIR.has(d)) return null;
    const c = LC.compact(LC.coreName(app.name));
    if (c.length >= 4 && (d === c || (c.length >= 5 && d.startsWith(c)) || (d.length >= 5 && c.startsWith(d)))) return { conf: 'wahrscheinlich', via: 'name', shared: false };
    const p = pubCompact(app.publisher);
    if (p.length >= 5 && !GENERIC_DIR.has(p) && (d === p || d.startsWith(p))) return { conf: 'möglich', via: 'publisher', shared: true };
    return null;
  };

  function dirMatch(dir, app, kb) {
    if (kb.data.some((re) => re.test(dir.name))) return { conf: 'sicher', via: 'kb', shared: kb.sharedData };
    return LC.dirNameMatch(dir.name, app);
  }

  const WHERE = { LocalAppData: 'AppData\\Local', AppData: 'AppData\\Roaming', ProgramData: 'ProgramData', UserProfile: 'Benutzerordner' };

  function dataItems(app, ix, kb) {
    const out = [];
    for (const d of ix.dataDirs) {
      const m = dirMatch(d, app, kb);
      if (!m) continue;
      const sharedWith = m.shared ? ix.apps.filter((o) => o.key !== app.key && dirMatch(d, o, ix.kb.get(o.key))).map((o) => o.name) : [];
      const shared = m.shared && (sharedWith.length > 0 || m.via === 'publisher' || kb.sharedData);
      out.push({
        id: 'data:' + d.path, group: 'data', impact: shared ? 'info' : 'leftover', confidence: m.conf,
        title: d.name + '  (' + (WHERE[d.where] || d.where) + ')',
        detail: (shared ? 'Gehört mehreren Programmen' + (sharedWith.length ? ' (auch: ' + sharedWith.slice(0, 3).join(', ') + ')' : '') + ' – nur löschen, wenn alle weg sind. ' : 'Bleibt nach dem Deinstallieren meist liegen. ') + (d.partial ? 'Größe mindestens. ' : '') + (d.modified ? 'Zuletzt geändert ' + LC.fmtDate(d.modified) + '.' : ''),
        bytes: d.bytes, path: d.path,
        add: shared ? null : { type: 'path', kind: 'dir', path: d.path, name: d.name, bytes: d.bytes, reason: 'Reste von „' + app.name + '“ (Programmdaten)' },
      });
    }
    return out.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
  }

  function fileItems(app, ix, kb) {
    const out = [];
    const mine = [...ix.extOwner.entries()].filter(([, o]) => o.key === app.key).map(([ext, o]) => ({ ext, via: o.via }));
    for (const m of mine) {
      const e = ix.extByName.get(m.ext);
      if (!e || !(e.files > 0)) continue;
      const top = asArray(e.dirs)[0];
      const dataLike = m.via === 'kb';
      out.push({
        id: 'ext:' + m.ext, group: 'files', impact: dataLike ? 'data' : 'degrades', confidence: dataLike ? 'sicher' : 'wahrscheinlich',
        title: m.ext + '-Dateien: ' + fmtNum(e.files, 0) + ' (' + fmtBytes(e.bytes) + ')',
        detail: (top ? 'Meist in „' + top.p + '“ (' + top.n + '). ' : '') + (e.newest ? 'Zuletzt geändert ' + LC.fmtDate(e.newest) + '. ' : '') + (e.cloudFiles ? e.cloudFiles + ' Datei(en) dieses Typs liegen auch in der Cloud. ' : 'Keine Datei dieses Typs in der Cloud gefunden – nicht gesichert. ') + (m.via === 'handler' ? 'Windows öffnet sie bisher mit diesem Programm.' : ''),
        bytes: e.bytes, path: top ? top.p : null, count: e.files,
      });
    }
    return out.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
  }

  function projectItems(app, ix, kb) {
    const out = [];
    const pm = ix.projects;
    if (!pm) return out;
    for (const p of pm.projects) {
      for (const r of p.resources) {
        if (!r.detected || r.detected.key !== app.key || r.effective === 'na' || r.effective === 'later') continue;
        const live = p.status === 'active' || p.status === 'planned';
        out.push({ id: 'project:' + p.id + ':' + r.id, group: 'projects', impact: live ? 'breaks' : 'info', confidence: 'sicher', title: 'Projekt „' + p.name + '“ (' + LC.PROJECT_STATUS[p.status] + ')',
          detail: 'Eingetragen als benötigtes Programm („' + r.name + '“).' + (live ? ' Du müsstest es erneut installieren, um daran weiterzuarbeiten.' : ''), projectId: p.id });
      }
    }
    if (kb.repoTool) {
      const tool = kb.repoTool;
      const lang = { java: ['Java', 'Kotlin'], node: ['JavaScript', 'TypeScript'], python: ['Python', 'Jupyter Notebook'] }[tool];
      const gh = pm.repos.filter((r) => !r.archived && !r.fork && r.recent && (tool === 'git' || (lang && lang.includes(r.language))));
      const localRepos = ix.fm ? ix.fm.repos : [];
      if (tool === 'git' && localRepos.length) {
        out.push({ id: 'repos:local', group: 'projects', impact: 'breaks', confidence: 'sicher', title: localRepos.length + ' lokale Git-' + LC.plural(localRepos.length, 'Repository', 'Repositories'),
          detail: localRepos.slice(0, 4).map((r) => r.name).join(', ') + (localRepos.length > 4 ? ' …' : '') + '. Ohne Git kein Commit/Push per Kommandozeile.' });
      }
      if (gh.length) {
        out.push({ id: 'repos:gh:' + tool, group: 'projects', impact: tool === 'git' ? 'degrades' : 'breaks', confidence: 'wahrscheinlich', title: gh.length + ' ' + LC.plural(gh.length, 'GitHub-Repo', 'GitHub-Repos') + ' (in den letzten 6 Monaten aktiv)',
          detail: gh.slice(0, 5).map((r) => r.name + (r.language ? ' (' + r.language + ')' : '')).join(', ') + (gh.length > 5 ? ' …' : '') + '. Laut Sprache werden dafür diese Werkzeuge gebraucht.' });
      }
      if (tool === 'node' && ix.fm) {
        const nm = ix.fm.repos.filter((r) => r.nodeModulesBytes > 0);
        if (nm.length) out.push({ id: 'repos:nm', group: 'projects', impact: 'info', confidence: 'sicher', title: 'node_modules in ' + nm.length + ' lokalen ' + LC.plural(nm.length, 'Repo', 'Repos'), detail: fmtBytes(nm.reduce((a, r) => a + r.nodeModulesBytes, 0)) + ' – lässt sich mit „npm ci“ neu aufbauen.' });
      }
    }
    return out;
  }

  function dependantItems(app, ix) {
    const out = [];
    for (const [cKey, m] of ix.serves) {
      if (cKey !== app.key) continue;
      for (const [aKey, e] of m) {
        const a = ix.byKey.get(aKey);
        if (!a || !e.hard) continue;
        out.push({ id: 'dep:' + aKey, group: 'dependants', impact: ix.removing.has(aKey) ? 'info' : 'breaks', confidence: 'wahrscheinlich', title: a.name, detail: e.why + (ix.removing.has(aKey) ? ' (steht ebenfalls auf der Aufräumliste)' : ''), app: a.key });
      }
    }
    return out;
  }

  function helperItems(app, ix, removing) {
    const out = [];
    for (const [cKey, m] of ix.serves) {
      const e = m.get(app.key);
      if (!e) continue;
      const c = ix.byKey.get(cKey);
      if (!c) continue;
      const servers = [...m.keys()].filter((k) => ix.byKey.has(k));
      const staying = servers.filter((k) => !removing.has(k));
      const usedDirect = c.applicable && (c.usageClass === 'active' || c.usageClass === 'occasional') && !c.flags.includes('notrace');
      const orphan = staying.length === 0 && !usedDirect && !ix.kb.get(c.key).protect;
      out.push({
        id: 'helper:' + cKey, group: 'helpers', impact: orphan ? 'orphan' : 'info', confidence: e.maybe ? 'möglich' : 'wahrscheinlich', title: c.name + (c.version ? ' ' + c.version : ''),
        detail: e.why + '. ' + (orphan ? 'Wird nach dem Entfernen von „' + app.name + '“ vermutlich nicht mehr gebraucht.' : staying.length ? 'Wird weiterhin gebraucht von: ' + staying.map((k) => ix.byKey.get(k).name).slice(0, 3).join(', ') + '.' : usedDirect ? 'Du nutzt es selbst regelmäßig.' : ''),
        bytes: c.sizeKB ? c.sizeKB * 1024 : null, app: c.key,
      });
    }
    return out;
  }

  function familyItems(app, ix) {
    const out = [];
    const mine = app.match ? app.match.roots : [];
    const myCore = LC.compact(LC.coreName(app.name));
    const pub = pubCompact(app.publisher);
    for (const o of ix.apps) {
      if (o.key === app.key) continue;
      const theirs = o.match ? o.match.roots : [];
      const sameDir = mine.some((r1) => theirs.some((r2) => r1 === r2 || r1.startsWith(r2 + '\\') || r2.startsWith(r1 + '\\')));
      const oc = LC.compact(LC.coreName(o.name));
      const [s, l] = myCore.length <= oc.length ? [myCore, oc] : [oc, myCore];
      const stem = pub && pubCompact(o.publisher) === pub && s.length >= 6 && l.startsWith(s);
      if (!sameDir && !stem) continue;
      out.push({ id: 'family:' + o.key, group: 'family', impact: ix.removing.has(o.key) ? 'info' : 'orphan', confidence: sameDir ? 'sicher' : 'wahrscheinlich', title: o.name + (o.version ? ' ' + o.version : ''),
        detail: (sameDir ? 'Liegt im selben Installationsordner. ' : 'Gleicher Hersteller, gleicher Namensstamm. ') + (ix.removing.has(o.key) ? 'Steht ebenfalls auf der Aufräumliste.' : 'Meist wird es zusammen entfernt – prüfe, ob du es einzeln brauchst.'), bytes: o.sizeKB ? o.sizeKB * 1024 : null, app: o.key });
      if (out.length >= 8) break;
    }
    return out;
  }

  function startupItems(app) {
    const items = [];
    if (app.startup) for (const s of app.startup.items) {
      items.push({ id: 'startup:' + s.name, group: 'startup', impact: 'info', confidence: 'sicher', title: 'Autostart: ' + s.name + (s.enabled ? '' : ' (deaktiviert)'), detail: s.location + (s.command ? ' – ' + s.command : '') + '. Der Eintrag wird beim Deinstallieren normalerweise mit entfernt.' });
    }
    return items;
  }

  function cloudItems(app, ix, kb) {
    const out = [];
    if (!kb.cloud || !ix.fm) return out;
    const prov = ix.fm.providers.find((p) => p.id === kb.cloud && p.mode !== 'leftover');   // an old leftover folder is not the cloud
    if (!prov) return out;
    const root = ix.fm.cloudRoots.find((r) => r.provider === prov.name || LC.pathUnder(r.path, prov.root));
    const online = root ? root.onlineBytes || 0 : 0;
    out.push({ id: 'cloud:' + prov.id, group: 'cloud', impact: online > 0 ? 'breaks' : 'degrades', confidence: 'sicher', title: prov.name + ' (' + (prov.mode === 'stream' ? 'streamt' : prov.mode === 'mirror' ? 'gespiegelt' : 'synchronisiert') + '): ' + prov.root,
      detail: (root ? fmtNum(root.files, 0) + ' Dateien, ' + fmtBytes(root.bytes) + (online ? ', davon ' + fmtBytes(online) + ' NUR online (nicht auf diesem PC)' : '') + '. ' : '')
        + (online > 0 ? 'Ohne das Programm erreichst du diese Dateien nur noch im Browser (drive.google.com bzw. Webseite des Anbieters).' : 'Die Dateien bleiben im Online-Konto; lokal verschwindet der Ordner bzw. wird nicht mehr synchronisiert.'),
      bytes: root ? root.bytes : null });
    return out;
  }

  function hardwareItems(app, ix, kb) {
    const out = [];
    if (!kb.hw) return out;
    if (kb.hw.kind === 'gpu') {
      const vendor = /nvidia/i.test(app.name) ? /nvidia/i : /amd|radeon/i.test(app.name) ? /amd|radeon/i : /intel/i.test(app.name) ? /intel/i : null;
      const gpu = asArray(ix.snap.gpu).find((g) => vendor && vendor.test(g.name));
      out.push({ id: 'hw:gpu', group: 'hardware', impact: gpu ? 'breaks' : 'info', confidence: gpu ? 'sicher' : 'möglich', title: gpu ? 'Treiber für ' + gpu.name + ' (verbaut)' : 'Grafiktreiber', detail: gpu ? 'Ohne diesen Treiber läuft die Grafikkarte nur im einfachen Windows-Modus (langsam, kein 3D/Spiele/Rendering).' : 'Es wurde keine passende Grafikkarte im Gerät erkannt – evtl. ein Überbleibsel.' });
    } else if (kb.hw.kind === 'tablet') {
      out.push({ id: 'hw:tablet', group: 'hardware', impact: 'info', confidence: 'möglich', title: 'Zeichentablett / Stifteingabe', detail: 'Ob das Tablett noch angeschlossen ist, kann LaptopCheck nicht erkennen. Ohne Treiber arbeitet es nur als Maus ohne Druckstärke.' });
    }
    return out;
  }

  function peerItems(app, ix) {
    if (!app.category || !/^(Medien|Entwicklung|Büro|Kommunikation|Spiele)/.test(app.category)) return [];
    return ix.apps.filter((o) => o.key !== app.key && o.applicable && o.category === app.category).sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || '')).slice(0, 6)
      .map((o) => ({ id: 'peer:' + o.key, group: 'peers', impact: 'info', confidence: 'möglich', title: o.name, detail: 'Gleicher Bereich („' + app.category + '“). ' + (o.lastUsed ? 'Zuletzt benutzt ' + LC.fmtDate(o.lastUsed) + '.' : 'Nutzung unbekannt.'), app: o.key }));
  }

  /* ------------------------------------------------------------------ usage */
  LC.usageLines = (app, now) => {
    const L = [];
    const when = (d) => (d ? LC.fmtDate(d) + ' (' + LC.fmtAgo(LC.daysBetween(d, now || new Date())) + ')' : null);
    L.push({ label: 'Zuletzt benutzt', value: app.lastUsed ? when(app.lastUsed) : app.everLaunched ? 'Wurde gestartet, Zeitpunkt unbekannt' : 'Keine Nutzungsspur gefunden', hint: app.lastUsedSource ? 'Quelle: ' + (app.lastUsedSource === 'manual' ? 'von dir eingetragen' : app.lastUsedSource) : '' });
    if (app.runCount) L.push({ label: 'Starts (gezählt von Windows)', value: fmtNum(app.runCount, 0) + '×', hint: app.focusHours ? 'insgesamt etwa ' + fmtNum(app.focusHours, 1) + ' Std. im Vordergrund' : '' });
    L.push({ label: 'Installiert', value: app.installDate ? when(app.installDate) : 'unbekannt', hint: app.installDateSource ? 'Quelle: ' + app.installDateSource : '' });
    if (app.startup) L.push({ label: 'Autostart', value: app.startup.enabled ? 'startet mit Windows' : 'Eintrag vorhanden, deaktiviert', hint: '' });
    if (app.purpose) L.push({ label: 'Wofür du es nutzt (deine Angabe)', value: app.purpose, hint: '' });
    if (app.note) L.push({ label: 'Deine Notiz', value: app.note, hint: '' });
    if (app.sizeKB) L.push({ label: 'Belegt', value: (app.sizeApprox ? 'mind. ' : '') + LC.fmtKB(app.sizeKB), hint: '' });
    return L;
  };

  /* ------------------------------------------------------------------ assemble */
  const GROUP_ORDER = ['dependants', 'projects', 'cloud', 'hardware', 'files', 'data', 'helpers', 'family', 'startup', 'peers'];
  function assemble(items, extra) {
    const groups = [];
    for (const id of GROUP_ORDER) {
      const g = items.filter((i) => i.group === id);
      if (!g.length) continue;
      g.sort((a, b) => LC.IMPACT[b.impact].rank - LC.IMPACT[a.impact].rank || (b.bytes || 0) - (a.bytes || 0));
      groups.push({ id, ...LC.REL_GROUPS[id], items: g });
    }
    const summary = { breaks: 0, data: 0, degrades: 0, orphan: 0, leftover: 0, info: 0, total: items.length, leftoverBytes: 0, orphanBytes: 0 };
    for (const i of items) {
      summary[i.impact]++;
      if (i.impact === 'leftover') summary.leftoverBytes += i.bytes || 0;
      if (i.impact === 'orphan') summary.orphanBytes += i.bytes || 0;
    }
    summary.needsAck = summary.breaks + summary.data > 0;
    const notable = items.filter((i) => ['breaks', 'data', 'degrades', 'orphan', 'leftover'].includes(i.impact)).sort((a, b) => LC.IMPACT[b.impact].rank - LC.IMPACT[a.impact].rank).slice(0, 3);
    return { groups, summary, notable, ...extra };
  }

  LC.relationsOfApp = (app, ix, opts) => {
    opts = opts || {};
    const removing = opts.removing || ix.removing;
    const kb = ix.kb.get(app.key) || mergeKb([]);
    const items = [].concat(dependantItems(app, ix), projectItems(app, ix, kb), cloudItems(app, ix, kb), hardwareItems(app, ix, kb), fileItems(app, ix, kb), dataItems(app, ix, kb),
      helperItems(app, ix, removing), familyItems(app, ix), startupItems(app), peerItems(app, ix));
    // a program listed as family/helper/dependant is not listed again as "similar program"
    const named = new Set(items.filter((i) => i.app && i.group !== 'peers').map((i) => i.app));
    const filtered = items.filter((i) => i.group !== 'peers' || !named.has(i.app));
    const needsFilesScan = !ix.hasFiles && (kb.exts.length > 0 || kb.data.length > 0);
    return assemble(filtered, { usage: LC.usageLines(app, ix.now), tips: kb.tips, protect: kb.protect, needsFilesScan, kbMatched: kb.ids.length > 0 });
  };

  /** Relations of a file or folder. item = { path, kind, bytes } */
  LC.relationsOfPath = (item, ix) => {
    const items = [];
    const p = item.path;
    const name = baseName(p);
    // programs that own this folder as data folder
    const fakeDir = { name, path: p };
    for (const a of ix.apps) {
      const kb = ix.kb.get(a.key);
      const m = dirMatch(fakeDir, a, kb);
      if (m && m.via !== 'publisher') items.push({ id: 'owner:' + a.key, group: 'dependants', impact: 'degrades', confidence: m.conf, title: 'Programmdaten von „' + a.name + '“', detail: 'Das Programm ist noch installiert – es legt den Ordner beim nächsten Start neu an; Einstellungen/Daten darin gehen verloren.', app: a.key });
      if (a.match && a.match.roots.some((r) => LC.normPath(p) === r)) items.push({ id: 'install:' + a.key, group: 'dependants', impact: 'breaks', confidence: 'sicher', title: 'Installationsordner von „' + a.name + '“', detail: 'Das Programm funktioniert danach nicht mehr – deinstalliere es über Windows statt den Ordner zu löschen.', app: a.key });
    }
    // projects pointing here
    if (ix.projects) {
      for (const pr of ix.projects.projects) {
        for (const lp of [pr.localPath, pr.cloudPath].filter(Boolean)) {
          if (LC.pathUnder(p, lp) || LC.pathUnder(lp, p)) items.push({ id: 'project:' + pr.id, group: 'projects', impact: pr.status === 'active' || pr.status === 'planned' ? 'breaks' : 'info', confidence: 'sicher', title: 'Projekt „' + pr.name + '“', detail: 'Der Ordner ist als Projekt-' + (lp === pr.cloudPath ? 'Cloud' : 'Arbeits') + 'ordner eingetragen.', projectId: pr.id });
        }
        for (const r of pr.resources) if (r.path && (LC.pathUnder(p, r.path) || LC.pathUnder(r.path, p))) items.push({ id: 'project:' + pr.id + ':' + r.id, group: 'projects', impact: 'data', confidence: 'sicher', title: 'Projekt „' + pr.name + '“ – Ressource „' + r.name + '“', detail: 'Als benötigte Datei/Ordner eingetragen.', projectId: pr.id });
      }
    }
    // git repositories inside
    if (ix.fm) {
      for (const r of ix.fm.repos) {
        if (LC.pathUnder(r.path, p)) items.push({ id: 'repo:' + r.path, group: 'projects', impact: r.unsaved ? 'breaks' : 'data', confidence: 'sicher', title: 'Git-Repository „' + r.name + '“' + (r.fullName ? ' (' + r.fullName + ')' : ''), detail: r.unsaved ? 'Enthält nicht gesicherte Arbeit: ' + r.problems.filter((x) => x.id !== 'in-cloud').map((x) => x.text).join(', ') + '.' : 'Ist auf GitHub gesichert – eine neue Kopie ließe sich mit „git clone“ holen.' });
      }
      // backup status from the scan
      const f = ix.fm.folders.find((x) => LC.pathUnder(x.path, p) && LC.pathUnder(p, x.path));
      if (f && f.files) {
        const covered = Math.round(f.matchPct);
        items.push({ id: 'backup', group: 'cloud', impact: covered >= 95 ? 'info' : 'data', confidence: 'wahrscheinlich', title: covered >= 95 ? 'In der Cloud gesichert (' + covered + ' % der Dateien gefunden)' : 'Nur ' + covered + ' % der Dateien sind in der Cloud wiederzufinden',
          detail: 'Abgleich über Name + Größe. ' + (covered >= 95 ? 'Die lokale Kopie ist ersetzbar.' : 'Der Rest existiert vermutlich nur auf diesem PC – vorher in die Cloud kopieren (Seite „Dateien“).') + (f.newest ? ' Zuletzt geändert ' + LC.fmtDate(f.newest) + '.' : ''), bytes: f.bytes });
      }
    }
    // files of programs: is this a file type someone needs?
    const ext = lower((String(name).match(/\.[a-z0-9]{1,12}$/i) || [''])[0]);
    if (item.kind === 'file' && ext && ix.extOwner.has(ext)) {
      const a = ix.byKey.get(ix.extOwner.get(ext).key);
      if (a) items.push({ id: 'ext:' + ext, group: 'files', impact: 'info', confidence: 'sicher', title: ext + '-Datei – wird mit „' + a.name + '“ geöffnet', detail: 'Das Programm ist installiert.', app: a.key });
    }
    // duplicates elsewhere
    for (const d of asArray(ix.raw && ix.raw.dupes)) {
      if (asArray(d.paths).some((q) => LC.pathUnder(q, p) || LC.pathUnder(p, q)) && d.count > 1) items.push({ id: 'dupe:' + d.name, group: 'cloud', impact: 'info', confidence: 'wahrscheinlich', title: 'Gleiche Datei mehrfach vorhanden: ' + d.name, detail: d.count + '× (gleicher Name und gleiche Größe)' + (d.inCloud ? ', mindestens eine Kopie liegt in der Cloud.' : '.'), bytes: d.size });
    }
    return assemble(items, { usage: [], tips: [], protect: false, needsFilesScan: !ix.hasFiles, kbMatched: false });
  };
})(typeof window !== 'undefined' ? window : globalThis);
