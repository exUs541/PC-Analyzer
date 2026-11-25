/* Inventur: where does a folder come from, is it still needed?   node --test tests/folders.test.js
 * The cases are taken from a real laptop (Marvel, BeamNG, .gradle, 3uTools, an old Drive mirror ...). */
const test = require('node:test');
const assert = require('node:assert');
const LC = require('./load.js');

const MB = 1024 ** 2, GB = 1024 ** 3;
const NOW = '2026-11-12T12:00:00';
const iso = (daysAgo) => new Date(Date.parse(NOW) - daysAgo * 86400000).toISOString().slice(0, 19);
const U = 'C:\\Users\\anna';
const dir = (where, name, path, mb, days, extra) => ({ where, name, path, bytes: Math.round(mb * MB), partial: false, modified: iso(days), newest: iso(days), created: iso(days + 400), ...extra });
const app = (name, publisher) => ({ key: name, name, publisher: publisher || '', match: { roots: [], exact: [], names: [] }, applicable: true });

const APPS = [app('Microsoft Visual Studio Code', 'Microsoft Corporation'), app('Android Studio', 'Google LLC'), app('Node.js', 'OpenJS Foundation'), app('Python 3.12.1', 'Python Software Foundation'),
  app('Unity Hub', 'Unity Technologies'), app('Antigravity 2.19.1', 'Google'), app('3uTools', 'Shenzhen Aisi'), app('Discord', 'Discord Inc.'), app('Epic Games Launcher', 'Epic Games, Inc.')];

function raw() {
  return {
    scannedAt: NOW,
    dataDirs: [
      dir('UserProfile', '.gemini', U + '\\.gemini', 11800, 20),
      dir('UserProfile', '.gradle', U + '\\.gradle', 1470, 3),
      dir('UserProfile', '.android', U + '\\.android', 6400, 1),
      dir('AppData', 'Code', U + '\\AppData\\Roaming\\Code', 1790, 6),
      dir('LocalAppData', 'npm-cache', U + '\\AppData\\Local\\npm-cache', 1770, 121),
      dir('LocalAppData', 'ms-playwright', U + '\\AppData\\Local\\ms-playwright', 1590, 189),
      dir('LocalAppData', 'Marvel', U + '\\AppData\\Local\\Marvel', 300, 635),
      dir('LocalAppData', 'BeamNG', U + '\\AppData\\Local\\BeamNG', 250, 264),
      dir('LocalAppData', 'pip', U + '\\AppData\\Local\\pip', 250, 727),
      dir('ProgramData', 'anna', 'C:\\ProgramData\\anna', 480, 742),
      dir('AppData', 'discord', U + '\\AppData\\Roaming\\discord', 340, 175),
      dir('LocalAppData', 'perplexity-updater', U + '\\AppData\\Local\\perplexity-updater', 160, 574),
    ],
    places: [
      dir('RootC', '3uToolsV3', 'C:\\3uToolsV3', 17300, 430),
      dir('RootC', 'Mono', 'C:\\Mono', 595, 2000),
      dir('RootC', 'lc-org-demo', 'C:\\lc-org-demo', 0.1, 20),
      dir('RootC', 'System64', 'C:\\System64', 3, 2300),
      dir('ProgramFiles', 'TeamViewer', 'C:\\Program Files\\TeamViewer', 30, 200),
      dir('ProgramFiles', 'IRONMACE', 'C:\\Program Files\\IRONMACE', 30, 628),
      dir('UserFolder', 'Local Sites', U + '\\Local Sites', 374, 640),
      dir('UserFolder', 'My Drive', U + '\\My Drive', 3000, 52, { partial: true }),
      dir('UserFolder', 'source', U + '\\source', 80, 30),
    ],
    providers: [{ id: 'gdrive', name: 'Google Drive', mode: 'stream', root: 'G:\\Meine Ablage' }, { id: 'gdrive', name: 'Google Drive', mode: 'leftover', root: U + '\\My Drive' }],
  };
}
const run = (extra) => LC.analyzeFolders(raw(), { apps: APPS, now: NOW, ...extra });
const find = (fm, name) => fm.items.find((i) => i.name === name);

