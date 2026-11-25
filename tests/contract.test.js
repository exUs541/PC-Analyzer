/* Contract test: the JSON that the C# scan really produces (xUnit runs it against a mock PC, see app/tests/LaptopCheck.Tests/MockPc.cs) must be understood by the dashboard.
 * Without input it does nothing:  COLLECTOR_JSON=<file of a system scan> node --test tests/contract.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const LC = require('./load.js');

const file = process.env.COLLECTOR_JSON;
if (!file) { console.log('COLLECTOR_JSON not set - skipping'); process.exit(0); }
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const m = LC.analyze(raw, { now: '2026-10-20T10:00:00' });
const app = (n) => m.inv.apps.find((a) => a.name === n);

test('hardware facts survive the scan -> JSON -> dashboard round trip', () => {
  assert.equal(m.hw.device.title, 'LENOVO ThinkPad T14 Gen 3');
  assert.equal(m.hw.device.isLaptop, true);
  assert.equal(m.hw.cpu.gen, 12);
  assert.equal(m.hw.cpu.cores, 12);
  assert.equal(m.hw.os.build, 26100);
  assert.equal(m.hw.os.edition, 'Pro');
  assert.equal(m.hw.os.supportState, 'ended');
  assert.equal(Math.round(m.hw.ram.installedBytes / LC.GB), 48);
  assert.equal(m.hw.ram.soldered.length, 1);
  assert.equal(m.hw.ram.removable.length, 1);
  assert.equal(m.hw.ram.type, 'DDR4');
  assert.equal(m.hw.ram.maxGB, 64);
  assert.equal(m.hw.storage.disks[0].kind, 'NVMe-SSD');
  assert.equal(m.hw.storage.disks[0].wearPct, 4);
  assert.equal(m.hw.storage.systemVolume.letter, 'C');
  assert.equal(m.hw.storage.systemDisk.model, 'Samsung SSD 980 PRO 1TB');
  assert.equal(Math.round(m.hw.battery.healthPct), 72);
  assert.equal(m.hw.battery.cycles, 412);
  assert.equal(m.hw.gpu.length, 2);
  assert.equal(m.hw.gpu[1].vramBytes, 2 * LC.GB);
  assert.equal(m.hw.gpu[0].integrated, true);
  assert.equal(m.hw.network[0].wifiLabel, 'Wi-Fi 6E');
  assert.equal(m.hw.security.firewallOff[0], 'Public');
  assert.equal(m.hw.security.secureBoot, true);
  assert.equal(m.hw.security.bitlocker.length, 1);
  assert.equal(m.hw.powerPlan.name, 'Ausbalanciert');
});

test('software inventory and usage evidence from the real scan output', () => {
  const chrome = app('Google Chrome');
  assert.ok(chrome, 'Chrome present');
  assert.equal(chrome.publisher, 'Google LLC');
  assert.equal(chrome.installDate.slice(0, 10), '2024-03-02');
  assert.equal(chrome.sizeKB, 1258291);
  assert.equal(chrome.lastUsed.slice(0, 10), '2026-10-19');        // UserAssist GUID path -> installLocation match
  assert.equal(chrome.lastUsedSource, 'UserAssist');
  assert.equal(chrome.runCount, 612);
  assert.equal(chrome.usageClass, 'active');
  const calc = app('Rechner');
  assert.equal(calc.lastUsed.slice(0, 10), '2026-10-19');          // AUMID
  assert.equal(app('Contoso Report Helper').publisher, null);
  assert.equal(app('Contoso Report Helper').installDate, null);
  assert.equal(app('SomeDev.Tool').publisher, 'Some Developer');
  assert.equal(app('SomeDev.Tool').applicable, false);              // store package without start entry = component
  assert.ok(!m.inv.apps.some((a) => /KB5001234|Update for Windows/.test(a.name)));
  assert.equal(m.snap.ignoredUpdates, 1);
  const java = app('Java 8 Update 311 (64-bit)');
  assert.equal(java.flags.includes('java'), true);
  assert.equal(app('Spotify').scope, 'user');
});

test('startup entries: enabled flags and matching', () => {
  const oneDrive = m.snap.startup.find((s) => s.name === 'OneDrive');
  const teams = m.snap.startup.find((s) => s.name === 'Teams');
  assert.equal(oneDrive.enabled, true);
  assert.equal(teams.enabled, false);
  assert.equal(m.hw.startup.length, 3);
});

test('findings from the real output', () => {
  const ids = m.findings.map((f) => f.id);
  assert.ok(ids.includes('os.eol'));
  assert.ok(ids.includes('sec.firewall'));
  assert.ok(ids.includes('ram.flex'));
  assert.equal(m.snap.updates, null);          // no winget in the mock -> "not checked", not "0 updates"
  assert.ok(ids.includes('sw.updates-unknown'));
});

test('no value is silently mangled: dates are ISO, numbers are numbers', () => {
  assert.match(m.snap.collectedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
  assert.equal(typeof m.snap.memory.visibleBytes, 'number');
  assert.equal(typeof m.snap.volumes[0].freeBytes, 'number');
  assert.equal(typeof m.snap.os.build, 'number');
  assert.ok(Array.isArray(m.snap.software));
});
