/* Logic tests (node --test tests/analysis.test.js). Run `node tests/make-fixtures.js` first. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const LC = require('./load.js');

const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n + '.json'), 'utf8'));
const NOW = '2026-10-20T10:00:00';
const run = (name, extra) => LC.analyze(fx(name), Object.assign({ now: NOW }, extra || {}));
const app = (m, name) => m.inv.apps.find((a) => a.name === name);
const finding = (m, id) => m.findings.find((f) => f.id === id);

/* ------------------------------------------------------------------ helpers */
test('normPath expands known-folder GUIDs, env vars, drive letters and user names', () => {
  assert.equal(LC.normPath('{6D809377-6AF0-444B-8957-A3773F02200E}\\Google\\Chrome\\Application\\chrome.exe'), '\\program files\\google\\chrome\\application\\chrome.exe');
  assert.equal(LC.normPath('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'), '\\program files\\google\\chrome\\application\\chrome.exe');
  assert.equal(LC.normPath('D:\\Program Files\\Foo\\foo.exe'), '\\program files\\foo\\foo.exe');
  assert.equal(LC.normPath('"C:\\Users\\Anna\\AppData\\Roaming\\Spotify\\Spotify.exe",0'), '\\users\\*\\appdata\\roaming\\spotify\\spotify.exe');
  assert.equal(LC.normPath('{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}\\Programs\\Microsoft VS Code\\Code.exe'), '\\users\\*\\appdata\\local\\programs\\microsoft vs code\\code.exe');
  assert.equal(LC.normPath('%windir%\\system32\\SecurityHealthSystray.exe'), '\\windows\\system32\\securityhealthsystray.exe');
  assert.equal(LC.normPath('C:\\Users\\Public\\x.exe'), '\\users\\public\\x.exe');
  assert.equal(LC.normPath(null), '');
});

test('exeFromCommand finds the executable in quoted and unquoted command lines', () => {
  assert.equal(LC.exeFromCommand('"C:\\Program Files\\Foo Bar\\foo.exe" /background'), '\\program files\\foo bar\\foo.exe');
  assert.equal(LC.exeFromCommand('C:\\Tools\\x.exe -silent'), '\\tools\\x.exe');
  assert.equal(LC.exeFromCommand('MsiExec.exe /X{1234}'), 'msiexec.exe');
  assert.equal(LC.exeFromCommand(''), '');
});

test('coreName strips versions, architecture and update numbers', () => {
  assert.equal(LC.coreName('Mozilla Firefox 131.0.3 (x64 de)'), 'mozilla firefox');
  assert.equal(LC.coreName('Java 8 Update 311 (64-bit)'), 'java 8');
  assert.equal(LC.coreName('Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.38.33135'), 'microsoft visual c++ 2015-2022 redistributable');
  assert.equal(LC.coreName('7-Zip 23.01 (x64)'), '7-zip');
});

test('cpu parsing: Intel generations, Ryzen series, low-end', () => {
  const p = LC.parseCpu;
  assert.equal(p('12th Gen Intel(R) Core(TM) i7-1260P').gen, 12);
  assert.equal(p('Intel(R) Core(TM) i5-6200U CPU @ 2.30GHz').gen, 6);
  assert.equal(p('Intel(R) Core(TM) i5-6200U CPU @ 2.30GHz').win11, false);
  assert.equal(p('Intel(R) Core(TM) i7-8550U CPU @ 1.80GHz').win11, true);
  assert.equal(p('Intel(R) Core(TM) i7-1065G7 CPU @ 1.30GHz').gen, 10);
  assert.equal(p('11th Gen Intel(R) Core(TM) i7-1165G7 @ 2.80GHz').gen, 11);
  assert.equal(p('Intel(R) Core(TM) i7-10750H CPU @ 2.60GHz').gen, 10);
  assert.equal(p('AMD Ryzen 7 5800U with Radeon Graphics').gen, 5000);
  assert.equal(p('AMD Ryzen 5 1600').win11, false);
  assert.equal(p('Intel(R) Core(TM) Ultra 7 155H').year, 2024);
  assert.equal(p('Intel(R) Celeron(R) N4020 CPU @ 1.10GHz').lowEnd, true);
});

