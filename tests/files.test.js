/* Logic tests for web/files.js (node --test tests/files.test.js).
 * FILES_JSON=<path>  optional: a real result of `LaptopCheck.exe --scan-files-only --out <path>` is checked as well (contract). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const LC = require('./load.js');

const NOW = '2026-10-21T10:00:00';
const GB = 1024 ** 3;
const cats = (o) => { const a = new Array(12).fill(0); Object.entries(o).forEach(([i, v]) => { a[i] = v; }); return a; };
const folder = (root, path, depth, bytes, cb, extra) => ({ root, path, depth, files: Math.max(1, Math.round(bytes / 100000)), bytes, onlineBytes: 0, matchFiles: 0, matchBytes: 0, newest: '2026-09-01T10:00:00', oldest: '2020-01-01T10:00:00', cf: cats({}), cb: cats(cb), ...(extra || {}) });

function synthetic() {
  const D = 'C:\\Users\\Anna';
  return {
    scannedAt: '2026-10-21T09:00:00', seconds: 12, catNames: [], gitAvailable: true,
    providers: [{ id: 'gdrive', name: 'Google Drive', mode: 'stream', root: 'G:\\Meine Ablage', detectedBy: 'test' }],
    roots: [
      { label: 'Google Drive', path: 'G:\\Meine Ablage', kind: 'cloud', provider: 'Google Drive', mode: 'stream', files: 900, bytes: 4 * GB, onlineBytes: 3 * GB, partial: false },
      { label: 'Dokumente', path: D + '\\Documents', kind: 'local', files: 500, bytes: 30 * GB, onlineBytes: 0, partial: false },
      { label: 'Downloads', path: D + '\\Downloads', kind: 'local', files: 80, bytes: 12 * GB, onlineBytes: 0, partial: true },
    ],
    folders: [
      folder('Google Drive', 'G:\\Meine Ablage', 0, 4 * GB, { 3: GB }, { files: 900 }),
      folder('Google Drive', 'G:\\Meine Ablage\\Steuer', 1, GB, { 3: GB }),
      folder('Google Drive', 'G:\\Meine Ablage\\Fotos', 1, 2 * GB, { 4: 2 * GB }),
      folder('Google Drive', 'G:\\Meine Ablage\\Alt', 1, GB, { 3: GB }),
      folder('Dokumente', D + '\\Documents', 0, 30 * GB, { 3: 3 * GB, 4: 12 * GB, 5: 15 * GB }),
      folder('Dokumente', D + '\\Documents\\Steuer', 1, 3 * GB, { 3: 3 * GB }, { matchFiles: 20, matchBytes: GB }),
      folder('Dokumente', D + '\\Documents\\Urlaub', 1, 12 * GB, { 4: 12 * GB }),
      folder('Dokumente', D + '\\Documents\\Blender', 1, 15 * GB, { 5: 15 * GB }),
      folder('Dokumente', D + '\\Documents\\Scripts', 1, GB, { 9: GB }),
      folder('Dokumente', D + '\\Documents\\demo-app', 1, 2 * GB, { 3: 2 * GB }),
      folder('Downloads', D + '\\Downloads', 0, 12 * GB, { 8: 6 * GB, 7: 4 * GB, 5: 2 * GB }),
      folder('Downloads', D + '\\Downloads\\old-setups', 1, 8 * GB, { 8: 6 * GB, 7: 2 * GB }),
    ],
    docs: [
      { p: D + '\\Documents\\Steuer\\a.pdf', s: 1000, m: '2025-01-01T10:00:00', c: 'pdf', cloud: 'G:\\Meine Ablage\\Steuer\\a.pdf' },
      { p: D + '\\Documents\\Steuer\\b.pdf', s: 2000, m: '2025-01-02T10:00:00', c: 'pdf', cloud: null },
    ],
    big: [{ p: D + '\\Downloads\\win.iso', s: 5 * GB, m: '2022-01-01T10:00:00', c: 'archives', cloud: null }],
    dupes: [{ name: 'a.pdf', size: 600 * 1024 * 1024, count: 2, inCloud: true, inLocal: true, paths: [] }, { name: 'b.mp4', size: 300 * 1024 * 1024, count: 3, inCloud: true, inLocal: false, paths: [] }],
    cloudTree: [{ provider: 'Google Drive', providerId: 'gdrive', mode: 'stream', root: 'G:\\Meine Ablage', files: 900, bytes: 4 * GB, rootFiles: 30, maxDepth: 9, emptyDirs: 40, nativeDocs: 10, partial: false, topFolders: ['Steuer', 'Fotos', 'Alt'], nameIssues: { unbenannt: 12 }, nameIssueSamples: ['G:\\Meine Ablage\\Unbenannt.docx'] }],
    gitRepos: [
      { path: D + '\\dev\\a', remote: 'https://github.com/x/a.git', fullName: 'x/a', branch: 'main', lastCommit: '2026-10-01T10:00:00', dirty: false, changedFiles: 0, untrackedFiles: 0, ahead: 0, noUpstream: false, sizeBytes: 5e6, nodeModulesBytes: 2 * GB, inCloudRoot: null },
      { path: D + '\\dev\\b', remote: null, fullName: null, branch: 'main', lastCommit: '2026-10-01T10:00:00', dirty: true, changedFiles: 3, untrackedFiles: 1, ahead: null, noUpstream: null, sizeBytes: 1e6, nodeModulesBytes: null, inCloudRoot: null },
      { path: 'G:\\Meine Ablage\\repo', remote: null, fullName: null, branch: 'main', lastCommit: null, dirty: false, changedFiles: 0, untrackedFiles: 0, ahead: 0, noUpstream: true, sizeBytes: 1e6, nodeModulesBytes: null, inCloudRoot: 'G:\\Meine Ablage' },
    ],
  };
}
const ctx = { now: NOW, projectNames: ['demo-app'], reposDoc: { repos: [{ fullName: 'x/a', name: 'a' }] }, cFree: { pct: 12, bytes: 20 * GB } };
const ids = (m) => m.findings.map((f) => f.id);
const find = (m, id) => m.findings.find((f) => f.id === id);

test('path helpers work for Windows and POSIX paths', () => {
  assert.ok(LC.pathUnder('C:\\Users\\Anna\\Documents\\x', 'c:/users/anna'));
  assert.ok(!LC.pathUnder('C:\\Users\\Annabelle', 'C:\\Users\\Anna'));
  assert.equal(LC.joinPath('G:\\Meine Ablage\\', '05 Projekte', 'A/B'), 'G:\\Meine Ablage\\05 Projekte\\A\\B');
  assert.equal(LC.joinPath('/mnt/drive', '05 Projekte'), '/mnt/drive/05 Projekte');
  assert.equal(LC.safeFolderName('a:b*c?. '), 'a_b_c_');
});

test('target suggestion: installers are deleted, media goes to Medien, project names win, finance rules apply', () => {
  const m = LC.analyzeFiles(synthetic(), ctx);
  const by = (n) => m.candidates.find((c) => c.name === n);
  assert.equal(by('old-setups').suggestion.action, 'delete');
  assert.equal(by('Urlaub').suggestion.target, '06 Medien/Fotos/Urlaub');
  assert.equal(by('Blender').suggestion.target, '06 Medien/Videos/Blender');
  assert.equal(by('demo-app').suggestion.target, '05 Projekte/demo-app');
  assert.equal(by('demo-app').suggestion.rule, 'project');
  assert.equal(by('Steuer').suggestion.target, '02 Finanzen/Steuer');
  assert.equal(by('Scripts').suggestion.action, 'git');
});

test('totals: freeable space counts only cloud-bound top folders, local = total minus online-only', () => {
  const m = LC.analyzeFiles(synthetic(), ctx);
  assert.equal(m.totals.freeableBytes, 3 * GB + 12 * GB + 15 * GB + 2 * GB);
  assert.equal(m.totals.docsLocalOnlyCount, 1);
  assert.equal(m.localCloudDupes.length, 1);
  assert.ok(m.candidates.every((c) => c.depth >= 1 && m.localRoots.some((r) => r.label === c.root)));
  assert.equal(m.candidates[0].name, 'Blender', 'largest first');
});

test('cloud structure analysis finds loose files, bad names, deep trees, duplicates, missing structure', () => {
  const m = LC.analyzeFiles(synthetic(), ctx);
  const c = m.cloud[0];
  const issueIds = c.issues.map((i) => i.id);
  for (const id of ['loose-root', 'deep', 'names', 'empty', 'dupes']) assert.ok(issueIds.includes(id), id);
  assert.equal(c.issues.find((i) => i.id === 'loose-root').severity, 'warn');
  assert.ok(c.score < 70 && c.score >= 0);
  assert.deepEqual(c.map.map((x) => x.existing).sort(), ['Alt', 'Fotos', 'Steuer'].sort().filter((n) => c.map.some((x) => x.existing === n)));
  assert.ok(c.map.find((x) => x.existing === 'Steuer').suggested.startsWith('02 Finanzen'));
  assert.ok(c.map.find((x) => x.existing === 'Fotos').suggested.startsWith('06 Medien'));
  assert.equal(c.missing.length, 8, 'no numbered folders exist yet');
  assert.ok(c.wastedBytes >= 2 * 300 * 1024 * 1024);
});

test('findings: movable space, local-only docs, installers, git, partial scan', () => {
  const m = LC.analyzeFiles(synthetic(), ctx);
  const f = find(m, 'files.movable');
  assert.ok(f && f.severity === 'warn', 'low free space on C: makes it a warning');
  assert.ok(ids(m).includes('files.partial:Downloads'));
  assert.ok(ids(m).includes('files.local-cloud-dupes'));
  assert.ok(ids(m).includes('files.big'));
  const unsaved = find(m, 'repos.unsaved');
  assert.ok(unsaved && /b:/.test(unsaved.detail), 'repo b has no remote and uncommitted work');
  assert.ok(!/ a:/.test(unsaved.detail), 'repo a is clean');
  assert.ok(ids(m).includes('repos.in-cloud'));
  assert.ok(ids(m).includes('repos.node-modules'));
  assert.ok(m.findings.every((x) => x.area === 'files' && x.title && x.severity));
});

test('findings: mirror mode and missing cloud are reported', () => {
  const raw = synthetic();
  raw.providers = [{ id: 'gdrive', name: 'Google Drive', mode: 'mirror', root: 'C:\\Users\\Anna\\Google Drive' }];
  let m = LC.analyzeFiles(raw, ctx);
  assert.ok(find(m, 'files.mirror-mode'));
  raw.providers = [];
  m = LC.analyzeFiles(raw, ctx);
  assert.ok(find(m, 'files.no-cloud'));
  assert.ok(!find(m, 'files.movable'), 'nothing can be moved without a cloud folder');
});

test('repos: GitHub list is linked by full name, problems are classified', () => {
  const m = LC.analyzeFiles(synthetic(), ctx);
  const a = m.repos.find((r) => r.name === 'a');
  assert.equal(a.github.fullName, 'x/a');
  assert.equal(a.unsaved, false);
  const b = m.repos.find((r) => r.name === 'b');
  assert.deepEqual(b.problems.map((p) => p.id), ['no-remote', 'dirty']);
  const c = m.repos.find((r) => r.name === 'repo');
  assert.ok(c.problems.some((p) => p.id === 'in-cloud'));
});

test('robust against empty or partial input', () => {
  const m = LC.analyzeFiles({}, {});
  assert.equal(m.candidates.length, 0);
  assert.ok(find(m, 'files.no-cloud'));
  const m2 = LC.analyzeFiles({ roots: [{ label: 'x', path: '/x', kind: 'local' }], folders: [{ root: 'x', path: '/x/y', depth: 1, files: 1, bytes: 10, cb: null, cf: null }] }, {});
  assert.equal(m2.candidates.length, 1);
});

const real = process.env.FILES_JSON && fs.existsSync(process.env.FILES_JSON) ? JSON.parse(fs.readFileSync(process.env.FILES_JSON, 'utf8')) : null;
test('contract: real PowerShell scan output is understood', { skip: !real }, () => {
  const m = LC.analyzeFiles(real, { now: real.scannedAt, projectNames: [], reposDoc: null });
  assert.ok(m.present && m.roots.length >= 4);
  assert.equal(m.cloud.length, 1);
  assert.ok(m.candidates.length >= 2);
  assert.equal(m.repos.length, 3);
  assert.ok(m.repos.filter((r) => r.unsaved).length === 3);
  assert.ok(m.localCloudDupes.length === 1);
  assert.ok(Array.isArray(real.exts) && real.exts.length > 3 && Array.isArray(real.dataDirs));
});
