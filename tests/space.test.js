/* Storage analysis ("Wo ist der Speicher geblieben?"): rules, no double counting, the numbers add up.
 * Sizes are those of a real, nearly full 476 GB laptop (C: 2 GB free).   node --test tests/space.test.js */
const test = require('node:test');
const assert = require('node:assert');
const LC = require('./load.js');

const GB = 1024 ** 3;
const e = (path, gb, depth) => ({ path, bytes: Math.round(gb * GB), depth: depth != null ? depth : path.split('\\').length - 1 });

/** What /api/scan-space delivers for that laptop (folders >= 300 MB, biggest first is not required). */
function raw() {
  const U = 'C:\\Users\\anna';
  return {
    schema: 1, scannedAt: '2026-11-12T10:00:00', seconds: 71.3, root: 'C:\\', partial: false,
    totalBytes: 476 * GB, freeBytes: 2.13 * GB, scannedBytes: Math.round(453.4 * GB),
    files: [{ path: 'C:\\hiberfil.sys', bytes: Math.round(19.08 * GB) }, { path: 'C:\\pagefile.sys', bytes: 3 * GB }, { path: 'C:\\swapfile.sys', bytes: 0.02 * GB }],
    unreadable: ['C:\\Program Files\\WindowsApps', 'C:\\System Volume Information'],
    entries: [
      e('C:\\Users', 189.63), e(U, 189.63),
      e(U + '\\AppData', 76.85), e(U + '\\AppData\\Local', 59.37), e(U + '\\AppData\\Roaming', 16.76),
      e(U + '\\AppData\\Local\\Google', 11.33), e(U + '\\AppData\\Local\\Google\\Chrome', 10.62), e(U + '\\AppData\\Local\\Google\\Chrome\\User Data', 10.6),
      e(U + '\\AppData\\Local\\Google\\Chrome\\User Data\\OptGuideOnDeviceModel', 3.98), e(U + '\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 7', 1.22),
      e(U + '\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 4', 1.08), e(U + '\\AppData\\Local\\Google\\Chrome\\User Data\\Default', 0.87),
      e(U + '\\AppData\\Local\\NVIDIA', 7.06), e(U + '\\AppData\\Local\\NVIDIA\\DXCache', 7.03),
      e(U + '\\AppData\\Local\\npm-cache', 6.08), e(U + '\\AppData\\Local\\Android', 5.34), e(U + '\\AppData\\Local\\Android\\Sdk', 5.34),
      e(U + '\\AppData\\Local\\Programs', 4.54), e(U + '\\AppData\\Local\\Programs\\Microsoft VS Code', 2.03),
      e(U + '\\AppData\\Local\\Temp', 3.0), e(U + '\\AppData\\Local\\Temp\\claude', 1.39),
      e(U + '\\My Drive', 54.16),
      e(U + '\\Documents', 14.48), e(U + '\\Documents\\Gamedevelopment', 8.24), e(U + '\\Downloads', 8.53),
      e(U + '\\.gemini', 11.55), e(U + '\\.android', 6.25), e(U + '\\.android\\avd', 6.04), e(U + '\\.gradle', 4.65),
      e('C:\\Program Files (x86)', 84.55), e('C:\\Program Files (x86)\\Steam', 75.47), e('C:\\Program Files (x86)\\Steam\\steamapps', 73.72),
      e('C:\\Program Files (x86)\\Steam\\steamapps\\common', 73.72), e('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Enlisted', 59.97),
      e('C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR', 5.42), e('C:\\Program Files (x86)\\Steam\\steamapps\\common\\SCP Project 90', 4.58),
      e('C:\\Program Files (x86)\\Steam\\steamapps\\common\\EarthVR', 2.79), e('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Eye of the Temple', 0.77),
      e('C:\\Program Files', 74.73), e('C:\\Program Files\\Epic Games', 29.63), e('C:\\Program Files\\Epic Games\\UE_5.7', 26.39),
      e('C:\\Program Files\\Unity', 17.1), e('C:\\Program Files\\Unity\\Hub', 17.1), e('C:\\Program Files\\Unity\\Hub\\Editor', 17.1), e('C:\\Program Files\\Unity\\Hub\\Editor\\6000.3.2f1', 17.1),
      e('C:\\Program Files\\Unity 6000.6.7f1', 8.34), e('C:\\Program Files\\Unity 6000.6.7f1\\Editor', 8.34),
      e('C:\\Program Files\\Microsoft Office', 4.22),
      e('C:\\Windows', 51.62), e('C:\\Windows\\WinSxS', 26.01), e('C:\\Windows\\System32', 11.74), e('C:\\Windows\\System32\\DriverStore', 6.47),
      e('C:\\ProgramData', 13.29), e('C:\\ProgramData\\NVIDIA Corporation', 8.78), e('C:\\ProgramData\\NVIDIA Corporation\\NVIDIA app', 8.07),
      e('C:\\ProgramData\\NVIDIA Corporation\\NVIDIA app\\UpdateFramework', 7.88), e('C:\\ProgramData\\NVIDIA Corporation\\NVIDIA app\\UpdateFramework\\ota-artifacts', 7.88),
      e('C:\\3uToolsV3', 16.9), e('C:\\3uToolsV3\\Firmware', 16.7),
    ],
  };
}

