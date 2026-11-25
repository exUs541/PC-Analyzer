#!/usr/bin/env node
/* Writes a complete, invented data folder for the dashboard: a pretend laptop with a nearly full C:, a Google Drive that streams to G:,
 * an old mirror folder of that Drive, a messy Downloads folder, a storage analysis and a folder comparison.
 * Nothing in it comes from a real PC - it exists for screenshots, demos and manual testing.
 *
 *   node tests/make-fixtures.js            (once: writes tests/fixtures/*.json, the base snapshot)
 *   node tools/make-demo-data.js demo-data
 *   LaptopCheck.exe --data-dir demo-data --web-root web          (or: dotnet run --project app/src/LaptopCheck.App -- --data-dir demo-data --web-root web)
 */
const fs = require('fs');
const path = require('path');

const out = process.argv[2];
if (!out) { console.error('usage: node tools/make-demo-data.js <output folder>'); process.exit(1); }
const base = path.join(__dirname, '..', 'tests', 'fixtures', 'main.json');
if (!fs.existsSync(base)) { console.error('Run "node tests/make-fixtures.js" first.'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });

const GB = 1024 ** 3, MB = 1024 ** 2;
const NOW = Date.now();
const iso = (daysAgo, hour = 10) => { const d = new Date(NOW - daysAgo * 86400000); d.setHours(hour, 0, 0, 0); return d.toISOString().slice(0, 19); };
const write = (name, obj) => fs.writeFileSync(path.join(out, name), JSON.stringify(obj));
const U = 'C:\\Users\\anna';
const DRIVE = 'G:\\Meine Ablage';
const OLD = U + '\\My Drive';

/* ---- system snapshot: the invented laptop of the test fixtures, with a C: that is nearly full */
const snap = JSON.parse(fs.readFileSync(base, 'utf8'));
snap.collectedAt = iso(0, new Date(NOW).getHours());
const c = (snap.volumes || []).find((v) => String(v.letter).toUpperCase() === 'C');
if (c) { c.sizeBytes = 476 * GB; c.freeBytes = 11.3 * GB; }
write('snapshot.json', snap);
const prev = JSON.parse(JSON.stringify(snap));
prev.collectedAt = iso(7);
const cp = (prev.volumes || []).find((v) => String(v.letter).toUpperCase() === 'C');
if (cp) cp.freeBytes = 31 * GB;
write('snapshot.prev.json', prev);
write('history.json', [30, 23, 16, 9, 2].map((d, i) => ({ t: iso(d), score: 74 - i * 2, cFreeGB: 62 - i * 11, ramUsedPct: 41 + i, programs: 96 + i * 2, unused: 11 + i, batteryHealthPct: 72 })));

