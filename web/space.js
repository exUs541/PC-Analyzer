/* space.js - "Wo ist der Speicher geblieben?": interprets the storage analysis (space.json: folder sizes of the system drive,
 * several levels deep, delivered by POST /api/scan-space). The scan only measures; everything below decides what it means.
 *
 *   LC.analyzeSpace(raw)  ->  { items[], groups[], used, scanned, small, unreadable, safeBytes, checkBytes, ... }
 *
 * Every folder is explained by the FIRST matching rule of LC.SPACE_RULES (specific rules before general ones):
 *   group   what kind of thing it is (games, dev, cache, cloud, mine, apps, system)
 *   safety  safe  = rebuilds itself / leftovers, can go
 *           check = your decision (a game, a program, your files)
 *           keep  = belongs to Windows
 *   expand  true: not shown as one line; its sub folders are shown (they inherit group/hint unless a rule matches them)
 * The list never counts anything twice: a folder is either shown as a whole or split into its parts (plus "übrige Dateien").
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { GB, asArray } = LC;

  LC.SPACE_GROUPS = [
    { id: 'games', label: 'Spiele', cls: 'g1' },
    { id: 'dev', label: 'Entwicklung', cls: 'g2' },
    { id: 'cache', label: 'Caches & Reste', cls: 'g3' },
    { id: 'cloud', label: 'Cloud-Ordner (lokal gespeichert)', cls: 'g4' },
    { id: 'mine', label: 'Eigene Dateien', cls: 'g5' },
    { id: 'apps', label: 'Programme & Programmdaten', cls: 'g6' },
    { id: 'system', label: 'Windows & System', cls: 'g7' },
    { id: 'other', label: 'Sonstiges', cls: 'soft' },
  ];
  const GROUP_BY_ID = Object.fromEntries(LC.SPACE_GROUPS.map((g) => [g.id, g]));

  const SAFE = 'safe', CHECK = 'check', KEEP = 'keep';
  LC.SPACE_SAFETY = {
    safe: { label: 'unkritisch', sev: 'ok', title: 'Baut sich selbst neu auf oder sind Reste – kann weg.' },
    check: { label: 'du entscheidest', sev: 'info', title: 'Deine Dateien, ein Spiel oder ein Programm – nur wenn du es nicht mehr brauchst.' },
    keep: { label: 'gehört zu Windows', sev: 'ok', title: 'Nicht von Hand löschen.' },
  };

  const last = (o) => o[o.length - 1];
  const re = (r) => (n) => r.test(n);
  const UNITY_HINT = 'Über den Unity Hub → Installationen entfernen. Behalte nur die Version(en), die deine Projekte wirklich nutzen.';

  /** Containers below AppData that are opened up instead of shown as one "program data" line. */
  const APPDATA_CONTAINER = /\\appdata\\(local|roaming)\\(google|nvidia|android|programs|code|godot|microsoft)$/;
  const USER_FOLDER_LABEL = { documents: 'Dokumente', downloads: 'Downloads', desktop: 'Desktop', pictures: 'Bilder', videos: 'Videos', music: 'Musik' };

  /** How the files scan classified a cloud folder: stream | mirror | sync | leftover (old mirror, not synced any more) | null = unknown (no files scan yet). */
  const cloudMode = (env, n) => { const p = env && env.providers.find((x) => x.key === n.key); return p ? p.mode : null; };
  const liveDrive = (env) => env && env.providers.find((x) => x.id === 'gdrive' && x.mode === 'stream');
  const CLOUD_HINT = {
    leftover: (env, n) => {
      const where = liveDrive(env) ? ' (' + liveDrive(env).root + ')' : '';
      const p = env && n ? env.providers.find((x) => x.key === n.key) : null;
      const c = p && p.compare && p.compare.files > 0 ? p.compare : null;
      if (c) {
        const inDrive = c.same.bytes + c.nameSize.bytes;
        const pct = c.bytes > 0 ? Math.round((inDrive / c.bytes) * 100) : 0;
        return 'Dein Drive läuft gestreamt' + where + '. Dieser Ordner ist ein Rest einer früheren Spiegelung. ' + pct + ' % davon (' + LC.fmtBytes(inDrive) + ') liegen unverändert schon im Drive – diese lokale Kopie ist überflüssig. '
          + (c.only.files ? 'Nur ' + c.only.files + ' Dateien (' + LC.fmtBytes(c.only.bytes) + ') fehlen im Drive: erst ins Drive kopieren (Mein PC → Hausordnung zeigt welche), dann den Ordner im Explorer in den Papierkorb legen.' : 'Im Drive fehlt nichts: du kannst den Ordner im Explorer in den Papierkorb legen.')
          + (c.partial ? ' (Der Abgleich wurde wegen der Zeitgrenze abgebrochen – prüfe vor dem Löschen noch einmal.)' : '');
      }
      return 'Dein Drive läuft gestreamt' + where + '. Dieser Ordner ist ein Rest einer früheren Spiegelung: Änderungen hier erreichen die Cloud nicht mehr. Ein neuer Dateien-Scan (Mein PC → Dateien & Cloud) gleicht ihn mit dem Drive ab und zeigt, was dort fehlt. Das Drive-Laufwerk bleibt unberührt.';
    },
    mirror: () => 'Dieser Ordner wird gespiegelt: Alles liegt zusätzlich auf deiner SSD. Stellst du die Cloud-App auf „Dateien streamen“ um, bleibt es in der Cloud und belegt hier fast nichts. Vorher prüfen, dass alles synchronisiert ist.',
    sync: () => 'Dieser Cloud-Ordner liegt komplett auf deiner SSD. Bei OneDrive spart Rechtsklick → „Speicherplatz freigeben“ den Platz (Dateien nur noch online); bei anderen Anbietern „nur online“/Streaming einschalten. Vorher prüfen, dass alles synchronisiert ist.',
    stream: () => 'Ordner einer Cloud-App im Streaming-Modus. Belegt nur Platz für Dateien, die du offline verfügbar gemacht hast.',
    unknown: () => 'Ordner einer Cloud-App. Ob er noch synchronisiert wird, zeigt „Dateien & Cloud“ nach einem Dateien-Scan. Läuft dein Drive bereits als Laufwerk (z. B. G:), ist ein Ordner „My Drive“ im Benutzerordner meist ein alter Rest einer früheren Spiegelung, der nicht mehr synchronisiert wird.',
  };

  LC.SPACE_RULES = [
    /* ---- Windows & system */
    { id: 'windows-old', test: re(/^[a-z]:\\windows\.old$/), group: 'system', safety: SAFE, label: () => 'Windows.old (alte Windows-Version)',
      hint: 'Reste der vorherigen Windows-Version. Einstellungen → System → Speicher → Temporäre Dateien → „Vorherige Windows-Installation“ entfernen.' },
    { id: 'winsxs', test: re(/^[a-z]:\\windows\\winsxs$/), group: 'system', safety: KEEP, label: () => 'Windows-Komponentenspeicher (WinSxS)',
      hint: 'Gehört zu Windows und wird nicht von Hand gelöscht. Der angezeigte Wert ist größer als der echte Verbrauch (Hardlinks). Etwas Platz gibt die Datenträgerbereinigung („Windows-Update-Bereinigung“) frei.' },
    { id: 'win-installer', test: re(/^[a-z]:\\windows\\installer$/), group: 'system', safety: KEEP, label: () => 'Windows-Installer-Cache',
      hint: 'Wird zum Reparieren und Deinstallieren von Programmen gebraucht. Nicht löschen.' },
    { id: 'driverstore', test: re(/^[a-z]:\\windows\\system32\\driverstore$/), group: 'system', safety: KEEP, label: () => 'Treiberspeicher (DriverStore)',
      hint: 'Treiberpakete von Windows. Alte Versionen entfernt die Datenträgerbereinigung („Gerätetreiberpakete“).' },
    { id: 'wu-download', test: re(/^[a-z]:\\windows\\softwaredistribution\\download$/), group: 'cache', safety: SAFE, label: () => 'Windows-Update-Downloads',
      hint: 'Heruntergeladene Update-Dateien. Die Datenträgerbereinigung räumt sie auf.' },
    { id: 'win-temp', test: re(/^[a-z]:\\windows\\temp$/), group: 'cache', safety: SAFE, label: () => 'Temporäre Dateien (Windows)',
      hint: 'Einstellungen → System → Speicher → Temporäre Dateien.' },

    /* ---- caches and leftovers */
    { id: 'user-temp', test: re(/\\appdata\\local\\temp$/), group: 'cache', safety: SAFE, label: () => 'Temporäre Dateien (Benutzer)',
      hint: 'Einstellungen → System → Speicher → Temporäre Dateien → entfernen. Dateien laufender Programme bleiben erhalten.' },
    { id: 'shader-cache', test: re(/\\appdata\\local\\(nvidia\\(dxcache|glcache)|d3dscache|amd\\(dxcache|glcache))$/), group: 'cache', safety: SAFE, label: (o) => 'Grafik-Shader-Cache (' + o.slice(-2).join('\\') + ')',
      hint: 'Zwischenspeicher der Grafiktreiber. Baut sich beim nächsten Spielstart neu auf (kurz mehr Ruckeln möglich).' },
    { id: 'browser-ai-model', test: re(/\\optguideondevicemodel$/), group: 'cache', safety: SAFE, label: () => 'Browser: lokales KI-Modell',
      hint: 'Vom Browser geladenes KI-Modell. In den Browser-Einstellungen unter „System“ die lokale KI abschalten; der Browser entfernt es dann selbst.' },
    { id: 'browser-profile', test: re(/\\(google\\chrome( beta)?|microsoft\\edge|bravesoftware\\brave-browser)\\user data\\(default|profile \d+)$/), group: 'apps', safety: CHECK, label: (o) => o[o.length - 3] + '-Profil: ' + last(o),
      hint: 'Browser-Profil mit Verlauf, Cache und Erweiterungen. Cache leeren: Browser → Einstellungen → Datenschutz → Browserdaten löschen („Bilder und Dateien im Cache“). Ungenutzte Profile entfernst du im Profilmenü des Browsers.' },
    { id: 'gradle', test: re(/\\\.gradle$/), group: 'cache', safety: SAFE, label: () => 'Gradle-Cache',
      hint: 'Heruntergeladene Bibliotheken und Build-Zwischenstände. Baut sich beim nächsten Build neu auf (der erste dauert dann länger).' },
    { id: 'nuget', test: re(/\\\.nuget\\packages$/), group: 'cache', safety: SAFE, label: () => 'NuGet-Paketcache',
      hint: 'Heruntergeladene .NET-Pakete. Werden beim nächsten Build neu geladen.' },
    { id: 'npm-cache', test: re(/\\appdata\\local\\npm-cache$/), group: 'cache', safety: SAFE, label: () => 'npm-Cache',
      hint: 'Im Terminal: npm cache clean --force. Pakete werden bei Bedarf neu geladen.' },
    { id: 'playwright', test: re(/\\appdata\\local\\ms-playwright$/), group: 'cache', safety: SAFE, label: () => 'Playwright-Testbrowser',
      hint: 'Mit „npx playwright install“ jederzeit wieder ladbar.' },
    { id: 'vscode-vsix', test: re(/\\appdata\\roaming\\code\\cachedextensionvsixs$/), group: 'cache', safety: SAFE, label: () => 'VS Code: Erweiterungs-Downloads',
      hint: 'Zwischengespeicherte Installationspakete von Erweiterungen; können gelöscht werden.' },
    { id: 'steam-cache', test: re(/\\steamapps\\(shadercache|downloading|temp)$/), group: 'cache', safety: SAFE, label: (o) => 'Steam: ' + last(o),
      hint: 'Zwischenspeicher von Steam; wird bei Bedarf neu aufgebaut.' },
    { id: 'nvidia-ota', test: re(/\\programdata\\nvidia corporation\\nvidia app\\updateframework\\ota-artifacts$/), group: 'cache', safety: CHECK, label: () => 'NVIDIA App: Update-Reste',
      hint: 'Entpackte Reste früherer Treiber-Updates. Löschen ist unkritisch, die NVIDIA App lädt Neues bei Bedarf. Dafür sind Administratorrechte nötig.' },
    { id: 'package-cache', test: re(/\\programdata\\package cache$/), group: 'cache', safety: CHECK, label: () => 'Installer-Cache (Package Cache)',
      hint: 'Installationspakete, die manche Programme zum Reparieren und Deinstallieren brauchen. Nur mit Vorsicht aufräumen.' },
    { id: '3utools-firmware', test: re(/\\3utoolsv3\\firmware$/), group: 'cache', safety: SAFE, label: () => '3uTools: iPhone-Firmware',
      hint: 'Heruntergeladene iPhone-Firmware-Dateien. Können gelöscht werden; 3uTools lädt bei Bedarf neu.' },

    /* ---- cloud folders in the profile: what they are depends on how the cloud app works (see cloudMode) */
    { id: 'cloud-folder', test: re(/^[a-z]:\\users\\[^\\]+\\(my drive|meine ablage|google drive|onedrive[^\\]*|dropbox|proton drive|icloud drive)$/), group: 'cloud', safety: CHECK,
      label: (o, env, n) => (cloudMode(env, n) === 'leftover' ? 'Alter Drive-Ordner „' + last(o) + '“ (nicht mehr synchronisiert)' : 'Cloud-Ordner „' + last(o) + '“'),
      hint: (o, env, n) => CLOUD_HINT[cloudMode(env, n) || 'unknown'](env, n) },

    /* ---- your own files (opened up: you want to see WHICH folder) */
    { id: 'user-folder', test: re(/^[a-z]:\\users\\[^\\]+\\(documents|downloads|desktop|pictures|videos|music)$/), expand: true, group: 'mine', safety: CHECK, label: (o) => USER_FOLDER_LABEL[last(o).toLowerCase()],
      hint: (o) => (/downloads$/i.test(last(o)) ? 'Alte Installer und Downloads sichten und löschen.' : 'Deine eigenen Dateien. Große alte Dateien in die Cloud auslagern oder löschen.') },

    /* ---- games */
    { id: 'steam-root', test: re(/\\steam$/), expand: true, group: 'games', safety: CHECK, label: () => 'Steam' },
    { id: 'steam-game', test: re(/\\steamapps\\common\\[^\\]+$/), group: 'games', safety: CHECK, label: (o) => last(o) + ' (Steam)',
      hint: 'In Steam deinstallieren (Bibliothek → Rechtsklick → Verwalten → Deinstallieren), wenn du es nicht mehr spielst. Spielstände vorher prüfen.' },
    { id: 'epic-root', test: re(/\\epic games$/), expand: true, group: 'games', safety: CHECK, label: () => 'Epic Games' },
    { id: 'epic-unreal', test: re(/\\epic games\\ue_[^\\]+$/), group: 'dev', safety: CHECK, label: (o) => 'Unreal Engine ' + last(o).slice(3),
      hint: 'Im Epic Games Launcher → Unreal Engine → Bibliothek die Version entfernen, wenn kein Projekt sie braucht.' },
    { id: 'epic-game', test: (n) => /\\epic games\\[^\\]+$/.test(n) && !/\\(launcher|directxredist|epiconlineservices)$/.test(n), group: 'games', safety: CHECK, label: (o) => last(o) + ' (Epic)',
      hint: 'Im Epic Games Launcher deinstallieren, wenn du es nicht mehr nutzt.' },

    /* ---- development */
    { id: 'unity-root', test: re(/\\program files\\unity$/), expand: true, group: 'dev', safety: CHECK, label: () => 'Unity' },
    { id: 'unity-editor', test: re(/\\unity\\hub\\editor\\[^\\]+$/), group: 'dev', safety: CHECK, label: (o) => 'Unity-Editor ' + last(o), hint: UNITY_HINT },
    { id: 'unity-standalone', test: re(/\\program files\\unity [^\\]+$/), group: 'dev', safety: CHECK, label: (o) => 'Unity-Editor ' + last(o).replace(/^unity /i, ''), hint: UNITY_HINT },
    { id: 'unity-hub-data', test: re(/\\appdata\\roaming\\unityhub$/), group: 'dev', safety: CHECK, label: () => 'Unity Hub: Vorlagen & Daten',
      hint: 'Projektvorlagen und Daten des Hubs. Vorlagen lädt der Hub bei Bedarf neu.' },
    { id: 'android-sdk', test: re(/\\appdata\\local\\android\\sdk$/), group: 'dev', safety: CHECK, label: () => 'Android SDK',
      hint: 'Nur nötig, wenn du Android-Apps entwickelst. In Android Studio → SDK Manager lassen sich einzelne Pakete entfernen.' },
    { id: 'android-avd', test: re(/\\\.android\\avd$/), group: 'dev', safety: CHECK, label: () => 'Android-Emulator-Geräte',
      hint: 'Android Studio → Device Manager → nicht genutzte virtuelle Geräte löschen.' },
    { id: 'godot-templates', test: re(/\\appdata\\roaming\\godot\\export_templates$/), group: 'dev', safety: CHECK, label: () => 'Godot: Export-Vorlagen',
      hint: 'Nur für den Export von Spielen nötig; im Godot-Editor jederzeit neu ladbar.' },
    { id: 'visual-studio', test: re(/\\program files\\microsoft visual studio$/), group: 'dev', safety: CHECK, label: () => 'Visual Studio',
      hint: 'Im „Visual Studio Installer“ → Ändern nicht benötigte Workloads abwählen.' },
    { id: 'gemini-data', test: re(/\\\.gemini$/), group: 'dev', safety: CHECK, label: () => 'Gemini / Antigravity-Daten',
      hint: 'Arbeitsdaten und Browserprofil der Antigravity-Umgebung, teils mehrfach gesichert (…-backup, …-ide). Nur nach Prüfen aufräumen.' },

    /* ---- programs (general rules last) */
    { id: 'program-folder', test: re(/^[a-z]:\\program files( \(x86\))?\\[^\\]+$/), group: 'apps', safety: CHECK, label: (o) => last(o),
      hint: 'Installiertes Programm. Wenn du es nicht brauchst: Einstellungen → Apps → Installierte Apps → Deinstallieren (siehe Software-Liste).' },
    { id: 'appdata-app', test: (n) => /\\appdata\\(local|roaming)\\[^\\]+$/.test(n) && !APPDATA_CONTAINER.test(n), group: 'apps', safety: CHECK, label: (o) => last(o) + ' (Programmdaten)',
      hint: 'Daten eines Programms (Cache, Einstellungen). Ist das Programm weg, kann der Ordner weg; sonst im Programm selbst den Cache leeren.' },
  ];

  /** Files in the drive root the scan reports separately. */
  const FILE_RULES = {
    'hiberfil.sys': { safety: CHECK, label: 'Ruhezustandsdatei (hiberfil.sys)',
      hint: 'Speichert den Arbeitsspeicher für Ruhezustand und Schnellstart. Brauchst du beides nicht: Eingabeaufforderung als Administrator → powercfg /hibernate off. Alternativ kleiner, mit Schnellstart: powercfg /h /type reduced.' },
    'pagefile.sys': { safety: KEEP, label: 'Auslagerungsdatei (pagefile.sys)', hint: 'Windows braucht sie als Überlauf für den Arbeitsspeicher. Nicht löschen.' },
    'swapfile.sys': { safety: KEEP, label: 'Swapfile (swapfile.sys)', hint: 'Gehört zu Windows.' },
  };

  const norm = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const segs = (p) => String(p).replace(/\//g, '\\').split('\\').filter(Boolean);
  /** C:\Users\name\… -> ~\… */
  const shortPath = (p) => String(p).replace(/^[A-Za-z]:\\Users\\[^\\]+/i, '~');
  LC.spaceShortPath = shortPath;

  function classify(key, o) {
    for (const r of LC.SPACE_RULES) if (r.test(key, o)) return r;
    return null;
  }

  /** Group and default safety of a folder no rule knows. */
  function fallback(key) {
    if (/^[a-z]:\\windows(\\|$)/.test(key)) return { group: 'system', safety: KEEP, hint: 'Gehört zu Windows.' };
    if (/^[a-z]:\\(program files|programdata)/.test(key) || /\\appdata\\/.test(key)) return { group: 'apps', safety: CHECK, hint: '' };
    if (/^[a-z]:\\users\\[^\\]+\\(documents|downloads|desktop|pictures|videos|music)(\\|$)/.test(key)) return { group: 'mine', safety: CHECK, hint: '' };
    if (/^[a-z]:\\users\\[^\\]+\\\./.test(key)) return { group: 'dev', safety: CHECK, hint: 'Versteckter Ordner eines Entwicklerwerkzeugs (Cache oder Einstellungen).' };
    return { group: 'other', safety: CHECK, hint: '' };
  }

  function findParent(key, byKey) {
    let k = key;
    for (;;) {
      const i = k.lastIndexOf('\\');
      if (i <= 2) return null;          // "c:\name": a top-level folder
      k = k.slice(0, i);
      const p = byKey.get(k);
      if (p) return p;
    }
  }

  /**
   * @param raw   space.json
   * @param opts  { restMinBytes } below this a left-over of a split folder is not listed on its own
   *              { providers }    the cloud folders of the files scan ({root, mode, id}): tells a streamed Drive from an old mirror
   */
  LC.analyzeSpace = (raw, opts) => {
    opts = opts || {};
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) return null;
    const restMin = opts.restMinBytes != null ? opts.restMinBytes : 0.3 * GB;
    const env = { providers: asArray(opts.providers).filter((p) => p && p.root).map((p) => ({ key: norm(p.root), root: p.root, mode: p.mode, id: p.id, compare: p.compare || null })) };

    const nodes = raw.entries.filter((e) => e && e.path && +e.bytes > 0)
      .map((e) => ({ path: String(e.path), key: norm(e.path), bytes: +e.bytes, depth: e.depth || segs(e.path).length - 1, kids: [] }));
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    const top = [];
    for (const n of nodes.slice().sort((a, b) => a.key.length - b.key.length)) {
      const p = findParent(n.key, byKey);
      if (p) p.kids.push(n); else top.push(n);
    }

    const items = [];
    const hintOf = (rule, o, n) => (typeof rule.hint === 'function' ? rule.hint(o, env, n) : rule.hint || '');
    const labelOf = (rule, o, n) => (rule.label ? rule.label(o, env, n) : last(o));
    const byBytes = (a, b) => b.bytes - a.bytes;

    const visit = (n, inh) => {
      const o = segs(n.path);
      const rule = classify(n.key, o);
      if (rule && !rule.expand) {
        items.push({ path: n.path, short: shortPath(n.path), bytes: n.bytes, kind: 'folder', label: labelOf(rule, o, n), group: rule.group, safety: rule.safety, hint: hintOf(rule, o, n), rule: rule.id, depth: n.depth });
        return;
      }
      const ctx = rule ? { group: rule.group, safety: rule.safety, hint: hintOf(rule, o, n), label: labelOf(rule, o, n) } : inh;
      if (!n.kids.length) {
        const fb = ctx || fallback(n.key);
        items.push({ path: n.path, short: shortPath(n.path), bytes: n.bytes, kind: 'folder', label: rule ? ctx.label : last(o), group: fb.group, safety: fb.safety, hint: fb.hint || '', rule: null, depth: n.depth });
        return;
      }
      const sum = n.kids.reduce((a, k) => a + k.bytes, 0);
      n.kids.slice().sort(byBytes).forEach((k) => visit(k, ctx));
      const rest = n.bytes - sum;
      if (rest >= restMin) {
        const fb = ctx || fallback(n.key);
        items.push({ path: n.path, short: shortPath(n.path), bytes: rest, kind: 'rest', label: ((ctx && ctx.label) || last(o)) + ' – übrige Dateien', group: fb.group, safety: fb.safety, hint: 'Lose Dateien und kleinere Ordner direkt in „' + shortPath(n.path) + '“.', rule: null, depth: n.depth });
      }
    };
    top.sort(byBytes).forEach((n) => visit(n, null));

    for (const f of asArray(raw.files)) {
      if (!f || !f.path || !(+f.bytes > 0)) continue;
      const name = segs(f.path).pop();
      const fr = FILE_RULES[name.toLowerCase()];
      items.push({ path: f.path, short: shortPath(f.path), bytes: +f.bytes, kind: 'file', label: fr ? fr.label : name, group: 'system', safety: fr ? fr.safety : KEEP, hint: fr ? fr.hint : 'Große Datei im Hauptordner des Laufwerks.', rule: fr ? name.toLowerCase() : null, depth: 0 });
    }
    items.sort(byBytes);

    const num = (x) => (x == null || Number.isNaN(+x) ? null : +x);
    const total = num(raw.totalBytes), free = num(raw.freeBytes);
    const used = total != null && free != null ? total - free : null;
    const listed = items.reduce((a, i) => a + i.bytes, 0);
    const scanned = num(raw.scannedBytes) != null ? Math.max(num(raw.scannedBytes), listed) : listed;
    const small = Math.max(0, scanned - listed);                       // many small folders and files below the threshold
    const unreadable = used != null ? Math.max(0, used - scanned) : null;   // restore points, Store apps ... (needs administrator rights)

    const groups = LC.SPACE_GROUPS.map((g) => ({ ...g, bytes: 0, count: 0 }));
    for (const i of items) { const g = groups.find((x) => x.id === i.group) || groups[groups.length - 1]; g.bytes += i.bytes; g.count++; }
    const shown = groups.filter((g) => g.bytes > 0).sort((a, b) => b.bytes - a.bytes);

    // the same measurements as a tree: every folder = its listed sub folders + "other files", so every level adds up to the one above
    const itemByKey = new Map(items.filter((i) => i.kind !== 'rest').map((i) => [norm(i.path), i]));
    const build = (n) => {
      const kids = n.kids.slice().sort(byBytes).map(build);
      const rest = Math.max(0, n.bytes - kids.reduce((a, k) => a + k.bytes, 0));
      const it = itemByKey.get(n.key) || null;
      // a folder that holds one big sub folder and (almost) nothing else is shown as one line ("steamapps\common")
      if (!it && kids.length === 1 && rest <= 0.02 * n.bytes) return { ...kids[0], name: last(segs(n.path)) + '\\' + kids[0].name };
      return { path: n.path, key: n.key, name: last(segs(n.path)), short: shortPath(n.path), bytes: n.bytes, kind: 'folder', kids, rest, item: it };
    };
    const fileNodes = items.filter((i) => i.kind === 'file').map((i) => ({ path: i.path, key: norm(i.path), name: last(segs(i.path)), short: shortPath(i.path), bytes: i.bytes, kind: 'file', kids: [], rest: 0, item: i }));
    const rootKids = top.slice().sort(byBytes).map(build).concat(fileNodes).sort(byBytes);
    const tree = { name: raw.root || 'Laufwerk', bytes: used != null ? used : scanned, kids: rootKids, rest: Math.max(0, scanned - rootKids.reduce((a, k) => a + k.bytes, 0)), unreadable: unreadable || 0 };

    const sumWhere = (f) => items.filter(f).reduce((a, i) => a + i.bytes, 0);
    return {
      tree,
      scannedAt: raw.scannedAt || null, seconds: num(raw.seconds), partial: !!raw.partial, root: raw.root || '',
      total, free, used, scanned, listed, small, unreadable, unreadablePaths: asArray(raw.unreadable),
      items, groups: shown,
      safeBytes: sumWhere((i) => i.safety === SAFE),
      checkBytes: sumWhere((i) => i.safety === CHECK),
      cloudBytes: sumWhere((i) => i.group === 'cloud'),
    };
  };

  /** "A (12 GB), B (8 GB), C (5 GB)" for the findings. */
  LC.spaceTopText = (space, n) => (space && space.items.length
    ? space.items.filter((i) => i.kind !== 'rest').slice(0, n || 4).map((i) => i.label + ' (' + LC.fmtBytes(i.bytes) + ')').join(', ')
    : '');
})(typeof window !== 'undefined' ? window : globalThis);
