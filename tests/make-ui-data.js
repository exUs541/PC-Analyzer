/* Writes a small data folder for manual browser tests: snapshot + scenario + files scan + repos + projects.
 *   node tests/make-ui-data.js <dir>      then:  LaptopCheck.exe --data-dir <dir> --web-root web   (or: dotnet run --project app/src/LaptopCheck.App -- --data-dir <dir> --web-root web) */
const fs = require('fs');
const path = require('path');
const LC = require('./load.js');
const { NOW, scenario } = require('./scenario.js');

const dir = process.argv[2];
if (!dir) { console.error('usage: node tests/make-ui-data.js <dir>'); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });
const sc = scenario({ krita: false });
const m = LC.analyze(sc.raw, { now: NOW, notes: sc.notes });
const blender = m.inv.apps.find((a) => a.name === 'Blender');
sc.notes.apps[blender.key] = { decision: 'remove', purpose: 'Hobby: 3D-Szenen' };
const w = (n, o) => fs.writeFileSync(path.join(dir, n), JSON.stringify(o));
w('snapshot.json', sc.raw);
fs.copyFileSync(path.join(__dirname, 'fixtures', 'main.prev.json'), path.join(dir, 'snapshot.prev.json'));
w('notes.json', { version: 1, apps: sc.notes.apps, hardware: {}, tasks: {}, customTasks: [], settings: { unusedDays: 365 } });
w('files.json', sc.filesRaw);
w('repos.json', { source: 'seed', syncedAt: '2026-10-20T10:00:00', users: ['demo'], errors: [], repos: [
  { fullName: 'demo/web-shop', name: 'web-shop', owner: 'demo', private: false, language: 'TypeScript', description: 'Kleiner Shop', pushedAt: '2026-10-10T10:00:00', url: 'https://github.com/demo/web-shop' },
  { fullName: 'demo/secret-tool', name: 'secret-tool', owner: 'demo', private: true, language: 'Python', description: 'Privates Werkzeug', pushedAt: '2026-09-01T10:00:00', url: 'https://github.com/demo/secret-tool' },
  { fullName: 'demo/old-thing', name: 'old-thing', owner: 'demo', private: false, language: 'C#', description: null, pushedAt: '2021-01-01T10:00:00', url: 'https://github.com/demo/old-thing' },
] });
w('projects.json', { version: 1, projects: [{ id: 'p_demo1', name: 'Render-Serie', status: 'active', description: 'Kurze 3D-Clips', due: '2026-11-15', repo: '', resources: [
  { id: 'r1', kind: 'program', name: 'Blender', state: 'auto' }, { id: 'r2', kind: 'program', name: 'DaVinci Resolve', state: 'auto' }, { id: 'r3', kind: 'file', name: 'Texturen', state: 'have' }, { id: 'r4', kind: 'hardware', name: 'Grafiktablett', state: 'missing' }],
  tasks: [{ id: 't1', text: 'Szene bauen', done: true }, { id: 't2', text: 'Rendern', done: false }] }] });
w('history.json', []);
w('winget-index.json', (sc.raw.updates || []).map((u) => ({ id: u.id, name: u.name })));
w('uninstall-index.json', sc.raw.software.filter((x) => x.uninstallString).map((x) => ({ id: x.id, name: x.name, uninstallString: x.uninstallString })));
w('config.json', { githubUsers: ['demo'] });
console.log('UI test data written to ' + dir);
