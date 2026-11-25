/* Speicher-Baum (jede Ebene = Summe der Ebene darunter) und Abgleich des alten Drive-Ordners mit dem echten Drive.
 *   node --test tests/leftover.test.js */
const test = require('node:test');
const assert = require('node:assert');
const LC = require('./load.js');

const GB = 1024 ** 3;
const e = (path, gb, depth) => ({ path, bytes: Math.round(gb * GB), depth });

/** 500 GB drive, 50 free; the scan read 425 GB, 25 GB could not be read (needs administrator rights). */
function raw() {
  return {
    schema: 1, scannedAt: '2026-11-13T10:00:00', seconds: 50, root: 'C:\\', partial: false,
    totalBytes: 500 * GB, freeBytes: 50 * GB, scannedBytes: 425 * GB,
    files: [{ path: 'C:\\hiberfil.sys', bytes: 10 * GB }],
    unreadable: ['C:\\System Volume Information'],
    entries: [
      e('C:\\Program Files', 150, 1), e('C:\\Program Files\\Epic Games', 60, 2), e('C:\\Program Files\\Unity 6000', 40, 2),
      e('C:\\Users', 200, 1), e('C:\\Users\\anna', 200, 2), e('C:\\Users\\anna\\My Drive', 54, 3), e('C:\\Users\\anna\\Documents', 30, 3),
      e('C:\\Windows', 60, 1),
    ],
  };
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
const STREAMED = { id: 'gdrive', name: 'Google Drive', mode: 'stream', root: 'G:\\Meine Ablage', detectedBy: 'drive G:' };
const OLD = { id: 'gdrive', name: 'Google Drive', mode: 'leftover', root: 'C:\\Users\\anna\\My Drive', detectedBy: 'folder in profile: My Drive' };
const COMPARE = (over) => ({
  localRoot: OLD.root, liveRoot: STREAMED.root, files: 140298, bytes: 54.2 * GB,
  same: { files: 139821, bytes: 53.8 * GB }, nameSize: { files: 36, bytes: 1e6 }, junk: { files: 0, bytes: 0 }, only: { files: 441, bytes: 0.4 * GB },
  partial: false, livePartial: false, seconds: 80,
  onlyDirs: [{ dir: OLD.root + '\\99_Other\\Urlaub 2026', files: 400, bytes: 0.3 * GB }], onlyDirsMore: 0,
  onlyTop: [{ p: OLD.root + '\\99_Other\\Urlaub 2026\\v.mp4', s: 18e6, m: '2026-09-15T10:00:00' }], ...over,
});

test('tree: the root is what is used, and every level adds up to the one above (nothing lost, nothing counted twice)', () => {
  const t = LC.analyzeSpace(raw()).tree;
  assert.equal(t.bytes, 450 * GB, 'used = total - free');
  assert.equal(t.unreadable, 25 * GB, 'used - read');
  assert.equal(sum(t.kids.map((k) => k.bytes)) + t.rest + t.unreadable, t.bytes, 'level 0 adds up');
  const check = (n) => {
    if (!n.kids.length) return;
    assert.equal(sum(n.kids.map((k) => k.bytes)) + n.rest, n.bytes, n.name + ' adds up');
    n.kids.forEach(check);
  };
  t.kids.forEach(check);
  assert.deepEqual(t.kids.map((k) => k.bytes), [...t.kids.map((k) => k.bytes)].sort((a, b) => b - a), 'biggest first');
});

test('tree: a folder with one big sub folder is shown as one line; classified folders keep their explanation', () => {
  const t = LC.analyzeSpace(raw()).tree;
  const names = t.kids.map((k) => k.name);
  assert.ok(names.includes('Users\\anna'), 'Users has only "anna" in it: one line');
  assert.ok(names.includes('Program Files') && names.includes('Windows') && names.includes('hiberfil.sys'));
  const anna = t.kids.find((k) => k.name === 'Users\\anna');
  assert.equal(anna.kids.length, 2); assert.equal(anna.rest, 116 * GB, '200 - 54 - 30');
  const drive = anna.kids.find((k) => k.name === 'My Drive');
  assert.ok(drive.item && drive.item.group === 'cloud', 'a node knows its item (group, safety, hint)');
  assert.equal(t.kids.find((k) => k.name === 'hiberfil.sys').item.kind, 'file');
});

test('tree: without a used value (no free space known) the tree still adds up to what was read', () => {
  const r = raw(); delete r.totalBytes; delete r.freeBytes;
  const t = LC.analyzeSpace(r).tree;
  assert.equal(t.bytes, 425 * GB); assert.equal(t.unreadable, 0);
  assert.equal(sum(t.kids.map((k) => k.bytes)) + t.rest, t.bytes);
});

test('old Drive folder compared with the live Drive: the hint says how much is already there and what is missing', () => {
  const hintOf = (c) => LC.analyzeSpace(raw(), { providers: [STREAMED, { ...OLD, compare: c }] }).items.find((i) => /My Drive/.test(i.label)).hint;
  const h = hintOf(COMPARE());
  assert.match(h, /99 % davon \(53,8 GB\) liegen unverändert schon im Drive/);
  assert.match(h, /Nur 441 Dateien \(410 MB\) fehlen im Drive/); assert.match(h, /Hausordnung/); assert.match(h, /Papierkorb/);
  assert.match(hintOf(COMPARE({ only: { files: 0, bytes: 0 } })), /Im Drive fehlt nichts/);
  assert.match(hintOf(COMPARE({ partial: true })), /Zeitgrenze/);
});

function model(compare) {
  const fx = JSON.parse(JSON.stringify(require('./fixtures/main.json')));
  const files = {
    scannedAt: '2026-11-13T10:00:00', seconds: 30, catNames: [], docs: [], big: [], dupes: [], folders: [], cloudTree: [], gitRepos: [], exts: [], dataDirs: [],
    providers: [STREAMED, compare ? { ...OLD, compare } : OLD],
    roots: [{ label: 'Google Drive', path: STREAMED.root, kind: 'cloud', provider: 'Google Drive', mode: 'stream', files: 100, bytes: 5 * GB, onlineBytes: 5 * GB, partial: false, seconds: 3 }],
  };
  return LC.analyze(fx, { now: '2026-11-13T10:00:00', files, space: raw() });
}

test('the comparison turns into numbers, a precise task, a house card and a savings lever', () => {
  const m = model(COMPARE());
  const lc = LC.leftoverCompare(m.files.providers.find((p) => p.mode === 'leftover'));
  assert.equal(lc.pct, 99); assert.equal(lc.onlyFiles, 441); assert.equal(lc.inDriveFiles, 139857);
  assert.equal(LC.leftoverCompare({ mode: 'leftover' }), null, 'without a comparison there is no number');
  const t = m.findings.find((x) => x.id === 'files.drive-leftover');
  assert.match(t.title, /99 % liegen schon im Drive, 441 Dateien fehlen dort/);
  assert.match(t.action, /fehlenden Dateien ins Drive kopieren/);
  assert.ok(t.steps.some((x) => /Papierkorb/.test(x)) && t.steps.some((x) => /Hausordnung/.test(x)));
  assert.equal(m.house.drive.compare.onlyFiles, 441); assert.equal(m.house.drive.liveRoot, STREAMED.root);
  const lever = m.savings.levers.find((l) => l.id === 'drive');
  assert.equal(lever.page, 'house'); assert.match(lever.detail, /99 % liegen schon im Drive, 441 Dateien/);
});

test('nothing missing in the Drive: the task says so and has a single step', () => {
  const t = model(COMPARE({ only: { files: 0, bytes: 0 } })).findings.find((x) => x.id === 'files.drive-leftover');
  assert.match(t.title, /im Drive fehlt nichts/); assert.equal(t.steps.length, 1); assert.match(t.steps[0], /Papierkorb/);
});

test('not compared yet: no invented numbers, the lever points to the files scan', () => {
  const m = model(null);
  assert.equal(m.house.drive.compare, null);
  const lever = m.savings.levers.find((l) => l.id === 'drive');
  assert.equal(lever.page, 'files'); assert.match(lever.detail, /Dateien-Scan/);
});
