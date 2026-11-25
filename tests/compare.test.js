/* "Ordner vergleichen": what the page says about the server's result.   node --test tests/compare.test.js */
const test = require('node:test');
const assert = require('node:assert');
const LC = require('./load.js');

const GB = 1024 ** 3, MB = 1024 ** 2;
const c = (files, bytes) => ({ files, bytes });
const dir = (d, o) => ({ d, same: c(0, 0), onlyA: c(0, 0), onlyB: c(0, 0), changed: c(0, 0), moved: c(0, 0), ...o });

/** The shape POST /api/compare answers with: the old Drive folder against the live Drive. */
function raw(over) {
  return {
    a: 'C:\\Users\\Anna\\My Drive', b: 'G:\\Meine Ablage', deep: false, ignoreJunk: true, scannedAt: '2026-11-13T20:00:00', seconds: 41, partial: false,
    summary: { filesA: 140000, bytesA: 54 * GB, filesB: 145000, bytesB: 91 * GB, same: c(139800, 53 * GB), changed: c(2, 3 * MB), moved: c(5, 10 * MB), onlyA: c(88, 382 * MB), onlyB: c(5105, 37 * GB), ignored: 375, unverified: 0 },
    onlyA: [{ p: '99_Other\\Urlaub 2026\\video.mp4', s: 18 * MB, m: '2026-09-15T10:00:00' }, { p: '20_Family\\Ausweise\\pass.pdf', s: 5 * MB, m: '2025-01-02T10:00:00' }],
    onlyB: [{ p: '30_Neu\\plan.xlsx', s: 2 * MB, m: '2026-11-01T10:00:00' }],
    changed: [{ p: 'Steuer\\notiz.txt', sa: 100, sb: 4000, ma: '2026-01-01T10:00:00', mb: '2026-06-01T10:00:00', why: 'size' }, { p: 'a.bin', sa: 50, sb: 50, ma: '2026-01-01T10:00:00', mb: '2026-01-01T10:00:00', why: 'content' }],
    moved: [{ a: 'Fotos\\bild.jpg', b: 'Bilder\\2026\\bild.jpg', s: 3 * MB }],
    dirs: [
      dir('', { same: c(139800, 53 * GB), onlyA: c(88, 382 * MB), onlyB: c(5105, 37 * GB), changed: c(2, 3 * MB), moved: c(5, 10 * MB) }),
      dir('99_Other', { onlyA: c(60, 300 * MB) }), dir('99_Other\\Urlaub 2026', { onlyA: c(28, 227 * MB) }),
      dir('30_Neu', { onlyB: c(5000, 30 * GB) }), dir('Steuer', { same: c(10, MB), changed: c(1, 3 * MB) }), dir('Fotos', { moved: c(2, 5 * MB) }),
    ],
    cutOnlyA: false, cutOnlyB: true, cutChanged: false, cutMoved: false, cutDirs: false, ...(over || {}),
  };
}
const withSummary = (o) => { const r = raw(); r.summary = { ...r.summary, ...o }; return r; };

test('names: the last part of the path; when both are called the same, the parent is added', () => {
  assert.deepEqual(LC.compareNames('C:\\Users\\Anna\\My Drive', 'G:\\Meine Ablage\\'), ['My Drive', 'Meine Ablage']);
  assert.deepEqual(LC.compareNames('C:\\alt\\Dokumente', 'D:\\neu\\Dokumente'), ['alt\\Dokumente', 'neu\\Dokumente']);
});

test('verdict: different folders say what differs, in numbers', () => {
  const m = LC.compareModel(raw());
  assert.equal(m.verdict.sev, 'warn'); assert.equal(m.verdict.title, 'Die Ordner unterscheiden sich');
  assert.match(m.verdict.text, /88 nur in „My Drive“ \(382 MB\)/); assert.match(m.verdict.text, /5105 nur in „Meine Ablage“/);
  assert.match(m.verdict.text, /2 in beiden, aber verschieden/); assert.match(m.verdict.text, /5 verschoben oder umbenannt/);
});

test('verdict: identical, A inside B, B inside A, only moved', () => {
  const same = LC.compareModel(withSummary({ onlyA: c(0, 0), onlyB: c(0, 0), changed: c(0, 0), moved: c(0, 0) }));
  assert.equal(same.verdict.sev, 'ok'); assert.equal(same.verdict.title, 'Die Ordner sind gleich'); assert.match(same.verdict.text, /139800 Dateien liegen in beiden Ordnern/);
  const aInB = LC.compareModel(withSummary({ onlyA: c(0, 0), changed: c(0, 0), moved: c(0, 0) }));
  assert.equal(aInB.verdict.title, 'Alles aus „My Drive“ ist auch in „Meine Ablage“'); assert.match(aInB.verdict.text, /hat zusätzlich 5105 Dateien/);
  const bInA = LC.compareModel(withSummary({ onlyB: c(0, 0), changed: c(0, 0), moved: c(0, 0) }));
  assert.equal(bInA.verdict.title, 'Alles aus „Meine Ablage“ ist auch in „My Drive“'); assert.match(bInA.verdict.text, /„My Drive“ hat zusätzlich 88 Dateien/);
  const moved = LC.compareModel(withSummary({ onlyA: c(0, 0), onlyB: c(0, 0), changed: c(0, 0) }));
  assert.equal(moved.verdict.sev, 'info'); assert.match(moved.verdict.text, /5 Dateien liegen dort an einer anderen Stelle/);
});

