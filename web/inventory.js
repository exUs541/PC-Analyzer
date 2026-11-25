/* inventory.js - turns the raw snapshot into the software inventory:
 *   - normalises paths and joins "usage evidence" (UserAssist, Prefetch, ...) to programs
 *   - matches autostart entries and winget updates to programs
 *   - merges the user's manual entries (notes.apps) over the automatic values
 *   - derives a recommendation per program
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});

  /* ------------------------------------------------------------------ paths */

  const KNOWN_FOLDERS = {
    '6D809377-6AF0-444B-8957-A3773F02200E': '\\program files',
    '905E63B6-C1BF-494E-B29C-65B732D3D21A': '\\program files',
    '7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E': '\\program files (x86)',
    '1AC14E77-02E7-4E5D-B744-2EB1AE5198B7': '\\windows\\system32',
    'D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27': '\\windows\\syswow64',
    'F38BF404-1D43-42F2-9305-67DE0B28FC23': '\\windows',
    'F1B32785-6FBA-4FCF-9D55-7B8E7F157091': '\\users\\*\\appdata\\local',
    '3EB685DB-65F9-4CF6-A03A-E3EF65729F3D': '\\users\\*\\appdata\\roaming',
    '62AB5D82-FDC1-4DC3-A9DD-070D1D495D97': '\\programdata',
    'FDD39AD0-238F-46AF-ADB4-6C85480369C7': '\\users\\*\\documents',
    '374DE290-123F-4565-9164-39C4925E467B': '\\users\\*\\downloads',
    'B4BFCC3A-DB2C-424C-B029-7FE99A87C641': '\\users\\*\\desktop',
    '0139D44E-6AFE-49F2-8690-3DAFCAE6FFB8': '\\programdata\\microsoft\\windows\\start menu\\programs',
    'A77F5D77-2E2B-44C3-A6A2-ABA601054A51': '\\users\\*\\appdata\\roaming\\microsoft\\windows\\start menu\\programs',
    '5E6C858F-0E22-4760-9AFE-EA3317B67173': '\\users\\*',
    'DFDF76A2-C82A-4D63-906A-5644AC457385': '\\users\\public',
    '9E3995AB-1F9C-4F13-B827-48B24B6C7174': '\\users\\*\\appdata\\roaming\\microsoft\\internet explorer\\quick launch\\user pinned',
  };

  /** Canonical, drive-less, lower-case path; known-folder GUIDs and env vars expanded; user name -> "*". */
  LC.normPath = (p) => {
    let s = String(p == null ? '' : p).trim();
    s = s.replace(/,\s*-?\d+$/, '').trim();            // icon index: "C:\\x\\app.exe",0
    s = s.replace(/^"+|"+$/g, '');
    if (!s) return '';
    s = s.replace(/\//g, '\\').toLowerCase();
    s = s.replace(/^\{([0-9a-f-]{36})\}/, (m, g) => KNOWN_FOLDERS[g.toUpperCase()] || m);
    s = s
      .replace(/%programfiles\(x86\)%/g, '\\program files (x86)')
      .replace(/%(programfiles|programw6432)%/g, '\\program files')
      .replace(/%(systemroot|windir)%/g, '\\windows')
      .replace(/%localappdata%/g, '\\users\\*\\appdata\\local')
      .replace(/%appdata%/g, '\\users\\*\\appdata\\roaming')
      .replace(/%programdata%/g, '\\programdata')
      .replace(/%userprofile%/g, '\\users\\*');
    s = s.replace(/^[a-z]:/, '');
    s = s.replace(/^\\users\\(?!\*\\|public\\)[^\\]+\\/, '\\users\\*\\');
    s = s.replace(/\\{2,}/g, '\\').replace(/\\$/, '');
    return s;
  };
  const dirname = (p) => p.slice(0, Math.max(0, p.lastIndexOf('\\')));
  const basename = (p) => p.slice(p.lastIndexOf('\\') + 1);
  const depth = (p) => p.split('\\').filter(Boolean).length;
  const GENERIC_DIRS = new Set(['\\program files', '\\program files (x86)', '\\windows', '\\windows\\system32', '\\windows\\syswow64', '\\programdata', '\\users\\*', '\\users\\public']);
  const isGenericDir = (d) =>
    !d || depth(d) < 2 || GENERIC_DIRS.has(d) ||
    /^\\users\\\*\\appdata\\(local|roaming)(\\programs)?$/.test(d) ||
    /^\\program files( \(x86\))?\\(common files|windowsapps|windows nt|internet explorer|installshield installation information)/.test(d) ||
    /^\\windows\\(installer|temp|winsxs)/.test(d) ||
    /^\\programdata\\package cache/.test(d);

  /** First .exe path of a command line (uninstall string, Run entry). */
  LC.exeFromCommand = (cmd) => {
    const s = String(cmd || '').trim();
    if (!s) return '';
    let m = s.match(/^"([^"]+?\.exe)"/i);
    if (m) return LC.normPath(m[1]);
    m = s.match(/^([a-z]:\\[^"]*?\.exe)\b/i) || s.match(/^(%[^%]+%[^"]*?\.exe)\b/i);
    if (m) return LC.normPath(m[1]);
    m = s.match(/^([^\s"]+\.exe)\b/i);
    return m ? LC.normPath(m[1]) : '';
  };

  /* ------------------------------------------------------------------ names */

  /** Display name without version, architecture and "update N" noise - the stable identity of a program. */
  LC.coreName = (name) =>
    LC.norm(name)
      .replace(/\b(version|ver\.?|v)\s*\d[\w.]*/g, ' ')
      .replace(/\b\d+(\.\d+)+([-+.\w]*)?/g, ' ')
      .replace(/\b(update|upd)\s*\d+\b/g, ' ')
      .replace(/\b(x64|x86|64-bit|32-bit|64 bit|32 bit|amd64|arm64|win64|win32)\b/g, ' ')
      .replace(/\s+(de|en|en-us|de-de|en-gb|fr|es|it|nl|pl)$/, '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–]+|[\s\-–]+$/g, '');

  const NAME_JUNK = /update|setup|install|uninstall|driver|runtime|redistributable|sdk|tools|helper|service|component|extension|plugin|addon|language|pack|launcher|crash/;
  /** Do two core names denote the same program? */
  const nameMatch = (a, b) => {
    const x = LC.compact(a);
    const y = LC.compact(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [s, l] = x.length <= y.length ? [x, y] : [y, x];
    if (s.length < 6) return false;
    const rest = l.startsWith(s) ? l.slice(s.length) : l.endsWith(s) ? l.slice(0, l.length - s.length) : null;
    if (rest == null) return false;
    return !NAME_JUNK.test(rest);
  };

  LC.appKey = (app) => {
    if (app.source === 'store' && app.packageName) return 'store:' + String(app.packageName).toLowerCase();
    return LC.coreName(app.name) + '|' + LC.norm(app.publisher || '');
  };

  /* ------------------------------------------------------------------ evidence */

  const NOISE_EXE = /(update|updater|upgrade|unins\w*|uninstall|setup|install\w*|helper|crashpad|crashreport|bugreport|maintenance|service|svc|agent|notifier|telemetry|watchdog|elevat\w*|msiexec|conhost|cmd|powershell|rundll32|regsvr32|explorer)\.exe$|^(update|setup)\.exe$/i;
  const GENERIC_SEG = new Set(['microsoft', 'common files', 'windows', 'windowsapps', 'program', 'programs', 'application', 'app', 'bin', 'x64', 'x86', 'win64', 'win32', 'system32', 'syswow64', 'update', 'updater', 'installer', 'setup', 'google', 'adobe', 'apple', 'intel', 'nvidia corporation', 'amd', 'current', 'latest', 'release', 'resources', 'core', 'client', 'main']);

  function folderToken(pathN) {
    const m = pathN.match(/^\\(?:program files(?: \(x86\))?|users\\\*\\appdata\\local(?:\\programs)?)\\(.+)\\[^\\]+$/);
    if (!m) return null;
    const segs = m[1].split('\\').slice(0, 2);
    for (let i = segs.length - 1; i >= 0; i--) {
      if (GENERIC_SEG.has(segs[i])) continue;
      const t = LC.compact(segs[i]);
      if (t.length >= 4) return t;
    }
    return null;
  }

  function prepareEvidence(snap) {
    return LC.asArray(snap.usage).map((e) => {
      const raw = String(e.path || '');
      const isAumid = raw.includes('!') && !raw.includes('\\');
      const pathN = isAumid ? null : LC.normPath(raw);
      const exe = pathN ? basename(pathN) : null;
      return {
        source: e.source,
        raw,
        pathN,
        exe,
        isAumid,
        pfn: isAumid ? raw.split('!')[0].toLowerCase() : null,
        isLnk: !!pathN && /\.lnk$/.test(pathN),
        lastRun: e.lastRun || null,
        lastMs: e.lastRun ? Date.parse(e.lastRun) || null : null,
        runCount: e.runCount == null ? null : +e.runCount,
        focusSec: e.focusSec == null ? null : +e.focusSec,
        noise: !!exe && NOISE_EXE.test(exe),
      };
    });
  }

  function prepareShortcuts(snap) {
    return LC.asArray(snap.shortcuts).map((s) => ({
      core: LC.coreName(s.name),
      pathN: LC.normPath(s.path),
      targetN: s.target ? LC.normPath(s.target) : '',
    }));
  }

  function buildMatcher(app, kb, shortcuts) {
    const roots = new Set();
    const exact = new Set();
    const names = new Set();
    const lnkPaths = new Set();
    const addRoot = (d) => { if (!isGenericDir(d)) roots.add(d); };
    const addExe = (p) => {
      if (!/\.exe$/.test(p)) return;
      exact.add(p);
      if (!NOISE_EXE.test(basename(p))) names.add(basename(p));
      addRoot(dirname(p));
    };
    if (app.installLocation) addRoot(LC.normPath(app.installLocation));
    if (app.displayIcon) addExe(LC.normPath(app.displayIcon));
    const un = LC.exeFromCommand(app.uninstallString);
    if (un && !/\\(msiexec|rundll32)\.exe$/.test(un)) addRoot(dirname(un));
    const core = LC.coreName(app.name);
    for (const sc of shortcuts) {
      if (!nameMatch(core, sc.core)) continue;
      lnkPaths.add(sc.pathN);
      if (sc.targetN) addExe(sc.targetN);
    }
    for (const x of kb.exes || []) names.add(x.toLowerCase());
    return { core, compact: LC.compact(core), roots, exact, names, lnkPaths, pfn: app.packageFamily ? String(app.packageFamily).toLowerCase() : null };
  }

  /** @returns {'high'|'medium'|null} */
  function matchEvidence(e, m) {
    if (e.pfn) return m.pfn && e.pfn === m.pfn ? 'high' : null;
    if (!e.pathN) return null;
    if (e.isLnk) {
      if (m.lnkPaths.has(e.pathN)) return 'high';
      const title = LC.coreName(basename(e.pathN).replace(/\.lnk$/, ''));
      return nameMatch(m.core, title) ? 'medium' : null;
    }
    if (m.exact.has(e.pathN)) return 'high';
    if (e.noise) return null;
    for (const r of m.roots) if (e.pathN.startsWith(r + '\\')) return 'high';
    if (e.exe && m.names.has(e.exe)) return 'medium';
    const tok = folderToken(e.pathN);
    if (tok && m.compact.includes(tok)) return 'medium';
    return null;
  }

  function summariseUsage(matches) {
    const userLaunched = matches.filter((x) => (x.e.source === 'UserAssist' || x.e.source === 'AppCompat') && x.e.lastMs);
    const prefetch = matches.filter((x) => x.e.source === 'Prefetch' && x.e.lastMs);
    const mui = matches.filter((x) => x.e.source === 'MuiCache');
    let pick = null;
    let source = null;
    let confidence = null;
    if (userLaunched.length) {
      pick = userLaunched.reduce((a, b) => (b.e.lastMs > a.e.lastMs ? b : a));
      source = pick.e.source;
      confidence = pick.conf;
    } else if (prefetch.length) {
      pick = prefetch.reduce((a, b) => (b.e.lastMs > a.e.lastMs ? b : a));
      source = 'Prefetch';
      confidence = 'low';
    }
    const ua = matches.filter((x) => x.e.source === 'UserAssist');
    const sumBy = (arr, f) => arr.reduce((a, x) => a + (x.e[f] || 0), 0);
    const exeRuns = sumBy(ua.filter((x) => !x.e.isLnk), 'runCount');
    const lnkRuns = sumBy(ua.filter((x) => x.e.isLnk), 'runCount');
    const exeFocus = sumBy(ua.filter((x) => !x.e.isLnk), 'focusSec');
    const lnkFocus = sumBy(ua.filter((x) => x.e.isLnk), 'focusSec');
    return {
      lastUsed: pick ? new Date(pick.e.lastMs).toISOString().slice(0, 19) : null,
      source,
      confidence,
      everLaunched: matches.length > 0,
      runCount: Math.max(exeRuns, lnkRuns) || null,
      focusHours: Math.max(exeFocus, lnkFocus) ? Math.round((Math.max(exeFocus, lnkFocus) / 3600) * 10) / 10 : null,
      evidence: matches
        .slice()
        .sort((a, b) => (b.e.lastMs || 0) - (a.e.lastMs || 0))
        .slice(0, 6)
        .map((x) => ({ source: x.e.source, path: x.e.raw, lastRun: x.e.lastRun, runCount: x.e.runCount, focusSec: x.e.focusSec, confidence: x.conf })),
    };
  }

  /* ------------------------------------------------------------------ versions, eol */

  const verParts = (v) => (String(v || '').match(/\d+/g) || []).map(Number);
  const cmpVer = (a, b) => {
    const x = verParts(a), y = verParts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d;
    }
    return 0;
  };
  LC.cmpVer = cmpVer;

  function dotnetMajor(name) {
    const m = String(name).match(/(?:\.NET(?: Core)?|Runtime|Framework|SDK|Desktop Runtime)[^\d]{0,12}(\d{1,2})\.\d+/i);
    return m ? +m[1] : null;
  }
  function javaMajor(name) {
    const m = String(name).match(/(?:Java(?:\(TM\))?\s+(?:SE\s+)?(?:Runtime Environment\s+|Development Kit\s+)?|JDK\s+|JRE\s+|OpenJDK\s+|Temurin[^\d]*|Corretto\s+)(\d{1,2})\b/i);
    return m ? +m[1] : null;
  }

  /* ------------------------------------------------------------------ main */

  /** Things that are never tens of GB: drivers, helpers, runtimes ... (used to catch wrong size entries). */
  const SMALL_THING = /driver|treiber|tablet|touchpad|bluetooth|wlan|wi-?fi|audio|sound|updater|helper|service|runtime|redistributable|launcher|assistant|agent|utility|codec|firmware|extension/i;
  const APPLICABLE = new Set(['app', 'vendor', 'security', 'game']);
  LC.isComponentKind = (k) => !APPLICABLE.has(k);

  const THRESHOLDS = { active: 30, occasional: 180 };

  /**
   * @param snap  normalised snapshot
   * @param notes user notes (may be null)
   * @param opts  { now?: Date|string, unusedDays?: number }
   */
  LC.buildInventory = (snap, notes, opts) => {
    opts = opts || {};
    const now = opts.now ? new Date(opts.now) : new Date();
    const unusedDays = opts.unusedDays || (notes && notes.settings && notes.settings.unusedDays) || 365;
    const overrides = (notes && notes.apps) || {};
    const evidence = prepareEvidence(snap);
    const shortcuts = prepareShortcuts(snap);
    const updates = LC.asArray(snap.updates).map((u) => ({ ...u, core: LC.coreName(u.name) }));

    const startupItems = LC.asArray(snap.startup).map((s) => ({
      ...s,
      exeN: LC.exeFromCommand(s.command),
      core: LC.coreName(s.name),
    }));

    const apps = [];
    const seenKeys = {};
    for (const raw of LC.asArray(snap.software)) {
      const kb = LC.kbLookup(raw);
      const matcher = buildMatcher(raw, kb, shortcuts);
      const matches = [];
      for (const e of evidence) {
        const conf = matchEvidence(e, matcher);
        if (conf) matches.push({ e, conf });
      }
      const usage = summariseUsage(matches);

      const key = LC.appKey(raw);
      seenKeys[key] = (seenKeys[key] || 0) + 1;
      const ov = overrides[key] || {};
      const pick = (v) => (v == null || v === '' ? null : v);

      const kind = pick(ov.kind) || kb.kind;
      const applicable = APPLICABLE.has(kind);

      // sync clients work in the background: Windows sees no "launch", but the cloud folder shows when they last did something
      const cloudEntry = LC.RELATIONS ? LC.RELATIONS.find((e) => e.cloud && e.re.test(raw.name)) : null;
      const cloudAct = cloudEntry && opts.cloudActivity ? opts.cloudActivity[cloudEntry.cloud] || null : null;
      let lastUsedAuto = usage.lastUsed;
      let autoSource = usage.source;
      if (cloudAct && cloudAct.newest && (!lastUsedAuto || cloudAct.newest > lastUsedAuto)) { lastUsedAuto = cloudAct.newest.slice(0, 19); autoSource = 'Cloud-Ordner'; }
      const lastUsed = pick(ov.lastUsed) || lastUsedAuto;
      const lastUsedSource = pick(ov.lastUsed) ? 'manual' : autoSource;
      const daysUnused = lastUsed ? Math.max(0, LC.daysBetween(lastUsed, now)) : null;
      const installDate = pick(ov.installDate) || raw.installDate || null;
      const daysInstalled = installDate ? LC.daysBetween(installDate, now) : null;

      let usageClass = 'n/a';
      if (applicable && kb.flags.includes('bg')) usageClass = 'background';   // launch history says nothing about use
      else if (applicable) {
        if (daysUnused == null) usageClass = kb.flags.includes('notrace') ? 'notrace' : 'unknown';
        else if (daysUnused < THRESHOLDS.active) usageClass = 'active';
        else if (daysUnused < THRESHOLDS.occasional) usageClass = 'occasional';
        else if (daysUnused < unusedDays) usageClass = 'rare';
        else usageClass = 'unused';
      }

      // autostart
      const startup = startupItems.filter((s) => {
        if (s.exeN && (matcher.exact.has(s.exeN) || [...matcher.roots].some((r) => s.exeN.startsWith(r + '\\')))) return true;
        return nameMatch(matcher.core, s.core);
      });

      // winget update
      const upd = updates.find((u) => nameMatch(matcher.core, u.core)) || null;

      // sizes: installers sometimes report BYTES where Windows expects KB (a 62 MB driver then claims 62 GB).
      // The collector re-measures big claims; what it cannot verify is checked for plausibility here.
      let sizeKB = raw.sizeKB || null;
      let sizeSuspect = false;
      const claimedKB = raw.sizeRegistryKB || null;
      const maxKB = SMALL_THING.test(raw.name) || ['driver', 'runtime', 'system', 'vendor', 'security'].includes(kind) ? 4 * 1024 * 1024 : null;
      if (sizeKB && raw.sizeSource !== 'folder-corrected' && maxKB && sizeKB > maxKB) { sizeSuspect = true; }   // registry claim or a measured folder that is too big for this kind of program

      const app = {
        id: raw.id,
        key,
        source: raw.source,
        name: raw.name,
        version: raw.version || null,
        scope: raw.scope,
        arch: raw.arch,
        regKey: raw.regKey || null,
        packageFamily: raw.packageFamily || null,
        publisher: pick(ov.publisher) || raw.publisher || null,
        publisherAuto: raw.publisher || null,
        publisherSource: pick(ov.publisher) ? 'manual' : raw.publisher ? 'auto' : null,
        installDate,
        installDateAuto: raw.installDate || null,
        installDateSource: pick(ov.installDate) ? 'manual' : raw.installDateSource || null,
        daysInstalled,
        lastUsed,
        lastUsedAuto,
        lastUsedSource,
        lastUsedConfidence: pick(ov.lastUsed) ? 'manual' : autoSource === 'Cloud-Ordner' ? 'medium' : usage.confidence,
        cloudActivity: cloudAct,
        daysUnused,
        everLaunched: usage.everLaunched,
        runCount: usage.runCount,
        focusHours: usage.focusHours,
        evidence: usage.evidence,
        usageClass,
        sizeKB: sizeSuspect ? null : sizeKB,
        sizeApprox: raw.sizeSource === 'folder-partial',
        sizeSource: raw.sizeSource || null,
        sizeSuspect,
        sizeClaimedKB: sizeSuspect ? sizeKB : claimedKB,       // what the installer claimed (suspect or corrected)
        sizeCorrected: raw.sizeSource === 'folder-corrected',
        category: pick(ov.category) || kb.cat,
        categoryAuto: kb.cat,
        kind,
        kindAuto: kb.kind,
        applicable,
        description: pick(ov.description) || kb.desc || null,
        descriptionAuto: kb.desc || null,
        descriptionSource: pick(ov.description) ? 'manual' : kb.desc ? 'kb' : null,
        kbMatched: kb.matched,
        kbAdvice: kb.advice,
        flags: kb.flags,
        purpose: pick(ov.purpose),
        decision: pick(ov.decision),
        note: pick(ov.note),
        installLocation: raw.installLocation || null,
        match: { roots: [...matcher.roots], exact: [...matcher.exact], names: [...matcher.names], core: matcher.core },
        uninstallString: raw.uninstallString || null,
        quietUninstall: raw.quietUninstall || null,
        aboutUrl: raw.aboutUrl || null,
        isSystemComponent: !!raw.isSystemComponent,
        startup: startup.length ? { enabled: startup.some((s) => s.enabled), items: startup.map((s) => ({ name: s.name, command: s.command, enabled: s.enabled, location: s.location })) } : null,
        update: upd ? { id: upd.id, from: upd.version, to: upd.available } : null,
        duplicate: false,
        isOlderDuplicate: false,
      };

      app.missing = [];
      if (!app.publisher) app.missing.push('publisher');
      if (!app.installDate) app.missing.push('installDate');
      if (applicable && !app.lastUsed) app.missing.push('lastUsed');
      if (!app.description) app.missing.push('description');
      if (applicable && !app.purpose) app.missing.push('purpose');
      apps.push(app);
    }

    // duplicates: several versions of the same program (not runtimes / SDKs which legitimately coexist)
    const groups = {};
    for (const a of apps) {
      if (!(a.applicable || a.flags.includes('java'))) continue;
      if (a.flags.includes('keep') || a.source === 'store') continue;
      const gk = LC.coreName(a.name) + '|' + a.arch + '|' + LC.norm(a.publisher || '');
      (groups[gk] = groups[gk] || []).push(a);
    }
    for (const g of Object.values(groups)) {
      if (g.length < 2) continue;
      const newest = g.reduce((a, b) => (cmpVer(b.version, a.version) > 0 ? b : a));
      for (const a of g) {
        a.duplicate = true;
        a.isOlderDuplicate = a !== newest && cmpVer(a.version, newest.version) < 0;
      }
    }

    const hasUsageData = evidence.some((e) => e.lastMs);
    for (const a of apps) a.reco = recommend(a, { now, unusedDays, hasUsageData });

    // autostart entries that belong to no inventory entry
    const claimed = new Set();
    for (const a of apps) if (a.startup) for (const i of a.startup.items) claimed.add(i.name + '|' + i.command);
    const startupUnmatched = startupItems.filter((s) => !claimed.has(s.name + '|' + s.command));

    return { apps, startupUnmatched, unusedDays, now, hasUsageData };
  };

  /* ------------------------------------------------------------------ recommendation */

  const LEVEL_RANK = { ok: 0, info: 1, warn: 2, critical: 3 };
  LC.LEVEL_RANK = LEVEL_RANK;

  function recommend(a, ctx) {
    const reasons = [];
    const push = (level, text, tag) => reasons.push({ level, text, tag: tag || null });
    const keepByUser = a.decision === 'keep';
    const size = a.sizeKB ? ' Belegt ' + (a.sizeApprox ? 'mind. ' : '') + LC.fmtKB(a.sizeKB) + '.' : '';

    if (a.decision === 'remove') push('warn', 'Von dir zum Entfernen markiert.', 'user-remove');
    if (a.decision === 'review') push('info', 'Von dir zum späteren Prüfen markiert.', 'user-review');

    if (a.flags.includes('pup') && !keepByUser) push('critical', a.kbAdvice || 'Potenziell unerwünschte Software – Deinstallieren empfohlen.', 'pup');
    if (a.flags.includes('eol') && !keepByUser) push('warn', 'Veraltet / Support beendet. ' + (a.kbAdvice || 'Entfernen.'), 'eol');

    if (a.flags.includes('dotnet')) {
      const major = dotnetMajor(a.name);
      const end = major != null ? LC.DOTNET_EOL[major] : null;
      if (end) {
        const days = LC.daysBetween(ctx.now, end);
        if (days < 0) push('warn', '.NET ' + major + ' hat seit ' + LC.fmtDate(end) + ' keinen Support mehr. Entfernen, sobald kein Programm es mehr braucht (Windows meldet das nicht automatisch).', 'eol');
        else if (days < 90) push('info', '.NET ' + major + ' wird am ' + LC.fmtDate(end) + ' eingestellt. Programme, die es brauchen, sollten dann auf .NET 10 (LTS) umziehen – bei Updates der jeweiligen Programme darauf achten.', 'eol-soon');
      }
    }
    if (a.flags.includes('java')) {
      const major = javaMajor(a.name);
      if (major != null && major <= 7) push('warn', 'Java ' + major + ' ist stark veraltet (Sicherheitsrisiko). Entfernen oder auf eine aktuelle Version (17/21) wechseln.', 'eol');
      else if (major === 8 && /java\(tm\)|oracle/i.test(a.name + ' ' + (a.publisher || ''))) push('info', 'Oracle Java 8: nur nötig, wenn ein Programm genau diese Version verlangt. Sonst aktuelle LTS-Version (17/21) verwenden.', 'java8');
    }

    if (a.isOlderDuplicate) push('warn', 'Mehrere Versionen installiert – die ältere (' + (a.version || '?') + ') kann entfernt werden.', 'dup');

    if (a.applicable && !keepByUser) {
      if (a.usageClass === 'notrace') {
        if (a.flags.includes('launcher-game') && a.sizeKB && a.sizeKB >= 5 * 1024 * 1024) {
          push('info', 'Belegt ' + LC.fmtKB(a.sizeKB) + '. Spielst du es noch? Windows sieht Steam-Starts nicht – „zuletzt gespielt“ steht in der Steam-Bibliothek. Zum Aufräumen dort deinstallieren.', 'big-game');
        }
      } else if (a.usageClass === 'unused') {
        push('warn', 'Seit ' + LC.fmtAgo(a.daysUnused).replace('vor ', '') + ' nicht benutzt (zuletzt ' + LC.fmtDate(a.lastUsed) + ').' + size + ' Deinstallieren?', 'unused');
      } else if (a.usageClass === 'rare') {
        push('info', 'Selten genutzt (zuletzt ' + LC.fmtDate(a.lastUsed) + ').' + size, 'rare');
      } else if (a.usageClass === 'unknown') {
        if (a.daysInstalled != null && a.daysInstalled > 180 && !a.everLaunched && ctx.hasUsageData) {
          push('info', 'Keine Nutzungsspur gefunden (installiert ' + LC.fmtDate(a.installDate) + '). Brauchst du es noch?' + size + ' Hinweis: Startet es im Hintergrund oder über die Kommandozeile, sieht Windows das nicht.', 'notrace');
        } else if (a.everLaunched) {
          push('info', 'Wurde schon einmal gestartet, aber der Zeitpunkt ist unbekannt. Trag das letzte Nutzungsdatum selbst ein.', 'ever');
        }
      }
      if (a.startup && a.startup.enabled) {
        if (a.usageClass === 'rare' || a.usageClass === 'unused') push('warn', 'Startet automatisch mit Windows, obwohl du es selten nutzt – Autostart abschalten (Task-Manager → Autostart).', 'startup');
        else if (a.usageClass === 'unknown') push('info', 'Startet automatisch mit Windows; eine Nutzung ist nicht erkennbar. Wenn du es nicht regelmäßig brauchst, Autostart abschalten (Task-Manager → Autostart).', 'startup');
      }
      if (!a.kbMatched && !a.publisher && !a.description && a.source === 'registry') {
        push('info', 'Unbekanntes Programm ohne Herausgeber und Beschreibung. Finde heraus, was es ist (Web-Suche in der Detailansicht) – oder entferne es, wenn du es nicht kennst.', 'unknown-program');
      }
    }
    if (a.flags.includes('bloat') && !keepByUser && a.applicable) {
      if (a.startup && a.startup.enabled) push('info', (a.kbAdvice || 'Optionale Hersteller-/Zusatzsoftware.') + ' Sie startet mit Windows.', 'bloat');
      else if (a.usageClass !== 'active') push('info', a.kbAdvice || 'Optionale Hersteller-/Zusatzsoftware.', 'bloat');
    }
    if (a.flags.includes('av')) push('info', a.kbAdvice || 'Virenschutz eines Drittanbieters.', 'av');
    if (a.usageClass === 'background' && !reasons.length) push('ok', (a.kbAdvice || 'Läuft im Hintergrund – Windows sieht dabei keine „Starts“.') + (a.cloudActivity ? ' Der Cloud-Ordner wurde zuletzt am ' + LC.fmtDate(a.cloudActivity.newest) + ' geändert (' + LC.fmtNum(a.cloudActivity.files, 0) + ' Dateien).' : ''), 'bg');
    if (a.update) push('info', 'Update verfügbar: ' + (a.update.from || '?') + ' → ' + (a.update.to || '?') + '.', 'update');
    if (!a.applicable && a.flags.includes('keep') && reasons.length === 0) push('ok', a.kbAdvice || 'Systemkomponente – belassen.', 'keep');

    let level = 'ok';
    let primary = null;
    for (const r of reasons) if (LEVEL_RANK[r.level] > LEVEL_RANK[level]) { level = r.level; primary = r; }
    const tag = primary ? primary.tag : null;
    const label = keepByUser && level === 'ok' ? 'Behalten (von dir)'
      : level === 'critical' ? 'Entfernen empfohlen'
      : tag === 'user-remove' ? 'Zum Entfernen markiert'
      : tag === 'user-review' ? 'Später prüfen'
      : tag === 'unused' ? 'Ungenutzt – prüfen'
      : tag === 'dup' ? 'Alte Version'
      : tag === 'eol' ? 'Veraltet'
      : tag === 'startup' ? 'Autostart prüfen'
      : level === 'warn' ? 'Prüfen'
      : tag === 'rare' ? 'Selten genutzt'
      : tag === 'update' ? 'Update'
      : tag === 'notrace' || tag === 'ever' ? 'Nutzung unklar'
      : tag === 'bg' ? 'Läuft im Hintergrund'
      : tag === 'unknown-program' ? 'Unbekannt'
      : level === 'info' ? 'Hinweis'
      : a.applicable ? 'In Ordnung' : 'Komponente';
    return { level, label, reasons, primary: primary ? primary.text : (a.kbAdvice || null), tag };
  }

  /** Aggregate numbers for the dashboard. */
  LC.inventoryStats = (inv) => {
    const apps = inv.apps;
    const real = apps.filter((a) => a.applicable);
    const sum = (arr) => arr.reduce((s, a) => s + (a.sizeKB || 0), 0);
    const unused = real.filter((a) => a.usageClass === 'unused');
    return {
      total: apps.length,
      programs: real.length,
      components: apps.length - real.length,
      unused: unused.length,
      unusedKB: sum(unused),
      rare: real.filter((a) => a.usageClass === 'rare').length,
      unknownUsage: real.filter((a) => a.usageClass === 'unknown' || a.usageClass === 'notrace').length,
      background: real.filter((a) => a.usageClass === 'background').length,
      withoutPurpose: real.filter((a) => !a.purpose).length,
      withoutDescription: apps.filter((a) => !a.description).length,
      pup: apps.filter((a) => a.reco.level === 'critical').length,
      eol: apps.filter((a) => a.reco.reasons.some((r) => r.tag === 'eol')).length,
      updates: apps.filter((a) => a.update).length,
      markedRemove: apps.filter((a) => a.decision === 'remove').length,
      startupEnabled: apps.filter((a) => a.startup && a.startup.enabled).length,
      totalKB: sum(apps),
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