/* ---- files scan */
const cats = (o) => { const a = new Array(12).fill(0); Object.entries(o).forEach(([i, v]) => { a[i] = v; }); return a; };
// category indexes: 3 pdf, 4 images, 5 video, 7 archives, 8 installers, 9 code
const folder = (root, p, depth, bytes, cb, extra) => ({ root, path: p, depth, files: Math.max(1, Math.round(bytes / 150000)), bytes, onlineBytes: 0, matchFiles: 0, matchBytes: 0, newest: iso(5), oldest: iso(1500), cf: cats({}), cb: cats(cb), ...(extra || {}) });
const docs = (name, mb, days, cb) => folder('Dokumente', U + '\\Documents\\' + name, 1, mb * MB, cb || { 3: mb * MB }, { newest: iso(days) });
const dl = (name, mb, days, cb, extra) => folder('Downloads', U + '\\Downloads\\' + name, 1, mb * MB, cb || { 4: mb * MB }, { newest: iso(days), ...(extra || {}) });
const copyInCloud = (f) => ({ ...f, files: 20000, matchFiles: 20000 });
const compare = {
  localRoot: OLD, liveRoot: DRIVE, files: 140298, bytes: 54.2 * GB, same: { files: 139809, bytes: 53.8 * GB }, nameSize: { files: 12, bytes: 4 * MB },
  junk: { files: 375, bytes: 2 * MB }, only: { files: 88, bytes: 382 * MB }, partial: false, livePartial: false, seconds: 23,
  onlyDirs: [
    { dir: OLD + '\\05_Medien\\Urlaub 2026', files: 28, bytes: 227 * MB }, { dir: OLD + '\\03_Studium\\Seminar\\Material', files: 2, bytes: 45 * MB },
    { dir: OLD + '\\01_Privat\\Dokumente\\Scans', files: 4, bytes: 20 * MB }, { dir: OLD + '\\03_Studium\\Buecher', files: 1, bytes: 16 * MB }, { dir: OLD + '\\04_Wohnung\\Auszug\\Bilder', files: 4, bytes: 14 * MB },
  ],
  onlyDirsMore: 0,
  onlyTop: [{ p: OLD + '\\05_Medien\\Urlaub 2026\\strand.mp4', s: 18 * MB, m: iso(70) }, { p: OLD + '\\01_Privat\\Dokumente\\Scans\\reisepass.pdf', s: 6 * MB, m: iso(400) }],
};
write('files.json', {
  scannedAt: iso(0, new Date(NOW).getHours()), seconds: 34, catNames: ['documents', 'spreadsheets', 'presentations', 'pdf', 'images', 'video', 'audio', 'archives', 'installers', 'code', 'data', 'other'], gitAvailable: true,
  providers: [
    { id: 'gdrive', name: 'Google Drive', mode: 'stream', root: DRIVE, detectedBy: 'drive G: ("Meine Ablage")' },
    { id: 'gdrive', name: 'Google Drive', mode: 'leftover', root: OLD, detectedBy: 'folder in profile: My Drive (left over from an old mirror setup)', compare },
  ],
  roots: [
    { label: 'Google Drive', path: DRIVE, kind: 'cloud', provider: 'Google Drive', mode: 'stream', files: 145121, bytes: 91 * GB, onlineBytes: 86 * GB, partial: false, seconds: 12 },
    { label: 'Dokumente', path: U + '\\Documents', kind: 'local', files: 162146, bytes: 14.5 * GB, onlineBytes: 0, partial: false, seconds: 9 },
    { label: 'Downloads', path: U + '\\Downloads', kind: 'local', files: 4210, bytes: 8.5 * GB, onlineBytes: 0, partial: false, seconds: 2 },
    { label: 'Videos', path: U + '\\Videos', kind: 'local', files: 10, bytes: 1.9 * GB, onlineBytes: 0, partial: false, seconds: 1 },
  ],
  folders: [
    folder('Google Drive', DRIVE, 0, 91 * GB, { 3: 20 * GB, 4: 40 * GB, 5: 20 * GB }, { files: 145121, onlineBytes: 86 * GB }),
    folder('Dokumente', U + '\\Documents', 0, 14.5 * GB, { 3: 2 * GB, 4: 4 * GB, 7: 4 * GB, 9: 1.2 * GB }),
    docs('Urlaub 2024', 3800, 400, { 4: 3800 * MB }), docs('Steuer', 900, 12), copyInCloud(docs('Bewerbungen', 640, 300)), docs('Skripte', 520, 330, { 9: 520 * MB }), docs('Studium', 2400, 210), docs('Projekt Alpha', 1800, 6, { 9: 1800 * MB }),
    folder('Downloads', U + '\\Downloads', 0, 8.5 * GB, { 7: 4 * GB, 8: 2.6 * GB, 4: 800 * MB }),
    dl('Treiber und Installer', 1900, 140, { 8: 1700 * MB, 7: 200 * MB }), dl('Fotos Hochzeit', 1400, 180, { 4: 1400 * MB }), dl('Neu', 700, 9), dl('Backup-2023.zip-Ordner', 900, 520, { 7: 900 * MB }),
  ],
  docs: [], dupes: [], cloudTree: [],
  big: [
    { p: U + '\\Downloads\\ubuntu-24.04-desktop-amd64.iso', s: 5.9 * GB, m: iso(210), c: 'installers', cloud: null },
    { p: U + '\\Downloads\\Setup-Toolbox-2.4.1-x64.exe', s: 480 * MB, m: iso(150), c: 'installers', cloud: null },
    { p: U + '\\Videos\\bildschirmaufnahme-2025.mkv', s: 1.7 * GB, m: iso(330), c: 'video', cloud: null },
  ],
  gitRepos: [
    { path: U + '\\dev\\wetter-app', remote: 'https://github.com/demo/wetter-app.git', fullName: 'demo/wetter-app', branch: 'main', lastCommit: iso(3), dirty: false, changedFiles: 0, untrackedFiles: 0, ahead: 0, noUpstream: false, sizeBytes: 12 * MB, nodeModulesBytes: 410 * MB, inCloudRoot: null },
    { path: U + '\\dev\\notizen-cli', remote: 'https://github.com/demo/notizen-cli.git', fullName: 'demo/notizen-cli', branch: 'main', lastCommit: iso(21), dirty: true, changedFiles: 3, untrackedFiles: 1, ahead: 2, noUpstream: false, sizeBytes: 3 * MB, nodeModulesBytes: null, inCloudRoot: null },
    { path: U + '\\dev\\experiment', remote: null, fullName: null, branch: 'master', lastCommit: iso(95), dirty: false, changedFiles: 0, untrackedFiles: 0, ahead: null, noUpstream: null, sizeBytes: 1 * MB, nodeModulesBytes: null, inCloudRoot: null },
  ],
});