test('notes: unfinished comparison, unverified content, ignored junk and what "gleich" means are said honestly', () => {
  const m = LC.compareModel({ ...raw(), partial: true, summary: { ...raw().summary, unverified: 3 } });
  assert.ok(m.notes.some((n) => /Zeitgrenze/.test(n)));
  assert.ok(m.notes.some((n) => /3 Dateien konnten nicht auf den Inhalt geprüft werden/.test(n)));
  assert.ok(m.notes.some((n) => /375 Verknüpfungen und Hilfsdateien/.test(n)));
  assert.ok(m.notes.some((n) => /gleicher Pfad und gleiche Größe/.test(n)));
  assert.ok(!LC.compareModel({ ...raw(), deep: true }).notes.some((n) => /gleicher Pfad und gleiche Größe/.test(n)), 'with content check the hint is not needed');
});

test('cards: five buckets with counts and sizes; "same" has no list', () => {
  const m = LC.compareModel(raw());
  assert.deepEqual(m.cards.map((x) => x.id), ['same', 'onlyA', 'onlyB', 'changed', 'moved']);
  assert.equal(m.cards[1].n, 88); assert.equal(m.cards[1].bytes, 382 * MB); assert.equal(m.cards[0].view, null);
});

test('tree: nested by folder, biggest difference first, parents added when a row is missing', () => {
  const m = LC.compareModel(raw());
  assert.deepEqual(m.tree.kids.map((k) => k.name), ['30_Neu', '99_Other', 'Fotos', 'Steuer'], 'by bytes that differ, biggest first');
  const other = m.tree.kids.find((k) => k.name === '99_Other');
  assert.equal(other.kids.length, 1); assert.equal(other.kids[0].name, 'Urlaub 2026'); assert.equal(other.kids[0].onlyA.n, 28);
  const orphan = LC.compareModel(raw({ dirs: [dir('X\\Y\\Z', { onlyB: c(1, 5) })] }));
  assert.equal(orphan.tree.kids[0].name, 'X'); assert.equal(orphan.tree.kids[0].kids[0].kids[0].name, 'Z');
  assert.equal(orphan.tree.kids[0].onlyA, undefined, 'a parent that was not in the data has no counts of its own');
});

test('rows: lists with folder and file name apart, filtered by text, moved shows both places', () => {
  const m = LC.compareModel(raw());
  const a = LC.compareRows(m, 'onlyA', '');
  assert.equal(a.length, 2); assert.equal(a[0].name, 'video.mp4'); assert.equal(a[0].dir, '99_Other\\Urlaub 2026');
  assert.deepEqual(LC.compareRows(m, 'onlyA', 'AUSWEIS').map((r) => r.name), ['pass.pdf'], 'case-insensitive');
  assert.deepEqual(LC.compareRows(m, 'onlyA', 'gibt es nicht'), []);
  const ch = LC.compareRows(m, 'changed', '');
  assert.equal(ch[0].newer, 'B'); assert.equal(ch[1].newer, null); assert.equal(ch[1].why, 'content');
  const mv = LC.compareRows(m, 'moved', '')[0];
  assert.equal(mv.dirA, 'Fotos'); assert.equal(mv.dirB, 'Bilder\\2026'); assert.equal(mv.nameA, 'bild.jpg');
  assert.equal(LC.compareRows(m, 'moved', 'bilder').length, 1, 'the filter looks at both paths');
});

test('csv: one line per difference, semicolon, quotes escaped, readable by Excel', () => {
  const r = raw(); r.onlyA[0].p = 'Ordner\\mit "Anführung".txt';
  const csv = LC.compareCsv(LC.compareModel(r));
  const lines = csv.replace('\uFEFF', '').split('\r\n');
  assert.equal(csv[0], '\uFEFF');
  assert.equal(lines.length, 1 + 2 + 1 + 2 + 1);
  assert.match(lines[0], /^"Art";"Pfad in My Drive";"Pfad in Meine Ablage"/);
  assert.match(lines[1], /^"Nur in My Drive";"Ordner\\mit ""Anführung"".txt";"";"\d+"/);
  assert.ok(lines.some((l) => /^"Verschoben";"Fotos\\bild.jpg";"Bilder\\2026\\bild.jpg"/.test(l)));
  assert.ok(lines.some((l) => /^"Verschieden \(Inhalt\)"/.test(l)));
});

test('no result yet: nothing to show', () => {
  assert.equal(LC.compareModel(null), null);
  assert.equal(LC.compareModel({}), null);
});