const find = (s, label) => s.items.find((i) => i.label === label);
const sum = (arr) => arr.reduce((a, i) => a + i.bytes, 0);

test('nothing is counted twice: no listed folder lies inside another listed folder', () => {
  const s = LC.analyzeSpace(raw());
  const norm = (p) => p.toLowerCase().replace(/\\+$/, '') + '\\';
  for (const a of s.items) for (const b of s.items) {
    if (a === b || a.kind === 'rest' || b.kind === 'rest' || a.kind === 'file' || b.kind === 'file') continue;
    assert.ok(!norm(b.path).startsWith(norm(a.path)), a.path + ' contains ' + b.path);
  }
});

test('the numbers add up: listed + small stuff = scanned, and the rest is "not readable"', () => {
  const s = LC.analyzeSpace(raw());
  assert.equal(Math.round(s.listed + s.small), Math.round(s.scanned));
  assert.equal(s.listed, sum(s.items));
  const used = 476 * GB - 2.13 * GB;
  assert.ok(Math.abs(s.used - used) < 1);
  assert.ok(Math.abs(s.unreadable - (used - s.scanned)) < 1);
  assert.ok(s.unreadable / GB > 19 && s.unreadable / GB < 22, 'about 20 GB cannot be read without administrator rights');
  assert.ok(s.small >= 0 && s.small / GB < 0.25 * 453, 'little is lost in "small stuff"');
  assert.equal(sum(s.groups), s.listed);
});

test('games: Steam games are listed one by one, the library itself only as a rest', () => {
  const s = LC.analyzeSpace(raw());
  const en = find(s, 'Enlisted (Steam)');
  assert.equal(en.group, 'games'); assert.equal(en.safety, 'check'); assert.match(en.hint, /Steam/);
  assert.ok(find(s, 'SteamVR (Steam)') && find(s, 'SCP Project 90 (Steam)') && find(s, 'EarthVR (Steam)'));
  assert.ok(!s.items.some((i) => i.label === 'Steam' || i.label === 'steamapps' || i.label === 'common'));
  assert.ok(s.items.some((i) => i.kind === 'rest' && /^Steam – übrige Dateien$/.test(i.label)));
});

test('development: Unreal Engine, both Unity editors, Android emulator, Gemini data', () => {
  const s = LC.analyzeSpace(raw());
  assert.equal(find(s, 'Unreal Engine 5.7').group, 'dev');
  assert.equal(find(s, 'Unity-Editor 6000.3.2f1').group, 'dev');
  assert.equal(find(s, 'Unity-Editor 6000.6.7f1').group, 'dev');       // the stand-alone install under Program Files
  assert.match(find(s, 'Unity-Editor 6000.3.2f1').hint, /Unity Hub/);
  assert.equal(find(s, 'Android-Emulator-Geräte').group, 'dev');
  assert.equal(find(s, 'Android SDK').group, 'dev');
  assert.equal(find(s, 'Gemini / Antigravity-Daten').group, 'dev');
});

test('caches and leftovers are the "safe" ones, with the way to clean them', () => {
  const s = LC.analyzeSpace(raw());
  for (const [label, re] of [['Gradle-Cache', /Build/], ['npm-Cache', /npm cache clean/], ['Temporäre Dateien (Benutzer)', /Speicher/], ['3uTools: iPhone-Firmware', /3uTools/], ['Browser: lokales KI-Modell', /System/]]) {
    const i = find(s, label);
    assert.ok(i, label + ' missing');
    assert.equal(i.safety, 'safe', label); assert.equal(i.group, 'cache', label); assert.match(i.hint, re, label);
  }
  assert.ok(s.items.some((i) => /^Grafik-Shader-Cache/.test(i.label) && i.safety === 'safe' && Math.abs(i.bytes - 7.03 * GB) < 1e6));
  const ota = find(s, 'NVIDIA App: Update-Reste');
  assert.equal(ota.safety, 'check'); assert.match(ota.hint, /Administrator/);
  // Temp\claude inside Temp is not listed on its own
  assert.ok(!s.items.some((i) => /\\Temp\\claude$/.test(i.path)));
});