/* ---- storage analysis: where a nearly full 476 GB drive has gone */
const e = (p, gb, depth) => ({ path: p, bytes: Math.round(gb * GB), depth: depth != null ? depth : p.split('\\').length - 1 });
write('space.json', {
  schema: 1, scannedAt: iso(0, new Date(NOW).getHours()), seconds: 57, root: 'C:\\', partial: false, totalBytes: 476 * GB, freeBytes: 11.3 * GB, scannedBytes: Math.round(444 * GB),
  files: [{ path: 'C:\\hiberfil.sys', bytes: Math.round(19.1 * GB) }, { path: 'C:\\pagefile.sys', bytes: 3 * GB }],
  unreadable: ['C:\\System Volume Information', 'C:\\Program Files\\WindowsApps', 'C:\\Recovery'],
  entries: [
    e('C:\\Windows', 66), e('C:\\Windows\\WinSxS', 26), e('C:\\Windows\\System32', 14), e('C:\\Windows\\System32\\DriverStore', 9.3), e('C:\\Windows\\Installer', 3),
    e('C:\\Program Files', 58), e('C:\\Program Files\\Epic Games', 29.6), e('C:\\Program Files\\Epic Games\\UE_5.4', 26.4), e('C:\\Program Files\\Unity Editor', 8.3), e('C:\\Program Files\\Microsoft Office', 4.2),
    e('C:\\Program Files (x86)', 94), e('C:\\Program Files (x86)\\Steam', 85), e('C:\\Program Files (x86)\\Steam\\steamapps', 85), e('C:\\Program Files (x86)\\Steam\\steamapps\\common', 85),
    e('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077', 60), e('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stardew Valley', 6.2), e('C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR', 5.4), e('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Portal 2', 4.6),
    e('C:\\3uToolsV3', 16.7), e('C:\\3uToolsV3\\Firmware', 16.7),
    e('C:\\Users', 190), e(U, 190),
    e(U + '\\AppData', 76), e(U + '\\AppData\\Local', 59.4), e(U + '\\AppData\\Local\\NVIDIA', 7.1), e(U + '\\AppData\\Local\\NVIDIA\\DXCache', 7), e(U + '\\AppData\\Local\\npm-cache', 6.1),
    e(U + '\\AppData\\Local\\Android', 5.3), e(U + '\\AppData\\Local\\Android\\Sdk', 5.3), e(U + '\\AppData\\Local\\Temp', 3), e(U + '\\AppData\\Local\\Google', 11.3), e(U + '\\AppData\\Local\\Google\\Chrome', 10.6), e(U + '\\AppData\\Local\\Google\\Chrome\\User Data', 10.6),
    e(U + '\\AppData\\Local\\Google\\Chrome\\User Data\\OptGuideOnDeviceModel', 4), e(U + '\\AppData\\Roaming', 16.7),
    e(OLD, 54.2), e(U + '\\Documents', 14.5), e(U + '\\Downloads', 8.5), e(U + '\\.android', 6.2), e(U + '\\.android\\avd', 6), e(U + '\\.gradle', 4.7), e(U + '\\Videos', 1.9),
  ],
});

