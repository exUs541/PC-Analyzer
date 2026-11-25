/* house.js - "Hausordnung": what you need stays on this PC, what nobody has touched for a long time moves to Google Drive,
 * installers and copies that already lie in the cloud can go. Plus the "Spar-Plan": every lever to save space, with its size.
 *
 *   LC.houseRules(config)                    -> the rules (defaults + what you changed in config.house)
 *   LC.analyzeHouse(filesModel, ctx)         -> { rules, items[], totals }      ctx = { config, now, raw (files.json) }
 *   LC.savingsPlan(model)                    -> { levers[], totalBytes }
 *   LC.houseFindings(house)                  -> tasks for "Aufgaben"
 *
 * Nothing here moves or deletes anything: an item is only a proposal. Moving goes through the verified cloud move of "Dateien & Cloud"
 * (copy, check every file with SHA-256, wait, then remove), deleting through the clean-up list (every item confirmed, Recycle Bin).
 *
 * item.action  archive  folder -> Google Drive (verified move)             untouched for the set time, big enough, content of its own
 *              cleanup  folder/file -> clean-up list: its files already lie in the cloud, or it is an installer that can be fetched again (never a plain archive)
 *              git      code that should be safe in a Git repository (GitHub) before it leaves this PC
 *              manual   a big loose file: look at it yourself (the move works on folders)
 *              keep     recently used (or you said "keep local")
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { asArray, fmtBytes } = LC;
  const MB = 1024 ** 2;

  LC.HOUSE_DEFAULTS = { archiveAfterDays: 180, downloadsAfterDays: 60, minMB: 100, archiveRoot: '99_Archiv', keepLocal: [] };

  const num = (v, lo, hi, d) => { const n = +v; return Number.isFinite(n) && v !== '' && v != null ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
  /** Folder name inside the cloud drive: no drive letter, no "..", forward slashes only. */
  const cleanRoot = (v, d) => {
    const parts = String(v == null ? '' : v).split(/[\\/]+/).map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..' && !/^[a-z]:$/i.test(s) && !/[<>:"|?*]/.test(s));
    return parts.length ? parts.join('/') : d;
  };

  LC.houseRules = (config) => {
    const c = (config && typeof config.house === 'object' && config.house) || {};
    const D = LC.HOUSE_DEFAULTS;
    return {
      archiveAfterDays: num(c.archiveAfterDays, 30, 3650, D.archiveAfterDays),
      downloadsAfterDays: num(c.downloadsAfterDays, 7, 3650, D.downloadsAfterDays),
      minMB: num(c.minMB, 5, 10240, D.minMB),
      archiveRoot: cleanRoot(c.archiveRoot, D.archiveRoot),
      keepLocal: asArray(c.keepLocal).filter((p) => typeof p === 'string' && p.trim()),
    };
  };

  // installers and disk images can be downloaded again; archives only when their name says "program package" (setup, x64, 1.2.3, ...)
  const INSTALLER_EXT = /\.(exe|msi|msix|appx|iso|img|dmg)$/i;
  const ARCHIVE_EXT = /\.(zip|7z|rar|gz|tgz|tar)$/i;
  const SETUP_NAME = /(setup|install|portable|release|x64|x86|amd64|win(32|64|dows)|\.(exe|msi|iso)\b|v?\d+\.\d+\.\d+)/i;
  const baseOf = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  const parentOf = (p) => String(p || '').replace(/[\\/][^\\/]+$/, '');
  const yearOf = (iso) => { const y = iso ? String(iso).slice(0, 4) : ''; return /^\d{4}$/.test(y) ? y : 'Ohne Datum'; };
  const ageOf = (iso, now) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / 86400000)); };

  /** @returns the house model, or null without a files scan */
  LC.analyzeHouse = (fm, ctx) => {
    ctx = ctx || {};
    if (!fm || !fm.present) return null;
    const rules = LC.houseRules(ctx.config);
    const now = ctx.now ? new Date(ctx.now).getTime() : Date.now();
    const minBytes = rules.minMB * MB;
    const thrOf = (rootLabel) => (rootLabel === 'Downloads' ? rules.downloadsAfterDays : rules.archiveAfterDays);
    const isKept = (p) => rules.keepLocal.some((k) => LC.pathUnder(p, k));
    const items = [];

    for (const c of fm.candidates.filter((x) => x.depth === 1)) {
      if (c.localBytes < minBytes) continue;
      const thr = thrOf(c.root);
      const age = c.newestDays != null ? c.newestDays : ageOf(c.newest, now);
      const base = { id: 'f:' + c.path, kind: 'folder', path: c.path, name: c.name, root: c.root, bytes: c.localBytes, files: c.files, newest: c.newest || null, ageDays: age, matchPct: c.matchPct, thr };
      if (isKept(c.path)) { items.push({ ...base, action: 'keep', kept: true, reason: 'Du hast „lokal behalten“ gewählt.' }); continue; }
      if (c.files > 0 && c.matchPct >= 95) {
        items.push({ ...base, action: 'cleanup', reason: 'Alle Dateien (Name + Größe) liegen schon in der Cloud – die lokale Kopie ist ersetzbar.' });
        continue;
      }
      if (age == null || age < thr) {
        items.push({ ...base, action: 'keep', reason: age == null ? 'Kein Datum erkennbar – bleibt lokal.' : 'Zuletzt benutzt vor ' + age + ' Tagen (Grenze: ' + thr + ' Tage) – bleibt lokal.' });
        continue;
      }
      const why = 'Seit ' + age + ' Tagen nichts darin geändert (Grenze: ' + thr + ' Tage).';
      const sug = c.suggestion || {};
      // only real installers (.exe/.msi/.iso ...) can be fetched again; .zip/.7z/.rar may hold your own things -> archive, never delete
      const share = (i) => (c.bytes > 0 ? (asArray(c.cb)[i] || 0) / c.bytes : 0);
      const archiveNote = share(7) >= 0.6 ? ' Überwiegend Archive (.zip, .7z …): darin können eigene Sachen stecken, die sich nicht neu laden lassen – deshalb ins Archiv statt löschen.' : '';
      if (sug.action === 'delete' && share(8) >= 0.6) items.push({ ...base, action: 'cleanup', reason: why + ' Fast nur Installer – lassen sich neu herunterladen.' });
      else if (sug.action === 'git') items.push({ ...base, action: 'git', reason: why + ' Überwiegend Code: erst in einem Git-Repository (GitHub) sichern.' });
      else items.push({ ...base, action: 'archive', target: rules.archiveRoot + '/' + yearOf(c.newest) + '/' + LC.safeFolderName(c.name), reason: why + archiveNote });
    }

    // big loose files directly in the main folders (the cloud move works on folders, so these are looked at one by one)
    const rootByPath = new Map(fm.localRoots.map((r) => [String(r.path).toLowerCase(), r.label]));
    for (const b of asArray(ctx.raw && ctx.raw.big)) {
      if (!b || !b.p || b.s < minBytes) continue;
      const rootLabel = rootByPath.get(parentOf(b.p).toLowerCase());
      if (!rootLabel) continue;
      const age = ageOf(b.m, now);
      const thr = thrOf(rootLabel);
      const base = { id: 'x:' + b.p, kind: 'file', path: b.p, name: baseOf(b.p), root: rootLabel, bytes: b.s, files: 1, newest: b.m || null, ageDays: age, thr };
      if (isKept(b.p)) items.push({ ...base, action: 'keep', kept: true, reason: 'Du hast „lokal behalten“ gewählt.' });
      else if (b.cloud) items.push({ ...base, action: 'cleanup', reason: 'Dieselbe Datei (Name + Größe) liegt schon in der Cloud.' });
      else if (age == null || age < thr) items.push({ ...base, action: 'keep', reason: 'Zuletzt geändert vor ' + (age == null ? '?' : age) + ' Tagen – bleibt lokal.' });
      else if (INSTALLER_EXT.test(b.p) || (ARCHIVE_EXT.test(b.p) && SETUP_NAME.test(baseOf(b.p)))) items.push({ ...base, action: 'cleanup', reason: 'Installer, seit ' + age + ' Tagen unberührt – lässt sich neu herunterladen.' });
      else if (ARCHIVE_EXT.test(b.p)) items.push({ ...base, action: 'manual', reason: 'Archiv, seit ' + age + ' Tagen unberührt. Darin können eigene Dateien stecken: ansehen, dann in einen Ordner im Drive legen oder löschen.' });
      else items.push({ ...base, action: 'manual', reason: 'Große Datei, seit ' + age + ' Tagen unberührt: in einen Ordner im Drive legen oder löschen, wenn du sie nicht mehr brauchst.' });
    }
    items.sort((a, b) => b.bytes - a.bytes);

    const by = {};
    for (const a of ['archive', 'cleanup', 'git', 'manual', 'keep']) { const l = items.filter((i) => i.action === a); by[a] = { items: l, count: l.length, bytes: l.reduce((s, i) => s + i.bytes, 0) }; }

    // the old local copy of the Drive: everything that is already in the live Drive is redundant, only what is missing there has to go there first
    const old = fm.providers.find((p) => p.mode === 'leftover');
    const live = old ? fm.liveProviders.find((p) => p.id === old.id && p.mode === 'stream') || fm.liveProviders.find((p) => p.id === old.id) || null : null;
    const lc = old ? LC.leftoverCompare(old) : null;
    const drive = old ? { root: old.root, liveRoot: lc && lc.liveRoot ? lc.liveRoot : live ? live.root : null, bytes: lc ? lc.bytes : old.localBytes || 0, compare: lc } : null;
    return {
      drive,
      rules, items, by, scannedAt: fm.raw && fm.raw.scannedAt,
      totals: { savings: by.archive.bytes + by.cleanup.bytes, archive: by.archive.bytes, cleanup: by.cleanup.bytes, keep: by.keep.bytes, count: items.length },
      hasCloud: fm.liveProviders.length > 0, cloud: fm.liveProviders.find((p) => p.mode === 'stream') || fm.liveProviders[0] || null,
    };
  };

  /** Every way to save space with its size - each belongs to a different place, so they can be added up. */
  LC.savingsPlan = (m) => {
    const levers = [];
    const add = (l) => { if (l.bytes > 50 * MB) levers.push(l); };
    if (m.house) add({ id: 'house', label: 'Alte Ordner und Dateien (Hausordnung)', detail: m.house.by.archive.count + ' nach Google Drive, ' + m.house.by.cleanup.count + ' auf die Aufräumliste', bytes: m.house.totals.savings, page: 'house' });
    const mirror = m.files ? m.files.providers.find((p) => p.mode === 'leftover') : null;
    const mirrorBytes = mirror && mirror.localBytes ? mirror.localBytes : 0;
    const lc = mirror ? LC.leftoverCompare(mirror) : null;
    if (mirror) add({ id: 'drive', label: 'Alter Google-Drive-Ordner', bytes: lc ? lc.bytes : mirrorBytes, page: lc ? 'house' : 'files',
      detail: lc ? lc.pct + ' % liegen schon im Drive' + (lc.onlyFiles ? ', ' + lc.onlyFiles + ' Dateien (' + fmtBytes(lc.onlyBytes) + ') fehlen dort' : ', im Drive fehlt nichts') + ' – dann in den Papierkorb'
        : 'Rest der früheren Spiegelung – ein neuer Dateien-Scan gleicht ihn mit dem Drive ab' });
    if (m.folders) {
      const items = m.folders.items.filter((i) => (i.status === 'leftover' || i.status === 'cache') && !(i.owner && i.owner.via === 'provider'));
      add({ id: 'inventory', label: 'Reste und Caches (Inventur)', detail: items.length + ' Ordner: Caches bauen sich neu auf, Reste braucht kein Programm', bytes: items.reduce((a, i) => a + i.bytes, 0), page: 'folders' });
    }
    if (m.stats && m.stats.unused) add({ id: 'programs', label: 'Ungenutzte Programme', detail: m.stats.unused + ' Programme seit langem nicht gestartet – du entscheidest', bytes: (m.stats.unusedKB || 0) * 1024, page: 'software', params: { filter: 'unused' } });
    levers.sort((a, b) => b.bytes - a.bytes);
    return { levers, totalBytes: levers.reduce((a, l) => a + l.bytes, 0) };
  };

  LC.houseFindings = (hs) => {
    const F = [];
    if (!hs) return F;
    const a = hs.by.archive;
    if (hs.hasCloud && (a.bytes >= 1024 ** 3 || a.count >= 3)) {
      F.push({ id: 'house.archive', area: 'house', severity: 'info', task: true, impact: 3,
        title: 'Hausordnung: ' + a.count + ' Ordner (' + fmtBytes(a.bytes) + ') seit langem unberührt – nach Google Drive',
        detail: a.items.slice(0, 4).map((i) => i.name + ' (' + fmtBytes(i.bytes) + ')').join(', ') + (a.count > 4 ? ' …' : '') + '. Im Drive belegen sie auf diesem PC fast keinen Platz mehr, bleiben aber erreichbar.',
        action: 'Unter „Mein PC → Hausordnung“ prüfen und in den Umzugsplan übernehmen (kopieren, prüfen, erst dann entfernen).' });
    }
    const c = hs.by.cleanup;
    if (c.bytes >= 500 * MB) {
      F.push({ id: 'house.cleanup', area: 'house', severity: 'info', task: true, impact: 2,
        title: 'Hausordnung: ' + fmtBytes(c.bytes) + ' Installer und Kopien, die weg können',
        detail: c.items.slice(0, 4).map((i) => i.name + ' (' + fmtBytes(i.bytes) + ')').join(', ') + (c.count > 4 ? ' …' : '') + '.',
        action: 'Unter „Mein PC → Hausordnung“ auf die Aufräumliste setzen (jedes Objekt bestätigst du einzeln).' });
    }
    return F;
  };
})(typeof window !== 'undefined' ? window : globalThis);