test('browser profiles are listed separately from the AI model; the browser folder is not one big line', () => {
  const s = LC.analyzeSpace(raw());
  assert.equal(find(s, 'Chrome-Profil: Profile 7').safety, 'check');
  assert.ok(find(s, 'Chrome-Profil: Default'));
  assert.ok(!s.items.some((i) => /\\User Data$/.test(i.path) && i.kind === 'folder'));
});

const STREAMED = { id: 'gdrive', name: 'Google Drive', mode: 'stream', root: 'G:\\Meine Ablage', detectedBy: 'drive G:' };
const profileFolder = (mode) => ({ id: 'gdrive', name: 'Google Drive', mode, root: 'C:\\Users\\anna\\My Drive', detectedBy: 'folder in profile: My Drive' });

test('a cloud folder is its own group; WHAT it is depends on what the files scan found out about it', () => {
  // no files scan yet: do not claim "mirrored" - say how to find out, and that a "My Drive" next to a Drive letter is usually an old leftover
  const unknown = find(LC.analyzeSpace(raw()), 'Cloud-Ordner „My Drive“');
  assert.equal(unknown.group, 'cloud'); assert.equal(unknown.safety, 'check');
  assert.match(unknown.hint, /Dateien & Cloud/); assert.match(unknown.hint, /alter Rest/);
  assert.doesNotMatch(unknown.hint, /wird gespiegelt/);

  // really mirrored: switching to streaming is the way to get the space back
  const mirror = LC.analyzeSpace(raw(), { providers: [profileFolder('mirror')] });
  const m = find(mirror, 'Cloud-Ordner „My Drive“');
  assert.match(m.hint, /gespiegelt/); assert.match(m.hint, /streamen/);
  assert.equal(mirror.cloudBytes, m.bytes);

  // Drive streams to G: and the profile folder is a leftover of an old mirror: NOT "switch to streaming" - check, rename, delete
  const left = LC.analyzeSpace(raw(), { providers: [STREAMED, profileFolder('leftover')] });
  const l = find(left, 'Alter Drive-Ordner „My Drive“ (nicht mehr synchronisiert)');
  assert.ok(l, 'labelled as a leftover');
  assert.equal(l.group, 'cloud'); assert.equal(l.safety, 'check'); assert.equal(l.bytes, find(mirror, 'Cloud-Ordner „My Drive“').bytes);
  assert.match(l.hint, /läuft gestreamt \(G:\\Meine Ablage\)/); assert.match(l.hint, /Rest einer früheren Spiegelung/);
  assert.match(l.hint, /Dateien-Scan/); assert.match(l.hint, /gleicht ihn mit dem Drive ab/);   // not compared yet: says how to find out
  assert.doesNotMatch(l.hint, /auf „Dateien streamen“ um/);

  // providers with a different path do not label the folder
  const other = LC.analyzeSpace(raw(), { providers: [{ ...profileFolder('leftover'), root: 'C:\\Users\\anna\\Elsewhere' }] });
  assert.ok(find(other, 'Cloud-Ordner „My Drive“'));
});

