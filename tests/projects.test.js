/* Logic tests for web/projects.js (node --test tests/projects.test.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const LC = require('./load.js');

const NOW = '2026-10-21T10:00:00';
const apps = [
  { name: 'Git', version: '2.47.0' }, { name: 'Visual Studio Code', version: '1.94' }, { name: 'Blender', version: '4.2' },
  { name: 'Google Chrome', version: '130' }, { name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)', version: '14.40' },
];
const reposDoc = {
  source: 'seed', repos: [
    { fullName: 'demo-user/ComputerManager', name: 'ComputerManager', owner: 'demo-user', private: true, language: 'PowerShell', pushedAt: '2026-10-20T10:00:00' },
    { fullName: 'demo-user/web-shop', name: 'web-shop', owner: 'demo-user', private: false, language: 'TypeScript', pushedAt: '2026-06-01T10:00:00' },
    { fullName: 'demo-user/old', name: 'old', owner: 'demo-user', private: false, language: 'Python', pushedAt: '2021-01-01T10:00:00' },
    { fullName: 'demo-user/forked', name: 'forked', owner: 'demo-user', private: false, language: 'Go', fork: true, pushedAt: '2026-10-01T10:00:00' },
    { fullName: 'demo-user/archived', name: 'archived', owner: 'demo-user', private: false, language: 'Go', archived: true, pushedAt: '2026-10-01T10:00:00' },
  ],
};
const filesModel = { repos: [{ path: 'C:\\dev\\cm', fullName: 'demo-user/ComputerManager', unsaved: true, lastCommit: '2026-10-19T10:00:00' }] };
const doc = {
  projects: [
    { id: 'p1', name: 'Render-Serie', status: 'active', due: '2026-10-25', resources: [
      { kind: 'program', name: 'Blender' }, { kind: 'program', name: 'DaVinci Resolve' }, { kind: 'program', name: 'node', state: 'later' },
      { kind: 'program', name: 'git' }, { kind: 'system', name: 'Render-PC' }, { kind: 'file', name: 'Texturen', state: 'have' }, { kind: 'hardware', name: 'Grafiktablett', state: 'missing' }] , tasks: [{ text: 'Szene bauen', done: true }, { text: 'Rendern' }] },
    { id: 'p2', name: 'Shop', status: 'active', repo: 'demo-user/web-shop', resources: [{ kind: 'program', name: 'Node.js' }, { kind: 'program', name: 'Docker Desktop', state: 'na' }], updatedAt: '2026-01-01T00:00:00' },
    { id: 'p3', name: 'Idee', status: 'idea', resources: [{ kind: 'program', name: 'Android Studio' }] },
  ],
};
const run = (d, extra) => LC.analyzeProjects(d || doc, Object.assign({ apps, reposDoc, filesModel, now: NOW }, extra || {}));

test('program matching: catalogue aliases, free names, no false positives', () => {
  assert.equal(LC.matchProgram('git', apps).app.name, 'Git');
  assert.equal(LC.matchProgram('VS Code', apps).app.name, 'Visual Studio Code');
  assert.equal(LC.matchProgram('Chrome', apps).app.name, 'Google Chrome');
  assert.equal(LC.matchProgram('Blender', apps).app.name, 'Blender');
  assert.equal(LC.matchProgram('node', apps), null);
  assert.equal(LC.matchProgram('DaVinci Resolve', apps), null);
  assert.equal(LC.matchProgram('C', apps), null, 'too short names never match');
});

test('resource states: auto for programs follows the inventory, manual states win, others stay open', () => {
  const m = run();
  const p1 = m.projects.find((p) => p.id === 'p1');
  const st = (n) => p1.resources.find((r) => r.name === n).effective;
  assert.equal(st('Blender'), 'have');
  assert.equal(st('DaVinci Resolve'), 'missing');
  assert.equal(st('node'), 'later');
  assert.equal(st('Render-PC'), 'open');
  assert.equal(st('Texturen'), 'have');
  assert.equal(st('Grafiktablett'), 'missing');
  assert.deepEqual(p1.counts, { have: 3, missing: 2, open: 1, later: 1, na: 0, required: 6 });
  assert.equal(p1.readyPct, 50);
  assert.equal(p1.tasksOpen, 1);
  assert.equal(p1.tasksDone, 1);
  assert.equal(p1.daysDue, 4);
});

test('repos are linked to projects and local clones; missing programs are grouped with winget ids', () => {
  const m = run();
  const shop = m.projects.find((p) => p.id === 'p2');
  assert.equal(shop.repoInfo.github.name, 'web-shop');
  assert.deepEqual(shop.missingPrograms.map((r) => r.name), ['Node.js']);
  const cm = m.repos.find((r) => r.name === 'ComputerManager');
  assert.equal(cm.clones.length, 1);
  assert.equal(m.repos[0].name, 'ComputerManager', 'most recently pushed first');
  const node = m.missing.find((x) => x.key === 'node');
  assert.equal(node.winget, 'OpenJS.NodeJS.LTS');
  assert.ok(node.why.includes('Projekt „Shop“'));
  assert.ok(!m.missing.some((x) => x.label === 'Android Studio'), 'ideas do not count as missing');
  assert.ok(m.missing.some((x) => /DaVinci/.test(x.label)));
  assert.equal(LC.wingetInstallCommands(m.missing).split('\n')[0].startsWith('winget install --id '), true);
});

test('drafts: recent repos without project; forks and archived are skipped', () => {
  const m = run();
  assert.deepEqual(m.drafts.map((r) => r.name), ['ComputerManager']);
  const d = LC.draftFromRepo(reposDoc.repos[0], NOW);
  assert.equal(d.status, 'active');
  assert.equal(d.repo, 'demo-user/ComputerManager');
  assert.deepEqual(d.resources.map((r) => r.name), ['Git', 'PowerShell 7', 'Visual Studio Code', 'GitHub-Konto']);
  assert.equal(LC.draftFromRepo(reposDoc.repos[2], NOW).status, 'paused');
});

test('findings: missing tools, due dates, stale projects, no repos', () => {
  const m = run();
  const ids = m.findings.map((f) => f.id);
  assert.ok(ids.includes('projects.missing-tools'));
  assert.ok(ids.includes('projects.due:p1'));
  assert.ok(ids.includes('projects.stale:p2'));
  assert.ok(!ids.includes('projects.no-repos'));
  assert.ok(m.findings.every((f) => f.area === 'projects'));
  const e = LC.analyzeProjects(null, { apps, reposDoc: null, now: NOW });
  assert.ok(e.findings.some((f) => f.id === 'projects.no-repos'));
  assert.equal(e.projects.length, 0);
});

test('robust: garbage documents are normalised', () => {
  const m = LC.analyzeProjects({ projects: [null, 5, { name: 'x', status: 'weird', resources: [null, { kind: 'nope', name: 'a' }], tasks: 'oops' }] }, { apps: null, now: NOW });
  assert.equal(m.projects.length, 1);
  assert.equal(m.projects[0].status, 'idea');
  assert.equal(m.projects[0].resources[0].kind, 'other');
});

test('a project can bundle several repositories (e.g. a family of browser extensions)', () => {
  const rd = { repos: ['a', 'b', 'c'].map((n, i) => ({ fullName: 'demo-bulk/' + n, name: n, owner: 'demo-bulk', language: 'JavaScript', pushedAt: ['2026-10-01', '2026-06-01', '2025-01-01'][i] + 'T10:00:00' })) };
  const d = { projects: [{ id: 'px', name: 'Extensions', status: 'active', repo: 'demo-bulk/a', repos: ['demo-bulk/b', 'demo-bulk/a'] }] };
  const m = LC.analyzeProjects(d, { apps, reposDoc: rd, filesModel: { repos: [{ path: 'C:\\dev\\b', fullName: 'demo-bulk/b', unsaved: true, lastCommit: '2026-10-19T10:00:00' }] }, now: NOW });
  const p = m.projects[0];
  assert.deepEqual(p.repos, ['demo-bulk/a', 'demo-bulk/b'], 'old "repo" field and "repos" merge without duplicates, first stays first');
  assert.equal(p.repoInfo.githubAll.length, 2);
  assert.equal(p.repoInfo.clones.length, 1);
  assert.equal(p.repoInfo.unsaved, true);
  assert.deepEqual(m.repos.find((r) => r.name === 'a').projectIds, ['px']);
  assert.deepEqual(m.repos.find((r) => r.name === 'c').projectIds, [], 'repo c is not in the project');
  assert.equal(p.idleDays, 2, 'latest activity of any repo counts');
});

test('tools are derived from project files of local clones, not only from the language', () => {
  const rd = { repos: [{ fullName: 'demo-bulk/vr', name: 'vr', owner: 'demo-bulk', language: 'C#', pushedAt: '2026-10-10T10:00:00' }, { fullName: 'demo-bulk/ext', name: 'ext', owner: 'demo-bulk', language: 'JavaScript', pushedAt: '2026-10-10T10:00:00' }] };
  const fm = { repos: [{ path: 'C:\\dev\\vr', fullName: 'demo-bulk/vr', markers: ['ProjectSettings', '*.sln'] }, { path: 'C:\\dev\\ext', fullName: 'demo-bulk/ext', markers: ['manifest.json'] }] };
  const m = LC.analyzeProjects(null, { apps, reposDoc: rd, filesModel: fm, now: NOW });
  const tools = (n) => m.repos.find((r) => r.name === n).tools.map((t) => t.key);
  assert.ok(tools('vr').includes('unityhub') && tools('vr').includes('vs'));
  assert.ok(tools('ext').includes('chrome') && !tools('ext').includes('unityhub'));
  const d = LC.draftFromRepos(rd.repos, { name: 'Mix', now: NOW, cloneOf: (r) => fm.repos.filter((c) => c.fullName === r.fullName) });
  assert.equal(d.name, 'Mix');
  assert.deepEqual(d.repos, ['demo-bulk/vr', 'demo-bulk/ext']);
  assert.ok(d.resources.some((r) => r.toolKey === 'unityhub') && d.resources.some((r) => r.toolKey === 'chrome'));
});