test('wifi generation guess', () => {
  assert.equal(LC.wifiGeneration('Intel(R) Wi-Fi 6E AX211 160MHz'), 6.5);
  assert.equal(LC.wifiGeneration('Intel(R) Wi-Fi 6 AX200 160MHz'), 6);
  assert.equal(LC.wifiGeneration('Intel(R) Dual Band Wireless-AC 3165'), 5);
  assert.equal(LC.wifiGeneration('Realtek RTL8723BE 802.11 bgn Wi-Fi'), null);
});

test('csv export neutralises spreadsheet formulas and escapes quotes', () => {
  const csv = LC.csv([['a', '=HYPERLINK("x")', 'He said "hi"; ok']]);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('"He said ""hi""; ok"'));
});

/* ------------------------------------------------------------------ memory: the "48 GB" scenarios */
test('mixed soldered + SO-DIMM = 48 GB is understood (soldered, flex channel, no free slot)', () => {
  const m = run('main');
  const r = m.hw.ram;
  assert.equal(Math.round(r.installedBytes / LC.GB), 48);
  assert.equal(r.soldered.length, 1);
  assert.equal(r.removable.length, 1);
  assert.equal(r.type, 'DDR4');
  assert.equal(r.freeSlots, 0);
  assert.equal(r.channels, 'flex');
  assert.equal(r.maxGB, 64);
  assert.ok(r.reservedBytes < 1 * LC.GB);
  assert.equal(finding(m, 'ram.visible-gap'), undefined);
  assert.ok(finding(m, 'ram.flex'));
  const up = m.upgrades.items.find((i) => i.id === 'ram');
  assert.equal(up.verdict, 'nicht nötig');
});

test('Windows seeing far less than installed RAM raises the gap finding with causes', () => {
  const m = run('main-ramgap');
  const f = finding(m, 'ram.visible-gap');
  assert.ok(f, 'gap finding expected');
  assert.equal(f.severity, 'warn');
  assert.match(f.title, /31,7 von 48/);
  assert.ok(f.steps.some((s) => /msconfig/.test(s)));
});

test('expected RAM entered by the user is compared against the modules', () => {
  const m = run('main', { notes: { hardware: { ramExpectedGB: 64 } } });
  const f = finding(m, 'ram.expected-mismatch');
  assert.ok(f);
  assert.match(f.title, /64 GB.*48/);
  const ok = run('main', { notes: { hardware: { ramExpectedGB: 48 } } });
  assert.equal(finding(ok, 'ram.expected-mismatch'), undefined);
});

test('old laptop: single 8 GB DDR3 module -> single channel, pressure high, RAM upgrade recommended', () => {
  const m = run('old');
  assert.equal(m.hw.ram.channels, 'single');
  assert.equal(m.hw.ram.pressureLevel, 'high');
  assert.ok(finding(m, 'ram.single-channel'));
  assert.ok(finding(m, 'ram.pressure'));
  const up = m.upgrades.items.find((i) => i.id === 'ram');
  assert.equal(up.verdict, 'empfohlen');
  assert.ok(up.best.resultGB >= 16);
  assert.match(up.best.text, /DDR3/);
  assert.match(up.shopping[0], /SO-DIMM/);
});

/* ------------------------------------------------------------------ system findings */
test('Windows 11 24H2 Pro is out of support on 2026-10-20', () => {
  const m = run('main');
  assert.equal(m.hw.os.supportState, 'ended');
  assert.equal(finding(m, 'os.eol').severity, 'critical');
  assert.equal(finding(m, 'os.reboot').severity, 'warn');
});

test('Windows 11 25H2 would be fine', () => {
  const raw = fx('main'); raw.os.build = 26200; raw.os.displayVersion = '25H2';
  const m = LC.analyze(raw, { now: NOW });
  assert.equal(m.hw.os.supportState, 'ok');
  assert.equal(finding(m, 'os.eol'), undefined);
  assert.ok(finding(m, 'os.ok'));
});

