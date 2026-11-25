/* files.js - interprets the files scan (data/files.json): where does what live, what could move to the cloud,
 * how well is the cloud drive organised, which git repositories hold unsaved work.
 *
 *   LC.analyzeFiles(raw, ctx)  -> model for the "Dateien" page + findings (area "files")
 *   LC.suggestTarget(folder, ctx) -> where a local folder belongs in the cloud
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { GB, asArray, fmtBytes, fmtNum } = LC;

  /* ------------------------------------------------------------------ path helpers (work for "C:\x" and "/x") */
  const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  const parentName = (p) => { const a = String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/); return a.length > 1 ? a[a.length - 2] : ''; };
  const normP = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  LC.pathUnder = (p, rootPath) => { const a = normP(p), b = normP(rootPath); return a === b || a.startsWith(b + '/'); };
  LC.sepOf = (rootPath) => (String(rootPath).includes('\\') ? '\\' : '/');
  LC.joinPath = (rootPath, ...parts) => {
    const sep = LC.sepOf(rootPath);
    return [String(rootPath).replace(/[\\/]+$/, '')].concat(parts.filter(Boolean).map((x) => String(x).replace(/^[\\/]+|[\\/]+$/g, '').replace(/[\\/]+/g, sep))).join(sep);
  };
  LC.safeFolderName = (n) => String(n).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '') || 'Ordner';

  /* ------------------------------------------------------------------ folder enrichment + target suggestion */
  function enrichFolder(f, now) {
    const cb = asArray(f.cb);
    const groups = {};
    LC.CAT_GROUPS.forEach((g) => { groups[g.id] = g.cats.reduce((a, i) => a + (cb[i] || 0), 0); });
    const top = Object.entries(groups).sort((a, b) => b[1] - a[1])[0];
    const bytes = f.bytes || 0;
    return {
      ...f,
      name: baseName(f.path),
      parent: parentName(f.path),
      localBytes: Math.max(0, bytes - (f.onlineBytes || 0)),
      matchPct: f.files ? (f.matchFiles / f.files) * 100 : 0,
      newestDays: f.newest ? LC.daysBetween(f.newest, now) : null,
      oldestDays: f.oldest ? LC.daysBetween(f.oldest, now) : null,
      groups,
      dominant: top && top[1] > 0 ? top[0] : null,
      dominantShare: bytes > 0 && top ? top[1] / bytes : 0,
      installerShare: bytes > 0 ? ((cb[8] || 0) + (cb[7] || 0)) / bytes : 0,
      installerOnlyShare: bytes > 0 ? (cb[8] || 0) / bytes : 0,   // real installers only (.exe/.msi/.iso); .zip/.7z may hold your own files
    };
  }

  /**
   * @param f   enriched folder
   * @param ctx { projectNames: string[] }
   * @returns {{action:'cloud'|'delete'|'git', target:string|null, reason:string, confidence:'hoch'|'mittel'|'niedrig', rule:string}}
   */
  LC.suggestTarget = (f, ctx) => {
    ctx = ctx || {};
    const name = LC.safeFolderName(f.name);
    const parent = f.depth === 2 ? LC.safeFolderName(f.parent) : null;
    const tail = (top) => (parent ? top + '/' + parent + '/' + name : top + '/' + name);

    if (f.installerOnlyShare >= 0.6 && f.files > 0) return { action: 'delete', target: null, rule: 'installers', confidence: 'hoch', reason: 'Fast nur Installer – lassen sich neu herunterladen. Nach Durchsicht löschen statt in die Cloud zu legen.' };
    if (f.dominantShare >= 0.6 && f.dominant === 'code') return { action: 'git', target: null, rule: 'code', confidence: 'mittel', reason: 'Überwiegend Code – gehört in ein Git-Repository auf GitHub, nicht in die Cloud-Ablage.' };
    const media = { images: '06 Medien/Fotos', video: '06 Medien/Videos', audio: '06 Medien/Musik' }[f.dominant];
    if (media && f.dominantShare >= 0.6) return { action: 'cloud', target: parent ? media + '/' + parent + '/' + name : media + '/' + name, rule: 'media', confidence: 'mittel', reason: 'Überwiegend ' + LC.CAT_GROUPS.find((g) => g.id === f.dominant).label + ' → Medien (spart lokal oft am meisten Platz).' };

    const compact = LC.compact(name + ' ' + (parent || ''));
    for (const p of ctx.projectNames || []) {
      const pc = LC.compact(p);
      if (pc.length >= 4 && compact.includes(pc)) {
        const proj = LC.safeFolderName(p);
        return { action: 'cloud', target: '05 Projekte/' + proj + (LC.compact(name) === pc ? '' : '/' + name), rule: 'project', confidence: 'hoch', reason: 'Der Name passt zu deinem Projekt „' + p + '“.' };
      }
    }
    const hay = name + ' ' + (parent || '');
    for (const r of LC.FOLDER_RULES) {
      if (r.re.test(hay)) return { action: 'cloud', target: tail(r.top), rule: r.id, confidence: 'mittel', reason: 'Der Name deutet auf „' + r.label + '“ hin.' };
    }
    if (f.dominantShare >= 0.6 && f.dominant === 'archives') return { action: 'cloud', target: '99 Archiv/' + name, rule: 'archive', confidence: 'niedrig', reason: 'Überwiegend Archive/Installer – falls aufbewahrenswert ins Archiv.' };
    return { action: 'cloud', target: '00 Eingang/' + name, rule: 'default', confidence: 'niedrig', reason: 'Nicht eindeutig – erst in den Eingang, später einsortieren.' };
  };

  /* ------------------------------------------------------------------ cloud drive structure */
  function analyzeCloud(ct, folders, dupes, now) {
    const label = ct.provider;
    const tops = folders.filter((f) => f.root === label && f.depth === 1 && LC.pathUnder(f.path, ct.root)).sort((a, b) => b.bytes - a.bytes);
    const numbered = tops.filter((t) => /^\d{2}[\s._-]/.test(t.name)).length;
    const issueTotal = Object.values(ct.nameIssues || {}).reduce((a, b) => a + b, 0);
    const cloudDupes = dupes.filter((d) => d.inCloud && d.count >= 2);
    const wasted = cloudDupes.reduce((a, d) => a + (d.count - 1) * d.size, 0);
    const issues = [];
    const add = (i) => issues.push({ severity: 'info', steps: [], ...i });
    if (ct.partial) add({ id: 'partial', severity: 'info', title: 'Die Analyse wurde wegen des Zeitlimits abgebrochen', detail: 'Zahlen sind Untergrenzen. Bei sehr großen Laufwerken das Zeitlimit pro Ordner unter Einstellungen erhöhen.', action: '' });
    if (ct.rootFiles > 5) add({ id: 'loose-root', severity: ct.rootFiles > 20 ? 'warn' : 'info', title: ct.rootFiles + ' lose Dateien direkt im Hauptordner', detail: 'Dateien im Wurzelordner machen die Ablage unübersichtlich und sind schwer zu finden.', action: 'In „00 Eingang“ verschieben und von dort einsortieren.', steps: ['Neuen Ordner „00 Eingang“ anlegen.', 'Alle losen Dateien im Hauptordner markieren und hineinziehen.', 'Einmal pro Woche den Eingang leeren: einsortieren oder löschen.'] });
    if (tops.length > 15) add({ id: 'many-top', severity: 'info', title: tops.length + ' Ordner im Hauptordner', detail: 'Mehr als etwa 8–12 Ordner auf oberster Ebene sind schwer zu überblicken.', action: 'Ordner zu wenigen Oberthemen bündeln (siehe empfohlene Struktur).' });
    if (tops.length > 6 && numbered / tops.length < 0.5) add({ id: 'no-numbers', severity: 'info', title: 'Oberste Ordner haben keine feste Reihenfolge', detail: 'Mit Nummern vorne („01 Persönlich“, „02 Finanzen“ …) bleibt die Reihenfolge stabil und wichtige Ordner stehen oben.', action: 'Oberste Ordner nach dem Schema der empfohlenen Struktur nummerieren.' });
    if (ct.maxDepth > 7) add({ id: 'deep', severity: 'info', title: 'Sehr tiefe Verschachtelung (' + ct.maxDepth + ' Ebenen)', detail: 'Ab etwa 5–6 Ebenen findet man Dinge kaum noch und Pfade werden lang (Probleme beim Synchronisieren unter Windows).', action: 'Tiefe Ordner flacher legen; Dateinamen statt Ordnerketten nutzen („2024-03 Rechnung Telekom.pdf“).' });
    if (issueTotal > 0) add({ id: 'names', severity: issueTotal > 10 ? 'warn' : 'info', title: issueTotal + ' Datei-/Ordnernamen wie „Unbenannt“, „Kopie von …“ oder „(1)“', detail: 'Beispiele: ' + asArray(ct.nameIssueSamples).slice(0, 4).map(baseName).join(', ') + '. Solche Namen deuten auf Duplikate oder vergessenes Benennen hin.', action: 'Umbenennen oder löschen. Namensschema: „JJJJ-MM Thema.ext“ (sortiert sich selbst).' });
    if (ct.emptyDirs > 20) add({ id: 'empty', severity: 'info', title: ct.emptyDirs + ' leere Ordner', detail: 'Leere Ordner sind Ballast und verwirren.', action: 'Leere Ordner löschen.' });
    if (wasted >= 100 * 1024 * 1024) add({ id: 'dupes', severity: wasted > GB ? 'warn' : 'info', title: 'Doppelte Dateien belegen ca. ' + fmtBytes(wasted) + ' in der Cloud', detail: cloudDupes.slice(0, 3).map((d) => d.name + ' (' + d.count + '×, ' + fmtBytes(d.size) + ')').join(', ') + (cloudDupes.length > 3 ? ' …' : '') + '. Gleicher Name und gleiche Größe = sehr wahrscheinlich dieselbe Datei.', action: 'Pro Datei eine Kopie behalten; Google Drive: Rechtsklick → „Verwalten von Versionen“ bzw. Duplikate löschen.' });
    if (ct.nativeDocs > 0 && ct.files > 0 && ct.nativeDocs / ct.files > 0.3) add({ id: 'native', severity: 'info', title: 'Viele Google-Docs-Dateien (' + ct.nativeDocs + ')', detail: 'Google-Docs/-Sheets-Dateien belegen kaum Platz, funktionieren aber nur online.', action: 'Wichtige als PDF/Office-Datei zusätzlich sichern (Datei → Herunterladen), falls du offline Zugriff brauchst.' });

    let score = 100;
    for (const i of issues) score -= { 'loose-root': i.severity === 'warn' ? 25 : 10, 'many-top': 10, 'no-numbers': 8, deep: 10, names: i.severity === 'warn' ? 15 : 5, empty: 8, dupes: i.severity === 'warn' ? 15 : 8 }[i.id] || 0;
    score = LC.clamp(score, 0, 100);

    // map existing top-level folders to the recommended structure
    const recommended = LC.DRIVE_STRUCTURE.map((s) => s.name);
    const map = [];
    for (const t of tops) {
      if (/^\d{2}[\s._-]/.test(t.name)) continue;
      const rule = LC.FOLDER_RULES.find((r) => r.re.test(t.name));
      if (rule) map.push({ existing: t.name, suggested: rule.top + '/' + LC.safeFolderName(t.name), why: rule.label });
      else if (/^(archiv|archive|alt|old)$/i.test(t.name)) map.push({ existing: t.name, suggested: '99 Archiv', why: 'Archiv' });
      else if (/^(fotos?|bilder|pictures|photos)$/i.test(t.name)) map.push({ existing: t.name, suggested: '06 Medien/Fotos', why: 'Medien' });
      else if (/^(projekte?|projects?)$/i.test(t.name)) map.push({ existing: t.name, suggested: '05 Projekte', why: 'Projekte' });
    }
    const presentNumbers = new Set(tops.map((t) => (t.name.match(/^(\d{2})/) || [])[1]).filter(Boolean));
    const missing = LC.DRIVE_STRUCTURE.filter((s) => !presentNumbers.has(s.name.slice(0, 2)));
    return { provider: ct.provider, mode: ct.mode, root: ct.root, files: ct.files, bytes: ct.bytes, rootFiles: ct.rootFiles, maxDepth: ct.maxDepth, emptyDirs: ct.emptyDirs, nativeDocs: ct.nativeDocs, partial: ct.partial, topFolders: tops, numberedTop: numbered, issues, score, map, missing, recommended, wastedBytes: wasted };
  }

  /* ------------------------------------------------------------------ git repositories */
  function analyzeRepos(rawRepos, reposDoc, now) {
    const gh = new Map(asArray(reposDoc && reposDoc.repos).map((r) => [String(r.fullName).toLowerCase(), r]));
    return asArray(rawRepos).map((r) => {
      const github = r.fullName ? gh.get(String(r.fullName).toLowerCase()) || null : null;
      const problems = [];
      if (!r.remote) problems.push({ id: 'no-remote', text: 'kein Remote – existiert nur auf diesem Gerät' });
      else if (!r.fullName) problems.push({ id: 'other-remote', text: 'Remote ist nicht GitHub' });
      if (r.dirty) problems.push({ id: 'dirty', text: (r.changedFiles || 0) + ' geänderte' + ((r.untrackedFiles || 0) ? ' + ' + r.untrackedFiles + ' neue' : '') + ' Datei(en) nicht committet' });
      if (r.remote && r.noUpstream) problems.push({ id: 'no-upstream', text: 'Branch „' + (r.branch || '?') + '“ wurde nie gepusht' });
      else if (r.ahead > 0) problems.push({ id: 'ahead', text: r.ahead + ' Commit(s) nicht gepusht' });
      if (r.inCloudRoot) problems.push({ id: 'in-cloud', text: 'liegt in einem Cloud-Ordner (Sync-Konflikte möglich)' });
      return { ...r, name: baseName(r.path), github, problems, unsaved: problems.some((p) => ['no-remote', 'dirty', 'no-upstream', 'ahead'].includes(p.id)), lastCommitDays: r.lastCommit ? LC.daysBetween(r.lastCommit, now) : null };
    });
  }

  /* ------------------------------------------------------------------ main */
  /** Result of the comparison of an old mirror folder with the live drive (files scan), as numbers for the pages; null without a comparison. */
  LC.leftoverCompare = (p) => {
    const c = p && p.compare && p.compare.files > 0 ? p.compare : null;
    if (!c) return null;
    const inDriveBytes = c.same.bytes + c.nameSize.bytes;
    return { files: c.files, bytes: c.bytes, inDriveFiles: c.same.files + c.nameSize.files, inDriveBytes, pct: c.bytes > 0 ? Math.round((inDriveBytes / c.bytes) * 100) : 0,
      onlyFiles: c.only.files, onlyBytes: c.only.bytes, junkFiles: c.junk.files, junkBytes: c.junk.bytes, partial: !!c.partial, liveRoot: c.liveRoot,
      dirs: asArray(c.onlyDirs), dirsMore: c.onlyDirsMore || 0, top: asArray(c.onlyTop) };
  };

  /**
   * @param raw  parsed data/files.json
   * @param ctx  { now, projectNames, reposDoc, cFree: {pct, bytes} }
   */
  LC.analyzeFiles = (raw, ctx) => {
    ctx = ctx || {};
    const now = ctx.now ? new Date(ctx.now) : new Date();
    const folders = asArray(raw.folders).map((f) => enrichFolder(f, now));
    const roots = asArray(raw.roots);
    // "leftover": an old mirror folder of Google Drive that is not synced any more (Drive streams to a virtual drive now). Not scanned,
    // so its size comes from the storage analysis (ctx.sizeAt), if there is one.
    const providers = asArray(raw.providers).map((p) => (p.mode === 'leftover' ? { ...p, localBytes: ctx.sizeAt ? ctx.sizeAt(p.root) : null } : p));
    const localRoots = roots.filter((r) => r.kind === 'local');
    const cloudRoots = roots.filter((r) => r.kind === 'cloud');
    const rootAggs = folders.filter((f) => f.depth === 0);

    const candidates = folders
      .filter((f) => f.depth >= 1 && f.files > 0 && localRoots.some((r) => r.label === f.root && LC.pathUnder(f.path, r.path)))
      .map((f) => ({ ...f, suggestion: LC.suggestTarget(f, ctx) }))
      .sort((a, b) => b.localBytes - a.localBytes);

    const localAggs = rootAggs.filter((f) => localRoots.some((r) => r.label === f.root && normP(r.path) === normP(f.path)));
    const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
    const groups = {};
    LC.CAT_GROUPS.forEach((g) => { groups[g.id] = localAggs.reduce((a, f) => a + (f.groups[g.id] || 0), 0); });
    const docsList = asArray(raw.docs);
    const localOnlyDocs = docsList.filter((d) => !d.cloud);
    const freeable = candidates.filter((c) => c.depth === 1 && c.suggestion.action === 'cloud').reduce((a, c) => a + c.localBytes, 0);
    const totals = {
      localBytes: localAggs.reduce((a, f) => a + f.localBytes, 0),
      localFiles: sum(localAggs, 'files'),
      onlineBytes: sum(localAggs, 'onlineBytes'),
      matchBytes: sum(localAggs, 'matchBytes'),
      groups,
      cloudBytes: cloudRoots.reduce((a, r) => a + (r.bytes || 0), 0),
      docsLocalOnlyCount: localOnlyDocs.length,
      docsLocalOnlyBytes: localOnlyDocs.reduce((a, d) => a + d.s, 0),
      docsListTruncated: docsList.length >= 6000,
      freeableBytes: freeable,
    };

    const dupes = asArray(raw.dupes);
    const big = asArray(raw.big).map((b) => ({ ...b, name: baseName(b.p) }));
    const cloud = asArray(raw.cloudTree).map((ct) => analyzeCloud(ct, folders, dupes, now));
    const repos = analyzeRepos(raw.gitRepos, ctx.reposDoc, now);
    const downloads = localAggs.find((f) => f.root === 'Downloads') || null;
    const model = {
      present: true, raw, scannedAt: raw.scannedAt, ageDays: raw.scannedAt ? LC.daysBetween(raw.scannedAt, now) : null, seconds: raw.seconds,
      providers, liveProviders: providers.filter((p) => p.mode !== 'leftover'), roots, localRoots, cloudRoots, folders, candidates, totals, docs: docsList, big, dupes,
      localCloudDupes: dupes.filter((d) => d.inCloud && d.inLocal),
      cloud, repos, downloads, gitAvailable: raw.gitAvailable, partialRoots: roots.filter((r) => r.partial), cFree: ctx.cFree || null,
    };
    model.findings = buildFilesFindings(model, ctx);
    return model;
  };

  /* ------------------------------------------------------------------ findings */
  function buildFilesFindings(m, ctx) {
    const F = [];
    const add = (f) => F.push({ area: 'files', severity: 'info', detail: '', action: '', steps: [], links: [], task: null, impact: 2, ...f });
    const cFreePct = m.cFree ? m.cFree.pct : null;

    if (!m.providers.length) {
      add({ id: 'files.no-cloud', severity: 'info', task: true, impact: 3, title: 'Kein Cloud-Ordner gefunden',
        detail: 'Weder Google Drive für Desktop noch OneDrive, Dropbox oder Proton Drive wurden erkannt. Ohne Cloud-Ordner kann das Tool keine Dateien auslagern.',
        action: 'Google Drive für Desktop installieren und anmelden – oder den Ordner unter „Dateien → Einstellungen“ von Hand angeben.',
        links: [{ label: 'Google Drive für Desktop herunterladen', url: 'https://www.google.com/drive/download/' }] });
    }
    for (const p of m.providers) {
      if (p.mode === 'leftover') {
        const live = m.liveProviders.find((x) => x.id === p.id && x.mode === 'stream');
        const lc = LC.leftoverCompare(p);
        if (lc) {
          const dirName = p.root.split(/[\\/]/).pop();
          add({ id: 'files.drive-leftover', severity: cFreePct != null && cFreePct < 20 ? 'warn' : 'info', task: true, impact: 4,
            title: 'Alter Google-Drive-Ordner (' + fmtBytes(lc.bytes) + '): ' + lc.pct + ' % liegen schon im Drive' + (lc.onlyFiles ? ', ' + lc.onlyFiles + ' Dateien fehlen dort' : ' – im Drive fehlt nichts'),
            detail: 'Dein Drive läuft gestreamt' + (live ? ' (' + live.root + ')' : '') + '. ' + p.root + ' ist ein Rest einer früheren Spiegelung und wird nicht mehr synchronisiert. Der Abgleich (Pfad und Größe) zeigt: ' + fmtBytes(lc.inDriveBytes) + ' (' + lc.inDriveFiles + ' Dateien) liegen unverändert im Drive – die lokale Kopie ist überflüssig. '
              + (lc.onlyFiles ? 'Nur ' + lc.onlyFiles + ' Dateien (' + fmtBytes(lc.onlyBytes) + ') gibt es im Drive nicht.' : 'Es fehlt keine Datei im Drive.') + (lc.partial ? ' Der Abgleich wurde wegen der Zeitgrenze abgebrochen: Zahlen sind unvollständig.' : ''),
            action: lc.onlyFiles ? 'Die fehlenden Dateien ins Drive kopieren, dann den Ordner löschen:' : 'Den Ordner im Explorer in den Papierkorb legen:',
            steps: (lc.onlyFiles ? ['Unter „Mein PC → Hausordnung“ steht, welche Ordner Dateien enthalten, die im Drive fehlen (mit Explorer-Knopf).',
              'Diese Dateien in denselben Unterordner im Drive kopieren (' + (live ? live.root : 'Drive-Laufwerk') + ').',
              'Einen neuen Dateien-Scan starten: der Abgleich muss „Im Drive fehlt nichts“ zeigen.'] : [])
              .concat(['Ordner „' + dirName + '“ im Explorer in den Papierkorb legen (Rechtsklick → Löschen). Das Drive-Laufwerk und die Cloud bleiben unberührt: Dieser Ordner wird nicht mehr synchronisiert.']),
            links: [] });
          continue;
        }
        add({ id: 'files.drive-leftover', severity: cFreePct != null && cFreePct < 20 ? 'warn' : 'info', task: true, impact: 4,
          title: 'Alter Google-Drive-Ordner auf diesem PC' + (p.localBytes ? ' (' + fmtBytes(p.localBytes) + ')' : '') + ' – nicht mehr synchronisiert',
          detail: 'Dein Drive läuft gestreamt' + (live ? ' (' + live.root + ')' : '') + '. Der Ordner ' + p.root + ' ist ein Rest einer früheren Spiegelung: Änderungen dort erreichen die Cloud nicht mehr, neuere Dateien gibt es nur im Drive. Er belegt weiter Platz auf der SSD' + (p.localBytes ? ' – bis zu ' + fmtBytes(p.localBytes) + ' lassen sich zurückholen' : '') + '.',
          action: 'Erst prüfen, ob dort etwas liegt, das es in der Cloud nicht gibt – dann den Ordner entfernen:',
          steps: ['Drive-Symbol in der Taskleiste → Zahnrad → Einstellungen: Bei „Meine Ablage“ steht „Dateien streamen“, und ' + p.root + ' ist dort nicht als synchronisierter Ordner aufgeführt.',
            'Alte Ordner mit der Cloud vergleichen (z. B. mit dem kostenlosen WinMerge: ' + p.root + ' gegen ' + (live ? live.root : 'das Drive-Laufwerk') + ') und Dateien sichern, die nur lokal liegen oder lokal neuer sind.',
            'Den Ordner nicht gleich löschen, sondern in „' + p.root.split(/[\\/]/).pop() + ' (alt)“ umbenennen und einige Tage beobachten.',
            'Danach löschen (Papierkorb leeren). Das Drive-Laufwerk und die Cloud bleiben unberührt.'],
          links: [] });
        continue;
      }
      if (p.id === 'gdrive' && p.mode === 'mirror') {
        add({ id: 'files.mirror-mode', severity: cFreePct != null && cFreePct < 30 ? 'warn' : 'info', task: true, impact: 4,
          title: 'Google Drive spiegelt alles auf diesen PC (kein Platzgewinn)',
          detail: 'Dein Drive liegt als normaler Ordner auf der Festplatte (' + p.root + '). Alles darin belegt auch lokal Platz – Auslagern spart so nichts.',
          action: 'Auf „Dateien streamen“ umstellen: dann liegen Dateien nur online und werden erst beim Öffnen geladen.',
          steps: ['Google-Drive-Symbol in der Taskleiste → Zahnrad → Einstellungen.', 'Links „Google Drive“ → „Meine Ablage“ → „Dateien streamen“ statt „Dateien spiegeln“ wählen.', 'Danach ersetzt Drive den Ordner durch ein virtuelles Laufwerk (meist G:); starte dann hier einen neuen Dateien-Scan.'] });
      }
    }
    for (const r of m.partialRoots) {
      add({ id: 'files.partial:' + r.label, severity: 'info', impact: 1, title: 'Scan von „' + r.label + '“ vorzeitig beendet', detail: 'Zeitlimit erreicht – Größen und Anzahlen sind Untergrenzen (' + fmtNum(r.files, 0) + ' Dateien gesehen).', action: 'Unter „Dateien → Einstellungen“ das Zeitlimit pro Ordner erhöhen und neu scannen.' });
    }

    const t = m.totals;
    const cands = m.candidates.filter((c) => c.depth === 1 && c.suggestion.action === 'cloud' && c.localBytes > 100 * 1024 * 1024).slice(0, 3);
    if (t.freeableBytes >= 2 * GB && m.liveProviders.length) {
      add({ id: 'files.movable', severity: cFreePct != null && cFreePct < 25 ? 'warn' : 'info', task: true, impact: 4,
        title: 'Bis zu ' + fmtBytes(t.freeableBytes) + ' lassen sich in die Cloud auslagern',
        detail: (cands.length ? 'Größte Kandidaten: ' + cands.map((c) => c.name + ' (' + fmtBytes(c.localBytes) + ')').join(', ') + '. ' : '') + 'Kopieren, prüfen und erst danach lokal entfernen – das Tool geht in dieser Reihenfolge vor.',
        action: 'Unter „Dateien“ Ordner auswählen und den Umzug starten.' });
    }
    if (t.docsLocalOnlyCount >= 50) {
      add({ id: 'files.local-only-docs', severity: 'info', task: true, impact: 3, title: t.docsLocalOnlyCount + (t.docsListTruncated ? '+' : '') + ' Dokumente existieren nur auf diesem Gerät',
        detail: 'Zusammen ' + fmtBytes(t.docsLocalOnlyBytes) + '. Geht der Laptop kaputt oder verloren, sind sie weg (kein Treffer in der Cloud mit gleichem Namen und gleicher Größe).',
        action: 'Wichtige Ordner in die Cloud kopieren (Dateien → Umzugsplan).' });
    }
    const dupBytes = m.localCloudDupes.reduce((a, d) => a + d.size, 0);
    if (dupBytes >= 100 * 1024 * 1024) {
      add({ id: 'files.local-cloud-dupes', severity: 'info', task: true, impact: 3, title: 'Mindestens ' + fmtBytes(dupBytes) + ' liegen lokal UND in der Cloud',
        detail: m.localCloudDupes.slice(0, 3).map((d) => d.name + ' (' + fmtBytes(d.size) + ')').join(', ') + '. Gleicher Name und gleiche Größe – die lokale Kopie kannst du entfernen, die Cloud-Kopie bleibt.',
        action: 'Unter „Dateien → Doppelte Dateien“ ansehen und lokal löschen.' });
    }
    const dl = m.downloads;
    if (dl && dl.groups && (dl.installerShare * dl.bytes) >= 500 * 1024 * 1024) {
      add({ id: 'files.installers', severity: 'info', task: true, impact: 2, title: 'Downloads: ' + fmtBytes(dl.installerShare * dl.bytes) + ' Installer und Archive',
        detail: 'Installer (.exe, .msi) und ZIP/ISO-Dateien lassen sich fast immer neu herunterladen.', action: 'Ordner „Downloads“ sichten und Installer löschen (nicht in die Cloud legen).' });
    }
    const bigLocal = m.big.filter((b) => !b.cloud && b.s >= GB);
    if (bigLocal.length) {
      add({ id: 'files.big', severity: 'info', impact: 2, title: bigLocal.length + ' Datei(en) über 1 GB nur lokal', detail: bigLocal.slice(0, 4).map((b) => b.name + ' (' + fmtBytes(b.s) + ')').join(', ') + '.', action: 'Prüfen, ob sie noch gebraucht werden – große Videos/ISOs sind die schnellste Platz-Ausbeute.' });
    }
    for (const c of m.cloud) {
      for (const i of c.issues) add({ id: 'drive.' + c.provider.toLowerCase().replace(/\W+/g, '') + '.' + i.id, severity: i.severity, task: i.severity === 'warn', impact: 2, title: c.provider + ': ' + i.title, detail: i.detail, action: i.action, steps: i.steps });
    }
    // git repositories
    const unsaved = m.repos.filter((r) => r.unsaved);
    if (unsaved.length) {
      add({ id: 'repos.unsaved', severity: 'warn', task: true, impact: 4, title: unsaved.length + ' lokale Git-' + LC.plural(unsaved.length, 'Repository', 'Repositories') + ' mit nicht gesicherter Arbeit',
        detail: unsaved.slice(0, 5).map((r) => r.name + ': ' + r.problems.filter((p) => ['no-remote', 'dirty', 'no-upstream', 'ahead'].includes(p.id)).map((p) => p.text).join(', ')).join(' · ') + (unsaved.length > 5 ? ' …' : ''),
        action: 'In jedem Repo: Änderungen committen und pushen (GitHub Desktop: „Commit“, dann „Push origin“). Repos ohne Remote auf GitHub anlegen.' });
    }
    const inCloud = m.repos.filter((r) => r.inCloudRoot);
    if (inCloud.length) {
      add({ id: 'repos.in-cloud', severity: 'warn', task: true, impact: 3, title: inCloud.length + ' Git-Repo(s) liegen in einem Cloud-Ordner', detail: inCloud.map((r) => r.path).slice(0, 3).join(', '), action: 'Repos außerhalb der Cloud ablegen (z. B. C:\\Dev) – Git sichert sie auf GitHub, und Cloud-Sync stört die .git-Dateien.' });
    }
    const nm = m.repos.reduce((a, r) => a + (r.nodeModulesBytes || 0), 0);
    if (nm >= GB) {
      add({ id: 'repos.node-modules', severity: 'info', impact: 2, title: 'node_modules belegt ' + fmtBytes(nm), detail: m.repos.filter((r) => r.nodeModulesBytes > 100 * 1024 * 1024).slice(0, 4).map((r) => r.name + ' (' + fmtBytes(r.nodeModulesBytes) + ')').join(', ') + '.', action: 'In Repos, an denen du länger nicht arbeitest, den Ordner node_modules löschen – „npm ci“ stellt ihn jederzeit wieder her.' });
    }
    return F;
  }
})(typeof window !== 'undefined' ? window : globalThis);