test('tools: a build cache is a cache; without its program it depends on how long it has been untouched', () => {
  const g = find(run(), '.gradle');
  assert.equal(g.status, 'cache'); assert.equal(g.action, 'clean'); assert.equal(g.owner.installed, true); assert.equal(g.conf, 'sicher');
  assert.match(g.hint, /Build-Cache.*neu auf/);
  const noAS = APPS.filter((a) => a.name !== 'Android Studio');
  // used 3 days ago: still a cache (it regenerates), but the program is not in the list
  const recent = find(run({ apps: noAS }), '.gradle');
  assert.equal(recent.status, 'cache'); assert.equal(recent.conf, 'möglich');
  const at = (days) => LC.analyzeFolders({ dataDirs: [dir('UserProfile', '.gradle', U + '\\.gradle', 500, days)] }, { apps: noAS, now: NOW }).items[0];
  assert.equal(at(200).status, 'maybe-leftover');           // between 90 days and a year: look first
  const old = at(800);
  assert.equal(old.status, 'leftover'); assert.equal(old.conf, 'wahrscheinlich'); assert.match(old.why[0], /steht nicht in der Programmliste/);
});

test('a folder used this week is NEVER a leftover, even when its program is not in the list (portable / command line)', () => {
  const godot = LC.analyzeFolders({ dataDirs: [dir('AppData', 'Godot', U + '\\AppData\\Roaming\\Godot', 2000, 1), dir('UserProfile', '.android', U + '\\.android', 6400, 1)] }, { apps: [], now: NOW });
  for (const i of godot.items) { assert.equal(i.status, 'active', i.name); assert.equal(i.conf, 'möglich'); assert.match(i.why.join(' '), /portabel oder per Kommandozeile/); }
  // the same folder, untouched for two years, is a leftover
  const old = LC.analyzeFolders({ dataDirs: [dir('AppData', 'Godot', U + '\\AppData\\Roaming\\Godot', 2000, 730)] }, { apps: [], now: NOW });
  assert.equal(old.items[0].status, 'leftover');
});

test('vendor folders (NVIDIA, Microsoft, Epic ...) belong to the installed programs of that publisher and are never leftovers', () => {
  const apps = [app('NVIDIA Graphics Driver 551.23', 'NVIDIA Corporation'), app('Microsoft Visual Studio Community 2022', 'Microsoft Corporation'), app('Epic Games Launcher', 'Epic Games, Inc.')];
  const fm = LC.analyzeFolders({ dataDirs: [dir('LocalAppData', 'NVIDIA', U + '\\AppData\\Local\\NVIDIA', 7000, 0), dir('ProgramData', 'NVIDIA Corporation', 'C:\\ProgramData\\NVIDIA Corporation', 4800, 0),
    dir('LocalAppData', 'Microsoft', U + '\\AppData\\Local\\Microsoft', 3000, 2), dir('ProgramData', 'Epic', 'C:\\ProgramData\\Epic', 240, 0), dir('LocalAppData', 'Intel', U + '\\AppData\\Local\\Intel', 90, 400)] }, { apps, now: NOW });
  for (const n of ['NVIDIA', 'NVIDIA Corporation', 'Microsoft', 'Epic']) { const i = find(fm, n); assert.equal(i.owner.via, 'vendor', n); assert.equal(i.status, 'active', n); }
  assert.equal(find(fm, 'Intel').owner, null);               // no installed Intel program: judged by age
  assert.equal(find(fm, 'Intel').status, 'maybe-leftover');
});

test('short or generic folder names still match an installed program exactly (Git, Local, MSI)', () => {
  const apps = [app('Git', 'The Git Development Community'), app('Local', 'Flywheel'), app('MSI Center', 'MSI')];
  const fm = LC.analyzeFolders({ dataDirs: [dir('ProgramFiles', 'Git', 'C:\\Program Files\\Git', 390, 20), dir('AppData', 'Local', U + '\\AppData\\Roaming\\Local', 2890, 648), dir('ProgramFiles', 'MSI', 'C:\\Program Files (x86)\\MSI', 360, 0)] }, { apps, now: NOW });
  assert.equal(find(fm, 'Git').status, 'active'); assert.equal(find(fm, 'Git').owner.name, 'Git');
  assert.equal(find(fm, 'Local').status, 'idle');            // installed, but nothing changed for 648 days
  assert.equal(find(fm, 'MSI').status, 'active');
});

test('program folders without an installed program: recent = unknown, up to a year = look, older = leftover', () => {
  const at = (days) => LC.analyzeFolders({ places: [dir('ProgramFiles', 'OldTool', 'C:\\Program Files\\OldTool', 50, days)] }, { apps: APPS, now: NOW }).items[0];
  assert.equal(at(10).status, 'unknown');
  assert.equal(at(200).status, 'maybe-leftover');
  assert.equal(at(500).status, 'leftover'); assert.equal(at(500).conf, 'wahrscheinlich');
});

test('active tools are kept: recently used folders of installed programs', () => {
  const fm = run();
  for (const n of ['.android', 'Code', '.gemini', 'discord']) assert.equal(find(fm, n).status, n === 'discord' ? 'active' : 'active', n);
  assert.equal(find(fm, '.gemini').owner.name, 'Antigravity / Gemini');
  assert.equal(find(fm, 'Code').action, 'keep');
  assert.match(find(fm, 'discord').why.join(' '), /Name passt zu „Discord“ \(installiert\)/);
});