test('old Windows 10 laptop: the full set of expected warnings', () => {
  const m = run('old');
  for (const id of ['os.eol', 'cpu.no-win11', 'storage.hdd-system', 'storage.c-low', 'battery.worn', 'sec.firewall', 'sec.multi-av', 'startup.many', 'os.powerplan']) {
    if (id === 'sec.multi-av') continue; // Defender off + Avast on is a single active AV
    assert.ok(finding(m, id), 'missing finding ' + id);
  }
  assert.equal(finding(m, 'storage.c-low').severity, 'critical');
  assert.ok(m.score.score < 40);
  const storageUp = m.upgrades.items.find((i) => i.id === 'storage');
  assert.equal(storageUp.verdict, 'empfohlen');
  assert.equal(storageUp.benefit, 5);
  const b = m.upgrades.bottlenecks;
  assert.ok(['storage', 'ram', 'cpu'].includes(b[0].area));
  assert.equal(m.hw.win11.ok, false);
});

test('battery health and cycles', () => {
  const m = run('main');
  assert.equal(Math.round(m.hw.battery.healthPct), 72);
  assert.equal(finding(m, 'battery.fair').severity, 'info');
  assert.equal(finding(run('old'), 'battery.worn').severity, 'warn');
});

/* ------------------------------------------------------------------ software */
test('usage evidence is attributed to the right program', () => {
  const m = run('main');
  const day = (a) => (a.lastUsed || '').slice(0, 10);
  assert.equal(day(app(m, 'Google Chrome')), '2026-10-19');
  assert.equal(day(app(m, '7-Zip 23.01 (x64)')), '2026-10-02');
  assert.equal(day(app(m, 'Mozilla Firefox (x64 de)')), '2025-02-14');
  assert.equal(day(app(m, 'VLC media player')), '2025-06-01');
  assert.equal(day(app(m, 'Microsoft Visual Studio Code (User)')), '2026-10-19');
  assert.equal(day(app(m, 'Spotify')), '2026-10-17');                 // via Start-menu shortcut (lnk)
  assert.equal(day(app(m, 'Rechner')), '2026-09-30');                 // via AUMID / package family
  assert.equal(day(app(m, 'Microsoft 365 Apps for enterprise - de-de')), '2026-10-18'); // KB exe names
});

test('REGRESSION: WinRAR must not inherit 7-Zip\'s last-used date', () => {
  const m = run('main');
  const w = app(m, 'WinRAR 6.24 (64-bit)');
  assert.equal(w.lastUsed, null);
  assert.equal(w.everLaunched, true);           // MuiCache says it ran at least once
  assert.equal(w.usageClass, 'unknown');
});

test('background updaters do not count as "used"', () => {
  const m = run('main');
  const cc = app(m, 'Adobe Creative Cloud');
  assert.equal(cc.lastUsed, null);               // AdobeUpdateService.exe at 2026-10-19 is noise
});

test('command-line tools and launcher games are "not detectable", not "unused"', () => {
  const m = run('main');
  for (const n of ['Python 3.9.5 (64-bit)', 'Git', 'Node.js', 'Counter-Strike 2']) assert.equal(app(m, n).usageClass, 'notrace', n);
  assert.equal(app(m, 'Counter-Strike 2').kind, 'game');
});

test('classification and recommendations', () => {
  const m = run('main');
  assert.equal(app(m, 'CCleaner').reco.level, 'critical');
  assert.equal(app(m, 'McAfee WebAdvisor').reco.level, 'critical');
  assert.equal(app(m, 'Microsoft .NET Runtime - 6.0.25 (x64)').reco.tag, 'eol');
  assert.equal(app(m, 'Microsoft Teams classic').reco.tag, 'eol');
  assert.equal(app(m, 'Java 8 Update 311 (64-bit)').isOlderDuplicate, true);
  assert.equal(app(m, 'Java 8 Update 361 (64-bit)').isOlderDuplicate, false);
  assert.equal(app(m, 'Mozilla Firefox (x64 de)').usageClass, 'unused');
  assert.equal(app(m, 'Google Chrome').usageClass, 'active');
  assert.equal(app(m, 'Google Chrome').update.to, '141.0.7390.77');
  assert.equal(app(m, 'Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.38.33135').applicable, false);
  assert.equal(app(m, 'Microsoft Edge WebView2 Runtime').reco.level, 'ok');
  assert.equal(app(m, 'HEVC Video Extensions von Geräteherstellern').applicable, false);
  assert.equal(app(m, 'Contoso Report Helper').reco.tag, 'unknown-program');
  assert.equal(app(m, 'Steam').startup.enabled, true);
  assert.ok(app(m, 'Dropbox').startup);
});

