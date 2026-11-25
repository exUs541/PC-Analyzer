/* "Empfehlung umsetzen": what a click would do (the dialog lists exactly this), and what it never includes.   node --test tests/apply.test.js */
const test = require('node:test');
const assert = require('node:assert');
const LC = require('./load.js');

const MB = 1024 ** 2, GB = 1024 ** 3;
const NOW = '2026-11-13T12:00:00';
const iso = (daysAgo) => new Date(Date.parse(NOW) - daysAgo * 86400000).toISOString().slice(0, 19);
const U = 'C:\\Users\\Anna';
const cats = (o) => { const a = new Array(12).fill(0); Object.entries(o).forEach(([i, v]) => { a[i] = v; }); return a; };
const folder = (root, p, depth, bytes, cb, extra) => ({ root, path: p, depth, files: Math.max(1, Math.round(bytes / 100000)), bytes, onlineBytes: 0, matchFiles: 0, matchBytes: 0, newest: iso(5), oldest: '2020-01-01T10:00:00', cf: cats({}), cb: cats(cb), ...(extra || {}) });
const STREAM = { id: 'gdrive', name: 'Google Drive', mode: 'stream', root: 'G:\\Meine Ablage', detectedBy: 'test' };
const OLD = { id: 'gdrive', name: 'Google Drive', mode: 'leftover', root: U + '\\My Drive', detectedBy: 'test' };
const COMPARE = (over) => ({ localRoot: OLD.root, liveRoot: STREAM.root, files: 1000, bytes: 10 * GB, same: { files: 900, bytes: 9.5 * GB }, nameSize: { files: 0, bytes: 0 }, junk: { files: 10, bytes: 1e6 },
  only: { files: 90, bytes: 0.4 * GB }, partial: false, livePartial: false, seconds: 5,
  onlyDirs: [{ dir: OLD.root + '\\99_Other\\Urlaub', files: 60, bytes: 0.3 * GB }, { dir: OLD.root + '\\20_Family\\Ausweise', files: 4, bytes: 20 * MB }], onlyDirsMore: 0, onlyTop: [], ...over });

function files(over) {
  const f = {
    scannedAt: NOW, seconds: 9, catNames: [], gitAvailable: true, providers: [STREAM, { ...OLD, compare: COMPARE() }],
    roots: [
      { label: 'Google Drive', path: STREAM.root, kind: 'cloud', provider: 'Google Drive', mode: 'stream', files: 900, bytes: 4 * GB, onlineBytes: 3 * GB, partial: false },
      { label: 'Dokumente', path: U + '\\Documents', kind: 'local', files: 500, bytes: 30 * GB, onlineBytes: 0, partial: false },
      { label: 'Downloads', path: U + '\\Downloads', kind: 'local', files: 80, bytes: 12 * GB, onlineBytes: 0, partial: false },
    ],
    folders: [
      folder('Google Drive', STREAM.root, 0, 4 * GB, { 3: GB }, { files: 900 }),
      folder('Dokumente', U + '\\Documents', 0, 30 * GB, { 3: 3 * GB, 4: 12 * GB }),
      folder('Dokumente', U + '\\Documents\\Urlaub', 1, 12 * GB, { 4: 12 * GB }, { newest: iso(400) }),
      folder('Dokumente', U + '\\Documents\\Doppelt', 1, 2 * GB, { 3: 2 * GB }, { newest: iso(400), files: 20000, matchFiles: 20000 }),   // everything of it lies in the cloud: a clean-up item, not an archive proposal
      folder('Downloads', U + '\\Downloads', 0, 12 * GB, { 8: 6 * GB }),
      folder('Downloads', U + '\\Downloads\\old-setups', 1, 8 * GB, { 8: 6 * GB, 7: 2 * GB }, { newest: iso(100) }),
    ],
    docs: [], big: [{ p: U + '\\Downloads\\win.iso', s: 5 * GB, m: iso(900), c: 'archives', cloud: null }], dupes: [], cloudTree: [], gitRepos: [],
  };
  return { ...f, ...(over || {}) };
}
const snap = () => JSON.parse(JSON.stringify(require('./fixtures/main.json')));
const model = (over, opts) => LC.analyze(snap(), { now: NOW, files: files(over), ...(opts || {}) });
const S = (m, doc) => ({ model: m, cleanupDoc: doc || LC.normalizeCleanup(null) });

test('plan: restore, move and cleanup in this order; every step knows its count, size and rows for the dialog', () => {
  LC.houseUi.off.clear();
  const m = model();
  const { steps } = LC.apply.plan(m.house, S(m), null);
  assert.deepEqual(steps.map((s) => s.id), ['restore', 'move', 'cleanup']);
  const r = steps[0];
  assert.equal(r.count, 90); assert.equal(r.bytes, 0.4 * GB);
  assert.deepEqual(r.rows.map((x) => x.name), ['99_Other\\Urlaub', '20_Family\\Ausweise']);
  assert.match(r.text, /Nichts wird überschrieben/); assert.match(r.text, /G:\\Meine Ablage/);
  const mv = steps[1];
  assert.equal(mv.items.length, 1); assert.equal(mv.items[0].name, 'Urlaub');
  assert.match(mv.rows[0].detail, /99_Archiv\/2025\/Urlaub/);
  const cl = steps[2];
  assert.ok(cl.items.some((i) => i.name === 'old-setups') && cl.items.some((i) => i.name === 'win.iso'));
  assert.match(cl.text, /ENTFERNEN/);
});

