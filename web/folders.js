/* folders.js - "Inventur": WHERE did this folder come from, and is it still needed?
 * Programs, tools and downloads create folders in places nobody looks at (AppData, hidden profile folders, the top of C:\, Program Files ...).
 * This explains each one - which program it belongs to, when it was last used - and says what to do about it.
 *
 *   LC.analyzeFolders(raw, ctx) -> { items[], totals, afterUninstall[], ... }
 *     raw = files.json (dataDirs + places)
 *     ctx = { apps (inventory), now, removed: [{name, publisher?, removedAt}], cleanupDoc, providers, sizeAt(path) }
 *
 * status   active          the program is installed and the folder was used within a year
 *          idle            the program is installed, but nothing in the folder changed for a year
 *          cache           regenerates by itself (build/package caches, shader caches ...)
 *          leftover        no program needs it any more (not installed / uninstalled / old mirror) - can go
 *          maybe-leftover  no program matches and nothing changed for a year - probably a leftover, check first
 *          unknown         no program matches, but it is recent: find out what it is
 *          kept            you said "keep"
 * action   keep | check | clean      (nothing is ever deleted here: "clean" only suggests the clean-up list, which asks for every item)
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { asArray } = LC;
  const DAY = 86400000;

  /** Tools that leave folders nobody remembers: what they are, whether they regenerate, and which installed program they belong to. */
  LC.FOLDER_TOOLS = [
    { re: /^\.gradle$/i, label: 'Gradle', kind: 'cache', owner: /android studio|intellij|gradle|jetbrains/i, hint: 'Build-Cache von Gradle (Android/Java). Baut sich beim nächsten Build neu auf; der erste Build dauert dann länger.' },
    { re: /^\.android$/i, label: 'Android-Entwicklung', kind: 'data', owner: /android studio|android sdk/i, hint: 'Virtuelle Geräte (avd) und Schlüssel für Android-Entwicklung. Nicht mehr genutzte Geräte in Android Studio → Device Manager löschen.' },
    { re: /^(\.nuget|nuget)$/i, label: 'NuGet', kind: 'cache', owner: /visual studio|\.net|dotnet/i, hint: 'Heruntergeladene .NET-Pakete. Werden beim nächsten Build neu geladen.' },
    { re: /^\.(vscode|vscode-shared|vscode-insiders)$/i, label: 'Visual Studio Code', kind: 'config', owner: /visual studio code/i, hint: 'Erweiterungen und Einstellungen von VS Code.' },
    { re: /^code$/i, label: 'Visual Studio Code', kind: 'config', owner: /visual studio code/i, hint: 'Einstellungen, Verlauf und Zwischenspeicher von VS Code.' },
    { re: /^\.cache$/i, label: 'Gemeinsamer Cache', kind: 'cache', owner: null, hint: 'Gemeinsamer Zwischenspeicher mehrerer Werkzeuge (z. B. Modelle, pip). Baut sich bei Bedarf neu auf.' },
    { re: /^\.{1,2}gemini$|^\.antigravity(-ide|-backup|-browser-profile)?$/i, label: 'Antigravity / Gemini', kind: 'data', owner: /antigravity|gemini/i, hint: 'Arbeitsdaten, Verlauf und Browserprofil der Antigravity-/Gemini-Werkzeuge, teils mehrfach gesichert.' },
    { re: /^\.claude(\.json)?$/i, label: 'Claude Code', kind: 'data', owner: /claude/i, hint: 'Claude Code: Verlauf, Einstellungen, Projekt-Gedächtnis.' },
    { re: /^\.openjfx$/i, label: 'JavaFX', kind: 'cache', owner: /java|openjdk|temurin|jdk/i, hint: 'Zwischenspeicher von JavaFX-Programmen.' },
    { re: /^\.bubblewrap$/i, label: 'Bubblewrap (PWA-Werkzeug)', kind: 'cache', owner: null, hint: 'Kopien von JDK und Android-SDK, die Bubblewrap/PWABuilder lädt. Baut sich neu auf.' },
    { re: /^\.(matplotlib|ipython|jupyter|idlerc)$/i, label: 'Python-Werkzeug', kind: 'config', owner: /python/i, hint: 'Einstellungen von Python-Werkzeugen.' },
    { re: /^\.ollama$/i, label: 'Ollama', kind: 'data', owner: /ollama/i, hint: 'Heruntergeladene KI-Modelle von Ollama (können sehr groß werden).' },
    { re: /^\.(ssh|config|local|dbus-keyrings|prefs)$/i, label: 'Benutzer-Einstellungen', kind: 'config', owner: null, hint: 'Einstellungen und Schlüssel von Werkzeugen. Nicht löschen.' },
    { re: /^\.(dotnet|templateengine|aitk|codeium|copilot|supabase|fop|thumbnails)$/i, label: 'Entwickler-Werkzeug', kind: 'config', owner: null, hint: 'Kleine Einstellungsordner von Entwicklerwerkzeugen.' },
    { re: /^\.(npm|m2|cargo|rustup|pyenv|conda|docker)$/i, label: 'Paket-/Laufzeit-Cache', kind: 'cache', owner: null, hint: 'Pakete und Laufzeiten eines Entwicklerwerkzeugs. Werden bei Bedarf neu geladen.' },
    { re: /^local$/i, label: 'Local (WordPress)', kind: 'data', owner: /^local\b|flywheel/i, hint: 'Programmdaten von „Local“ (lokale WordPress-Seiten).' },
    { re: /^(anthropicclaude|claude)$/i, label: 'Claude (Desktop-App)', kind: 'data', owner: /claude/i, hint: 'Programm und Daten der Claude-Desktop-App.' },
    { re: /^microsoft vs code$/i, label: 'Visual Studio Code', kind: 'config', owner: /visual studio code/i, hint: 'Installationsordner von VS Code.' },
    { re: /^dotnet$/i, label: '.NET', kind: 'data', owner: /\.net|dotnet/i, hint: '.NET-Laufzeiten und SDKs.' },
    { re: /^java$/i, label: 'Java', kind: 'cache', owner: /java|openjdk|temurin|jdk/i, hint: 'Zwischenspeicher und Einstellungen von Java.' },
    { re: /^msi$/i, label: 'MSI Center', kind: 'data', owner: /\bmsi\b/i, hint: 'Programmdaten der MSI-Software.' },
    { re: /^npm-cache$/i, label: 'npm', kind: 'cache', owner: /node\.?js/i, hint: 'Im Terminal: npm cache clean --force. Pakete werden bei Bedarf neu geladen.' },
    { re: /^npm$/i, label: 'npm', kind: 'config', owner: /node\.?js/i, hint: 'Globale npm-Pakete und Einstellungen.' },
    { re: /^ms-playwright(-go)?$/i, label: 'Playwright', kind: 'cache', owner: null, hint: 'Testbrowser; mit „npx playwright install“ jederzeit wieder ladbar.' },
    { re: /^pip$/i, label: 'pip', kind: 'cache', owner: /python/i, hint: 'Zwischenspeicher von pip (Python-Pakete). Baut sich neu auf.' },
    { re: /^(godot|godot-tools)$/i, label: 'Godot', kind: 'data', owner: /godot/i, hint: 'Godot-Editor: Export-Vorlagen und Einstellungen.' },
    { re: /^unity(hub)?$/i, label: 'Unity', kind: 'data', owner: /unity/i, hint: 'Unity Hub: Vorlagen, Lizenz- und Hub-Daten.' },
    { re: /^squirreltemp$/i, label: 'Installer-Zwischenordner', kind: 'cache', owner: null, hint: 'Zwischenordner von Installern (Squirrel). Bleibt oft liegen.' },
    { re: /^local sites$/i, label: 'Local (WordPress)', kind: 'data', owner: /^local\b|flywheel/i, hint: 'Lokale WordPress-Seiten von „Local“.' },
    { re: /^librepcb-workspace$/i, label: 'LibrePCB', kind: 'data', owner: /librepcb/i, hint: 'Arbeitsbereich von LibrePCB (Platinen-Projekte).' },
    { re: /^easyeda-data$/i, label: 'EasyEDA', kind: 'data', owner: /easyeda/i, hint: 'Projektdaten von EasyEDA.' },
    { re: /^mono$/i, label: 'Mono', kind: 'data', owner: /\bmono\b/i, hint: 'Mono-Laufzeit. Wird nur von sehr wenigen Programmen gebraucht.' },
    { re: /^battlestate games$/i, label: 'Escape from Tarkov (Launcher)', kind: 'data', owner: /battlestate|tarkov/i, hint: 'Ordner des Tarkov-Launchers.' },
    { re: /^lc-org-demo$/i, label: 'LaptopCheck-Testrest', kind: 'leftover', owner: null, hint: 'Übrig geblieben vom Test der Funktion „Ordnen“ in LaptopCheck. Kann weg.' },
    { re: /^(temp|tmp)$/i, label: 'Temporärer Ordner', kind: 'cache', owner: null, hint: 'Temporäre Dateien. Kann geleert werden, wenn nichts läuft.' },
  ];

  const WHERE = { LocalAppData: 'AppData\\Local', AppData: 'AppData\\Roaming', ProgramData: 'ProgramData', UserProfile: 'Benutzerordner (versteckt)',
    RootC: 'Hauptordner von C:\\', ProgramFiles: 'Programme', LocalPrograms: 'AppData\\Local\\Programs', LocalLow: 'AppData\\LocalLow', UserFolder: 'Benutzerordner' };
  LC.FOLDER_WHERE = WHERE;

  const IS_PROGRAM_PLACE = new Set(['ProgramFiles', 'LocalPrograms']);
  const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
  const normP = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const timeOf = (iso) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? null : t; };

  function installedApp(apps, re) { return apps.find((a) => re.test(a.name)) || null; }

  /** Who does this folder belong to? -> { name, installed: true|false|null, via, hint?, kind?, app?, shared?, conf, removedAt? } | null */
  function ownerOf(e, apps, ctx) {
    const nameTool = LC.FOLDER_TOOLS.find((t) => t.re.test(e.name));
    if (nameTool) {
      const app = nameTool.owner ? installedApp(apps, nameTool.owner) : null;
      return { name: nameTool.label, installed: nameTool.owner ? !!app : null, via: 'tool', kind: nameTool.kind, hint: nameTool.hint, app, conf: 'sicher' };
    }
    const kb = asArray(LC.RELATIONS).find((r) => asArray(r.data).some((re) => re.test(e.name)));
    if (kb) {
      const app = apps.find((a) => kb.re.test(a.name)) || null;
      return { name: app ? app.name : cap(kb.id), installed: !!app, via: 'kb', shared: !!kb.sharedData, app, conf: 'wahrscheinlich' };
    }
    // the program's own install folder (Program Files, AppData\Local\Programs)
    const p = normP(e.path);
    const byRoot = apps.find((a) => a.match && asArray(a.match.roots).some((r) => r && (p === r || p.startsWith(r + '\\') || r.startsWith(p + '\\'))));
    if (byRoot) return { name: byRoot.name, installed: true, via: 'root', app: byRoot, conf: 'sicher' };
    // exact name of an installed program, even a short or "generic" one (Git, Local)
    const dc = LC.compact(e.name);
    if (dc.length >= 3) {
      const exact = apps.find((a) => LC.compact(LC.coreName(a.name)) === dc);
      if (exact) return { name: exact.name, installed: true, via: 'name', app: exact, conf: 'wahrscheinlich' };
    }
    // vendor folders (NVIDIA, Microsoft, Intel, Google ...): they belong to every installed program of that publisher and are never "leftovers"
    const dp = LC.pubCompact(e.name);
    if (dp.length >= 3) {
      const vendorApp = apps.find((a) => { const ap = LC.pubCompact(a.publisher); return ap.length >= 3 && (ap === dp || (dp.length >= 4 && ap.startsWith(dp))); });
      if (vendorApp) return { name: 'Programme von ' + (vendorApp.publisher || e.name), installed: true, via: 'vendor', app: vendorApp, shared: true, conf: 'wahrscheinlich' };
    }
    // by name / publisher of an installed program
    for (const a of apps) {
      const m = LC.dirNameMatch(e.name, a);
      if (m && m.via === 'name') return { name: a.name, installed: true, via: 'name', app: a, conf: m.conf };
    }
    for (const a of apps) {
      const m = LC.dirNameMatch(e.name, a);
      if (m) return { name: a.name + ' (Herausgeber)', installed: true, via: 'publisher', app: a, shared: true, conf: m.conf };
    }
    // a program that was uninstalled since LaptopCheck has been watching
    for (const r of asArray(ctx.removed)) {
      if (LC.dirNameMatch(e.name, { name: r.name, publisher: r.publisher })) return { name: r.name, installed: false, via: 'removed', removedAt: r.removedAt || null, conf: 'sicher' };
    }
    return null;
  }

  /** @returns the inventory model, or null without a files scan */
  LC.analyzeFolders = (raw, ctx) => {
    ctx = ctx || {};
    if (!raw || typeof raw !== 'object' || (!Array.isArray(raw.dataDirs) && !Array.isArray(raw.places))) return null;
    const now = ctx.now ? new Date(ctx.now).getTime() : Date.now();
    const apps = asArray(ctx.apps);
    const doc = ctx.cleanupDoc && ctx.cleanupDoc.items ? ctx.cleanupDoc : null;
    const leftoverRoots = asArray(ctx.providers).filter((p) => p && p.mode === 'leftover').map((p) => normP(p.root));

    const seen = new Set();
    const entries = [];
    for (const e of asArray(raw.dataDirs).concat(asArray(raw.places))) {
      if (!e || !e.path) continue;
      const k = normP(e.path);
      if (seen.has(k)) continue;
      seen.add(k);
      entries.push(e);
    }

    const items = entries.map((e) => {
      const key = normP(e.path);
      const rec = doc ? doc.items[LC.cleanup.pathId(e.path)] : null;
      const lastIso = e.newest || e.modified || null;
      const lastMs = timeOf(lastIso);
      const ageDays = lastMs != null ? Math.max(0, Math.floor((now - lastMs) / DAY)) : null;
      const createdMs = timeOf(e.created);
      const createdDays = createdMs != null ? Math.max(0, Math.floor((now - createdMs) / DAY)) : null;
      let bytes = +e.bytes || 0;
      const isLeftoverMirror = leftoverRoots.includes(key);
      if (isLeftoverMirror && e.partial && ctx.sizeAt) { const s = ctx.sizeAt(e.path); if (s != null) bytes = s; }
      const owner = isLeftoverMirror ? { name: 'Google Drive (alter Spiegel)', installed: false, via: 'provider', conf: 'sicher', hint: 'Rest der früheren Spiegelung: prüfen, in „… (alt)“ umbenennen und selbst löschen (siehe Aufgabe „Alter Google-Drive-Ordner“). Das Tool löscht Cloud-Ordner nie selbst.' } : ownerOf(e, apps, ctx);
      const program = IS_PROGRAM_PLACE.has(e.where);

      let status, conf = 'möglich';
      const why = [];
      // the program of this folder is missing from the program list: judged by how recently the folder was used. A program can be portable or
      // installed from the command line, so a folder used this week is NOT a leftover; only a folder untouched for a year (or more) is.
      const missingProgram = (kind, recent) => {
        if (ageDays != null && ageDays <= 90) {
          status = recent || (kind === 'cache' ? 'cache' : 'active'); conf = 'möglich';
          if (status === 'active') why.push('Das Programm steht nicht in der Programmliste (portabel oder per Kommandozeile installiert?), aber der Ordner wird benutzt.');
        } else if (ageDays != null && ageDays <= 365) { status = 'maybe-leftover'; conf = 'möglich'; }
        else if (ageDays != null) { status = 'leftover'; conf = 'wahrscheinlich'; }
        else { status = 'maybe-leftover'; conf = 'möglich'; }
      };
      const usedOrIdle = () => (ageDays != null && ageDays > 365 ? 'idle' : 'active');
      if (rec && rec.state === 'kept') { status = 'kept'; why.push('Du hast „Behalten“ gewählt.'); }
      else if (owner && owner.via === 'provider') { status = 'leftover'; conf = 'sicher'; why.push('Dein Drive läuft gestreamt; dieser Ordner ist ein Rest der früheren Spiegelung und wird nicht mehr synchronisiert.'); }
      else if (owner && owner.via === 'removed') { status = 'leftover'; conf = 'sicher'; why.push('„' + owner.name + '“ wurde deinstalliert' + (owner.removedAt ? ' (' + LC.fmtDate(owner.removedAt) + ')' : '') + '.'); }
      else if (owner && owner.via === 'tool') {
        why.push('Gehört zu ' + owner.name + (owner.installed === true ? ' (installiert).' : owner.installed === false ? ' – das Programm steht nicht in der Programmliste.' : '.'));
        if (owner.kind === 'leftover') { status = 'leftover'; conf = 'sicher'; }
        else if (owner.installed === false) missingProgram(owner.kind);
        else if (owner.kind === 'cache') { status = 'cache'; conf = 'sicher'; }
        else status = usedOrIdle();
      } else if (owner && owner.via === 'kb' && !owner.installed) {
        why.push('Gehört zu „' + owner.name + '“ – das Programm steht nicht in der Programmliste.');
        if (owner.shared) { status = 'maybe-leftover'; conf = 'möglich'; } else missingProgram('data');
      } else if (owner && owner.via === 'vendor') {
        why.push('Ordner des Herstellers – gehört zu seinen installierten Programmen (' + owner.name.replace(/^Programme von /, '') + ').');
        status = usedOrIdle(); conf = 'wahrscheinlich';
      } else if (owner) {
        why.push((owner.via === 'root' ? 'Installationsordner von „' : 'Name passt zu „') + owner.name.replace(/ \(Herausgeber\)$/, '') + '“ (installiert).');
        status = usedOrIdle();
        conf = owner.conf;
      } else if (program) {
        why.push('Programmordner, zu dem kein installiertes Programm gehört.');
        missingProgram('data', 'unknown');
      } else {
        why.push('Kein installiertes Programm passt zu diesem Ordner.');
        status = ageDays != null && ageDays >= 365 ? 'maybe-leftover' : 'unknown';
      }
      if (ageDays != null) why.push('Zuletzt etwas darin geändert: vor ' + (ageDays === 0 ? 'weniger als einem Tag' : ageDays + (ageDays === 1 ? ' Tag' : ' Tagen')) + '.');
      if (createdDays != null && createdDays > 1) why.push('Angelegt am ' + LC.fmtDate(e.created) + '.');
      if (e.partial) why.push('Größe mindestens (Messung nach Zeitlimit beendet).');

      const action = status === 'active' || status === 'kept' ? 'keep' : status === 'cache' || status === 'leftover' ? 'clean' : 'check';
      const hintTail = {
        active: 'Wird benutzt – behalten.', idle: 'Das Programm ist da, aber in diesem Ordner hat sich seit über einem Jahr nichts getan. Brauchst du das Programm noch?',
        cache: 'Unkritisch: baut sich bei Bedarf selbst neu auf.', leftover: 'Wird nicht mehr gebraucht – kann auf die Aufräumliste.',
        'maybe-leftover': 'Vermutlich ein Rest. Schau kurz hinein, bevor du ihn aufräumst.', unknown: 'Unbekannt: schau, was darin liegt, bevor du entscheidest.', kept: '',
      }[status];
      return {
        id: LC.cleanup.pathId(e.path), path: e.path, short: LC.spaceShortPath ? LC.spaceShortPath(e.path) : e.path, name: e.name, where: e.where, whereLabel: WHERE[e.where] || e.where,
        bytes, partial: !!e.partial, created: e.created || null, last: lastIso, ageDays, createdDays,
        owner, status, conf, action, why, hint: [owner && owner.hint, owner && owner.via === 'provider' ? '' : hintTail].filter(Boolean).join(' '),
        marked: !!(rec && ['marked', 'confirmed', 'started'].includes(rec.state)), kept: !!(rec && rec.state === 'kept'),
      };
    }).sort((a, b) => b.bytes - a.bytes);

    const STATUSES = ['active', 'idle', 'cache', 'leftover', 'maybe-leftover', 'unknown', 'kept'];
    const by = Object.fromEntries(STATUSES.map((s) => [s, items.filter((i) => i.status === s)]));
    const sum = (arr) => arr.reduce((a, i) => a + i.bytes, 0);
    const totals = {
      count: items.length, bytes: sum(items),
      counts: Object.fromEntries(STATUSES.map((s) => [s, by[s].length])), sizes: Object.fromEntries(STATUSES.map((s) => [s, sum(by[s])])),
      reclaimableBytes: sum(by.leftover) + sum(by.cache),                 // can go without further thought (each still needs your confirmation)
      checkBytes: sum(by['maybe-leftover']) + sum(by.unknown) + sum(by.idle),
    };
    return {
      scannedAt: raw.scannedAt || null, items, by, totals,
      afterUninstall: items.filter((i) => i.owner && i.owner.via === 'removed'),   // what the programs you removed left behind
      hasPlaces: Array.isArray(raw.places),
    };
  };

  /** Tasks for "Aufgaben": what the programs you removed left behind, what can go, what to look at. */
  LC.folderFindings = (fm) => {
    const F = [];
    const { fmtBytes } = LC;
    const sum = (arr) => arr.reduce((a, i) => a + i.bytes, 0);
    const list = (arr, n) => arr.slice(0, n).map((i) => i.name + ' (' + fmtBytes(i.bytes) + ')').join(', ') + (arr.length > n ? ' …' : '');
    const open = (i) => !i.marked && !i.kept;
    const after = fm.afterUninstall.filter((i) => i.status === 'leftover' && open(i));
    if (after.length) {
      F.push({ id: 'folders.after-uninstall', area: 'folders', severity: 'info', task: true, impact: 3,
        title: 'Reste deinstallierter Programme: ' + after.length + (after.length === 1 ? ' Ordner' : ' Ordner') + ' (' + fmtBytes(sum(after)) + ')',
        detail: list(after, 4) + '. Diese Programme hast du entfernt; ihre Daten liegen noch auf dem PC.',
        action: 'Unter „Mein PC → Inventur“ ansehen und auf die Aufräumliste setzen.' });
    }
    const goes = fm.items.filter((i) => (i.status === 'leftover' || i.status === 'cache') && open(i) && !(i.owner && (i.owner.via === 'provider' || i.owner.via === 'removed')));
    if (sum(goes) >= 1024 ** 3) {
      F.push({ id: 'folders.reclaimable', area: 'folders', severity: 'info', task: true, impact: 3,
        title: 'Inventur: ca. ' + fmtBytes(sum(goes)) + ' Reste und Caches können weg',
        detail: list(goes, 4) + '. Caches bauen sich selbst neu auf; Reste gehören zu Programmen, die es nicht mehr gibt.',
        action: 'Unter „Mein PC → Inventur“ prüfen und auf die Aufräumliste setzen (jedes Objekt bestätigst du einzeln).' });
    }
    const look = fm.items.filter((i) => (i.status === 'unknown' || i.status === 'maybe-leftover') && open(i));
    if (sum(look) >= 500 * 1024 ** 2) {
      F.push({ id: 'folders.unknown', area: 'folders', severity: 'info', task: true, impact: 2,
        title: look.length + ' unbekannte Ordner (' + fmtBytes(sum(look)) + ') – woher kommen die?',
        detail: list(look, 4) + '. Kein installiertes Programm passt dazu.',
        action: 'Unter „Mein PC → Inventur“ nachsehen: behalten oder aufräumen.' });
    }
    return F;
  };
})(typeof window !== 'undefined' ? window : globalThis);
