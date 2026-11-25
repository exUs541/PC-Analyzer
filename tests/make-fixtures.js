/* Generates realistic snapshots in the exact shape of the system scan (LaptopCheck.Scan).
 * Usage: node tests/make-fixtures.js   (writes tests/fixtures/*.json)
 */
const fs = require('fs');
const path = require('path');

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const iso = (s) => s; // dates are ISO local strings
const out = path.join(__dirname, 'fixtures');
fs.mkdirSync(out, { recursive: true });

/* ------------------------------------------------------------------ helper to build software entries */
let seq = 0;
const sw = (name, version, publisher, o = {}) => ({
  id: 'reg:HKLM:x64:' + (o.regKey || 'k' + ++seq),
  source: 'registry',
  name, version, publisher,
  installDate: o.installDate || null,
  installDateSource: o.installDate ? o.dateSrc || 'registry' : null,
  installLocation: o.loc || null,
  displayIcon: o.icon || null,
  uninstallString: o.un || (o.loc ? '"' + o.loc + '\\uninstall.exe"' : 'MsiExec.exe /X{0000-' + seq + '}'),
  quietUninstall: null,
  sizeKB: o.sizeKB || null,
  sizeSource: o.sizeKB ? o.sizeSrc || 'registry' : null,
  scope: o.scope || 'machine',
  arch: o.arch || 'x64',
  isSystemComponent: false,
  aboutUrl: null,
  regKey: o.regKey || 'k' + seq,
});
const store = (name, pkg, publisher, o = {}) => ({
  id: 'store:' + pkg + '_1.0_x64__abc', source: 'store', name, version: o.version || '1.0.0.0', publisher,
  installDate: o.installDate || null, installDateSource: o.installDate ? 'folder' : null,
  installLocation: 'C:\\Program Files\\WindowsApps\\' + pkg, displayIcon: null, uninstallString: null, quietUninstall: null,
  sizeKB: null, sizeSource: null, scope: 'user', arch: 'X64', isSystemComponent: false, aboutUrl: null, regKey: null,
  packageName: pkg, packageFamily: pkg + '_8wekyb3d8bbwe', hasStartEntry: o.start !== false,
});
const ua = (p, last, runs, focus) => ({ source: 'UserAssist', path: p, lastRun: last, runCount: runs, focusSec: focus });

/* ================================================================== MAIN: ThinkPad, 16 GB soldered + 32 GB SO-DIMM = 48 GB */
const PF = '{6D809377-6AF0-444B-8957-A3773F02200E}';
const PF86 = '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}';
const LAD = '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}';