test('plan: a single step on request, and un-ticked proposals stay out of the move', () => {
  const m = model();
  assert.deepEqual(LC.apply.plan(m.house, S(m), 'cleanup').steps.map((s) => s.id), ['cleanup']);
  assert.deepEqual(LC.apply.plan(m.house, S(m), 'restore').steps.map((s) => s.id), ['restore']);
  LC.houseUi.off.add(m.house.by.archive.items[0].id);
  assert.deepEqual(LC.apply.plan(m.house, S(m), 'move').steps, [], 'the only proposal was un-ticked');
  LC.houseUi.off.clear();
});

test('plan: no restore when the comparison is unfinished, nothing is missing, or the live drive is unknown', () => {
  const none = (compare) => { const m = model({ providers: [STREAM, { ...OLD, compare }] }); return LC.apply.plan(m.house, S(m), 'restore').steps; };
  assert.equal(none(COMPARE({ partial: true })).length, 0, 'a list that may be incomplete is not copied from');
  assert.equal(none(COMPARE({ only: { files: 0, bytes: 0 }, onlyDirs: [] })).length, 0);
  assert.equal(none(null).length, 0, 'not compared yet');
  const noDrive = model({ providers: [{ ...OLD, compare: COMPARE() }] });
  assert.equal(LC.apply.plan(noDrive.house, S(noDrive), 'restore').steps.length, 0);
});

test('plan: no move into a drive that mirrors everything or without a drive; no cleanup of what is already on the list', () => {
  const mirror = model({ providers: [{ ...STREAM, mode: 'mirror' }] });
  assert.equal(LC.apply.plan(mirror.house, S(mirror), 'move').steps.length, 0, 'no gain in a mirrored drive');
  const m = model();
  const doc = LC.normalizeCleanup(null);
  const item = m.house.by.cleanup.items[0];
  LC.cleanup.addPath(doc, { path: item.path, kind: 'dir', name: item.name, bytes: item.bytes });
  LC.cleanup.confirm(doc, { id: LC.cleanup.pathId(item.path), type: 'path' }, { ack: true });
  const left = LC.apply.plan(m.house, S(m, doc), 'cleanup').steps[0].items;
  assert.ok(!left.some((i) => i.path === item.path), 'already confirmed: not again');
  assert.equal(left.length, m.house.by.cleanup.items.length - 1);
});

test('plan: only things inside your own profile go to the removal (the server would refuse the rest)', () => {
  const m = model({ big: [{ p: U + '\\Downloads\\win.iso', s: 5 * GB, m: iso(900), c: 'archives', cloud: null }, { p: 'D:\\Daten\\alt.iso', s: 5 * GB, m: iso(900), c: 'archives', cloud: null }] });
  const items = LC.apply.plan(m.house, S(m), 'cleanup').steps[0].items;
  assert.ok(items.every((i) => /^[a-z]:\\users\\anna\\/i.test(i.path)));
});

// ---- caches of the storage analysis
const e = (path, gb) => ({ path, bytes: Math.round(gb * GB), depth: path.split('\\').length - 1 });
const spaceRaw = () => ({
  schema: 1, scannedAt: NOW, seconds: 40, root: 'C:\\', partial: false, totalBytes: 400 * GB, freeBytes: 20 * GB, scannedBytes: 370 * GB, files: [], unreadable: [],
  entries: [
    e('C:\\Users', 60), e(U, 60), e(U + '\\AppData', 30), e(U + '\\AppData\\Local', 30),
    e(U + '\\AppData\\Local\\npm-cache', 6), e(U + '\\AppData\\Local\\NVIDIA', 7), e(U + '\\AppData\\Local\\NVIDIA\\DXCache', 7), e(U + '\\AppData\\Local\\Temp', 3),
    e(U + '\\.gradle', 4.7),
    e('C:\\ProgramData', 8), e('C:\\ProgramData\\NVIDIA Corporation', 8), e('C:\\ProgramData\\NVIDIA Corporation\\NVIDIA app', 8), e('C:\\ProgramData\\NVIDIA Corporation\\NVIDIA app\\UpdateFramework', 8), e('C:\\ProgramData\\NVIDIA Corporation\\NVIDIA app\\UpdateFramework\\ota-artifacts', 7.9),
    e('C:\\3uToolsV3', 16.7), e('C:\\3uToolsV3\\Firmware', 16.7),
  ],
});

test('caches: only uncritical folders inside your profile - never temp folders (Windows handles those), ProgramData or other drives\' folders', () => {
  const sp = LC.analyzeSpace(spaceRaw());
  const names = LC.apply.cacheItems(sp, S({}, null)).map((i) => i.path.replace(U, '~'));
  assert.ok(names.includes('~\\AppData\\Local\\npm-cache'));
  assert.ok(names.includes('~\\AppData\\Local\\NVIDIA\\DXCache'));
  assert.ok(names.includes('~\\.gradle'));
  assert.ok(!names.some((n) => /\\Temp$/.test(n)), 'user temp is for Windows\' own cleanup');
  assert.ok(!names.some((n) => /ProgramData|3uTools/i.test(n)));
  // what is already confirmed is not offered again
  const doc = LC.normalizeCleanup(null);
  LC.cleanup.addPath(doc, { path: U + '\\.gradle', kind: 'dir', name: 'x', bytes: 1 });
  LC.cleanup.confirm(doc, { id: LC.cleanup.pathId(U + '\\.gradle'), type: 'path' }, { ack: true });
  assert.ok(!LC.apply.cacheItems(sp, S({}, doc)).some((i) => /\.gradle$/.test(i.path)));
  assert.deepEqual(LC.apply.cacheItems(null, S({}, null)), []);
});