test('an installed program whose folder was untouched for a year is "idle" (3uTools)', () => {
  const t = find(run(), '3uToolsV3');
  assert.equal(t.status, 'idle'); assert.equal(t.action, 'check');
  assert.match(t.hint, /Brauchst du das Programm noch/);
  assert.ok(t.bytes > 16 * GB);
});

test('no program matches: old = probably a leftover, recent = unknown', () => {
  const fm = run();
  assert.equal(find(fm, 'Marvel').status, 'maybe-leftover'); assert.equal(find(fm, 'Marvel').conf, 'möglich');
  assert.equal(find(fm, 'pip').owner.name, 'pip'); assert.equal(find(fm, 'pip').status, 'cache');   // known tool, python is installed
  assert.equal(find(fm, 'BeamNG').status, 'unknown');             // 264 days: not old enough to guess
  assert.equal(find(fm, 'anna').status, 'maybe-leftover');       // ProgramData\anna, 742 days
  assert.equal(find(fm, 'perplexity-updater').status, 'maybe-leftover');
  assert.equal(find(fm, 'source').status, 'unknown');
  assert.match(find(fm, 'Marvel').why[0], /Kein installiertes Programm passt/);
  assert.match(find(fm, 'Marvel').why.join(' '), /vor 635 Tagen/);
});

test('a program that was uninstalled while LaptopCheck watched: its folders are leftovers - surely', () => {
  const removed = [{ name: 'Marvel Rivals', removedAt: iso(3) }, { name: 'BeamNG.drive', removedAt: iso(5) }];
  const fm = run({ removed });
  for (const n of ['Marvel', 'BeamNG']) {
    const i = find(fm, n);
    assert.equal(i.status, 'leftover', n); assert.equal(i.conf, 'sicher', n); assert.equal(i.owner.via, 'removed', n);
    assert.match(i.why[0], /wurde deinstalliert/);
  }
  assert.deepEqual(fm.afterUninstall.map((i) => i.name).sort(), ['BeamNG', 'Marvel']);
  // installed again -> not removed (the installed program wins)
  const back = run({ removed, apps: APPS.concat(app('Marvel Rivals', 'NetEase')) });
  assert.notEqual(find(back, 'Marvel').owner.via, 'removed');
});

test('old program folders without a program are leftovers; the tool testbed too', () => {
  const fm = run();
  const tv = find(fm, 'TeamViewer');
  assert.equal(tv.status, 'maybe-leftover'); assert.match(tv.why[0], /Programmordner/);          // 200 days: look first
  const im = find(fm, 'IRONMACE');
  assert.equal(im.status, 'leftover'); assert.equal(im.conf, 'wahrscheinlich');                       // 628 days
  const demo = find(fm, 'lc-org-demo');
  assert.equal(demo.status, 'leftover'); assert.equal(demo.conf, 'sicher'); assert.match(demo.hint, /Test der Funktion „Ordnen“/);
  const mono = find(fm, 'Mono');                                   // a known tool whose program is not installed (and untouched since 2020)
  assert.equal(mono.status, 'leftover'); assert.equal(mono.conf, 'wahrscheinlich'); assert.match(mono.why[0], /steht nicht in der Programmliste/);
});

test('an old Drive mirror next to a streamed Drive is a leftover and gets its real size', () => {
  const fm = run({ providers: raw().providers, sizeAt: (p) => (/My Drive$/.test(p) ? 54.2 * GB : null) });
  const d = find(fm, 'My Drive');
  assert.equal(d.status, 'leftover'); assert.equal(d.conf, 'sicher'); assert.equal(d.owner.via, 'provider');
  assert.ok(Math.abs(d.bytes - 54.2 * GB) < 1e6, 'partial measurement replaced by the storage analysis');
  assert.match(d.why[0], /gestreamt/);
  // without the storage analysis the (partial) measured size is shown as "at least"
  const plain = find(run({ providers: raw().providers }), 'My Drive');
  assert.equal(plain.bytes, 3000 * MB); assert.equal(plain.partial, true);
  assert.match(plain.why.join(' '), /Größe mindestens/);
});

test('kept and marked folders are respected', () => {
  const doc = LC.normalizeCleanup(null);
  LC.cleanup.keep(doc, { id: LC.cleanup.pathId('C:\\Mono'), type: 'path', name: 'Mono', path: 'C:\\Mono', kind: 'dir', bytes: 1 });
  LC.cleanup.addPath(doc, { path: U + '\\AppData\\Local\\Marvel', kind: 'dir', name: 'Marvel', bytes: 1, reason: 'x' });
  const fm = run({ cleanupDoc: doc });
  assert.equal(find(fm, 'Mono').status, 'kept'); assert.equal(find(fm, 'Mono').action, 'keep'); assert.equal(find(fm, 'Mono').kept, true);
  assert.equal(find(fm, 'Marvel').marked, true);
  assert.equal(fm.by.kept.length, 1);
});

