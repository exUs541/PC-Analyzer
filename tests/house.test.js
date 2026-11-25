/* Hausordnung + Spar-Plan: what stays local, what moves to the cloud drive, what can go.   node --test tests/house.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const LC = require('./load.js');

const MB = 1024 ** 2, GB = 1024 ** 3;
const NOW = '2026-11-12T12:00:00';
const iso = (daysAgo) => new Date(Date.parse(NOW) - daysAgo * 86400000).toISOString().slice(0, 19);
const D = 'C:\\Users\\Anna';
const cats = (o) => { const a = new Array(12).fill(0); Object.entries(o).forEach(([i, v]) => { a[i] = v; }); return a; };
// cb categories as in the files scan: 3 = documents, 4 = images, 5 = video, 8/7 = installers/archives, 9 = code
const folder = (root, p, depth, bytes, cb, extra) => ({ root, path: p, depth, files: Math.max(1, Math.round(bytes / 100000)), bytes, onlineBytes: 0, matchFiles: 0, matchBytes: 0, newest: iso(5), oldest: '2020-01-01T10:00:00', cf: cats({}), cb: cats(cb), ...(extra || {}) });
const docs = (name, mb, days, extra) => folder('Dokumente', D + '\\Documents\\' + name, 1, mb * MB, { 3: mb * MB }, { newest: iso(days), ...extra });
const dl = (name, mb, days, cb, extra) => folder('Downloads', D + '\\Downloads\\' + name, 1, mb * MB, cb || { 4: mb * MB }, { newest: iso(days), ...extra });

function raw() {
  const urlaub = folder('Dokumente', D + '\\Documents\\Urlaub', 1, 12 * GB, { 4: 12 * GB }, { newest: iso(400) });
  const doppelt = docs('Doppelt', 2048, 400); doppelt.matchFiles = doppelt.files;
  return {
    scannedAt: NOW, seconds: 9, catNames: [], gitAvailable: true,
    providers: [{ id: 'gdrive', name: 'Google Drive', mode: 'stream', root: 'G:\\Meine Ablage', detectedBy: 'test' }],
    roots: [
      { label: 'Google Drive', path: 'G:\\Meine Ablage', kind: 'cloud', provider: 'Google Drive', mode: 'stream', files: 900, bytes: 4 * GB, onlineBytes: 3 * GB, partial: false },
      { label: 'Dokumente', path: D + '\\Documents', kind: 'local', files: 500, bytes: 30 * GB, onlineBytes: 0, partial: false },
      { label: 'Downloads', path: D + '\\Downloads', kind: 'local', files: 80, bytes: 12 * GB, onlineBytes: 0, partial: false },
    ],
    folders: [
      folder('Google Drive', 'G:\\Meine Ablage', 0, 4 * GB, { 3: GB }, { files: 900 }),
      folder('Dokumente', D + '\\Documents', 0, 30 * GB, { 3: 3 * GB, 4: 12 * GB }),
      urlaub,                                    // 12 GB images, 400 days untouched      -> archive (99_Archiv/2025/Urlaub)
      docs('Steuer', 3072, 10),                  // used 10 days ago                      -> keep
      doppelt,                                   // everything already in the cloud       -> cleanup
      folder('Dokumente', D + '\\Documents\\Scripts', 1, GB, { 9: GB }, { newest: iso(400) }),   // code -> git
      docs('Klein', 50, 400),                    // below the size limit                  -> not listed
      docs('Mittel', 2048, 90),                  // 90 days: younger than 180             -> keep
      docs('Behalten', 5120, 400),               // old, but "keep local"
      folder('Downloads', D + '\\Downloads', 0, 12 * GB, { 8: 6 * GB }),
      dl('old-setups', 8192, 100, { 8: 6 * GB, 7: 2 * GB }),     // installers, 100 days > 60 -> cleanup
      dl('Neu', 2048, 30),                                       // 30 days                   -> keep
      dl('Bilder-90', 2048, 90),                                 // Downloads: 90 > 60        -> archive
      dl('Zips', 800, 100, { 7: 800 * MB }),                     // only .zip/.7z: may be your own things -> archive, NEVER delete
    ],
    docs: [],
    big: [
      { p: D + '\\Downloads\\win.iso', s: 5 * GB, m: iso(900), c: 'archives', cloud: null },       // installer image, old    -> cleanup
      { p: D + '\\Downloads\\film.mkv', s: 4 * GB, m: iso(500), c: 'video', cloud: null },        // loose, old, no copy     -> manual
      { p: D + '\\Downloads\\frisch.zip', s: GB, m: iso(5), c: 'archives', cloud: null },         // recent                  -> keep
      { p: D + '\\Documents\\kopie.pdf', s: 300 * MB, m: iso(400), c: 'docs', cloud: 'G:\\Meine Ablage\\kopie.pdf' },   // copy lies in the cloud -> cleanup
      { p: D + '\\Downloads\\privat.zip', s: 600 * MB, m: iso(300), c: 'archives', cloud: null },   // an archive may hold your own files -> manual
      { p: D + '\\Downloads\\Tool-1.2.3-win-x64.zip', s: 200 * MB, m: iso(300), c: 'archives', cloud: null },   // looks like a program package -> cleanup
      { p: D + '\\Downloads\\sub\\tief.iso', s: 3 * GB, m: iso(900), c: 'archives', cloud: null },  // not directly in a main folder -> ignored
    ],
    dupes: [], cloudTree: [], gitRepos: [],
  };
}
const files = (extra) => LC.analyzeFiles(raw(), { now: NOW, projectNames: [], reposDoc: { repos: [] }, cFree: { pct: 8, bytes: 20 * GB }, ...(extra || {}) });
const house = (config, mutate) => { const r = raw(); if (mutate) mutate(r); return LC.analyzeHouse(LC.analyzeFiles(r, { now: NOW, projectNames: [], reposDoc: { repos: [] } }), { config, now: NOW, raw: r }); };
const find = (hs, name) => hs.items.find((i) => i.name === name);

test('rules: defaults, clamping and a safe archive folder', () => {
  const D0 = LC.houseRules(null);
  assert.deepEqual(D0, { archiveAfterDays: 180, downloadsAfterDays: 60, minMB: 100, archiveRoot: '99_Archiv', keepLocal: [] });
  const r = LC.houseRules({ house: { archiveAfterDays: 5, downloadsAfterDays: 99999, minMB: '', archiveRoot: 'G:\\..\\Archiv/ 2026 /', keepLocal: ['C:\\x', 7, '', null] } });
  assert.equal(r.archiveAfterDays, 30, 'below the minimum -> clamped up');
  assert.equal(r.downloadsAfterDays, 3650, 'above the maximum -> clamped down');
  assert.equal(r.minMB, 100, 'empty input -> default');
  assert.equal(r.archiveRoot, 'Archiv/2026', 'no drive letter, no "..", forward slashes');
  assert.deepEqual(r.keepLocal, ['C:\\x']);
  assert.equal(LC.houseRules({ house: { archiveRoot: '..\\..' } }).archiveRoot, '99_Archiv', 'nothing usable left -> default');
});

test('classification: archive, cleanup, git, keep - with the age limit per main folder', () => {
  const hs = house({});
  assert.equal(find(hs, 'Urlaub').action, 'archive');
  assert.equal(find(hs, 'Urlaub').target, '99_Archiv/2025/Urlaub', 'year of the newest file');
  assert.equal(find(hs, 'Doppelt').action, 'cleanup'); assert.match(find(hs, 'Doppelt').reason, /Cloud/);
  assert.equal(find(hs, 'Scripts').action, 'git'); assert.match(find(hs, 'Scripts').reason, /Git/);
  assert.equal(find(hs, 'Steuer').action, 'keep');
  assert.equal(find(hs, 'Mittel').action, 'keep', '90 days is younger than the 180-day limit in Dokumente');
  assert.equal(find(hs, 'Bilder-90').action, 'archive', '...but older than the 60-day limit in Downloads');
  assert.equal(find(hs, 'old-setups').action, 'cleanup'); assert.match(find(hs, 'old-setups').reason, /Installer/);
  assert.equal(find(hs, 'Zips').action, 'archive', 'archives are never proposed for deletion');
  assert.equal(find(hs, 'Zips').target, '99_Archiv/' + new Date(Date.parse(NOW) - 100 * 86400000).getFullYear() + '/Zips'); assert.match(find(hs, 'Zips').reason, /nicht neu laden/);
  assert.equal(find(hs, 'Neu').action, 'keep');
  assert.equal(find(hs, 'Klein'), undefined, 'below the size limit: not listed at all');
  assert.equal(find(hs, 'Behalten').action, 'archive');
});

test('keep local: your choice wins over every rule, also for sub-paths', () => {
  const hs = house({ house: { keepLocal: [D + '\\Documents\\Behalten', D + '\\Documents\\Urlaub'] } });
  assert.equal(find(hs, 'Behalten').action, 'keep'); assert.equal(find(hs, 'Behalten').kept, true);
  assert.equal(find(hs, 'Urlaub').action, 'keep');
  assert.equal(hs.by.archive.items.some((i) => i.name === 'Urlaub'), false);
  // a parent folder keeps everything below it (also a loose file)
  const parent = house({ house: { keepLocal: [D + '\\Downloads'] } });
  assert.equal(parent.items.find((i) => i.name === 'win.iso').action, 'keep');
  assert.equal(parent.by.archive.items.length > 0, true, 'Documents is not under Downloads and is still sorted');
});

test('your limits change the result at once', () => {
  assert.equal(find(house({ house: { archiveAfterDays: 60 } }), 'Mittel').action, 'archive');
  assert.equal(find(house({ house: { downloadsAfterDays: 120 } }), 'Bilder-90').action, 'keep');
  assert.equal(find(house({ house: { minMB: 6000 } }), 'Urlaub').action, 'archive');
  assert.equal(find(house({ house: { minMB: 6000 } }), 'Steuer'), undefined);
  assert.equal(find(house({ house: { archiveRoot: 'Ablage/Alt' } }), 'Urlaub').target, 'Ablage/Alt/2025/Urlaub');
});

test('loose big files: installers go to the clean-up list, the rest is for you to look at', () => {
  const hs = house({});
  const it = (n) => hs.items.find((i) => i.name === n);
  assert.equal(it('win.iso').action, 'cleanup'); assert.equal(it('win.iso').kind, 'file');
  assert.equal(it('film.mkv').action, 'manual'); assert.match(it('film.mkv').reason, /500 Tagen/);
  assert.equal(it('privat.zip').action, 'manual'); assert.match(it('privat.zip').reason, /eigene Dateien/);
  assert.equal(it('Tool-1.2.3-win-x64.zip').action, 'cleanup');
  assert.equal(it('frisch.zip').action, 'keep');
  assert.equal(it('kopie.pdf').action, 'cleanup'); assert.match(it('kopie.pdf').reason, /Cloud/);
  assert.equal(it('tief.iso'), undefined, 'only files directly in the main folders');
});

test('sums: archive and cleanup add up, nothing is counted twice', () => {
  const hs = house({});
  const sum = (a) => hs.items.filter((i) => i.action === a).reduce((s, i) => s + i.bytes, 0);
  assert.equal(hs.by.archive.bytes, sum('archive'));
  assert.equal(hs.by.cleanup.bytes, sum('cleanup'));
  assert.equal(hs.totals.savings, hs.by.archive.bytes + hs.by.cleanup.bytes);
  assert.equal(hs.totals.count, hs.items.length);
  assert.ok(hs.items.every((x, i, a) => i === 0 || a[i - 1].bytes >= x.bytes), 'biggest first');
  assert.equal(new Set(hs.items.map((i) => i.id)).size, hs.items.length, 'every proposal has its own id');
  // a folder item never also appears as a file item
  assert.equal(hs.items.filter((i) => i.kind === 'file').every((i) => i.path.split('\\').length === 5), true);
});

test('without a files scan there is no house; without a cloud drive the move is not offered', () => {
  assert.equal(LC.analyzeHouse(null, {}), null);
  assert.equal(LC.analyzeHouse({ present: false }, {}), null);
  const hs = house({});
  assert.equal(hs.hasCloud, true); assert.equal(hs.cloud.id, 'gdrive');
  const none = house({}, (r) => { r.providers = []; });
  assert.equal(none.hasCloud, false); assert.equal(none.cloud, null);
  assert.deepEqual(LC.houseFindings(none).map((f) => f.id), ['house.cleanup'], 'no move task without a cloud drive; clean-up still stands');
});

test('Aufgaben: one for the move, one for the clean-up - only when it is worth it', () => {
  const F = LC.houseFindings(house({}));
  const arch = F.find((f) => f.id === 'house.archive'), clean = F.find((f) => f.id === 'house.cleanup');
  assert.ok(arch && clean);
  assert.equal(arch.area, 'house'); assert.equal(arch.task, true); assert.equal(arch.severity, 'info');
  assert.match(arch.title, /Ordner/); assert.match(arch.detail, /Urlaub/); assert.match(arch.action, /Hausordnung/);
  assert.match(clean.title, /Installer/);
  assert.deepEqual(LC.houseFindings(null), []);
  const tiny = house({}, (r) => { r.big = []; r.folders = r.folders.filter((f) => !/Urlaub|Doppelt|old-setups|Bilder-90|Zips|Scripts|Behalten/.test(f.path)); });
  assert.deepEqual(LC.houseFindings(tiny), []);
  assert.ok(LC.AREAS.house && LC.AREAS.house.page === 'house');
});

test('Spar-Plan: every lever with its own place, biggest first, small things left out', () => {
  const hs = house({});
  const m = {
    house: hs,
    files: { providers: [{ id: 'gdrive', mode: 'leftover', localBytes: 54 * GB }] },
    folders: { items: [
      { status: 'leftover', bytes: 3 * GB }, { status: 'cache', bytes: 2 * GB },
      { status: 'leftover', bytes: 9 * GB, owner: { via: 'provider' } },     // belongs to the Drive leftover: counted there, not twice
      { status: 'active', bytes: 20 * GB }, { status: 'leftover', bytes: 10 * MB },
    ] },
    stats: { unused: 4, unusedKB: 6 * 1024 * 1024 },
  };
  const sp = LC.savingsPlan(m);
  const by = Object.fromEntries(sp.levers.map((l) => [l.id, l]));
  assert.equal(by.drive.bytes, 54 * GB);
  assert.equal(by.inventory.bytes, 5 * GB + 10 * MB, 'leftover + cache, without the provider folder');
  assert.equal(by.programs.bytes, 6 * GB); assert.deepEqual(by.programs.params, { filter: 'unused' });
  assert.equal(by.house.bytes, hs.totals.savings); assert.equal(by.house.page, 'house');
  assert.ok(sp.levers.every((l, i, a) => i === 0 || a[i - 1].bytes >= l.bytes), 'biggest first');
  assert.equal(sp.totalBytes, sp.levers.reduce((a, l) => a + l.bytes, 0));
  const small = LC.savingsPlan({ house: null, files: { providers: [] }, folders: { items: [{ status: 'cache', bytes: 20 * MB }] }, stats: { unused: 1, unusedKB: 10 * 1024 } });
  assert.deepEqual(small.levers, [], 'under 50 MB a lever is noise');
  assert.equal(small.totalBytes, 0);
  assert.deepEqual(LC.savingsPlan({ house: null, files: null, folders: null, stats: null }).levers, []);
});

test('whole pipeline: LC.analyze delivers house, savings and the tasks - and works without a files scan', () => {
  const snap = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'main.json'), 'utf8'));
  const without = LC.analyze(snap, { now: NOW });
  assert.equal(without.house, null);
  assert.ok(Array.isArray(without.savings.levers));
  assert.equal(without.findings.some((f) => f.area === 'house'), false);
  const m = LC.analyze(snap, { now: NOW, files: raw(), config: { house: { archiveAfterDays: 365 } } });
  assert.ok(m.house); assert.equal(m.house.rules.archiveAfterDays, 365);
  assert.equal(m.house.by.archive.items.find((i) => i.name === 'Urlaub').action, 'archive');
  assert.equal(m.house.by.archive.items.some((i) => i.name === 'Mittel'), false);
  assert.ok(m.findings.some((f) => f.id === 'house.archive'));
  assert.ok(m.savings.levers.some((l) => l.id === 'house'));
  // the config rules reach the model: stricter limit, other result
  const strict = LC.analyze(snap, { now: NOW, files: raw(), config: { house: { archiveAfterDays: 60 } } });
  assert.ok(strict.house.by.archive.count > m.house.by.archive.count);
});

test('Dateien & Cloud: only real installers are called "re-downloadable"; a folder of .zip is not proposed for deletion', () => {
  const fm = files();
  const sug = (n) => fm.candidates.find((c) => c.name === n).suggestion;
  assert.equal(sug('old-setups').action, 'delete'); assert.match(sug('old-setups').reason, /Installer/);
  assert.notEqual(sug('Zips').action, 'delete');
});