const main = {
  schema: 1,
  collectedAt: '2026-10-19T21:30:12',
  durationSec: 74.3,
  collector: { version: '1.0.0', psVersion: '5.1.22621.4391', isAdmin: false, computerName: 'ANNA-T14', userName: 'anna', options: { quick: false, noWinget: false, skipSizes: false } },
  system: {
    manufacturer: 'LENOVO', model: '21CFCTO1WW', family: 'ThinkPad T14 Gen 3', sku: 'LENOVO_MT_21CF_BU_Think_FM_ThinkPad T14 Gen 3', productVersion: 'ThinkPad T14 Gen 3',
    serial: 'PF3ABCDE', pcSystemType: 2, chassisTypes: [10], biosVendor: 'LENOVO', biosVersion: 'R23ET60W (1.30 )', biosDate: '2023-02-14T00:00:00',
    boardManufacturer: 'LENOVO', boardProduct: '21CFCTO1WW', firmwareType: 2,
  },
  os: { caption: 'Microsoft Windows 11 Pro', version: '10.0.26100', build: 26100, ubr: 5074, displayVersion: '24H2', edition: 'Professional', architecture: '64-bit', installDate: '2023-04-02T10:11:00', lastBoot: '2026-10-02T08:05:00', uptimeDays: 17.6, fastStartup: 1, uacEnabled: 1, locale: 'de-DE' },
  cpu: [{ name: '12th Gen Intel(R) Core(TM) i7-1260P', manufacturer: 'GenuineIntel', cores: 12, logical: 16, maxMHz: 2100, socket: 'U3E1', l2KB: 9216, l3KB: 18432, virtualization: true }],
  memory: {
    totalPhysicalBytes: 50889011200, visibleBytes: 50889011200, freeBytes: 14.2 * GB, commitBytes: 28.5 * GB, commitLimitBytes: 58 * GB, pagesInPerSec: 4.3, cpuLoadPct: 12.4,
    modules: [
      { locator: 'Onboard', bank: 'BANK 0', capacityBytes: 16 * GB, speed: 3200, configuredSpeed: 3200, manufacturer: 'Samsung', partNumber: 'K4AAG165WA-BCWE', smbiosType: 26, formFactor: 0, voltageMv: 1200, rank: 1, dataWidth: 64, totalWidth: 64 },
      { locator: 'DIMM A', bank: 'BANK 1', capacityBytes: 32 * GB, speed: 3200, configuredSpeed: 3200, manufacturer: 'Micron', partNumber: '16ATF4G64HZ-3G2R1', smbiosType: 26, formFactor: 12, voltageMv: 1200, rank: 2, dataWidth: 64, totalWidth: 64 },
    ],
    arrays: [{ maxCapacityKB: 67108864, slots: 2, ecc: 3 }],
    pageFiles: [{ name: 'C:\\pagefile.sys', allocatedMB: 8192, usedMB: 1200, peakMB: 3100 }],
  },
  gpu: [{ name: 'Intel(R) Iris(R) Xe Graphics', vendor: 'Intel Corporation', driverVersion: '31.0.101.4502', driverDate: '2023-06-15T00:00:00', vramBytes: 128 * MB, hRes: 1920, vRes: 1200, refreshHz: 60, status: 'OK', pnpId: 'PCI\\VEN_8086' }],
  disks: [{ number: 0, model: 'Samsung SSD 980 PRO 1TB', mediaType: 'SSD', busType: 'NVMe', sizeBytes: 1000204886016, health: 'Healthy', operational: 'OK', spindleSpeed: 0, firmware: '5B2QGXA7', partitionStyle: 'GPT', isBoot: true, isSystem: true, reliability: null }],
  volumes: [{ letter: 'C', label: 'Windows', fileSystem: 'NTFS', sizeBytes: 998 * GB * 0.95, freeBytes: 118 * GB, driveType: 3, diskNumber: 0 }],
  battery: { present: true, name: 'SDS 5B10W13975', manufacturer: 'SMP', chemistry: 'LiP', designMWh: 52000, fullChargeMWh: 37500, cycleCount: 412, chargePct: 86, batteryStatus: 2 },
  network: [
    { name: 'WLAN', description: 'Intel(R) Wi-Fi 6E AX211 160MHz', status: 'Up', linkSpeed: '1.2 Gbps', mediaType: 'Native 802.11' },
    { name: 'Ethernet', description: 'Intel(R) Ethernet Connection (17) I219-LM', status: 'Disconnected', linkSpeed: '0 bps', mediaType: '802.3' },
  ],
  security: {
    defender: { serviceEnabled: true, antivirusEnabled: true, realTime: true, tamperProtected: true, signatureUpdated: '2026-10-18T07:12:00', quickScanEnd: '2026-10-14T12:00:00', fullScanEnd: null },
    antivirus: [{ name: 'Windows Defender', enabled: true, upToDate: true }, { name: 'McAfee WebAdvisor', enabled: false, upToDate: false }],
    firewall: [{ profile: 'Domain', enabled: true }, { profile: 'Private', enabled: true }, { profile: 'Public', enabled: true }],
    secureBoot: 1, tpm: null, bitlocker: [], pendingReboot: true, lastHotfix: '2026-09-10T00:00:00', hotfixCount: 14, lastUpdateInstall: '2026-09-12T03:22:10',
  },
  powerPlan: { guid: '381b4222-f694-41f0-9685-ff5bb260df2e', name: 'Ausbalanciert' },
  startup: [
    { name: 'OneDrive', command: '"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe" /background', location: 'HKCU\\Run', scope: 'user', enabled: true },
    { name: 'Spotify', command: 'C:\\Users\\anna\\AppData\\Roaming\\Spotify\\Spotify.exe /minimized', location: 'HKCU\\Run', scope: 'user', enabled: true },
    { name: 'Steam', command: '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent', location: 'HKCU\\Run', scope: 'user', enabled: true },
    { name: 'Dropbox', command: '"C:\\Program Files (x86)\\Dropbox\\Client\\Dropbox.exe" /systemstartup', location: 'HKCU\\Run', scope: 'user', enabled: true },
    { name: 'Docker Desktop', command: '"C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe" -Autostart', location: 'HKCU\\Run', scope: 'user', enabled: true },
    { name: 'Adobe Creative Cloud', command: '"C:\\Program Files\\Adobe\\Adobe Creative Cloud\\ACC\\Creative Cloud.exe" --showwindow=false', location: 'HKCU\\Run', scope: 'user', enabled: true },
    { name: 'CCleaner Smart Cleaning', command: '"C:\\Program Files\\CCleaner\\CCleaner64.exe" /MONITOR', location: 'HKLM\\Run', scope: 'machine', enabled: true },
    { name: 'LenovoVantage', command: '"C:\\Program Files (x86)\\Lenovo\\VantageService\\Vantage.exe"', location: 'HKLM\\Run', scope: 'machine', enabled: true },
    { name: 'RtkAudUService', command: '"C:\\Windows\\System32\\DriverStore\\FileRepository\\realtekservice\\RtkAudUService64.exe" -background', location: 'HKLM\\Run', scope: 'machine', enabled: true },
    { name: 'Teams', command: '"C:\\Users\\anna\\AppData\\Local\\Microsoft\\Teams\\Update.exe" --processStart "Teams.exe"', location: 'HKCU\\Run', scope: 'user', enabled: false },
    { name: 'Zoom', command: '"C:\\Users\\anna\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe" --autostart', location: 'HKCU\\Run', scope: 'user', enabled: true },
    { name: 'SecurityHealth', command: '%windir%\\system32\\SecurityHealthSystray.exe', location: 'HKLM\\Run', scope: 'machine', enabled: true },
  ],
  processes: [
    { name: 'chrome', count: 34, workingSetBytes: 4.1 * GB, cpuSeconds: 8120 },
    { name: 'vmmem', count: 1, workingSetBytes: 6.0 * GB, cpuSeconds: 2300 },
    { name: 'Teams', count: 9, workingSetBytes: 1.9 * GB, cpuSeconds: 1900 },
    { name: 'Code', count: 11, workingSetBytes: 1.7 * GB, cpuSeconds: 900 },
    { name: 'WINWORD', count: 1, workingSetBytes: 0.5 * GB, cpuSeconds: 110 },
    { name: 'Docker Desktop', count: 4, workingSetBytes: 0.4 * GB, cpuSeconds: 300 },
    { name: 'explorer', count: 2, workingSetBytes: 0.25 * GB, cpuSeconds: 400 },
  ].map((p) => ({ ...p, workingSetBytes: Math.round(p.workingSetBytes) })),
  folders: [
    { id: 'downloads', label: 'Downloads', path: 'C:\\Users\\anna\\Downloads', bytes: 18.4 * GB, partial: false, kind: 'folder' },
    { id: 'temp-user', label: 'Temp (Benutzer)', path: 'C:\\Users\\anna\\AppData\\Local\\Temp', bytes: 2.3 * GB, partial: false, kind: 'folder' },
    { id: 'windows-old', label: 'Windows.old', path: 'C:\\Windows.old', bytes: 14.1 * GB, partial: false, kind: 'folder' },
    { id: 'wu-download', label: 'Windows-Update-Downloads', path: 'C:\\Windows\\SoftwareDistribution\\Download', bytes: 1.4 * GB, partial: false, kind: 'folder' },
    { id: 'appdata-local', label: 'AppData\\Local (Programmdaten/Caches)', path: 'C:\\Users\\anna\\AppData\\Local', bytes: 31 * GB, partial: true, kind: 'folder' },
    { id: 'videos', label: 'Videos', path: 'C:\\Users\\anna\\Videos', bytes: 42 * GB, partial: false, kind: 'folder' },
    { id: 'hiberfil.sys', label: 'hiberfil.sys', path: 'C:\\hiberfil.sys', bytes: 30 * GB, partial: false, kind: 'file' },
    { id: 'pagefile.sys', label: 'pagefile.sys', path: 'C:\\pagefile.sys', bytes: 8 * GB, partial: false, kind: 'file' },
    { id: 'recycle-bin', label: 'Papierkorb', path: 'shell:RecycleBinFolder', bytes: 3.2 * GB, partial: false, kind: 'bin' },
  ].map((f) => ({ ...f, bytes: Math.round(f.bytes) })),
  software: [
    sw('Google Chrome', '130.0.6723.92', 'Google LLC', { regKey: 'Google Chrome', installDate: '2023-04-05', loc: 'C:\\Program Files\\Google\\Chrome\\Application', icon: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe,0', sizeKB: 1.2 * 1024 * 1024 }),
    sw('Mozilla Firefox (x64 de)', '131.0.3', 'Mozilla', { regKey: 'Mozilla Firefox 131.0.3 (x64 de)', installDate: '2024-01-12', loc: 'C:\\Program Files\\Mozilla Firefox', icon: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe,0', sizeKB: 280 * 1024 }),
    sw('VLC media player', '3.0.20', 'VideoLAN', { regKey: 'VLC media player', installDate: '2023-04-20', loc: 'C:\\Program Files\\VideoLAN\\VLC', icon: 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe', sizeKB: 190 * 1024 }),
    sw('7-Zip 23.01 (x64)', '23.01', 'Igor Pavlov', { regKey: '7-Zip', installDate: '2023-04-03', loc: 'C:\\Program Files\\7-Zip\\', icon: 'C:\\Program Files\\7-Zip\\7zFM.exe', sizeKB: 5 * 1024 }),
    sw('WinRAR 6.24 (64-bit)', '6.24.0', 'win.rar GmbH', { regKey: 'WinRAR archiver', loc: 'C:\\Program Files\\WinRAR', icon: 'C:\\Program Files\\WinRAR\\WinRAR.exe,0', sizeKB: 12 * 1024, installDate: '2023-04-03' }),
    sw('Python 3.9.5 (64-bit)', '3.9.5150.0', 'Python Software Foundation', { regKey: '{py395}', installDate: '2021-05-10', sizeKB: 100 * 1024 }),
    sw('Python 3.9.5 Core Interpreter (64-bit)', '3.9.5150.0', 'Python Software Foundation', { regKey: '{py395core}', installDate: '2021-05-10' }),
    sw('Python 3.9.5 Standard Library (64-bit)', '3.9.5150.0', 'Python Software Foundation', { regKey: '{py395lib}', installDate: '2021-05-10' }),
    sw('Python Launcher', '3.9.5150.0', 'Python Software Foundation', { regKey: '{pylauncher}', installDate: '2021-05-10' }),
    sw('Java 8 Update 311 (64-bit)', '8.0.3110.11', 'Oracle Corporation', { regKey: '{26A24AE4-039D-4CA4-87B4-2F64180311F0}', installDate: '2021-11-02', sizeKB: 280 * 1024 }),
    sw('Java 8 Update 361 (64-bit)', '8.0.3610.9', 'Oracle Corporation', { regKey: '{26A24AE4-039D-4CA4-87B4-2F64180361F0}', installDate: '2023-04-10', sizeKB: 280 * 1024 }),
    sw('Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.38.33135', '14.38.33135.0', 'Microsoft Corporation', { regKey: '{vc2022x64}', installDate: '2024-02-01', sizeKB: 20 * 1024 }),
    sw('Microsoft Visual C++ 2015-2022 Redistributable (x86) - 14.38.33135', '14.38.33135.0', 'Microsoft Corporation', { regKey: '{vc2022x86}', installDate: '2024-02-01', sizeKB: 17 * 1024, arch: 'x86' }),
    sw('Microsoft Visual C++ 2013 Redistributable (x64) - 12.0.40664', '12.0.40664.0', 'Microsoft Corporation', { regKey: '{vc2013x64}', installDate: '2023-04-03', sizeKB: 20 * 1024 }),
    sw('Microsoft .NET Runtime - 6.0.25 (x64)', '48.100.33108', 'Microsoft Corporation', { regKey: '{dotnet6}', installDate: '2023-12-01', sizeKB: 70 * 1024 }),
    sw('Microsoft .NET Runtime - 8.0.10 (x64)', '64.40.33727', 'Microsoft Corporation', { regKey: '{dotnet8}', installDate: '2024-10-15', sizeKB: 75 * 1024 }),
    sw('Microsoft Windows Desktop Runtime - 8.0.10 (x64)', '64.40.33727', 'Microsoft Corporation', { regKey: '{wdr8}', installDate: '2024-10-15', sizeKB: 160 * 1024 }),
    sw('Microsoft .NET SDK 8.0.403 (x64)', '8.4.324', 'Microsoft Corporation', { regKey: '{sdk8}', installDate: '2024-10-15', sizeKB: 600 * 1024 }),
    sw('Microsoft Edge WebView2 Runtime', '130.0.2849.56', 'Microsoft Corporation', { regKey: 'Microsoft EdgeWebView', installDate: '2024-11-02', loc: 'C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application', sizeKB: 450 * 1024, arch: 'x86' }),
    sw('CCleaner', '6.20.11045', 'Piriform Software Ltd', { regKey: 'CCleaner', installDate: '2023-05-11', loc: 'C:\\Program Files\\CCleaner', icon: 'C:\\Program Files\\CCleaner\\CCleaner64.exe', sizeKB: 60 * 1024 }),
    sw('McAfee WebAdvisor', '4.1.1.1', 'McAfee, LLC', { regKey: '{mcafeewebadvisor}', installDate: '2023-04-02', sizeKB: 90 * 1024 }),
    sw('Lenovo System Update', '5.08.01.0016', 'Lenovo', { regKey: '{lsu}', installDate: '2023-04-02', loc: 'C:\\Program Files (x86)\\Lenovo\\System Update', sizeKB: 45 * 1024, arch: 'x86' }),
    sw('Lenovo Vantage Service', '3.12.24', 'Lenovo Group Ltd.', { regKey: '{lenovovantageservice}', installDate: '2023-04-02', loc: 'C:\\Program Files (x86)\\Lenovo\\VantageService', arch: 'x86' }),
    sw('Steam', '2.10.91.91', 'Valve Corporation', { regKey: 'Steam', installDate: '2023-06-01', loc: 'C:\\Program Files (x86)\\Steam', icon: 'C:\\Program Files (x86)\\Steam\\steam.exe', sizeKB: 2.4 * 1024 * 1024, arch: 'x86' }),
    sw('Counter-Strike 2', '', 'Valve', { regKey: 'Steam App 730', installDate: '2023-09-28', loc: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive', sizeKB: 36 * 1024 * 1024, arch: 'x86' }),
    sw('Zoom Workplace (64-bit)', '6.2.3 (50341)', 'Zoom Communications, Inc.', { regKey: 'ZoomUMX', installDate: '2024-03-10', scope: 'user', loc: 'C:\\Users\\anna\\AppData\\Roaming\\Zoom', icon: 'C:\\Users\\anna\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe', sizeKB: 520 * 1024 }),
    sw('Microsoft Teams classic', '1.6.00.37560', 'Microsoft Corporation', { regKey: 'Teams', installDate: '2023-04-02', scope: 'user', loc: 'C:\\Users\\anna\\AppData\\Local\\Microsoft\\Teams', sizeKB: 320 * 1024 }),
    sw('Microsoft 365 Apps for enterprise - de-de', '16.0.17928.20156', 'Microsoft Corporation', { regKey: 'O365ProPlusRetail - de-de', installDate: '2023-04-02', loc: 'C:\\Program Files\\Microsoft Office', icon: 'C:\\Program Files\\Common Files\\Microsoft Shared\\ClickToRun\\OfficeClickToRun.exe', sizeKB: 4.3 * 1024 * 1024 }),
    sw('Adobe Acrobat Reader (64-bit)', '24.003.20112', 'Adobe', { regKey: '{AC76BA86-1033-1031-7760-BC15014EA700}', installDate: '2024-05-17', loc: 'C:\\Program Files\\Adobe\\Acrobat DC', icon: 'C:\\Program Files\\Adobe\\Acrobat DC\\Acrobat\\Acrobat.exe', sizeKB: 700 * 1024 }),
    sw('Adobe Creative Cloud', '6.3.0.207', 'Adobe Inc.', { regKey: 'Adobe Creative Cloud', installDate: '2023-04-12', loc: 'C:\\Program Files (x86)\\Adobe\\Adobe Creative Cloud', sizeKB: 800 * 1024, arch: 'x86' }),
    sw('Docker Desktop', '4.34.2', 'Docker Inc.', { regKey: 'Docker Desktop', installDate: '2024-09-14', loc: 'C:\\Program Files\\Docker\\Docker', icon: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe', sizeKB: 3.1 * 1024 * 1024 }),
    sw('Microsoft Visual Studio Code (User)', '1.94.2', 'Microsoft Corporation', { regKey: '{771FD6B0-FA20-440A-A002-3B3BAC16DC50}_is1', installDate: '2023-04-04', scope: 'user', loc: 'C:\\Users\\anna\\AppData\\Local\\Programs\\Microsoft VS Code', icon: 'C:\\Users\\anna\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', sizeKB: 420 * 1024 }),
    sw('Git', '2.46.0', 'The Git Development Community', { regKey: 'Git_is1', installDate: '2023-04-04', loc: 'C:\\Program Files\\Git', icon: 'C:\\Program Files\\Git\\git-cmd.exe', sizeKB: 330 * 1024 }),
    sw('Node.js', '20.17.0', 'Node.js Foundation', { regKey: '{nodejs20}', installDate: '2024-09-18', loc: 'C:\\Program Files\\nodejs\\', sizeKB: 90 * 1024 }),
    sw('Dropbox', '211.4.4443', 'Dropbox, Inc.', { regKey: 'Dropbox', installDate: '2023-04-08', loc: 'C:\\Program Files (x86)\\Dropbox\\Client', sizeKB: 760 * 1024, arch: 'x86' }),
    sw('Notepad++ (64-bit x64)', '8.6.9', 'Notepad++ Team', { regKey: 'Notepad++', installDate: '2023-04-03', loc: 'C:\\Program Files\\Notepad++', icon: 'C:\\Program Files\\Notepad++\\notepad++.exe', sizeKB: 12 * 1024 }),
    sw('Contoso Report Helper', '2.1', null, { regKey: 'ContosoReportHelper' }),
    sw('Spotify', '1.2.48.405.g1a2b3c4', 'Spotify AB', { regKey: 'Spotify', installDate: '2023-04-09', scope: 'user', icon: 'C:\\Users\\anna\\AppData\\Roaming\\Spotify\\Spotify.exe', sizeKB: 400 * 1024 }),
    sw('Intel(R) Driver & Support Assistant', '24.8.20.4', 'Intel', { regKey: '{intelDSA}', installDate: '2024-08-20', sizeKB: 60 * 1024 }),
    sw('Intel(R) Management Engine Components', '2306.1.20.0', 'Intel Corporation', { regKey: '{intelME}', installDate: '2023-04-02' }),
    sw('Realtek High Definition Audio Driver', '6.0.9549.1', 'Realtek Semiconductor Corp.', { regKey: '{realtek}', installDate: '2023-04-02' }),
    sw('Windows Driver Package - Intel (e1d) Net (11/15/2022 12.19.2.45)', '11/15/2022 12.19.2.45', 'Intel', { regKey: 'drvpkg1', installDate: '2023-04-02' }),
    store('Rechner', 'Microsoft.WindowsCalculator', 'Microsoft Corporation', { installDate: '2023-04-02' }),
    store('Candy Crush Saga', 'king.com.CandyCrushSaga', 'king.com', { installDate: '2023-04-02' }),
    store('Xbox', 'Microsoft.GamingApp', 'Microsoft Corporation', { installDate: '2023-04-02' }),
    store('Clipchamp', 'Clipchamp.Clipchamp', 'Microsoft Corporation', { installDate: '2023-04-02' }),
    store('HEVC Video Extensions von Geräteherstellern', 'Microsoft.HEVCVideoExtension', 'Microsoft Corporation', { installDate: '2023-04-02', start: false }),
  ],
  ignoredUpdates: 37,
  shortcuts: [
    { name: 'Google Chrome', path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Google Chrome.lnk', target: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: '' },
    { name: 'Firefox', path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Firefox.lnk', target: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', args: '' },
    { name: 'VLC media player', path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\VideoLAN\\VLC media player.lnk', target: 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe', args: '' },
    { name: '7-Zip File Manager', path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\7-Zip\\7-Zip File Manager.lnk', target: 'C:\\Program Files\\7-Zip\\7zFM.exe', args: '' },
    { name: 'WinRAR', path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\WinRAR\\WinRAR.lnk', target: 'C:\\Program Files\\WinRAR\\WinRAR.exe', args: '' },
    { name: 'Spotify', path: 'C:\\Users\\anna\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Spotify.lnk', target: 'C:\\Users\\anna\\AppData\\Roaming\\Spotify\\Spotify.exe', args: '' },
    { name: 'Steam', path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Steam\\Steam.lnk', target: 'C:\\Program Files (x86)\\Steam\\steam.exe', args: '' },
    { name: 'Zoom Workplace', path: 'C:\\Users\\anna\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Zoom\\Zoom Workplace.lnk', target: 'C:\\Users\\anna\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe', args: '' },
    { name: 'Word', path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Word.lnk', target: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE', args: '' },
    { name: 'Acrobat Reader', path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Acrobat Reader.lnk', target: 'C:\\Program Files\\Adobe\\Acrobat DC\\Acrobat\\Acrobat.exe', args: '' },
    { name: 'Docker Desktop', path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Docker Desktop.lnk', target: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe', args: '' },
    { name: 'Visual Studio Code', path: 'C:\\Users\\anna\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Visual Studio Code\\Visual Studio Code.lnk', target: 'C:\\Users\\anna\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', args: '' },
    { name: 'Notepad++', path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Notepad++.lnk', target: 'C:\\Program Files\\Notepad++\\notepad++.exe', args: '' },
  ],
  usage: [
    ua(PF + '\\Google\\Chrome\\Application\\chrome.exe', '2026-10-19T20:58:00', 612, 412000),
    ua(PF + '\\VideoLAN\\VLC\\vlc.exe', '2025-06-01T19:12:00', 14, 9800),
    ua(PF + '\\7-Zip\\7zFM.exe', '2026-10-02T09:30:00', 41, 1100),
    ua(PF + '\\Microsoft Office\\root\\Office16\\WINWORD.EXE', '2026-10-18T16:44:00', 188, 98000),
    ua(PF + '\\Adobe\\Acrobat DC\\Acrobat\\Acrobat.exe', '2026-08-02T11:00:00', 22, 3000),
    ua(PF + '\\Docker\\Docker\\Docker Desktop.exe', '2026-10-15T08:15:00', 70, 52000),
    ua(LAD + '\\Programs\\Microsoft VS Code\\Code.exe', '2026-10-19T19:30:00', 301, 244000),
    ua(PF + '\\Notepad++\\notepad++.exe', '2024-11-03T10:00:00', 9, 400),
    ua(PF86 + '\\Steam\\steam.exe', '2026-09-12T20:00:00', 33, 15000),
    ua('{A77F5D77-2E2B-44C3-A6A2-ABA601054A51}\\Spotify.lnk', '2026-10-17T22:00:00', 120, 130000),
    ua('{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}\\Zoom\\bin\\Zoom.exe', '2025-04-22T14:00:00', 50, 28000),
    ua('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App', '2026-09-30T10:00:00', 5, 120),
    ua(PF + '\\Adobe\\Adobe Creative Cloud\\ACC\\Creative Cloud.exe', null, 0, 0),
    { source: 'AppCompat', path: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', lastRun: '2025-02-14T10:00:00', runCount: null, focusSec: null },
    { source: 'MuiCache', path: 'C:\\Program Files\\WinRAR\\WinRAR.exe', lastRun: null, runCount: null, focusSec: null, title: 'WinRAR archiver' },
    { source: 'AppCompat', path: 'C:\\Program Files (x86)\\Adobe\\Adobe Creative Cloud\\Utils\\AdobeUpdateService.exe', lastRun: '2026-10-19T08:00:00', runCount: null, focusSec: null },
  ],
  usageCounts: { userAssist: 13, appCompat: 2, muiCache: 1, prefetch: 0 },
  updates: [
    { name: 'Google Chrome', id: 'Google.Chrome', version: '130.0.6723.92', available: '141.0.7390.77', source: 'winget' },
    { name: '7-Zip', id: '7zip.7zip', version: '23.01', available: '25.01', source: 'winget' },
    { name: 'Git', id: 'Git.Git', version: '2.46.0', available: '2.51.0', source: 'winget' },
  ],
  warnings: [{ area: 'security', message: 'Defender status: Zugriff verweigert' }],
};
fs.writeFileSync(path.join(out, 'main.json'), JSON.stringify(main));

/* previous scan for the diff view: before CCleaner + Notepad++ install, bigger free space */
const prev = JSON.parse(JSON.stringify(main));
prev.collectedAt = '2026-10-05T20:10:00';
prev.software = prev.software.filter((s) => !['CCleaner'].includes(s.name)).concat([sw('FileZilla 3.66', '3.66.0', 'Tim Kosse', { regKey: 'FileZilla Client' })]);
prev.software.find((s) => s.name === 'Git').version = '2.45.2';
prev.volumes[0].freeBytes = 131 * GB;
fs.writeFileSync(path.join(out, 'main.prev.json'), JSON.stringify(prev));

/* ================================================================== MAIN-GAP: same machine, but Windows sees only ~31.7 GB of 48 GB */
const gap = JSON.parse(JSON.stringify(main));
gap.memory.totalPhysicalBytes = Math.round(31.7 * GB);
gap.memory.visibleBytes = Math.round(31.7 * GB);
gap.memory.freeBytes = Math.round(9 * GB);
fs.writeFileSync(path.join(out, 'main-ramgap.json'), JSON.stringify(gap));

/* ================================================================== OLD: 2016 Windows 10 laptop, HDD, single 8 GB DDR3, worn battery */
const old = {
  schema: 1, collectedAt: '2026-10-19T09:00:00', durationSec: 51.0,
  collector: { version: '1.0.0', psVersion: '5.1.19041.4648', isAdmin: true, computerName: 'OLDBOOK', userName: 'tom', options: {} },
  system: { manufacturer: 'Hewlett-Packard', model: 'HP ProBook 450 G3', family: '103C_5336AN HP ProBook', sku: 'T1B71EA#ABD', productVersion: null, serial: 'CND6123XYZ', pcSystemType: 2, chassisTypes: [10], biosVendor: 'HP', biosVersion: 'N78 Ver. 01.30', biosDate: '2017-03-03T00:00:00', boardManufacturer: 'HP', boardProduct: '8101', firmwareType: 1 },
  os: { caption: 'Microsoft Windows 10 Home', version: '10.0.19045', build: 19045, ubr: 6456, displayVersion: '22H2', edition: 'Core', architecture: '64-bit', installDate: '2019-03-04T11:00:00', lastBoot: '2026-10-19T08:50:00', uptimeDays: 0.0, fastStartup: 1, uacEnabled: 1, locale: 'de-DE' },
  cpu: [{ name: 'Intel(R) Core(TM) i5-6200U CPU @ 2.30GHz', manufacturer: 'GenuineIntel', cores: 2, logical: 4, maxMHz: 2400, socket: 'U3E1', l2KB: 512, l3KB: 3072, virtualization: false }],
  memory: {
    totalPhysicalBytes: 8 * GB - 150 * MB, visibleBytes: 8 * GB - 150 * MB, freeBytes: 0.7 * GB, commitBytes: 9.1 * GB, commitLimitBytes: 11.1 * GB, pagesInPerSec: 340, cpuLoadPct: 41,
    modules: [{ locator: 'SODIMM0', bank: 'BANK 0', capacityBytes: 8 * GB, speed: 1600, configuredSpeed: 1600, manufacturer: 'Kingston', partNumber: '99U5469-045.A00LF', smbiosType: 24, formFactor: 12, voltageMv: 1350, rank: 2, dataWidth: 64, totalWidth: 64 }],
    arrays: [{ maxCapacityKB: 33554432, slots: 2, ecc: 3 }], pageFiles: [{ name: 'C:\\pagefile.sys', allocatedMB: 3072, usedMB: 2800, peakMB: 3072 }],
  },
  gpu: [{ name: 'Intel(R) HD Graphics 520', vendor: 'Intel Corporation', driverVersion: '20.19.15.4531', driverDate: '2017-05-01T00:00:00', vramBytes: 1 * GB, hRes: 1366, vRes: 768, refreshHz: 60, status: 'OK', pnpId: 'PCI' }],
  disks: [{ number: 0, model: 'ST500LM021-1KJ152', mediaType: 'HDD', busType: 'SATA', sizeBytes: 500107862016, health: 'Healthy', operational: 'OK', spindleSpeed: 5400, firmware: '0001', partitionStyle: 'MBR', isBoot: true, isSystem: true, reliability: { wearPct: null, temperatureC: 47, powerOnHours: 21000, readErrors: 0, writeErrors: 0 } }],
  volumes: [{ letter: 'C', label: '', fileSystem: 'NTFS', sizeBytes: 465 * GB, freeBytes: 27 * GB, driveType: 3, diskNumber: 0 }],
  battery: { present: true, name: 'Primary', manufacturer: 'HP', chemistry: 'LION', designMWh: 41000, fullChargeMWh: 17900, cycleCount: 1180, chargePct: 100, batteryStatus: 2 },
  network: [{ name: 'WLAN', description: 'Intel(R) Dual Band Wireless-AC 3165', status: 'Up', linkSpeed: '150 Mbps', mediaType: 'Native 802.11' }],
  security: { defender: { serviceEnabled: true, antivirusEnabled: false, realTime: false, tamperProtected: false, signatureUpdated: '2026-02-01T00:00:00', quickScanEnd: null, fullScanEnd: null }, antivirus: [{ name: 'Avast Free Antivirus', enabled: true, upToDate: false }], firewall: [{ profile: 'Domain', enabled: true }, { profile: 'Private', enabled: true }, { profile: 'Public', enabled: false }], secureBoot: null, tpm: { present: true, ready: true, specVersion: '1.2, 2, 1.16' }, bitlocker: [{ mount: 'C:', status: 'FullyDecrypted', protection: 'Off' }], pendingReboot: false, lastHotfix: '2026-06-01T00:00:00', hotfixCount: 21, lastUpdateInstall: null },
  powerPlan: { guid: 'a1841308-3541-4fab-bc81-f71556f20b4a', name: 'Energiesparmodus' },
  startup: Array.from({ length: 13 }, (_, i) => ({ name: 'Autostart ' + (i + 1), command: 'C:\\Program Files\\Vendor' + i + '\\tool.exe', location: 'HKCU\\Run', scope: 'user', enabled: true })),
  processes: [{ name: 'chrome', count: 22, workingSetBytes: 2.8 * GB, cpuSeconds: 4000 }, { name: 'MsMpEng', count: 1, workingSetBytes: 0.4 * GB, cpuSeconds: 900 }],
  folders: [{ id: 'downloads', label: 'Downloads', path: 'C:\\Users\\tom\\Downloads', bytes: 9 * GB, partial: false, kind: 'folder' }, { id: 'hiberfil.sys', label: 'hiberfil.sys', path: 'C:\\hiberfil.sys', bytes: 6.4 * GB, partial: false, kind: 'file' }],
  software: [
    sw('Avast Free Antivirus', '23.9.6082', 'Avast Software', { regKey: 'Avast Antivirus', installDate: '2019-03-10', loc: 'C:\\Program Files\\Avast Software\\Avast', sizeKB: 700 * 1024 }),
    sw('Java(TM) 6 Update 45', '6.0.450', 'Oracle', { regKey: '{jre6}', installDate: '2016-01-10' }),
    sw('Adobe Flash Player 32 NPAPI', '32.0.0.465', 'Adobe', { regKey: 'Adobe Flash Player NPAPI', installDate: '2019-03-10' }),
    sw('Driver Booster 6', '6.5.0', 'IObit', { regKey: 'Driver Booster_is1', installDate: '2019-05-01', loc: 'C:\\Program Files (x86)\\IObit\\Driver Booster', arch: 'x86' }),
    sw('QuickTime', '7.79.80.95', 'Apple Inc.', { regKey: '{quicktime}', installDate: '2019-03-10', arch: 'x86' }),
    sw('Microsoft Office Professional Plus 2016', '16.0.4266.1001', 'Microsoft Corporation', { regKey: 'Office16.PROPLUS', installDate: '2019-03-05', loc: 'C:\\Program Files\\Microsoft Office', sizeKB: 2.5 * 1024 * 1024 }),
    sw('Mozilla Firefox', '115.0', 'Mozilla', { regKey: 'Mozilla Firefox', installDate: '2022-08-01', loc: 'C:\\Program Files\\Mozilla Firefox' }),
  ],
  ignoredUpdates: 80, shortcuts: [], usage: [], usageCounts: { userAssist: 0, appCompat: 0, muiCache: 0, prefetch: 0 }, updates: null, warnings: [],
};
fs.writeFileSync(path.join(out, 'old.json'), JSON.stringify(old));

/* ================================================================== EMPTY: what the collector emits when nothing is readable (e.g. Linux) */
const empty = {
  schema: 1, collectedAt: '2026-10-19T12:00:00', durationSec: 1.2, collector: { version: '1.0.0', psVersion: '7.5.4', isAdmin: false, computerName: 'X', userName: 'x', options: {} },
  system: null, os: null, cpu: [], memory: null, gpu: [], disks: [], volumes: [], battery: null, network: [], security: null, powerPlan: null, startup: [], processes: [], folders: [], software: [],
  ignoredUpdates: 0, shortcuts: [], usage: [], usageCounts: null, updates: null, warnings: [{ area: 'system', message: "The term 'Get-CimInstance' is not recognized" }, { area: 'memory', message: 'x' }],
};
fs.writeFileSync(path.join(out, 'empty.json'), JSON.stringify(empty));

/* PowerShell collapses single-element arrays to bare objects - simulate that variant too */
const collapsed = JSON.parse(JSON.stringify(main));
collapsed.cpu = collapsed.cpu[0];
collapsed.disks = collapsed.disks[0];
collapsed.volumes = collapsed.volumes[0];
collapsed.gpu = collapsed.gpu[0];
collapsed.system.chassisTypes = 10;
collapsed.security.antivirus = collapsed.security.antivirus[0];
fs.writeFileSync(path.join(out, 'collapsed.json'), JSON.stringify(collapsed));

console.log('fixtures written to', out);