test('the same folder reported twice (program data and places) is listed once; sorted by size', () => {
  const r = raw();
  r.places.push({ ...r.dataDirs[0] });
  const fm = LC.analyzeFolders(r, { apps: APPS, now: NOW });
  assert.equal(fm.items.filter((i) => i.name === '.gemini').length, 1);
  assert.ok(fm.items.every((i, k, a) => k === 0 || a[k - 1].bytes >= i.bytes));
  const ids = new Set(fm.items.map((i) => i.id)); assert.equal(ids.size, fm.items.length);
});

test('totals add up: every folder has exactly one status', () => {
  const fm = run();
  const c = fm.totals.counts;
  assert.equal(Object.values(c).reduce((a, b) => a + b, 0), fm.totals.count);
  assert.equal(Object.values(fm.totals.sizes).reduce((a, b) => a + b, 0), fm.totals.bytes);
  assert.equal(fm.totals.reclaimableBytes, fm.totals.sizes.leftover + fm.totals.sizes.cache);
});

test('tasks: leftovers after an uninstall, reclaimable GB, unknown folders', () => {
  const fm = run({ removed: [{ name: 'Marvel Rivals', removedAt: iso(3) }], sizeAt: () => 54.2 * GB });
  const F = LC.folderFindings(fm);
  const after = F.find((f) => f.id === 'folders.after-uninstall');
  assert.ok(after); assert.match(after.title, /Reste deinstallierter Programme: 1 Ordner/); assert.match(after.detail, /Marvel/);
  const rec = F.find((f) => f.id === 'folders.reclaimable');
  assert.ok(rec); assert.match(rec.title, /Reste und Caches können weg/);
  assert.ok(!/My Drive/.test(rec.detail), 'the Drive leftover has its own task (Dateien & Cloud)');
  assert.ok(F.every((f) => f.area === 'folders' && f.task === true));
  // nothing to say: no tasks
  const quiet = LC.analyzeFolders({ dataDirs: [dir('AppData', 'Code', U + '\\AppData\\Roaming\\Code', 100, 2)], places: [] }, { apps: APPS, now: NOW });
  assert.deepEqual(LC.folderFindings(quiet), []);
});

test('robust: no scan, junk, empty lists, missing dates', () => {
  assert.equal(LC.analyzeFolders(null), null);
  assert.equal(LC.analyzeFolders({}), null);
  assert.equal(LC.analyzeFolders({ dataDirs: 'x' }), null);
  const empty = LC.analyzeFolders({ dataDirs: [], places: [] }, { now: NOW });
  assert.equal(empty.totals.count, 0); assert.deepEqual(empty.items, []); assert.equal(empty.hasPlaces, true);
  const odd = LC.analyzeFolders({ dataDirs: [null, { path: '' }, { where: 'LocalAppData', name: 'Zork', path: U + '\\AppData\\Local\\Zork', bytes: 5 * MB }] }, { apps: [], now: NOW });
  assert.equal(odd.items.length, 1); assert.equal(odd.items[0].ageDays, null); assert.equal(odd.items[0].status, 'unknown');
  assert.equal(odd.hasPlaces, false);                       // an older files scan without "places"
});

test('model: the inventory and its tasks come with LC.analyze; uninstalled programs are remembered via notes', () => {
  const fx = JSON.parse(JSON.stringify(require('./fixtures/main.json')));
  const files = { scannedAt: NOW, seconds: 5, catNames: [], docs: [], big: [], dupes: [], folders: [], cloudTree: [], gitRepos: [], exts: [], roots: [], providers: [], ...raw() };
  const noNotes = LC.analyze(fx, { now: NOW, files });
  assert.ok(noNotes.folders && noNotes.folders.items.length);
  assert.equal(LC.analyze(fx, { now: NOW }).folders, null);                      // without a files scan
  const notes = { removedApps: [{ name: 'Marvel Rivals', removedAt: iso(3) }] };
  const withNotes = LC.analyze(fx, { now: NOW, files, notes });
  assert.equal(withNotes.folders.items.find((i) => i.name === 'Marvel').status, 'leftover');
  assert.ok(withNotes.findings.some((f) => f.id === 'folders.after-uninstall'));
  assert.equal(LC.normalizeNotes({ removedApps: [null, { name: 'A' }, {}] }).removedApps.length, 1);
});
