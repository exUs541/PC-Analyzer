/* Shared test scenario: a fixture snapshot plus Blender, a tablet driver, a files scan and projects. */
const fs = require('fs');
const path = require('path');
const NOW = '2026-10-21T10:00:00';
const GB = 1024 ** 3, MB = 1024 ** 2;
const fx = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'main.json'), 'utf8'));
const sw = (name, publisher, loc, extra) => ({ id: 'reg:HKLM:x64:' + name, source: 'registry', name, version: '1.0', publisher, installDate: '2023-01-01', installDateSource: 'registry', installLocation: loc, displayIcon: null, uninstallString: 'MsiExec.exe /I{9F3A1B2C-0000-4000-8000-123456789ABC}', quietUninstall: null, sizeKB: 100000, sizeSource: 'registry', scope: 'machine', arch: 'x64', isSystemComponent: false, aboutUrl: null, regKey: name, ...(extra || {}) });

function scenario(opts) {
  opts = opts || {};
  const raw = fx();
  raw.software.push(sw('Blender', 'Blender Foundation', 'C:\\Program Files\\Blender Foundation\\Blender 4.2', { version: '4.2.1', sizeKB: 1.2 * 1024 * 1024 }));
  raw.software.push(sw('Blender Benchmark Launcher', 'Blender Foundation', 'C:\\Program Files\\Blender Foundation\\Blender 4.2'));
  raw.software.push(sw('GAOMON Tablet Driver', 'GAOMON Technology', 'C:\\Program Files (x86)\\GAOMON\\Driver'));
  if (opts.krita) raw.software.push(sw('Krita (x64) 5.2', 'Krita Foundation', 'C:\\Program Files\\Krita (x64)'));
  raw.usage.push({ source: 'UserAssist', path: '{6D809377-6AF0-444B-8957-A3773F02200E}\\Blender Foundation\\Blender 4.2\\blender-launcher.exe', lastRun: '2024-02-01T20:00:00', runCount: 9, focusSec: 36000 });
  const notes = { apps: {} };
  const filesRaw = {
    scannedAt: '2026-10-21T09:00:00', seconds: 10, providers: [], roots: [{ label: 'Dokumente', path: 'C:\\Users\\anna\\Documents', kind: 'local', files: 10, bytes: 5 * GB, onlineBytes: 0, partial: false }],
    folders: [{ root: 'Dokumente', path: 'C:\\Users\\anna\\Documents', depth: 0, files: 10, bytes: 5 * GB, onlineBytes: 0, matchFiles: 0, matchBytes: 0, newest: '2024-02-01T10:00:00', oldest: '2020-01-01T10:00:00', cf: new Array(12).fill(0), cb: new Array(12).fill(0) },
      { root: 'Dokumente', path: 'C:\\Users\\anna\\Documents\\Blender', depth: 1, files: 214, bytes: 3.2 * GB, onlineBytes: 0, matchFiles: 0, matchBytes: 0, newest: '2024-02-01T10:00:00', oldest: '2021-01-01T10:00:00', cf: new Array(12).fill(0), cb: new Array(12).fill(0) }],
    docs: [], big: [], dupes: [], cloudTree: [], gitRepos: [],
    exts: [
      { ext: '.blend', files: 214, bytes: 3.2 * GB, newest: '2024-02-01T10:00:00', cloudFiles: 0, handler: 'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender-launcher.exe', dirs: [{ p: 'C:\\Users\\anna\\Documents\\Blender', n: 200 }] },
      { ext: '.html', files: 30, bytes: 5 * MB, newest: '2026-01-01T10:00:00', cloudFiles: 0, handler: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', dirs: [] },
      { ext: '.txt', files: 900, bytes: 9 * MB, newest: '2026-01-01T10:00:00', cloudFiles: 0, handler: 'C:\\Windows\\system32\\NOTEPAD.EXE', dirs: [] },
    ],
    dataDirs: [
      { where: 'AppData', name: 'Blender Foundation', path: 'C:\\Users\\anna\\AppData\\Roaming\\Blender Foundation', bytes: 800 * MB, partial: false, modified: '2024-02-01T10:00:00' },
      { where: 'LocalAppData', name: 'Google', path: 'C:\\Users\\anna\\AppData\\Local\\Google', bytes: 3 * GB, partial: false, modified: '2026-10-01T10:00:00' },
      { where: 'AppData', name: 'GIMP', path: 'C:\\Users\\anna\\AppData\\Roaming\\GIMP', bytes: 120 * MB, partial: false, modified: '2022-01-01T10:00:00' },
      { where: 'LocalAppData', name: 'Ollama', path: 'C:\\Users\\anna\\AppData\\Local\\Ollama', bytes: 9 * GB, partial: false, modified: '2025-01-01T10:00:00' },
      { where: 'LocalAppData', name: 'SomethingSmall', path: 'C:\\Users\\anna\\AppData\\Local\\SomethingSmall', bytes: 1 * MB, partial: false, modified: null },
    ],
  };
  return { raw, notes, filesRaw };
}

module.exports = { NOW, GB, MB, fx, sw, scenario };