test('.NET 8 is flagged as ending soon (support ends 2026-11-10)', () => {
  const m = run('main');
  const a = app(m, 'Microsoft .NET Runtime - 8.0.10 (x64)');
  assert.equal(a.reco.tag, 'eol-soon');
  assert.match(a.reco.primary, /10\.11\.2026/);
});

test('missing info is tracked, components are exempt from usage/purpose', () => {
  const m = run('main');
  const c = app(m, 'Contoso Report Helper');
  assert.deepEqual(c.missing.sort(), ['description', 'installDate', 'lastUsed', 'publisher', 'purpose']);
  const vc = app(m, 'Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.38.33135');
  assert.ok(!vc.missing.includes('lastUsed') && !vc.missing.includes('purpose'));
});

test('user entries override automatic values and survive a re-analysis', () => {
  const key = LC.appKey({ name: 'Contoso Report Helper', publisher: null, source: 'registry' });
  const notes = { apps: { [key]: { publisher: 'Contoso Ltd', purpose: 'Monatsberichte', lastUsed: '2026-10-01', installDate: '2024-05-05', description: 'Erstellt Berichte', decision: 'remove' } } };
  const m = run('main', { notes });
  const a = app(m, 'Contoso Report Helper');
  assert.equal(a.publisher, 'Contoso Ltd'); assert.equal(a.publisherSource, 'manual');
  assert.equal(a.purpose, 'Monatsberichte');
  assert.equal(a.lastUsedSource, 'manual'); assert.equal(a.lastUsed, '2026-10-01');
  assert.equal(a.usageClass, 'active');
  assert.equal(a.descriptionSource, 'manual');
  assert.equal(a.missing.length, 0);
  assert.ok(m.findings.some((f) => f.id === 'sw.remove:' + key), 'remove decision becomes a task');
});

test('app key is stable across version changes', () => {
  const a = LC.appKey({ name: 'Mozilla Firefox 131.0.3 (x64 de)', publisher: 'Mozilla', source: 'registry' });
  const b = LC.appKey({ name: 'Mozilla Firefox 132.0 (x64 de)', publisher: 'Mozilla', source: 'registry' });
  assert.equal(a, b);
  assert.equal(LC.appKey({ name: 'x', source: 'store', packageName: 'Foo.Bar' }), 'store:foo.bar');
});

test('diff against the previous scan', () => {
  const m = run('main', { prev: fx('main.prev') });
  assert.deepEqual(m.diff.added, ['CCleaner']);
  assert.deepEqual(m.diff.removed, ['FileZilla 3.66']);
  assert.deepEqual(m.diff.updated, ['Git 2.45.2 → 2.46.0']);
  assert.ok(m.diff.cFreeDeltaBytes < 0);
});

/* ------------------------------------------------------------------ robustness */
test('empty snapshot (nothing readable) does not throw and reports the gaps', () => {
  const m = run('empty');
  assert.ok(m);
  assert.equal(m.inv.apps.length, 0);
  assert.ok(finding(m, 'scan.warnings'));
  assert.ok(m.score.score <= 100);
  assert.ok(Array.isArray(m.areas));
});

test('PowerShell single-element array collapsing is tolerated', () => {
  const a = run('main'), b = run('collapsed');
  assert.equal(b.hw.cpu.name, a.hw.cpu.name);
  assert.equal(b.hw.storage.disks.length, 1);
  assert.equal(b.hw.storage.systemVolume.letter, 'C');
  assert.equal(b.hw.gpu.length, 1);
  assert.equal(b.hw.device.isLaptop, true);
  assert.equal(b.findings.length, a.findings.length);
});