test('files model: an old Drive mirror is reported with its size, is no cloud and no move target, and has its own task', () => {
  const fx = JSON.parse(JSON.stringify(require('./fixtures/main.json')));
  fx.volumes[0].sizeBytes = 476 * GB; fx.volumes[0].freeBytes = 2.13 * GB;
  const files = {
    scannedAt: '2026-11-12T10:00:00', seconds: 30, catNames: [], docs: [], big: [], dupes: [], folders: [], cloudTree: [], gitRepos: [], exts: [], dataDirs: [],
    providers: [STREAMED, profileFolder('leftover')],
    roots: [{ label: 'Google Drive', path: 'G:\\Meine Ablage', kind: 'cloud', provider: 'Google Drive', mode: 'stream', files: 100, bytes: 5 * GB, onlineBytes: 5 * GB, partial: false, seconds: 3 }],
  };
  const m = LC.analyze(fx, { now: '2026-11-12T10:00:00', files, space: raw() });
  const f = m.files;
  assert.equal(f.providers.length, 2); assert.equal(f.liveProviders.length, 1);
  assert.equal(f.liveProviders[0].mode, 'stream');
  const left = f.providers.find((p) => p.mode === 'leftover');
  assert.ok(Math.abs(left.localBytes - 54.16 * GB) < 1e6, 'size comes from the storage analysis');
  assert.ok(!f.cloudRoots.some((r) => /My Drive/.test(r.path)), 'not a cloud root');

  const t = m.findings.find((x) => x.id === 'files.drive-leftover');
  assert.ok(t, 'task for the leftover');
  assert.match(t.title, /Alter Google-Drive-Ordner auf diesem PC \(54,2 GB\) – nicht mehr synchronisiert/);
  assert.equal(t.severity, 'warn');                                      // C: is nearly full
  assert.match(t.detail, /gestreamt \(G:\\Meine Ablage\)/); assert.match(t.detail, /bis zu 54,2 GB lassen sich zurückholen/);
  assert.ok(t.steps.some((s) => /WinMerge/.test(s)) && t.steps.some((s) => /„My Drive \(alt\)“/.test(s)));
  assert.ok(!m.findings.some((x) => x.id === 'files.mirror-mode'), 'no "switch to streaming" advice');

  // without a storage analysis the leftover is still found, only its size is missing
  const noSpace = LC.analyze(fx, { now: '2026-11-12T10:00:00', files });
  assert.equal(noSpace.files.providers.find((p) => p.mode === 'leftover').localBytes, null);
  assert.match(noSpace.findings.find((x) => x.id === 'files.drive-leftover').title, /^Alter Google-Drive-Ordner auf diesem PC – nicht mehr synchronisiert$/);
});

test('your own folders are opened up: Documents shows its sub folder and what is left', () => {
  const s = LC.analyzeSpace(raw());
  const g = find(s, 'Gamedevelopment');
  assert.equal(g.group, 'mine');
  const rest = find(s, 'Dokumente – übrige Dateien');
  assert.ok(rest && Math.abs(rest.bytes - (14.48 - 8.24) * GB) < 1e6);
  const dl = find(s, 'Downloads');                       // no sub folder above 300 MB: shown as one line with the "your files" hint
  assert.ok(dl && dl.group === 'mine' && /Installer/.test(dl.hint));
});

test('Windows: WinSxS and the driver store are "keep"; hibernation file is your decision; page file is kept', () => {
  const s = LC.analyzeSpace(raw());
  assert.equal(find(s, 'Windows-Komponentenspeicher (WinSxS)').safety, 'keep');
  assert.equal(find(s, 'Treiberspeicher (DriverStore)').group, 'system');
  const hib = find(s, 'Ruhezustandsdatei (hiberfil.sys)');
  assert.equal(hib.kind, 'file'); assert.equal(hib.safety, 'check'); assert.match(hib.hint, /powercfg/);
  assert.equal(find(s, 'Auslagerungsdatei (pagefile.sys)').safety, 'keep');
  assert.ok(!s.items.some((i) => i.label === 'swapfile.sys' && i.bytes > 1 * GB));
});

test('programs: one line per installed program, not their insides', () => {
  const s = LC.analyzeSpace(raw());
  const o = find(s, 'Microsoft Office');
  assert.equal(o.group, 'apps'); assert.match(o.hint, /Apps/);
  assert.ok(find(s, 'npm-Cache') && !s.items.some((i) => /Local\\Programs$/.test(i.path) && i.kind === 'folder'));
});

test('summary: what can go without asking, what needs a decision', () => {
  const s = LC.analyzeSpace(raw());
  const safe = s.items.filter((i) => i.safety === 'safe');
  assert.equal(s.safeBytes, sum(safe));
  assert.ok(s.safeBytes / GB > 35 && s.safeBytes / GB < 60, 'safe: ' + (s.safeBytes / GB).toFixed(1) + ' GB');
  assert.ok(s.checkBytes / GB > 150, 'check: ' + (s.checkBytes / GB).toFixed(1) + ' GB');
  assert.equal(s.items[0].bytes >= s.items[1].bytes, true);                 // biggest first
  const groupIds = s.groups.map((g) => g.id);
  assert.ok(groupIds.includes('games') && groupIds.includes('dev') && groupIds.includes('cloud') && groupIds.includes('system'));
  assert.ok(s.groups.every((g, i, a) => i === 0 || a[i - 1].bytes >= g.bytes), 'groups are sorted by size');
});

