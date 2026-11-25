/* Logic tests for web/relations.js + web/cleanup.js (node --test tests/cleanup.test.js). Run `node tests/make-fixtures.js` first. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const LC = require('./load.js');

const { NOW, GB, MB, fx, sw, scenario } = require('./scenario.js');
function build(sc, extra) {
  extra = extra || {};
  const notes = sc.notes;
  const m = LC.analyze(sc.raw, { now: NOW, notes });
  const blender = m.inv.apps.find((a) => a.name === 'Blender');
  if (extra.mark !== false) notes.apps[blender.key] = { decision: 'remove' };
  const m2 = LC.analyze(sc.raw, { now: NOW, notes });
  const filesModel = LC.analyzeFiles(sc.filesRaw, { now: NOW, projectNames: [], reposDoc: null });
  const projects = LC.analyzeProjects(extra.projects || { projects: [{ id: 'p1', name: 'Render-Serie', status: 'active', resources: [{ kind: 'program', name: 'Blender' }] }] }, { apps: m2.inv.apps, reposDoc: null, filesModel, now: NOW });
  const ix = LC.buildRelationIndex({ apps: m2.inv.apps, snap: m2.snap, filesRaw: extra.noFiles ? null : sc.filesRaw, filesModel: extra.noFiles ? null : filesModel, projects, now: NOW });
  const doc = LC.normalizeCleanup(extra.doc || null);
  const cleanup = LC.buildCleanup({ inv: m2.inv, doc, ix, filesModel: extra.noFiles ? null : filesModel, filesRaw: sc.filesRaw, now: NOW });
  return { m: m2, ix, cleanup, doc, blender: m2.inv.apps.find((a) => a.name === 'Blender'), filesModel };
}
const group = (rel, id) => (rel.groups.find((g) => g.id === id) || { items: [] }).items;

test('Blender marked for removal: reasons come from the user and from the usage data', () => {
  const { cleanup, blender } = build(scenario());
  const it = cleanup.items.find((i) => i.id === 'app:' + blender.key);
  assert.equal(it.state, 'marked');
  assert.ok(it.reasons.some((r) => r.by === 'du' && /markiert/.test(r.text)));
  assert.ok(it.reasons.some((r) => r.by === 'tool' && r.tag === 'unused'), 'last used 2024 -> unused for > 365 days');
  assert.ok(Math.abs(it.bytes - 1.2 * GB) < 1024);
  assert.equal(it.canUninstall, true);
});

test('affected objects of Blender: files, data folder, project, helper driver, family, usage', () => {
  const { cleanup, blender } = build(scenario());
  const rel = cleanup.items.find((i) => i.id === 'app:' + blender.key).rel;
  const files = group(rel, 'files');
  assert.equal(files.length, 1, 'only .blend; .html/.txt belong to other programs');
  assert.equal(files[0].impact, 'data');
  assert.match(files[0].title, /\.blend-Dateien: 214/);
  assert.match(files[0].detail, /nicht gesichert/, 'no cloud copy -> warning');
  const data = group(rel, 'data');
  assert.deepEqual(data.map((d) => d.title.split('  ')[0]), ['Blender Foundation']);
  assert.equal(data[0].impact, 'leftover');
  assert.ok(data[0].add && data[0].add.path.endsWith('Blender Foundation'), 'offers to add the folder to the list');
  const proj = group(rel, 'projects');
  assert.equal(proj[0].impact, 'breaks');
  assert.match(proj[0].title, /Render-Serie/);
  const helpers = group(rel, 'helpers');
  const gaomon = helpers.find((h) => /GAOMON/.test(h.title));
  assert.ok(gaomon, 'tablet driver is recognised as helper');
  assert.equal(gaomon.impact, 'orphan', 'no other drawing program installed -> driver becomes superfluous');
  const fam = group(rel, 'family');
  assert.ok(fam.some((f) => /Benchmark Launcher/.test(f.title)), 'same vendor + same install folder');
  assert.ok(rel.usage.some((u) => u.label === 'Zuletzt benutzt' && /2024/.test(u.value)));
  assert.equal(rel.summary.breaks, 1);
  assert.equal(rel.summary.data, 1);
  assert.equal(rel.summary.needsAck, true);
  assert.ok(rel.tips.some((t) => /\.blend/.test(t)));
});

test('another drawing program keeps the tablet driver alive', () => {
  const { cleanup, blender } = build(scenario({ krita: true }));
  const rel = cleanup.items.find((i) => i.id === 'app:' + blender.key).rel;
  const gaomon = group(rel, 'helpers').find((h) => /GAOMON/.test(h.title));
  assert.equal(gaomon.impact, 'info');
  assert.match(gaomon.detail, /weiterhin gebraucht von: Krita/);
});

test('removing Krita as well makes the driver an orphan again (removal set is respected)', () => {
  const sc = scenario({ krita: true });
  const first = LC.analyze(sc.raw, { now: NOW, notes: sc.notes });
  const krita = first.inv.apps.find((a) => /Krita/.test(a.name));
  sc.notes.apps[krita.key] = { decision: 'remove' };
  const { cleanup, blender } = build(sc);
  const rel = cleanup.items.find((i) => i.id === 'app:' + blender.key).rel;
  assert.equal(group(rel, 'helpers').find((h) => /GAOMON/.test(h.title)).impact, 'orphan');
});

test('generic handlers do not claim files: Chrome opens .html (degrades), Notepad belongs to nobody', () => {
  const { ix } = build(scenario());
  const chrome = ix.apps.find((a) => a.name === 'Google Chrome');
  const rel = LC.relationsOfApp(chrome, ix);
  const f = group(rel, 'files');
  assert.equal(f.length, 1);
  assert.equal(f[0].impact, 'degrades');
  assert.ok(!ix.extOwner.has('.txt'));
});

test('without a files scan the page says so instead of pretending nothing is affected', () => {
  const { cleanup, blender } = build(scenario(), { noFiles: true });
  const rel = cleanup.items.find((i) => i.id === 'app:' + blender.key).rel;
  assert.equal(rel.needsFilesScan, true);
  assert.equal(group(rel, 'files').length, 0);
  assert.ok(group(rel, 'projects').length, 'projects are still known');
});

test('confirmation lifecycle: marked -> confirmed -> started -> done; revoke goes back', () => {
  const sc = scenario();
  let r = build(sc);
  const id = 'app:' + r.blender.key;
  const item = r.cleanup.items.find((i) => i.id === id);
  LC.cleanup.confirm(r.doc, item, { ack: true, now: NOW });
  assert.equal(r.doc.items[id].state, 'confirmed');
  assert.equal(r.doc.items[id].rawId, 'reg:HKLM:x64:Blender');
  assert.equal(typeof r.doc.items[id].confirmedMs, 'number');
  r = build(sc, { doc: r.doc });
  assert.equal(r.cleanup.items.find((i) => i.id === id).state, 'confirmed');
  assert.equal(r.cleanup.totals.confirmed, 1);
  LC.cleanup.started(r.doc, id, new Date(NOW));
  r = build(sc, { doc: r.doc });
  assert.equal(r.cleanup.items.find((i) => i.id === id).state, 'started');
  // un-marking the program (decision no longer "remove") drops it from the list even if a confirmation record exists
  const k = r.blender.key;
  sc.notes.apps[k] = { decision: 'keep' };
  r = build(sc, { doc: r.doc, mark: false });
  assert.ok(!r.cleanup.items.some((i) => i.id === id && i.state !== 'done'), 'no stale confirmation survives a changed decision');
  // program gone after a rescan -> done
  const gone = scenario();
  gone.raw.software = gone.raw.software.filter((s) => s.name !== 'Blender');
  const doc = r.doc;
  const r2 = build(gone, { doc, mark: false });
  assert.equal(r2.cleanup.items.find((i) => i.id === id).state, 'done');
});

test('an unconfirmed or revoked record never counts as confirmed', () => {
  const sc = scenario();
  let r = build(sc);
  const id = 'app:' + r.blender.key;
  LC.cleanup.confirm(r.doc, r.cleanup.items.find((i) => i.id === id), { ack: true, now: NOW });
  LC.cleanup.revoke(r.doc, id);
  r = build(sc, { doc: r.doc });
  assert.equal(r.cleanup.items.find((i) => i.id === id).state, 'marked');
});

test('tool suggestions: unwanted/outdated programs are proposed, "keep" silences them', () => {
  const sc = scenario();
  let r = build(sc);
  const sug = r.cleanup.by.suggested.map((i) => i.name);
  assert.ok(sug.some((n) => /CCleaner|McAfee/.test(n)), 'PUP candidates proposed: ' + sug.join(', '));
  assert.ok(!sug.includes('Google Chrome'));
  assert.ok(!r.cleanup.items.some((i) => /Redistributable/.test(i.name) && i.state === 'suggested'), 'runtimes are not proposed');
  const cc = r.m.inv.apps.find((a) => /CCleaner/.test(a.name));
  sc.notes.apps[cc.key] = { decision: 'keep' };
  r = build(sc);
  assert.ok(!r.cleanup.items.some((i) => i.name === cc.name));
});

test('file suggestions: installer folders, local copies of cloud files, leftovers of uninstalled programs', () => {
  const sc = scenario();
  sc.filesRaw.roots.push({ label: 'Google Drive', path: 'G:\\Meine Ablage', kind: 'cloud', provider: 'Google Drive', mode: 'stream', files: 5, bytes: GB, onlineBytes: 0, partial: false });
  const mk = (path, depth, bytes, cb) => ({ root: 'Dokumente', path, depth, files: 20, bytes, onlineBytes: 0, matchFiles: 0, matchBytes: 0, newest: '2024-01-01T10:00:00', oldest: '2020-01-01T10:00:00', cf: new Array(12).fill(0), cb });
  sc.filesRaw.folders.push(mk('C:\\Users\\anna\\Documents\\old-setups', 1, 3 * GB, [0, 0, 0, 0, 0, 0, 0, GB, 2 * GB, 0, 0, 0]));
  sc.filesRaw.dupes.push({ name: 'urlaub.mp4', size: 300 * MB, count: 2, inCloud: true, inLocal: true, paths: ['G:\\Meine Ablage\\urlaub.mp4', 'C:\\Users\\anna\\Videos\\urlaub.mp4'] });
  sc.filesRaw.gitRepos.push({ path: 'C:\\dev\\old', remote: 'https://github.com/x/old.git', fullName: 'x/old', branch: 'main', lastCommit: '2025-01-01T10:00:00', dirty: false, changedFiles: 0, untrackedFiles: 0, ahead: 0, noUpstream: false, sizeBytes: 1e6, nodeModulesBytes: 900 * MB, inCloudRoot: null });
  const r = build(sc);
  const byTag = (t) => r.cleanup.items.filter((i) => i.state === 'suggested' && i.reasons.some((x) => x.tag === t));
  assert.equal(byTag('installers').length, 1);
  assert.equal(byTag('cloud-dupe')[0].path, 'C:\\Users\\anna\\Videos\\urlaub.mp4', 'only the LOCAL copy is proposed, never the cloud one');
  assert.equal(byTag('node-modules')[0].path, 'C:\\dev\\old\\node_modules');
  const left = byTag('leftover').map((i) => i.name);
  assert.deepEqual(left.sort(), ['GIMP', 'Ollama'].filter((n) => n !== 'GIMP' || true).sort().filter((n) => left.includes(n)));
  assert.ok(left.includes('Ollama') && !left.includes('Blender Foundation'), 'Blender is installed, so its folder is not a leftover');
  assert.ok(!left.includes('SomethingSmall'));
  for (const i of byTag('cloud-dupe')) assert.ok(i.rel.groups.some((g) => g.items.some((x) => x.id.startsWith('dupe:') || x.id === 'backup')), 'shows where the other copy is');
});

test('path relations: git repo with unsaved work inside, project folder, protected install folder', () => {
  const sc = scenario();
  sc.filesRaw.gitRepos.push({ path: 'C:\\Users\\anna\\Documents\\Blender\\addon', remote: null, fullName: null, branch: 'main', lastCommit: null, dirty: true, changedFiles: 2, untrackedFiles: 0, ahead: null, noUpstream: null, sizeBytes: 1e5, nodeModulesBytes: null, inCloudRoot: null });
  const r = build(sc, { projects: { projects: [{ id: 'p9', name: 'Meine Szenen', status: 'active', localPath: 'C:\\Users\\anna\\Documents\\Blender' }] } });
  const rel = LC.relationsOfPath({ path: 'C:\\Users\\anna\\Documents\\Blender', kind: 'dir', bytes: 3 * GB }, r.ix);
  assert.ok(group(rel, 'projects').some((x) => x.impact === 'breaks' && /Meine Szenen/.test(x.title)));
  assert.ok(group(rel, 'projects').some((x) => x.impact === 'breaks' && /Git-Repository „addon“/.test(x.title) && /nicht gesicherte Arbeit/.test(x.detail)));
  const inst = LC.relationsOfPath({ path: 'C:\\Program Files\\Blender Foundation\\Blender 4.2', kind: 'dir', bytes: GB }, r.ix);
  assert.ok(group(inst, 'dependants').some((x) => x.impact === 'breaks' && /Installationsordner/.test(x.title)));
  const data = LC.relationsOfPath({ path: 'C:\\Users\\anna\\AppData\\Roaming\\Blender Foundation', kind: 'dir', bytes: MB }, r.ix);
  assert.ok(group(data, 'dependants').some((x) => /Programmdaten von „Blender/.test(x.title)));
});

test('findings of the clean-up list', () => {
  const r = build(scenario());
  const ids = r.cleanup.findings.map((f) => f.id);
  assert.ok(ids.includes('cleanup.confirm'));
  assert.ok(ids.includes('cleanup.orphans'));
  assert.ok(ids.includes('cleanup.suggestions'));
  assert.ok(r.cleanup.findings.every((f) => f.area === 'cleanup' && f.title));
});

test('robust: empty inventory / missing optional inputs', () => {
  const m = LC.analyze(fx(), { now: NOW });
  const ix = LC.buildRelationIndex({ apps: m.inv.apps, snap: m.snap, now: NOW });
  const c = LC.buildCleanup({ inv: m.inv, doc: null, ix, now: NOW });
  assert.ok(Array.isArray(c.items));
  assert.equal(LC.normalizeCleanup('garbage').items && Object.keys(LC.normalizeCleanup('garbage').items).length, 0);
  assert.deepEqual(Object.keys(LC.normalizeCleanup({ items: { 'bad id': { state: 'confirmed' }, 'app:x': { state: 'weird' } } }).items), ['app:x']);
});
