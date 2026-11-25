/* page-hardware.js - what is inside the laptop, one card per component, each with its own recommendation. */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { h, fmtBytes, fmtNum, GB } = LC;

  const byArea = (m, ...areas) => m.findings.filter((f) => areas.includes(f.area));
  const yesNo = (v, y, n, u) => (v === true ? y : v === false ? n : u || 'unbekannt');

  LC.pages.hardware = (S, app) => {
    const m = S.model;
    const hw = m.hw;
    const cards = [
      deviceCard(m), osCard(m, S, app), cpuCard(m), gpuCard(m), ramCard(m, S, app), storageCard(m, S, app), batteryCard(m), networkCard(m), securityCard(m),
    ].filter(Boolean);
    // Small cards sit two by two; wide ones (memory modules, storage analysis, security) take the whole row.
    // A small card left over on its own row also takes the whole row, so there is no empty half.
    let run = [];
    const endRun = () => { if (run.length % 2 === 1) run[run.length - 1].classList.add('span-all'); run = []; };
    cards.forEach((c) => { if (HALF_CARDS.has(c.id)) run.push(c); else { endRun(); c.classList.add('span-all'); } });
    endRun();
    const wanted = S.params && S.params.area;
    if (wanted) setTimeout(() => { const el = document.getElementById('area-' + wanted); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 30);
    return h('div', { class: 'stack' },
      h('div', { class: 'page-title' }, h('h2', null, 'Hardware'), h('p', null, 'Was in deinem Gerät steckt – mit einer Einschätzung pro Teil.')),
      h('div', { class: 'grid cols-2 hw-grid' }, ...cards));
  };
  const HALF_CARDS = new Set(['area-system', 'area-os', 'area-cpu', 'area-gpu', 'area-battery', 'area-network']);

  // every card gets a quick "open the matching place in Windows" button in its header
  const QUICK_OPEN = { os: 'windows-update', storage: 'storage', security: 'windows-security', gpu: 'device-manager', ram: 'task-manager', battery: 'power' };
  const withId = (id, node) => {
    node.id = 'area-' + id;
    node.style.scrollMarginTop = '120px';
    const head = node.querySelector('.card-head');
    if (QUICK_OPEN[id] && head) head.appendChild(LC.openButton(QUICK_OPEN[id]));
    const flag = head ? LC.reviewButton({ id: 'hardware:' + id, kind: 'hardware', title: (head.querySelector('h3') || {}).textContent || id }, { ghost: true }) : null;
    if (flag) head.appendChild(flag);
    return node;
  };

  /* ------------------------------------------------------------------ device */
  function deviceCard(m) {
    const d = m.hw.device;
    return withId('system', LC.card('Gerät', 'laptop', [
      LC.kv([
        ['Modell', d.title],
        ['Maschinentyp', d.machineType && d.machineType !== d.title ? d.machineType : null],
        ['Bauform', d.isLaptop ? 'Notebook / Laptop' : 'Desktop / sonstiges'],
        ['Seriennummer', d.serial],
        ['Hauptplatine', d.board],
        ['BIOS / UEFI', [d.bios.vendor, d.bios.version].filter(Boolean).join(' ') + (d.bios.date ? ' · ' + LC.fmtDate(d.bios.date) : '')],
        ['BIOS-Alter', d.bios.ageYears != null ? fmtNum(d.bios.ageYears) + ' Jahre' : null],
        ['Startmodus', d.uefi === true ? 'UEFI' : d.uefi === false ? 'Legacy-BIOS (alt)' : null],
        ['Geschätztes Gerätealter', m.hw.deviceAgeYears != null ? 'ca. ' + m.hw.deviceAgeYears + ' Jahre (nach Prozessor-Generation)' : null],
      ]),
      LC.recoBox(byArea(m, 'system'), 'BIOS ist aktuell genug.'),
    ]));
  }

  /* ------------------------------------------------------------------ windows */
  function osCard(m, S, app) {
    const o = m.hw.os;
    const win11 = m.hw.win11;
    const checks = !o.isWin11 ? h('div', { style: { marginTop: '12px' } },
      h('h4', { style: { marginBottom: '6px' } }, 'Eignung für Windows 11'),
      win11.checks.map((c) => h('div', { class: 'check-row' }, LC.sevIcon(c.ok === true ? 'ok' : c.ok === false ? 'warn' : 'info'), h('div', null, h('b', null, c.label), h('div', { class: 'small muted' }, c.detail)))),
      h('p', { class: 'small muted' }, 'Das ist nur eine Näherung. Verbindlich: Microsoft-App „PC-Integritätsprüfung“.')) : null;
    return withId('os', LC.card('Windows', 'windows', [
      LC.kv([
        ['Version', o.label + (o.displayVersion ? ' (' + o.displayVersion + ')' : '')],
        ['Edition / Build', [o.edition, o.build + (o.ubr ? '.' + o.ubr : '')].filter(Boolean).join(' · ') + (o.architecture ? ' · ' + o.architecture : '')],
        ['Support (Home/Pro)', o.supportEnd ? LC.fmtDate(o.supportEnd) + (o.supportState === 'ended' ? ' – abgelaufen' : o.daysLeft != null ? ' – noch ' + o.daysLeft + ' Tage' : '') : o.longTerm ? 'abweichende Frist (Enterprise/Education)' : 'unbekannt'],
        ['Installiert seit', o.installDate ? LC.fmtDate(o.installDate) : null],
        ['Laufzeit seit Neustart', o.uptimeDays != null ? fmtNum(o.uptimeDays) + ' Tage' : null],
        ['Schnellstart', yesNo(o.fastStartup, 'an (Herunterfahren startet nicht komplett neu)', 'aus')],
        ['Energieplan', m.hw.powerPlan ? m.hw.powerPlan.name : null],
      ]),
      checks,
      LC.recoBox(byArea(m, 'os'), 'Windows ist aktuell und wird unterstützt.'),
    ]));
  }

  /* ------------------------------------------------------------------ cpu */
  function cpuCard(m) {
    const c = m.hw.cpu;
    if (!c.name) return null;
    return withId('cpu', LC.card('Prozessor', 'cpu', [
      LC.kv([
        ['Modell', c.name],
        ['Einordnung', c.label],
        ['Kerne / Threads', c.cores ? c.cores + ' / ' + c.threads : null],
        ['Maximaltakt', c.maxGHz ? fmtNum(c.maxGHz) + ' GHz' : null],
        ['L3-Cache', c.l3MB ? fmtNum(c.l3MB, 0) + ' MB' : null],
        ['Windows 11 (offiziell)', yesNo(c.win11, 'unterstützt', 'nicht unterstützt')],
        ['Virtualisierung (BIOS)', yesNo(c.virtualization, 'an', 'aus')],
        ['Austauschbar?', 'in Laptops praktisch nie (aufgelötet)'],
      ]),
      LC.recoBox(byArea(m, 'cpu'), 'Der Prozessor ist für heutige Aufgaben ausreichend.'),
    ]));
  }

  /* ------------------------------------------------------------------ memory */
  function ramCard(m, S, app) {
    const ram = m.hw.ram;
    if (!ram) return withId('ram', LC.card('Arbeitsspeicher', 'memory', h('div', { class: 'muted' }, 'Nicht auslesbar (siehe Daten → Datenlücken).')));
    const inst = ram.installedBytes;
    const vis = ram.totalPhysicalBytes || ram.visibleBytes;

    /* installed vs visible vs expected */
    const expectedInput = h('input', { type: 'number', min: '1', max: '2048', step: '1', placeholder: 'GB', value: ram.expectedGB || '', style: { width: '90px' }, 'aria-label': 'Erwartete RAM-Größe in GB' });
    expectedInput.addEventListener('change', () => app.updateNotes((n) => { n.hardware = n.hardware || {}; if (expectedInput.value) n.hardware.ramExpectedGB = +expectedInput.value; else delete n.hardware.ramExpectedGB; }));
    const instGB = inst / GB;
    const expOk = ram.expectedGB ? Math.abs(ram.expectedGB - instGB) <= 0.6 : null;
    const compare = h('div', { class: 'grid cols-3' },
      statBox('Verbaut (laut Modulen)', fmtNum(instGB, 0) + ' GB', ram.modules.map((x) => fmtNum(x.capGB, 0)).join(' + ') + ' GB'),
      statBox('Von Windows nutzbar', fmtNum(vis / GB) + ' GB', ram.reservedBytes > 0.05 * GB ? fmtBytes(ram.reservedBytes) + ' für Hardware reserviert' : 'praktisch alles'),
      h('div', { class: 'card', style: { boxShadow: 'none', background: 'var(--surface-2)' } },
        h('div', { class: 'small muted' }, 'Laut Datenblatt / Kaufbeleg'),
        h('div', { class: 'row', style: { marginTop: '4px' } }, expectedInput, h('span', null, 'GB'),
          expOk === true ? LC.chip('ok', 'passt') : expOk === false ? LC.chip('warn', 'weicht ab') : null),
        h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Trag ein, was dir versprochen wurde – das Tool vergleicht es mit den Modulen.')));

    /* usage bar over installed memory */
    const used = ram.usedBytes, free = ram.freeBytes;
    const bar = used != null ? LC.meter([
      { pct: (used / inst) * 100, title: 'In Benutzung ' + fmtBytes(used) },
      { pct: (free / inst) * 100, cls: 'soft', title: 'Verfügbar ' + fmtBytes(free) },
      { pct: (ram.reservedBytes / inst) * 100, cls: 'hatch', title: 'Reserviert ' + fmtBytes(ram.reservedBytes) },
    ], true) : null;
    const legend = used != null ? h('div', { class: 'legend' },
      h('span', null, h('i'), 'In Benutzung ' + fmtBytes(used) + ' (' + Math.round(ram.usedPct) + ' %)'),
      h('span', null, h('i', { class: 'soft' }), 'Verfügbar ' + fmtBytes(free)),
      ram.reservedBytes > 0.05 * GB ? h('span', null, h('i', { class: 'hatch' }), 'Für Hardware reserviert ' + fmtBytes(ram.reservedBytes)) : null) : null;

    /* modules */
    const mods = h('div', { class: 'modules' }, ram.modules.map((x) => h('div', { class: 'module' },
      h('div', { class: 'row between' }, h('span', { class: 'small muted' }, x.locator), x.soldered ? LC.badge('aufgelötet', 'warn', 'Fest verlötet – nicht tauschbar') : LC.badge(x.form, '')),
      h('div', { class: 'cap num' }, fmtNum(x.capGB, 0) + ' GB'),
      h('div', null, x.typeName + (x.configuredSpeed ? '-' + x.configuredSpeed : '')),
      h('div', { class: 'small muted' }, [x.manufacturer, x.part].filter(Boolean).join(' · ') || 'Hersteller unbekannt'),
      h('div', { class: 'small muted' }, [x.speed && x.speed !== x.configuredSpeed ? 'Nennwert ' + x.speed + ' MT/s' : null, x.voltage ? fmtNum(x.voltage, 2) + ' V' : null, x.rank ? x.rank + '-Rank' : null].filter(Boolean).join(' · ')))));

    const slotsTxt = ram.slotsReported != null
      ? 'BIOS meldet ' + ram.slotsReported + ' Plätze: ' + ram.removable.length + ' Steckmodul(e) belegt' + (ram.soldered.length ? ', ' + ram.soldered.length + ' aufgelötet' : '') + (ram.freeSlots != null ? ' → ' + (ram.freeSlots > 0 ? ram.freeSlots + ' frei (laut BIOS)' : 'keiner frei') : '')
      : 'unbekannt';
    const chLabel = { single: 'Single-Channel', dual: 'Dual-Channel', 'dual-likely': 'vermutlich Dual-Channel', flex: 'gemischt (Flex)', integrated: 'fest integriert', unknown: 'unbekannt' }[ram.channels];

    const profileSel = h('select', { 'aria-label': 'Nutzungsprofil', style: { width: 'auto' }, onchange: (e) => app.updateNotes((n) => { n.hardware = n.hardware || {}; n.hardware.usageProfile = e.target.value; }) },
      Object.entries(LC.USAGE_PROFILES).map(([id, label]) => h('option', { value: id, selected: ((S.notes.hardware || {}).usageProfile || 'mixed') === id ? true : null }, label)));

    const procs = ram.topProcesses.length ? h('details', null, h('summary', null, 'Wer braucht den Speicher gerade? (größte Programme beim Scan)'),
      ram.topProcesses.map((p) => h('div', { class: 'bar-row' }, h('div', null, p.name + (p.count > 1 ? ' ×' + p.count : '')), LC.meter([{ pct: Math.min(100, (p.bytes / (vis || 1)) * 100 * 2.5), title: fmtBytes(p.bytes) }]), h('div', { class: 'why' }, fmtBytes(p.bytes))))) : null;

    return withId('ram', LC.card('Arbeitsspeicher', 'memory', [
      compare,
      bar ? h('div', { style: { margin: '14px 0 2px' } }, bar, legend) : null,
      h('h4', { style: { margin: '16px 0 8px' } }, 'Speichermodule'),
      mods,
      h('div', { style: { marginTop: '14px' } }, LC.kv([
        ['Typ', ram.type],
        ['Steckplätze', slotsTxt],
        ['Maximal laut BIOS', ram.maxGB ? fmtNum(ram.maxGB, 0) + ' GB (Angabe der Hersteller-Firmware, oft ungenau)' : 'nicht gemeldet'],
        ['Kanalmodus', chLabel + (ram.channelNote ? ' – ' + ram.channelNote : '')],
        ['Takt', ram.configuredSpeed ? ram.configuredSpeed + ' MT/s' + (ram.ratedSpeed && ram.ratedSpeed !== ram.configuredSpeed ? ' (Modul kann ' + ram.ratedSpeed + ')' : '') : null],
        ['Auslagerungsdatei', ram.pageFiles.length ? ram.pageFiles.map((p) => fmtNum(p.allocatedMB / 1024) + ' GB (belegt ' + fmtNum(p.usedMB / 1024) + ' GB)').join(', ') : null],
        ['Speicherdruck', ram.pressureLevel === 'high' ? 'hoch – ' + ram.pressureWhy.join('; ') : ram.pressureLevel === 'medium' ? 'mittel – ' + ram.pressureWhy.join('; ') : 'niedrig' + (ram.pagesInPerSec != null ? ' (Auslagern: ' + fmtNum(ram.pagesInPerSec, 0) + ' Seiten/s)' : '')],
        ['Mein Nutzungsprofil', profileSel],
      ])),
      h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Der Speicherdruck ist eine Momentaufnahme. Am aussagekräftigsten ist ein Scan, während du mit all deinen üblichen Programmen arbeitest.'),
      procs,
      LC.recoBox(byArea(m, 'ram'), 'Arbeitsspeicher passt.'),
    ]));
  }
  function statBox(label, value, sub) {
    return h('div', { class: 'card', style: { boxShadow: 'none', background: 'var(--surface-2)' } }, h('div', { class: 'small muted' }, label), h('div', { style: { fontSize: '24px', fontWeight: '700' }, class: 'num' }, value), h('div', { class: 'small muted' }, sub));
  }

  /* ------------------------------------------------------------------ storage */
  function storageCard(m, S, app) {
    const st = m.hw.storage;
    if (!st.disks.length && !st.volumes.length) return null;
    const disks = st.disks.map((d) => h('div', { class: 'module', style: { gap: '6px' } },
      h('div', { class: 'row between' }, h('b', null, d.model), d.healthy ? LC.chip('ok', 'Gesundheit: ' + (d.health || 'ok')) : LC.chip('critical', 'Gesundheit: ' + d.health)),
      h('div', { class: 'facts' },
        h('span', null, h('b', null, d.kind)), h('span', null, d.sizeBytes ? fmtBytes(d.sizeBytes) : '–'),
        d.partitionStyle ? h('span', null, d.partitionStyle) : null,
        d.isSystem ? h('span', null, 'Systemlaufwerk') : null,
        d.wearPct != null ? h('span', null, 'Verschleiß ' + d.wearPct + ' %') : null,
        d.tempC != null ? h('span', null, d.tempC + ' °C') : null,
        d.powerOnHours != null ? h('span', null, fmtNum(d.powerOnHours, 0) + ' Betriebsstunden') : null),
      !d.hasReliability ? h('div', { class: 'small muted' }, 'Verschleiß/Temperatur: nur wenn LaptopCheck als Administrator läuft (Rechtsklick → „Als Administrator ausführen“).') : null,
      d.volumes.map((v) => volumeBar(v))));
    const orphanVols = st.volumes.filter((v) => !st.disks.some((d) => d.volumes.includes(v)));
    // a cloud app's virtual drive (G:) shows the size of the real disk: say what it is instead of a second, "almost full" disk
    const virtualNote = st.virtualVolumes.map((v) => h('div', { class: 'small muted' },
      LC.icon('cloud'), ' Laufwerk ' + v.letter + ':' + (v.label ? ' (' + v.label + ')' : '') + ' ist ein virtuelles Cloud-Laufwerk ohne eigenen Speicher. Es zeigt Größe und freien Platz von Laufwerk C: an; deine Dateien liegen in der Cloud und belegen hier nur, was du offline verfügbar gemacht hast.'));
    const folders = st.folders.filter((f) => f.bytes > 0.2 * GB).sort((a, b) => b.bytes - a.bytes);
    const maxF = folders.length ? folders[0].bytes : 1;
    // how much of the used space does this short list explain? (a folder inside another listed folder, e.g. Temp in AppData\Local, counts once)
    const cVol = st.systemVolume;
    const covered = folders.filter((f, i) => !folders.some((o, j) => j !== i && f.path && o.path && LC.pathUnder(f.path, o.path) && !LC.pathUnder(o.path, f.path))).reduce((a, f) => a + f.bytes, 0);
    const coverage = cVol && cVol.usedBytes && covered < 0.8 * cVol.usedBytes
      ? h('div', { class: 'callout warn', style: { margin: '8px 0' } }, h('b', null, 'Diese Liste erklärt nur ' + fmtBytes(covered) + ' von ' + fmtBytes(cVol.usedBytes) + ' belegtem Speicher (' + Math.round((covered / cVol.usedBytes) * 100) + ' %). '),
        'Sie misst nur wenige bekannte Ordner. Der Rest liegt dort, wo sie nicht hinsieht: Spiele, Entwicklungswerkzeuge, Programme, Windows und Cloud-Ordner. ' + (m.space ? 'Die genaue Aufschlüsselung steht oben unter „Wo ist der Speicher geblieben?“.' : 'Die genaue Aufschlüsselung liefert „Speicher analysieren“ (oben).')) : null;
    // with the full storage analysis this short list of known folders is redundant: folded unless asked for
    const hog = folders.length ? h('details', { open: m.space ? null : true }, h('summary', null, 'Platzfresser (gemessen beim Scan)'), coverage,
      folders.map((f) => h('div', { class: 'bar-row' }, h('div', null, f.label), LC.meter([{ pct: (f.bytes / maxF) * 100, title: fmtBytes(f.bytes) }]),
        h('div', { class: 'why' }, fmtBytes(f.bytes) + (f.partial ? ' (mindestens – Messung abgebrochen)' : '') + hogHint(f)))),
      h('p', { class: 'small muted' }, 'Beim normalen Scan werden nur diese bekannten Ordner nachgemessen. Für alle Ordner des Laufwerks: oben „Speicher analysieren“.')) : null;
    return withId('storage', LC.card('Speicher', 'storage', [
      h('div', { class: 'stack', style: { gap: '10px' } }, disks, orphanVols.map(volumeBar), virtualNote),
      LC.spaceSection && S && app ? h('div', { style: { marginTop: '14px' } }, LC.spaceSection(m, S, app)) : null,
      hog ? h('div', { style: { marginTop: '12px' } }, hog) : null,
      LC.recoBox(byArea(m, 'storage'), 'Speicher ist gesund und hat genug Reserve.'),
    ]));
  }
  function hogHint(f) {
    return ({ downloads: ' – sichten, Altes löschen', 'temp-user': ' – gefahrlos löschbar (Einstellungen → Speicher)', 'temp-windows': ' – löschbar', 'windows-old': ' – alte Windows-Version; löschbar über „Temporäre Dateien“', 'wu-download': ' – löschbar über „Temporäre Dateien“', 'recycle-bin': ' – leeren', 'hiberfil.sys': ' – Ruhezustand', 'pagefile.sys': ' – Auslagerungsdatei (nötig)', 'swapfile.sys': ' – System', 'package-cache': ' – Installer-Reste (vorsichtig)', 'crash-dumps': ' – löschbar', 'appdata-local': ' – Programmdaten/Caches' })[f.id] || '';
  }
  function volumeBar(v) {
    if (v.sizeBytes == null) return null;
    const usedPct = 100 - (v.freePct || 0);
    const sev = v.freePct < 10 ? 'critical' : v.freePct < 15 ? 'warn' : null;
    return h('div', null,
      h('div', { class: 'row between small' }, h('span', null, 'Laufwerk ' + v.letter + ':' + (v.label ? ' (' + v.label + ')' : '') + (v.removable ? ' · Wechseldatenträger' : '')), h('span', { class: 'num' }, fmtBytes(v.freeBytes) + ' frei von ' + fmtBytes(v.sizeBytes))),
      LC.meter([{ pct: usedPct, cls: sev ? 'sev-' + sev : '', title: Math.round(usedPct) + ' % belegt' }, { pct: v.freePct, cls: 'soft', title: fmtBytes(v.freeBytes) + ' frei' }]),
      sev ? h('div', { class: 'small', style: { marginTop: '4px' } }, LC.chip(sev, sev === 'critical' ? 'Fast voll' : 'Wird eng')) : null);
  }

  /* ------------------------------------------------------------------ gpu */
  function gpuCard(m) {
    const gpus = m.hw.gpu;
    if (!gpus.length) return null;
    return withId('gpu', LC.card('Grafik & Bildschirm', 'monitor', [
      gpus.map((g) => h('div', { style: { marginBottom: '10px' } }, LC.kv([
        ['Grafikchip', g.name + (g.integrated ? ' (integriert – teilt sich den RAM)' : '')],
        ['Videospeicher', g.vramBytes ? fmtBytes(g.vramBytes) + (g.integrated ? ' (fest zugewiesen; zusätzlich nutzt sie bei Bedarf Arbeitsspeicher)' : '') : null],
        ['Treiber', g.driverVersion ? g.driverVersion + (g.driverDate ? ' vom ' + LC.fmtDate(g.driverDate) : '') : null],
        ['Auflösung', g.resolution ? g.resolution + (g.refreshHz ? ' @ ' + g.refreshHz + ' Hz' : '') : null],
      ]))),
      LC.recoBox(byArea(m, 'gpu'), 'Grafik ist in Ordnung.'),
    ]));
  }

  /* ------------------------------------------------------------------ battery */
  function batteryCard(m) {
    const b = m.hw.battery;
    if (!b) return m.hw.device.isLaptop ? withId('battery', LC.card('Akku', 'battery', [h('div', { class: 'muted' }, 'Kein Akku erkannt.'), LC.recoBox(byArea(m, 'battery'), '')])) : null;
    const pct = b.healthPct;
    return withId('battery', LC.card('Akku', 'battery', [
      pct != null ? h('div', null, h('div', { class: 'row', style: { alignItems: 'baseline' } }, h('span', { style: { fontSize: '30px', fontWeight: '700' }, class: 'num' }, Math.round(pct) + ' %'), h('span', { class: 'muted' }, 'der ursprünglichen Kapazität')),
        h('div', { style: { margin: '8px 0 14px' } }, LC.meter([{ pct: Math.min(100, pct), cls: pct < 60 ? 'sev-critical' : pct < 80 ? 'sev-warn' : '', title: Math.round(pct) + ' % Kapazität' }, { pct: Math.max(0, 100 - pct), cls: 'soft', title: 'verloren' }], true))) : null,
      LC.kv([
        ['Kapazität jetzt / neu', b.fullWh && b.designWh ? fmtNum(b.fullWh) + ' Wh / ' + fmtNum(b.designWh) + ' Wh' : null],
        ['Ladezyklen', b.cycles != null ? String(b.cycles) : null],
        ['Ladezustand jetzt', b.chargePct != null ? b.chargePct + ' %' + (b.charging ? ' (am Netzteil)' : '') : null],
        ['Technik', [b.chemistry, b.manufacturer].filter(Boolean).join(' · ') || null],
      ]),
      LC.recoBox(byArea(m, 'battery'), 'Akku in gutem Zustand.'),
    ]));
  }

  /* ------------------------------------------------------------------ network */
  function networkCard(m) {
    const n = m.hw.network;
    if (!n.length) return null;
    return withId('network', LC.card('Netzwerk', 'wifi', [
      n.map((x) => h('div', { class: 'check-row' }, LC.sevIcon(/up|connected/i.test(x.status || '') ? 'ok' : 'info'),
        h('div', null, h('b', null, x.description || x.name), h('div', { class: 'small muted' }, [x.wifiLabel, x.status, x.linkSpeed].filter(Boolean).join(' · '))))),
      h('p', { class: 'small muted' }, 'Ein Upgrade der WLAN-Karte lohnt nur selten – siehe Upgrade-Tipps.'),
    ]));
  }

  /* ------------------------------------------------------------------ security */
  function securityCard(m) {
    const s = m.hw.security;
    const rows = [];
    const row = (ok, label, detail) => rows.push(h('div', { class: 'check-row' }, LC.sevIcon(ok === true ? 'ok' : ok === false ? 'warn' : 'info'), h('div', null, h('b', null, label), h('div', { class: 'small muted' }, detail))));
    row(s.defenderOn === true ? true : s.otherAvActive.length ? true : s.defender ? false : null, 'Virenschutz',
      s.defender ? (s.defenderOn ? 'Microsoft Defender aktiv' : 'Defender nicht aktiv') + (s.otherAvActive.length ? ' · ' + s.otherAvActive.map((x) => x.name).join(', ') + ' aktiv' : '') + (s.signatureAgeDays != null ? ' · Signaturen ' + s.signatureAgeDays + ' Tage alt' : '') : 'unbekannt');
    row(s.firewall.length ? s.firewallOff.length === 0 : null, 'Firewall', s.firewall.length ? s.firewall.map((f) => f.profile + ': ' + (f.enabled ? 'an' : 'AUS')).join(' · ') : 'unbekannt');
    row(s.updateAgeDays != null ? s.updateAgeDays <= 45 : null, 'Windows-Updates', s.lastUpdate ? 'zuletzt installiert ' + LC.fmtDate(s.lastUpdate) + ' (' + LC.fmtAgo(s.updateAgeDays) + ')' : 'nicht ermittelbar' + (s.pendingReboot ? '' : ''));
    row(!s.pendingReboot, 'Neustart ausstehend', s.pendingReboot ? 'ja – Updates warten auf den Neustart' : 'nein');
    row(m.hw.os.uac, 'Benutzerkontensteuerung (UAC)', yesNo(m.hw.os.uac, 'an', 'AUS'));
    row(s.secureBoot, 'Secure Boot', yesNo(s.secureBoot, 'an', 'aus (im BIOS aktivierbar)'));
    row(s.tpm ? !!s.tpm.present : null, 'TPM', s.tpm ? (s.tpm.present ? 'vorhanden' + (s.tpm.specVersion ? ' (' + String(s.tpm.specVersion).split(',')[0] + ')' : '') : 'nicht vorhanden') : 'nur als Administrator auslesbar');
    row(s.bitlocker.length ? s.bitlocker.some((b) => /^c/i.test(b.mount) && /on|1|ein/i.test(b.protection)) : null, 'Laufwerksverschlüsselung (BitLocker)', s.bitlocker.length ? s.bitlocker.map((b) => b.mount + ' ' + b.protection).join(' · ') : 'nur als Administrator auslesbar');
    return withId('security', LC.card('Sicherheit', 'shield', [...rows, LC.recoBox(byArea(m, 'security'), 'Grundschutz aktiv.')]));
  }
})(typeof window !== 'undefined' ? window : globalThis);