test('text for the findings names the biggest items', () => {
  const s = LC.analyzeSpace(raw());
  const t = LC.spaceTopText(s, 3);
  assert.match(t, /^Enlisted \(Steam\) \(60 GB\), Cloud-Ordner „My Drive“ \(54,2 GB\)/);
  assert.equal(t.split('), ').length, 3);
  assert.equal(LC.spaceTopText(null), '');
});

test('robust: nothing, junk, no entries, forward slashes, a different drive letter', () => {
  assert.equal(LC.analyzeSpace(null), null);
  assert.equal(LC.analyzeSpace({}), null);
  assert.equal(LC.analyzeSpace({ entries: 'x' }), null);
  const empty = LC.analyzeSpace({ entries: [] });
  assert.deepEqual(empty.items, []); assert.equal(empty.used, null); assert.equal(empty.unreadable, null);
  const odd = LC.analyzeSpace({ entries: [null, { path: '', bytes: 5 }, { path: 'D:/Games/Foo', bytes: 3 * GB }, { path: 'D:\\Games', bytes: 3 * GB }, { path: 'D:\\x', bytes: -1 }] });
  assert.equal(odd.items.length, 1);
  assert.equal(odd.items[0].label, 'Foo'); assert.equal(odd.items[0].group, 'other');
  const partial = LC.analyzeSpace({ ...raw(), partial: true });
  assert.equal(partial.partial, true);
});

test('the analysis result is attached to the model and mentioned by the storage finding', () => {
  const fx = JSON.parse(JSON.stringify(require('./fixtures/main.json')));
  fx.volumes[0].sizeBytes = 476 * GB; fx.volumes[0].freeBytes = 2.13 * GB;       // C: nearly full
  const withSpace = LC.analyze(fx, { now: '2026-11-12T10:00:00', space: raw() });
  assert.ok(withSpace.space && withSpace.space.items.length);
  const f = withSpace.findings.find((x) => x.id === 'storage.c-low');
  assert.equal(f.severity, 'critical');
  assert.match(f.detail, /Größte Posten laut Speicher-Analyse: Enlisted \(Steam\)/);
  assert.match(f.detail, /unkritisch/);
  assert.ok(f.steps.some((s) => /Wo ist der Speicher geblieben/.test(s)));

  const plain = LC.analyze(fx, { now: '2026-11-12T10:00:00' });
  assert.equal(plain.space, null);
  const g = plain.findings.find((x) => x.id === 'storage.c-low');
  assert.doesNotMatch(g.detail, /Speicher-Analyse/);
  assert.ok(g.steps.some((s) => /Speicher analysieren/.test(s)), 'without the analysis the finding tells how to start it');
});

test('a cloud app\'s virtual drive (G: "Google Drive") is not a second disk and not "almost full"', () => {
  const fx = JSON.parse(JSON.stringify(require('./fixtures/main.json')));
  const c = fx.volumes[0];
  c.sizeBytes = 476 * GB; c.freeBytes = 11.9 * GB;
  // as Windows reports it: FAT32, same size as C:, no disk behind it
  fx.volumes.push({ letter: 'G', label: 'Google Drive', fileSystem: 'FAT32', sizeBytes: 476 * GB, freeBytes: 11.3 * GB, driveType: 3 });
  const st = LC.analyze(fx, { now: '2026-11-12T10:00:00' }).hw.storage;
  assert.deepEqual(st.volumes.map((v) => v.letter), ['C']);
  assert.deepEqual(st.virtualVolumes.map((v) => v.letter), ['G']);
  assert.equal(st.systemVolume.letter, 'C');

  // a REAL partition that happens to be called "Google Drive" (it sits on a disk) stays a normal volume
  const real = JSON.parse(JSON.stringify(fx));
  real.volumes[1].diskNumber = 1;
  const st2 = LC.analyze(real, { now: '2026-11-12T10:00:00' }).hw.storage;
  assert.deepEqual(st2.volumes.map((v) => v.letter), ['C', 'G']);
  assert.equal(st2.virtualVolumes.length, 0);

  // without any virtual drive nothing changes
  assert.equal(LC.analyze(JSON.parse(JSON.stringify(require('./fixtures/main.json'))), { now: '2026-11-12T10:00:00' }).hw.storage.virtualVolumes.length, 0);
});