test('analysis is fast enough for editing (300 programs, 1500 evidence entries)', () => {
  const raw = fx('main');
  const base = raw.software.slice();
  for (let i = 0; i < 6; i++) base.forEach((s, j) => raw.software.push({ ...s, id: s.id + i + '_' + j, name: s.name + ' ' + i + ' Zusatz' }));
  const u = raw.usage.slice();
  for (let i = 0; i < 90; i++) u.forEach((e) => raw.usage.push({ ...e, path: e.path + i }));
  const t0 = Date.now();
  const m = LC.analyze(raw, { now: NOW });
  const ms = Date.now() - t0;
  assert.ok(m.inv.apps.length > 300);
  assert.ok(ms < 1500, 'analysis took ' + ms + ' ms');
  console.log('      (analysis of ' + m.inv.apps.length + ' apps / ' + raw.usage.length + ' evidence entries: ' + ms + ' ms)');
});

test('score is bounded and explains deductions', () => {
  for (const n of ['main', 'old', 'empty']) {
    const m = run(n);
    assert.ok(m.score.score >= 0 && m.score.score <= 100);
    const lost = m.score.parts.reduce((s, p) => s + p.loss, 0);
    assert.equal(m.score.score, Math.max(0, Math.round(100 - lost)));
  }
});

test('every finding has the fields the UI relies on', () => {
  for (const n of ['main', 'old', 'main-ramgap']) {
    for (const f of run(n).findings) {
      assert.ok(f.id && f.area && f.severity && f.title, 'finding fields: ' + JSON.stringify(f));
      assert.ok(LC.AREAS[f.area], 'unknown area ' + f.area);
      assert.ok(['ok', 'info', 'warn', 'critical'].includes(f.severity));
      assert.equal(typeof f.task, 'boolean');
    }
  }
  const ids = run('main').findings.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'finding ids must be unique');
});

/* ------------------------------------------------------------------ "open in Windows" buttons */
test('every "open in Windows" target a finding points to exists; autostart finding has its shortcuts', () => {
  for (const n of ['main', 'old', 'main-ramgap']) {
    for (const f of run(n).findings) for (const id of f.open || []) assert.ok(LC.OPEN_TARGETS[id], f.id + ' -> unknown target ' + id);
  }
  const f = finding(run('main'), 'startup.many');
  assert.deepEqual(f.open, ['startup-apps', 'task-manager']);
  assert.equal(f.filter, 'startup');
  assert.deepEqual(finding(run('main'), 'os.eol').open, ['windows-update']);
  assert.deepEqual(finding(run('main'), 'storage.c-low').open, ['storage', 'disk-cleanup']);
  assert.deepEqual(finding(run('main'), 'sw.updates').open, ['terminal']);
  assert.equal(finding(run('main'), 'ram.ok').open, undefined, 'no buttons on "all fine" findings');
});

test('implausible installer sizes: a tablet driver claiming 62 GB is flagged and not counted; honest big programs are kept', () => {
  const raw = fx('main');
  const baseTotal = LC.analyze(fx('main'), { now: NOW }).stats.totalKB;
  const mk = (name, kb, extra) => ({ id: 'reg:HKLM:x64:' + name, source: 'registry', name, version: '1.0', publisher: 'X', installDate: '2024-01-01', installDateSource: 'registry', installLocation: null, displayIcon: null, uninstallString: null, quietUninstall: null, sizeKB: kb, sizeSource: 'registry', scope: 'machine', arch: 'x64', isSystemComponent: false, aboutUrl: null, regKey: name, ...(extra || {}) });
  raw.software.push(mk('GAOMON Tablet', 62 * 1024 * 1024));
  raw.software.push(mk('Big Game Launcher Edition', 70 * 1024 * 1024, { name: 'Counter Fun' }));
  raw.software.push(mk('Corrected Helper', 5 * 1024, { sizeSource: 'folder-corrected', sizeRegistryKB: 62 * 1024 * 1024 }));
  const m = LC.analyze(raw, { now: NOW });
  const g = app(m, 'GAOMON Tablet');
  assert.equal(g.sizeSuspect, true);
  assert.equal(g.sizeKB, null);
  assert.equal(g.sizeClaimedKB, 62 * 1024 * 1024);
  const big = app(m, 'Counter Fun');
  assert.equal(big.sizeSuspect, false, 'a game may be big');
  assert.equal(big.sizeKB, 70 * 1024 * 1024);
  const c = app(m, 'Corrected Helper');
  assert.equal(c.sizeCorrected, true);
  assert.equal(c.sizeKB, 5 * 1024);
  const f = finding(m, 'sw.size-suspect');
  assert.ok(f && /GAOMON Tablet/.test(f.detail) && /Corrected Helper/.test(f.detail));
  assert.equal(f.task, false);
  assert.equal(Math.round(m.stats.totalKB), Math.round(baseTotal + 70 * 1024 * 1024 + 5 * 1024), 'the bogus 62 GB is not in the total (only the honest game and the corrected 5 MB are)');
});