/* ---- the folder comparison page: old Drive folder against the live Drive */
const c0 = (n, b) => ({ files: n, bytes: b });
const d = (dir, o) => ({ d: dir, same: c0(0, 0), onlyA: c0(0, 0), onlyB: c0(0, 0), changed: c0(0, 0), moved: c0(0, 0), ...o });
write('compare.json', {
  a: OLD, b: DRIVE, deep: false, ignoreJunk: true, scannedAt: iso(0, new Date(NOW).getHours()), seconds: 10.4, partial: false, partialA: false, partialB: false,
  summary: { filesA: 138707, bytesA: 45.5 * GB, filesB: 145121, bytesB: 91.6 * GB, same: c0(138657, 45.4 * GB), changed: c0(14, 39 * MB), moved: c0(21, 16 * MB), onlyA: c0(15, 97 * MB), onlyB: c0(6429, 46.1 * GB), ignored: 688, unverified: 0 },
  onlyA: [
    { p: '05_Medien\\Urlaub 2026\\strand.mp4', s: 18 * MB, m: iso(70) }, { p: '03_Studium\\Seminar\\Material\\folien.pdf', s: 30 * MB, m: iso(900) }, { p: '01_Privat\\Dokumente\\Scans\\reisepass.pdf', s: 6 * MB, m: iso(400) },
  ],
  onlyB: [{ p: '99_Archiv\\2025\\Fotos\\IMG_4821.jpg', s: 8 * MB, m: iso(300) }, { p: '04_Projekte\\Alpha\\konzept.pptx', s: 6 * MB, m: iso(20) }, { p: '02_Finanzen\\2026\\steuer-2025.pdf', s: 2 * MB, m: iso(40) }],
  changed: [{ p: '02_Finanzen\\haushalt.xlsx', sa: 84 * 1024, sb: 131 * 1024, ma: iso(200), mb: iso(12), why: 'size' }, { p: '03_Studium\\notizen.docx', sa: 22 * 1024, sb: 25 * 1024, ma: iso(600), mb: iso(580), why: 'size' }],
  moved: [{ a: '05_Medien\\Fotos\\sommer.jpg', b: '99_Archiv\\2025\\Fotos\\sommer.jpg', s: 4 * MB }],
  dirs: [
    d('', { same: c0(138657, 45.4 * GB), onlyA: c0(15, 97 * MB), onlyB: c0(6429, 46.1 * GB), changed: c0(14, 39 * MB), moved: c0(21, 16 * MB) }),
    d('99_Archiv', { onlyB: c0(5200, 30 * GB), moved: c0(15, 12 * MB) }), d('99_Archiv\\2025', { onlyB: c0(5000, 29 * GB), moved: c0(15, 12 * MB) }), d('99_Archiv\\2025\\Fotos', { onlyB: c0(4800, 26 * GB), moved: c0(15, 12 * MB) }),
    d('04_Projekte', { onlyB: c0(900, 14 * GB) }), d('04_Projekte\\Alpha', { onlyB: c0(880, 13.6 * GB) }),
    d('02_Finanzen', { same: c0(300, 600 * MB), onlyB: c0(300, 1.4 * GB), changed: c0(6, 9 * MB) }), d('02_Finanzen\\2026', { onlyB: c0(180, 900 * MB) }),
    d('05_Medien', { onlyA: c0(10, 70 * MB), moved: c0(6, 4 * MB) }), d('05_Medien\\Urlaub 2026', { onlyA: c0(10, 70 * MB) }),
    d('03_Studium', { onlyA: c0(3, 30 * MB), changed: c0(8, 30 * MB) }), d('01_Privat', { onlyA: c0(2, 6 * MB) }),
  ],
  cutOnlyA: false, cutOnlyB: true, cutChanged: false, cutMoved: false, cutDirs: false,
});

/* ---- the rest of what the dashboard keeps */
write('notes.json', { version: 1, apps: {}, hardware: {}, tasks: {}, customTasks: [{ id: 'c1', title: 'Backup-Festplatte bestellen', area: 'storage', status: 'open', createdAt: iso(3) }], settings: { unusedDays: 365 } });
write('repos.json', { source: 'demo', syncedAt: iso(0), users: ['demo'], errors: [], repos: [
  { fullName: 'demo/wetter-app', name: 'wetter-app', owner: 'demo', private: false, language: 'TypeScript', description: 'Kleine Wetter-App', pushedAt: iso(3), url: 'https://github.com/demo/wetter-app' },
  { fullName: 'demo/notizen-cli', name: 'notizen-cli', owner: 'demo', private: true, language: 'Go', description: 'Notizen im Terminal', pushedAt: iso(40), url: 'https://github.com/demo/notizen-cli' },
] });
write('projects.json', { version: 1, projects: [{ id: 'p1', name: 'Wetter-App', status: 'active', description: 'Mobile Wetter-App mit Offline-Modus', due: '', repo: 'demo/wetter-app', resources: [
  { id: 'r1', kind: 'program', name: 'Visual Studio Code', state: 'auto' }, { id: 'r2', kind: 'program', name: 'Node.js', state: 'auto' }, { id: 'r3', kind: 'hardware', name: 'Testgerät (Android)', state: 'need' }], tasks: [{ id: 't1', text: 'Karten-Ansicht', done: true }, { id: 't2', text: 'Offline-Cache', done: false }] }] });
write('config.json', { githubUsers: ['demo'], cloudQuotaGB: { gdrive: 2048 }, autoUpdate: false });
write('cleanup.json', { version: 1, items: {} });
console.log('Demo data written to ' + path.resolve(out));