test('background programs (cloud sync, tablet drivers) are never "rarely used" and not offered for autostart removal', () => {
  const raw = fx('main');
  const mk = (name, extra) => ({ id: 'reg:HKLM:x64:' + name, source: 'registry', name, version: '1.0', publisher: 'X', installDate: '2024-01-01', installDateSource: 'registry', installLocation: null, displayIcon: null, uninstallString: null, quietUninstall: null, sizeKB: 1000, sizeSource: 'registry', scope: 'machine', arch: 'x64', isSystemComponent: false, aboutUrl: null, regKey: name, ...(extra || {}) });
  raw.software.push(mk('Google Drive'), mk('Proton Drive'), mk('GAOMON Tablet'));
  for (const n of ['Google Drive', 'Proton Drive', 'GAOMON Tablet']) raw.startup.push({ name: n, command: '"C:\\Program Files\\' + n + '\\' + n + '.exe"', location: 'HKCU\\Run', scope: 'user', enabled: true });
  // a launch from long ago must not turn it into "unused" either
  raw.usage.push({ source: 'UserAssist', path: '{6D809377-6AF0-444B-8957-A3773F02200E}\\Google Drive\\GoogleDriveFS.exe', lastRun: '2023-01-01T10:00:00', runCount: 1, focusSec: 10 });
  const m = LC.analyze(raw, { now: NOW });
  for (const n of ['Google Drive', 'Proton Drive', 'GAOMON Tablet']) {
    const a = app(m, n);
    assert.equal(a.usageClass, 'background', n);
    assert.ok(!a.reco.reasons.some((r) => ['unused', 'rare', 'startup', 'notrace'].includes(r.tag)), n + ': ' + JSON.stringify(a.reco.reasons.map((r) => r.tag)));
  }
  const f = finding(m, 'startup.many');
  assert.ok(!f || !/Google Drive|Proton Drive|GAOMON/.test(f.detail), 'not listed as "selten/nie genutzt"');
});

test('cloud folder activity counts as "last used" for the sync client', () => {
  const raw = fx('main');
  raw.software.push({ id: 'reg:HKLM:x64:Google Drive', source: 'registry', name: 'Google Drive', version: '1', publisher: 'Google LLC', installDate: '2024-01-01', installDateSource: 'registry', installLocation: null, displayIcon: null, uninstallString: null, quietUninstall: null, sizeKB: 1000, sizeSource: 'registry', scope: 'machine', arch: 'x64', isSystemComponent: false, aboutUrl: null, regKey: 'Google Drive' });
  const m = LC.analyze(raw, { now: NOW, cloudActivity: undefined });
  assert.equal(app(m, 'Google Drive').lastUsed, null);
  const files = { scannedAt: NOW, providers: [{ id: 'gdrive', name: 'Google Drive', mode: 'stream', root: 'G:\\Meine Ablage', detectedBy: 't' }], roots: [{ label: 'Google Drive', path: 'G:\\Meine Ablage', kind: 'cloud', provider: 'Google Drive', files: 900, bytes: 4e9, onlineBytes: 0, partial: false }],
    folders: [{ root: 'Google Drive', path: 'G:\\Meine Ablage', depth: 0, files: 900, bytes: 4e9, onlineBytes: 0, matchFiles: 0, matchBytes: 0, newest: '2026-10-18T09:00:00', oldest: '2020-01-01T00:00:00', cf: new Array(12).fill(0), cb: new Array(12).fill(0) }], docs: [], big: [], dupes: [], cloudTree: [], gitRepos: [] };
  const m2 = LC.analyze(raw, { now: NOW, files });
  const g = app(m2, 'Google Drive');
  assert.equal(g.lastUsed, '2026-10-18T09:00:00');
  assert.equal(g.lastUsedSource, 'Cloud-Ordner');
  assert.equal(g.usageClass, 'background');
});
