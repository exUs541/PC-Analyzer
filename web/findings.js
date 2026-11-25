/* findings.js - the rule set: turns hardware facts + software inventory into findings
 * ("Befunde") with a recommended action, plus the overall score and per-area status.
 *
 * finding = { id, area, severity: ok|info|warn|critical, title, detail, action, steps[], command?, links[], task, impact }
 *   task   true  -> shows up in the "Aufgaben" list
 *   impact 1..5  -> sort order within the same severity
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { GB, fmtBytes, fmtNum, asArray } = LC;

  LC.AREAS = {
    ram: { label: 'Arbeitsspeicher', page: 'hardware' },
    storage: { label: 'Speicher', page: 'space' },
    cpu: { label: 'Prozessor', page: 'hardware' },
    gpu: { label: 'Grafik', page: 'hardware' },
    battery: { label: 'Akku', page: 'hardware' },
    os: { label: 'Windows', page: 'hardware' },
    security: { label: 'Sicherheit', page: 'hardware' },
    software: { label: 'Software', page: 'software' },
    startup: { label: 'Autostart', page: 'software' },
    system: { label: 'System & Daten', page: 'data' },
    files: { label: 'Dateien & Cloud', page: 'files' },
    projects: { label: 'Projekte', page: 'projects' },
    cleanup: { label: 'Aufräumen', page: 'cleanup' },
    folders: { label: 'Inventur', page: 'folders' },
    house: { label: 'Hausordnung', page: 'house' },
  };

  const SEV_RANK = { ok: 0, info: 1, warn: 2, critical: 3 };
  LC.SEV_RANK = SEV_RANK;
  const SEV_LABEL = { ok: 'In Ordnung', info: 'Hinweis', warn: 'Achtung', critical: 'Dringend' };
  LC.SEV_LABEL = SEV_LABEL;

  const CLEAN_STEPS = [
    'Einstellungen → System → Speicher → „Temporäre Dateien“ → Häkchen setzen (Papierkorb, Downloads NICHT automatisch mitlöschen) → „Dateien entfernen“.',
    'Speicheroptimierung einschalten (Einstellungen → System → Speicher), dann räumt Windows regelmäßig selbst auf.',
  ];

  /** extras.space: the analysed storage (LC.analyzeSpace) - optional. */
  LC.buildFindings = (snap, hw, inv, stats, notes, extras) => {
    const F = [];
    const add = (f) => F.push(Object.assign({ severity: 'info', detail: '', action: '', steps: [], links: [], task: null, impact: 2 }, f));
    const now = hw.now;
    const profile = (notes && notes.hardware && notes.hardware.usageProfile) || 'mixed';

    /* ----------------------------------------------------------- scan quality */
    const age = LC.daysBetween(snap.collectedAt, now);
    if (age != null && age >= 7) {
      add({ id: 'scan.stale', area: 'system', severity: 'info', task: true, impact: 1,
        title: 'Die Daten sind ' + age + ' Tage alt',
        detail: 'Der letzte Scan war am ' + LC.fmtDateTime(snap.collectedAt) + '. Seitdem kann sich einiges geändert haben.',
        action: 'Oben auf „Neu scannen“ klicken.' });
    }

    /* ----------------------------------------------------------- RAM */
    const ram = hw.ram;
    if (ram && ram.modules.length) {
      const instGB = ram.installedBytes / GB;
      const visGB = ram.totalPhysicalBytes / GB;
      const gap = ram.installedBytes ? ram.reservedBytes / ram.installedBytes : 0;
      if (hw.os.is32bit && instGB > 3.5) {
        add({ id: 'ram.32bit', area: 'ram', severity: 'critical', task: true, impact: 5,
          title: 'Du nutzt ein 32-Bit-Windows – es sieht nur ca. 4 GB RAM',
          detail: 'Verbaut sind ' + fmtNum(instGB, 0) + ' GB, ein 32-Bit-System kann aber höchstens ca. 3,5–4 GB ansprechen.',
          action: 'Auf 64-Bit-Windows wechseln (Neuinstallation mit 64-Bit-Medium; Daten vorher sichern).' });
      } else if (gap > 0.15) {
        add({ id: 'ram.visible-gap', area: 'ram', severity: 'warn', task: true, impact: 4,
          title: 'Windows nutzt nur ' + fmtNum(visGB) + ' von ' + fmtNum(instGB) + ' GB RAM',
          detail: fmtBytes(ram.reservedBytes) + ' (' + Math.round(gap * 100) + ' %) sind für Windows nicht verfügbar. Normal wären höchstens wenige hundert MB bis ca. 1–2 GB (integrierte Grafik).',
          action: 'Mögliche Ursachen der Reihe nach prüfen:',
          steps: [
            'Win + R → „msconfig“ → Reiter „Start“ → „Erweiterte Optionen“ → „Maximaler Speicher“ darf NICHT angehakt sein.',
            'BIOS/UEFI: Option „Memory Remap“/„Above 4G Decoding“ aktivieren; „iGPU UMA Frame Buffer“ nicht auf einen sehr großen Wert stellen.',
            'Module neu einsetzen (Gerät aus, Netzteil/Akku trennen) – ein nicht richtig sitzendes Modul wird teilweise erkannt.',
            'Mit MemTest86 prüfen, ob eines der Module defekt ist.',
            'Falls du in einer virtuellen Maschine arbeitest: Die VM-Einstellungen begrenzen den RAM.',
          ] });
      } else if (gap > 0.03) {
        add({ id: 'ram.reserved', area: 'ram', severity: 'info', impact: 1,
          title: fmtBytes(ram.reservedBytes) + ' RAM sind für Hardware reserviert',
          detail: 'Von ' + fmtNum(instGB, 0) + ' GB verbaut sieht Windows ' + fmtNum(visGB) + ' GB. Das ist bei integrierter Grafik (teilt sich den RAM) und Firmware-Reservierungen normal.',
          action: 'Nichts zu tun.' });
      }
      const expected = ram.expectedGB;
      if (expected && Math.abs(expected - instGB) > 0.6) {
        const more = instGB < expected;
        add({ id: 'ram.expected-mismatch', area: 'ram', severity: 'warn', task: true, impact: 4,
          title: 'Du erwartest ' + fmtNum(expected, 0) + ' GB, verbaut sind ' + (more ? 'nur ' : '') + fmtNum(instGB) + ' GB',
          detail: 'Die Module melden zusammen ' + fmtNum(instGB) + ' GB: ' + ram.modules.map((m) => fmtNum(m.capGB, 0) + ' GB (' + m.locator + ')').join(' + ') + '.',
          action: more ? 'Prüfen, woher die Differenz kommt:' : 'Die Angabe stimmt nicht – prüfe deine Erwartung:',
          steps: more ? [
            'Datenblatt/Kaufbeleg: Wurde die Größe vielleicht inkl. Grafikspeicher oder einer anderen Ausstattungsvariante angegeben?',
            'Fehlt ein Modul (nicht eingesteckt, nicht erkannt)? → Gerät öffnen, Module neu einsetzen.',
            'BIOS/UEFI: Wird das Modul dort angezeigt? Falls nein, Modul tauschen oder BIOS-Update einspielen.',
            'Mit CPU-Z (Reiter „SPD“) jedes Modul einzeln ansehen.',
          ] : ['Tippfehler oder falsche Quelle? Die Module melden ihre Größe direkt aus dem eigenen Speicherchip (SPD).'] });
      }
      if (ram.channels === 'single' && ram.removable.length === 1) {
        add({ id: 'ram.single-channel', area: 'ram', severity: ram.pressureLevel === 'low' && hw.gpu[0] && !hw.gpu[0].integrated ? 'info' : 'warn', task: true, impact: 3,
          title: 'Der Arbeitsspeicher läuft im Single-Channel',
          detail: 'Nur ein Speichermodul → die Speicherbandbreite ist halbiert. Das merkt man vor allem mit integrierter Grafik (Spiele, Video, Browser) um 10–30 %.',
          action: ram.freeSlots > 0 ? 'Ein zweites, möglichst identisches Modul in den freien Steckplatz setzen (siehe Upgrade-Tipps).' : 'Beide Plätze mit gleich großen Modulen bestücken (siehe Upgrade-Tipps).' });
      }
      if (ram.channels === 'flex') {
        add({ id: 'ram.flex', area: 'ram', severity: 'info', impact: 1,
          title: 'Speichermodule sind unterschiedlich groß',
          detail: ram.modules.map((x) => fmtNum(x.capGB, 0) + ' GB (' + (x.soldered ? 'aufgelötet' : x.locator) + ')').join(' + ') + ': ' + ram.channelNote.replace(/^Module unterschiedlich groß → /, ''),
          action: ram.soldered.length ? 'Bei teils aufgelötetem Speicher ist das normal und lässt sich nicht ändern – nichts zu tun.' : 'Nur relevant, wenn du Maximalleistung willst: zwei gleich große Module einsetzen.' });
      }
      if (ram.slowerThanRated) {
        add({ id: 'ram.slow', area: 'ram', severity: 'info', task: true, impact: 2,
          title: 'RAM läuft mit ' + ram.configuredSpeed + ' statt der möglichen ' + ram.ratedSpeed + ' MT/s',
          detail: 'Der Speicher taktet langsamer als sein Nennwert. Häufige Gründe: gemischte Module (das langsamste bestimmt), ein Profil (XMP/EXPO) ist im BIOS nicht aktiv oder die CPU/Platine unterstützt nur weniger.',
          action: 'BIOS prüfen (XMP/EXPO-Profil, nur wenn dein BIOS es anbietet) – bei Laptops meist nicht änderbar; dann ist es die Grenze der Plattform.' });
      }
      const pressureTxt = ram.pressureWhy.length ? ram.pressureWhy.join('; ') + '.' : '';
      if (ram.pressureLevel === 'high') {
        add({ id: 'ram.pressure', area: 'ram', severity: 'warn', task: true, impact: 5,
          title: 'Der Arbeitsspeicher ist knapp',
          detail: pressureTxt + ' Windows muss dann Daten auf die (langsamere) SSD/Festplatte auslagern – das fühlt sich wie „Hängen“ an.',
          action: ram.removable.length ? 'RAM erweitern (siehe Upgrade-Tipps). Bis dahin: Browser-Tabs schließen, Autostart-Programme reduzieren.' : 'RAM ist aufgelötet – nur entlasten: Autostart reduzieren, weniger Programme/Tabs gleichzeitig, speicherhungrige Programme prüfen (siehe Liste im RAM-Bereich).' });
      } else if (ram.pressureLevel === 'medium') {
        add({ id: 'ram.pressure-medium', area: 'ram', severity: 'info', impact: 2,
          title: 'Arbeitsspeicher mäßig ausgelastet',
          detail: pressureTxt,
          action: 'Beobachten. Tipp: Scanne zu einem Zeitpunkt, an dem alle deine üblichen Programme offen sind – das ergibt das ehrlichste Bild.' });
      }
      if (instGB < 8 && !F.some((f) => f.area === 'ram' && f.severity === 'critical')) {
        add({ id: 'ram.tiny', area: 'ram', severity: 'warn', task: true, impact: 5,
          title: 'Nur ' + fmtNum(instGB, 0) + ' GB RAM sind für Windows 11 sehr knapp',
          detail: 'Windows, Browser und Chat-Programme brauchen zusammen schnell 6–8 GB.',
          action: ram.removable.length ? 'Auf mindestens 16 GB erweitern.' : 'Nicht erweiterbar – bei der nächsten Anschaffung mindestens 16 GB wählen.' });
      }
      if (!F.some((f) => f.area === 'ram' && (f.severity === 'warn' || f.severity === 'critical'))) {
        add({ id: 'ram.ok', area: 'ram', severity: 'ok', impact: 1,
          title: 'Arbeitsspeicher passt',
          detail: fmtNum(instGB, 0) + ' GB ' + ram.type + (ram.usedPct != null ? ', aktuell ' + Math.round(ram.usedPct) + ' % belegt' : '') + '.',
          action: 'Kein Handlungsbedarf.' });
      }
    }

    /* ----------------------------------------------------------- storage */
    const st = hw.storage;
    const c = st.systemVolume;
    if (c && c.freePct != null) {
      const freeGB = c.freeBytes / GB;
      const folders = st.folders;
      const cleanables = folders.filter((f) => ['downloads', 'temp-user', 'temp-windows', 'windows-old', 'wu-download', 'recycle-bin', 'crash-dumps', 'package-cache'].includes(f.id) && f.bytes > 0.3 * GB);
      const cleanTxt = cleanables.length ? ' Sofort greifbar: ' + cleanables.sort((a, b) => b.bytes - a.bytes).map((f) => f.label + ' (' + fmtBytes(f.bytes) + (f.partial ? '+' : '') + ')').join(', ') + '.' : '';
      // with the storage analysis the finding says WHAT fills the drive; without it, it points to the analysis
      const sp = extras && extras.space;
      const spaceTxt = sp && sp.items.length
        ? ' Größte Posten laut Speicher-Analyse: ' + LC.spaceTopText(sp, 4) + '.' + (sp.safeBytes >= 1 * GB ? ' Davon ca. ' + fmtBytes(sp.safeBytes) + ' unkritisch (Caches, Reste).' : '')
        : '';
      const spaceStep = sp && sp.items.length
        ? 'Genaue Aufschlüsselung mit Empfehlung je Posten: Hardware → Speicher → „Wo ist der Speicher geblieben?“.'
        : 'Genau sehen, was den Platz belegt: Hardware → Speicher → „Speicher analysieren“ (dauert 1–2 Minuten, nur lesend).';
      if (c.freePct < 10 || freeGB < 10) {
        add({ id: 'storage.c-low', area: 'storage', severity: 'critical', task: true, impact: 5,
          title: 'Laufwerk C: ist fast voll (' + fmtBytes(c.freeBytes) + ' frei, ' + Math.round(c.freePct) + ' %)',
          detail: 'Unter ca. 10 % freiem Platz werden Windows-Updates, Auslagerungsdatei und SSD-Verwaltung ausgebremst.' + cleanTxt + spaceTxt,
          action: 'Sofort aufräumen:', steps: CLEAN_STEPS.concat([spaceStep, 'Siehe auch ungenutzte Programme in der Programmliste.']) });
      } else if (c.freePct < 15) {
        add({ id: 'storage.c-low', area: 'storage', severity: 'warn', task: true, impact: 4,
          title: 'Laufwerk C: wird eng (' + fmtBytes(c.freeBytes) + ' frei, ' + Math.round(c.freePct) + ' %)',
          detail: 'Ideal sind mindestens 15–20 % frei.' + cleanTxt + spaceTxt, action: 'Aufräumen oder größere SSD einplanen:', steps: CLEAN_STEPS.concat([spaceStep]) });
      } else if (c.freePct < 20) {
        add({ id: 'storage.c-low', area: 'storage', severity: 'info', task: true, impact: 2,
          title: 'Laufwerk C: ' + Math.round(c.freePct) + ' % frei', detail: 'Noch okay, aber Reserve schrumpft.' + cleanTxt + spaceTxt, action: 'Gelegentlich aufräumen.', steps: CLEAN_STEPS.concat([spaceStep]) });
      } else {
        add({ id: 'storage.ok', area: 'storage', severity: 'ok', impact: 1,
          title: 'Genug freier Speicherplatz', detail: 'C: hat ' + fmtBytes(c.freeBytes) + ' frei (' + Math.round(c.freePct) + ' %).', action: 'Kein Handlungsbedarf.' });
      }
      const hib = st.folders.find((f) => f.id === 'hiberfil.sys');
      if (hib && hib.bytes >= 6 * GB && c.freePct < 25) {
        add({ id: 'storage.hiberfil', area: 'storage', severity: 'info', task: true, impact: 2,
          title: 'Ruhezustandsdatei belegt ' + fmtBytes(hib.bytes),
          detail: 'hiberfil.sys speichert den Arbeitsspeicher für Ruhezustand und Schnellstart. Sie ist so groß wie ein Großteil deines RAM.',
          action: 'Wenn du Ruhezustand/Schnellstart nicht brauchst, abschalten. Das spart den Platz:',
          steps: ['Eingabeaufforderung als Administrator → powercfg /hibernate off', 'Oder verkleinern, aber Schnellstart behalten: powercfg /h /type reduced'] });
      }
    }
    for (const d of st.disks) {
      if (!d.healthy) {
        add({ id: 'storage.health:' + d.number, area: 'storage', severity: 'critical', task: true, impact: 5,
          title: d.model + ' meldet Gesundheitsstatus „' + d.health + '“',
          detail: 'Das Laufwerk kündigt einen möglichen Ausfall an.', action: 'Sofort Backup anlegen und das Laufwerk ersetzen.' });
      }
      if (d.wearPct != null && d.wearPct >= 80) {
        add({ id: 'storage.wear:' + d.number, area: 'storage', severity: d.wearPct >= 95 ? 'critical' : 'warn', task: true, impact: 4,
          title: d.model + ' ist zu ' + d.wearPct + ' % verschlissen', detail: 'Die SSD hat einen Großteil ihrer Schreibzyklen verbraucht.', action: 'Backup prüfen und Ersatz einplanen.' });
      }
      if (d.tempC != null && d.tempC >= 70) {
        add({ id: 'storage.temp:' + d.number, area: 'storage', severity: 'warn', task: true, impact: 2,
          title: d.model + ' ist mit ' + d.tempC + ' °C heiß', detail: 'Dauerhaft über 70 °C verkürzt die Lebensdauer.', action: 'Lüftungsschlitze freihalten, Staub entfernen, Laptop nicht auf Weichem betreiben.' });
      }
      if ((d.readErrors || 0) + (d.writeErrors || 0) > 0) {
        add({ id: 'storage.errors:' + d.number, area: 'storage', severity: 'warn', task: true, impact: 3,
          title: d.model + ' zeigt Lese-/Schreibfehler', detail: (d.readErrors || 0) + ' Lese- und ' + (d.writeErrors || 0) + ' Schreibfehler seit Inbetriebnahme.', action: 'Backup anlegen und Laufwerk mit CrystalDiskInfo beobachten.' });
      }
      if (d.hdd && d.isSystem) {
        add({ id: 'storage.hdd-system', area: 'storage', severity: 'warn', task: true, impact: 5,
          title: 'Windows läuft auf einer mechanischen Festplatte',
          detail: d.model + ' ist eine HDD. Eine SSD macht Start, Programme und Updates um ein Vielfaches schneller.', action: 'SSD einbauen (siehe Upgrade-Tipps) – das ist das größte Einzel-Upgrade.' });
      }
    }
    if (st.disks.length && !st.disks.some((d) => d.hasReliability)) {
      add({ id: 'storage.no-smart', area: 'storage', severity: 'info', impact: 1,
        title: 'Keine Details zu Verschleiß/Temperatur', detail: 'Diese Werte (SMART) liefert Windows nur an Administratoren.', action: 'Optional: LaptopCheck als Administrator starten (Rechtsklick → „Als Administrator ausführen“).' });
    }
    const bigFolders = st.folders.filter((f) => f.kind === 'folder' && f.bytes >= 2 * GB && ['downloads', 'appdata-local', 'videos', 'pictures', 'documents'].includes(f.id));
    if (bigFolders.length && c && c.freePct < 30) {
      add({ id: 'storage.big-folders', area: 'storage', severity: 'info', impact: 1,
        title: 'Größte persönliche Ordner: ' + bigFolders.sort((a, b) => b.bytes - a.bytes).map((f) => f.label + ' ' + fmtBytes(f.bytes)).join(', '),
        detail: 'Hier liegt vermutlich der meiste Platz. Mit WizTree oder TreeSize siehst du die einzelnen Dateien.', action: 'Große alte Dateien auslagern (externe SSD/Cloud) oder löschen.' });
    }

    /* ----------------------------------------------------------- battery */
    const b = hw.battery;
    if (b && b.healthPct != null) {
      if (b.healthPct < 60) {
        add({ id: 'battery.worn', area: 'battery', severity: b.healthPct < 40 ? 'critical' : 'warn', task: true, impact: 3,
          title: 'Akku nur noch bei ' + Math.round(b.healthPct) + ' % der Kapazität',
          detail: fmtNum(b.fullWh) + ' Wh statt ursprünglich ' + fmtNum(b.designWh) + ' Wh' + (b.cycles ? ' nach ' + b.cycles + ' Ladezyklen' : '') + '.',
          action: 'Akku tauschen, wenn du mobil arbeitest (siehe Upgrade-Tipps).' });
      } else if (b.healthPct < 80) {
        add({ id: 'battery.fair', area: 'battery', severity: 'info', impact: 2,
          title: 'Akku bei ' + Math.round(b.healthPct) + ' % der Kapazität', detail: 'Normaler Verschleiß' + (b.cycles ? ' nach ' + b.cycles + ' Zyklen' : '') + '.',
          action: 'Ladelimit auf 80 % (falls im Hersteller-Tool angeboten) verlängert die Lebensdauer, wenn du viel am Netzteil arbeitest.' });
      } else {
        add({ id: 'battery.ok', area: 'battery', severity: 'ok', impact: 1, title: 'Akku in gutem Zustand', detail: Math.round(b.healthPct) + ' % der Kapazität' + (b.cycles ? ', ' + b.cycles + ' Zyklen' : '') + '.', action: 'Kein Handlungsbedarf.' });
      }
    } else if (hw.device.isLaptop && !b) {
      add({ id: 'battery.none', area: 'battery', severity: 'info', impact: 1, title: 'Kein Akku erkannt', detail: 'Windows meldet keinen Akku (Desktop-Betrieb oder Akku nicht erkannt).', action: 'Falls dein Gerät einen Akku haben sollte: Akku-Anschluss und Treiber prüfen.' });
    } else if (b && b.healthPct == null) {
      add({ id: 'battery.nodata', area: 'battery', severity: 'info', impact: 1, title: 'Akkuzustand nicht auslesbar', detail: 'Die Kapazitätswerte waren nicht verfügbar.', action: 'In der Eingabeaufforderung „powercfg /batteryreport“ ausführen und den HTML-Bericht ansehen.' });
    }

    /* ----------------------------------------------------------- cpu / gpu */
    const cpu = hw.cpu;
    if (hw.os && !hw.os.isWin11 && cpu.win11 === false) {
      add({ id: 'cpu.no-win11', area: 'cpu', severity: 'warn', task: true, impact: 4,
        title: 'Der Prozessor wird von Windows 11 offiziell nicht unterstützt',
        detail: cpu.label + '. Windows 10 hat keinen regulären Support mehr; ein Wechsel auf Windows 11 ist offiziell nicht vorgesehen.',
        action: 'Optionen: (1) neues Gerät, (2) Windows 10 mit Erweiterten Sicherheitsupdates (ESU, falls noch buchbar), (3) alternative Systeme wie Linux. Prüfe das mit der App „PC-Integritätsprüfung“.' });
    }
    if (cpu.ageYears != null && cpu.ageYears >= 7) {
      add({ id: 'cpu.old', area: 'cpu', severity: 'info', impact: 2,
        title: 'Prozessor ca. ' + cpu.ageYears + ' Jahre alt', detail: cpu.label + '. Alte Prozessoren sind bei Effizienz und Funktionen (z. B. Windows 11, KI-Funktionen) im Nachteil.', action: 'Nicht tauschbar. RAM und SSD zuerst optimieren; bei der nächsten Anschaffung auf aktuelle Generation achten.' });
    } else if (cpu.name) {
      add({ id: 'cpu.ok', area: 'cpu', severity: 'ok', impact: 1, title: 'Prozessor in Ordnung', detail: (cpu.label || cpu.name) + (cpu.cores ? ', ' + cpu.cores + ' Kerne / ' + cpu.threads + ' Threads' : '') + '.', action: 'Kein Handlungsbedarf.' });
    }
    if (snap.memory && snap.memory.cpuLoadPct >= 80) {
      add({ id: 'cpu.busy-at-scan', area: 'cpu', severity: 'info', impact: 1, title: 'Der Prozessor war beim Scan stark ausgelastet (' + Math.round(snap.memory.cpuLoadPct) + ' %)', detail: 'Messwerte (RAM, Prozesse) können dadurch von deinem Normalbetrieb abweichen.', action: 'Wenn das öfter vorkommt: im Task-Manager sehen, welcher Prozess die CPU auslastet.' });
    }
    if (cpu.virtualization === false && inv.apps.some((a) => /docker|virtualbox|vmware|wsl|hyper-v|subsystem for linux/i.test(a.name))) {
      add({ id: 'cpu.virt-off', area: 'cpu', severity: 'warn', task: true, impact: 3, title: 'Virtualisierung ist im BIOS ausgeschaltet', detail: 'Du hast Docker/VM/WSL installiert, aber die CPU-Virtualisierung ist deaktiviert – diese Programme laufen nicht oder sehr langsam.', action: 'BIOS/UEFI öffnen und „Intel VT-x“ bzw. „AMD SVM“ aktivieren.' });
    }
    hw.gpu.forEach((g, i) => {
      if (g.basic) {
        add({ id: 'gpu.basic:' + i, area: 'gpu', severity: 'warn', task: true, impact: 4, title: 'Es läuft nur der Basis-Grafiktreiber von Microsoft', detail: 'Ohne richtigen Treiber ist Grafik langsam, Spiele/Videos ruckeln, Hochauflösung/Helligkeit gehen evtl. nicht.', action: 'Den Treiber des Herstellers installieren (NVIDIA/AMD/Intel bzw. Laptop-Hersteller-Support).' });
      } else if (g.driverAgeDays != null && g.driverAgeDays > (g.integrated ? 900 : 540)) {
        add({ id: 'gpu.driver-old:' + i, area: 'gpu', severity: 'info', task: true, impact: 1, title: 'Grafiktreiber ist ' + (g.driverAgeDays >= 700 ? fmtNum(g.driverAgeDays / 365.25) + ' Jahre' : Math.round(g.driverAgeDays / 30.4) + ' Monate') + ' alt', detail: g.name + ', Treiber ' + (g.driverVersion || '?') + ' vom ' + LC.fmtDate(g.driverDate) + '.', action: 'Über Windows Update bzw. NVIDIA App / AMD Software / Intel Driver & Support Assistant aktualisieren.' });
      }
    });
    if (hw.gpu.length && !F.some((f) => f.area === 'gpu')) {
      const g = hw.gpu[0];
      add({ id: 'gpu.ok', area: 'gpu', severity: 'ok', impact: 1, title: 'Grafik in Ordnung', detail: g.name + (g.vramBytes ? ' · ' + fmtBytes(g.vramBytes) : '') + (g.integrated ? ' (integriert, teilt sich den RAM)' : '') + '.', action: 'Kein Handlungsbedarf.' });
    }

    /* ----------------------------------------------------------- windows */
    const os = hw.os;
    if (os.supportState === 'ended') {
      const ready = hw.win11.ok;
      add({ id: 'os.eol', area: 'os', severity: 'critical', task: true, impact: 5,
        title: os.label + ' erhält keine regulären Sicherheitsupdates mehr',
        detail: 'Der Support für ' + os.label + ' (Home/Pro) endete am ' + LC.fmtDate(os.supportEnd) + '. Ohne Updates bleiben Sicherheitslücken offen.' + (os.isWin11 ? '' : ' Für Windows 10 gab es zeitlich begrenzt kostenpflichtige „Erweiterte Sicherheitsupdates“ (ESU) – prüfe den aktuellen Stand bei Microsoft.'),
        action: os.isWin11 ? 'Auf die aktuelle Windows-11-Version aktualisieren: Einstellungen → Windows Update → Nach Updates suchen (ggf. „Funktionsupdate“ anklicken).'
          : ready === false ? 'Dieser PC erfüllt die Windows-11-Anforderungen laut Scan nicht (Details im Bereich Windows). Entscheidung: neues Gerät, ESU oder alternatives System.'
          : 'Auf Windows 11 wechseln: Einstellungen → Windows Update (wenn angeboten). Prüfe vorher mit „PC-Integritätsprüfung“, ob dein PC geeignet ist (Details im Bereich Windows).' });
    } else if (os.supportState === 'ending') {
      add({ id: 'os.ending', area: 'os', severity: 'warn', task: true, impact: 3,
        title: os.label + ': Support endet in ' + os.daysLeft + ' Tagen (' + LC.fmtDate(os.supportEnd) + ')', detail: 'Danach gibt es für diese Funktionsversion keine Sicherheitsupdates mehr.', action: 'Einstellungen → Windows Update → neues Funktionsupdate installieren.' });
    } else if (os.supportState === 'ok') {
      add({ id: 'os.ok', area: 'os', severity: 'ok', impact: 1, title: os.label + ' wird unterstützt', detail: os.supportEnd ? 'Support für diese Version bis ' + LC.fmtDate(os.supportEnd) + ' (Home/Pro).' : 'Aktuelle Version.', action: 'Kein Handlungsbedarf.' });
    } else if (os.longTerm) {
      add({ id: 'os.edition', area: 'os', severity: 'info', impact: 1, title: os.label + ' (' + os.edition + ')', detail: 'Enterprise/Education haben längere Supportfristen; die genaue Frist liegt bei deiner IT.', action: 'Bei deiner IT-Abteilung nachfragen.' });
    }
    if (hw.security.pendingReboot) {
      add({ id: 'os.reboot', area: 'os', severity: 'warn', task: true, impact: 3, title: 'Ein Neustart steht aus', detail: 'Installierte Updates werden erst nach einem Neustart wirksam.', action: 'Arbeit speichern und Windows neu starten (nicht nur „Herunterfahren“, wenn der Schnellstart aktiv ist).' });
    }
    if (os.uptimeDays != null && os.uptimeDays >= 14) {
      add({ id: 'os.uptime', area: 'os', severity: os.uptimeDays >= 30 ? 'warn' : 'info', task: true, impact: 2,
        title: 'Der letzte Neustart ist ' + Math.round(os.uptimeDays) + ' Tage her',
        detail: 'Dauerbetrieb sammelt Speicherlecks und verzögert Updates.' + (os.fastStartup ? ' Achtung: Bei aktivem Schnellstart startet „Herunterfahren“ NICHT wirklich neu – nur „Neu starten“ tut das.' : ''),
        action: 'Windows über „Neu starten“ (nicht „Herunterfahren“) neu starten.' });
    }
    if (hw.security.updateAgeDays != null && hw.security.updateAgeDays > 60) {
      add({ id: 'os.updates-old', area: 'os', severity: 'warn', task: true, impact: 4, title: 'Seit ' + hw.security.updateAgeDays + ' Tagen kein Windows-Update installiert', detail: 'Letztes erkanntes Update: ' + LC.fmtDate(hw.security.lastUpdate) + '.', action: 'Einstellungen → Windows Update → Nach Updates suchen. Bleiben sie aus, Windows-Update-Problembehandlung nutzen.' });
    }
    if (hw.powerPlan && hw.powerPlan.guid === 'a1841308-3541-4fab-bc81-f71556f20b4a') {
      add({ id: 'os.powerplan', area: 'os', severity: 'info', impact: 1, title: 'Energieplan „Energiesparmodus“ aktiv', detail: 'Dieser Plan drosselt die CPU auch am Netzteil.', action: 'Systemsteuerung → Energieoptionen → „Ausbalanciert“ oder „Höchstleistung“ wählen (am Netzteil).' });
    }
    if (hw.win11 && !os.isWin11) {
      // information only (shown in the Windows card)
    }
    if (hw.device.bios.ageYears != null && hw.device.bios.ageYears >= 2.5 && !/virtual|vmware|hyper-v|qemu|kvm/i.test((hw.device.manufacturer || '') + (hw.device.model || ''))) {
      add({ id: 'system.bios-old', area: 'system', severity: 'info', task: true, impact: 1, title: 'BIOS/Firmware ist ' + fmtNum(hw.device.bios.ageYears) + ' Jahre alt',
        detail: 'Version ' + (hw.device.bios.version || '?') + ' vom ' + LC.fmtDate(hw.device.bios.date) + '. BIOS-Updates schließen Sicherheitslücken und verbessern Akku, Lüfter und Speicher-Kompatibilität.',
        action: 'Auf der Support-Seite deines Herstellers (oder im Hersteller-Tool wie Lenovo Vantage, MyASUS, Dell Command Update, HP Support Assistant) nach einem neueren BIOS suchen. Beim Update Netzteil anschließen und nicht unterbrechen.' });
    }

    /* ----------------------------------------------------------- security */
    const sec = hw.security;
    if (sec.defender) {
      if (sec.otherAvActive.length === 0 && sec.defenderOn === false) {
        add({ id: 'sec.defender-off', area: 'security', severity: 'critical', task: true, impact: 5, title: 'Es ist kein aktiver Virenschutz erkannt', detail: 'Microsoft Defender ist ausgeschaltet und kein anderer Virenscanner meldet sich als aktiv.', action: 'Windows-Sicherheit öffnen → Viren- & Bedrohungsschutz → Echtzeitschutz einschalten.' });
      }
      if (sec.defenderOn && sec.signatureAgeDays != null && sec.signatureAgeDays > 7) {
        add({ id: 'sec.sig-old', area: 'security', severity: 'warn', task: true, impact: 3, title: 'Defender-Signaturen sind ' + sec.signatureAgeDays + ' Tage alt', detail: 'Sie werden normalerweise täglich aktualisiert.', action: 'Windows-Sicherheit → Viren- & Bedrohungsschutz → „Schutzupdates“ → „Nach Updates suchen“.' });
      }
    }
    if (sec.otherAvActive.length >= 2 || (sec.otherAvActive.length >= 1 && sec.defenderOn)) {
      add({ id: 'sec.multi-av', area: 'security', severity: 'warn', task: true, impact: 3, title: 'Mehrere Virenscanner gleichzeitig aktiv',
        detail: sec.antivirus.filter((x) => x.enabled).map((x) => x.name).join(', ') + '. Zwei Echtzeitscanner bremsen sich aus und stören sich.', action: 'Nur einen behalten – im Zweifel Microsoft Defender – und den anderen deinstallieren.' });
    }
    if (sec.firewallOff.length) {
      add({ id: 'sec.firewall', area: 'security', severity: 'warn', task: true, impact: 3, title: 'Windows-Firewall ist ausgeschaltet (' + sec.firewallOff.join(', ') + ')', detail: 'Ohne Firewall sind Dienste deines PCs im Netzwerk ungeschützt.', action: 'Windows-Sicherheit → Firewall- & Netzwerkschutz → für alle Profile einschalten (außer eine andere Firewall übernimmt).' });
    }
    if (os.uac === false) {
      add({ id: 'sec.uac', area: 'security', severity: 'warn', task: true, impact: 3, title: 'Benutzerkontensteuerung (UAC) ist aus', detail: 'UAC verhindert, dass Programme unbemerkt Admin-Rechte erhalten.', action: 'Systemsteuerung → Benutzerkonten → UAC-Einstellungen → Standard einstellen.' });
    }
    if (sec.bitlocker.length && hw.device.isLaptop) {
      const cp = sec.bitlocker.find((x) => /^c/i.test(x.mount));
      if (cp && !/on|ein|1/i.test(cp.protection) ) {
        add({ id: 'sec.bitlocker', area: 'security', severity: 'info', task: true, impact: 2, title: 'Laufwerk C: ist nicht verschlüsselt', detail: 'Bei Verlust/Diebstahl des Laptops könnten Dateien ausgelesen werden.', action: 'Einstellungen → Datenschutz & Sicherheit → Geräteverschlüsselung bzw. BitLocker einschalten (Wiederherstellungsschlüssel sicher aufbewahren!).' });
      }
    }
    if (sec.secureBoot === false && hw.device.uefi !== false) {
      add({ id: 'sec.secureboot', area: 'security', severity: 'info', impact: 1, title: 'Secure Boot ist ausgeschaltet', detail: 'Secure Boot schützt vor manipulierten Startdateien und ist Voraussetzung für Windows 11.', action: 'Im BIOS/UEFI „Secure Boot“ aktivieren (falls ein Dual-Boot-System das nicht verhindert).' });
    }
    if (!F.some((f) => f.area === 'security' && f.severity !== 'ok') && (sec.defender || sec.antivirus.length)) {
      add({ id: 'sec.ok', area: 'security', severity: 'ok', impact: 1, title: 'Grundschutz aktiv', detail: 'Virenschutz' + (sec.defenderOn ? ' (Microsoft Defender)' : '') + (sec.firewall.length ? ', Firewall' : '') + ' ohne Auffälligkeiten.', action: 'Kein Handlungsbedarf.' });
    }

    /* ----------------------------------------------------------- startup */
    const startEnabled = hw.startup.filter((s) => s.enabled);
    if (startEnabled.length > 8) {
      const candidates = inv.apps.filter((a) => a.startup && a.startup.enabled && ['rare', 'unused', 'unknown'].includes(a.usageClass)).map((a) => a.name);
      add({ id: 'startup.many', area: 'startup', severity: startEnabled.length > 12 ? 'warn' : 'info', task: true, impact: 3,
        title: startEnabled.length + ' Programme starten automatisch mit Windows',
        detail: 'Jedes Autostart-Programm verlängert den Start und belegt Arbeitsspeicher.' + (candidates.length ? ' Davon selten/nie genutzt: ' + candidates.slice(0, 8).join(', ') + '.' : ''),
        action: 'Strg + Umschalt + Esc → Reiter „Autostart“ → unnötige Einträge mit Rechtsklick „Deaktivieren“ (die Programme bleiben installiert).', filter: 'startup' });
    } else if (startEnabled.length) {
      add({ id: 'startup.ok', area: 'startup', severity: 'ok', impact: 1, title: 'Autostart überschaubar', detail: startEnabled.length + ' Einträge.', action: 'Kein Handlungsbedarf.' });
    }

    /* ----------------------------------------------------------- software */
    const progs = inv.apps;
    const pup = progs.filter((a) => a.reco.level === 'critical' && a.decision !== 'keep');
    if (pup.length) {
      add({ id: 'sw.pup', area: 'software', severity: 'critical', task: true, impact: 4,
        title: pup.length + LC.plural(pup.length, ' Programm gilt', ' Programme gelten') + ' als potenziell unerwünscht', detail: pup.map((a) => a.name).join(', ') + '.',
        action: 'Deinstallieren (Einstellungen → Apps → Installierte Apps). Bei Treiber-/Tuning-Programmen: Windows Update und Herstellerseiten genügen.', filter: 'critical' });
    }
    const eol = progs.filter((a) => a.reco.reasons.some((r) => r.tag === 'eol') && a.decision !== 'keep' && a.reco.level !== 'critical');
    if (eol.length) {
      add({ id: 'sw.eol', area: 'software', severity: 'warn', task: true, impact: 3,
        title: eol.length + LC.plural(eol.length, ' veralteter Eintrag', ' veraltete Einträge') + ' (Support beendet)', detail: eol.slice(0, 10).map((a) => a.name + ' ' + (a.version || '')).join('; ') + (eol.length > 10 ? ' …' : '') + '.',
        action: 'Prüfen, ob noch etwas davon abhängt, dann entfernen – veraltete Software erhält keine Sicherheitsupdates.', filter: 'eol' });
    }
    const badSize = inv.apps.filter((a) => a.sizeSuspect || a.sizeCorrected);
    if (badSize.length) {
      add({ id: 'sw.size-suspect', area: 'software', severity: 'info', impact: 1, task: false,
        title: badSize.length + ' ' + LC.plural(badSize.length, 'Programm', 'Programme') + ' mit unplausibler Größenangabe',
        detail: badSize.slice(0, 5).map((a) => a.name + ': ' + LC.fmtKB(a.sizeClaimedKB) + ' angegeben' + (a.sizeCorrected ? ', nachgemessen ' + LC.fmtKB(a.sizeKB) : ' (nicht überprüfbar)')).join(' · ') + '. Üblicher Grund: Der Installer trägt die Größe in Bytes statt Kilobytes ein (62 MB werden zu „62 GB“).',
        action: 'Die falsche Angabe fließt nicht in Summen oder „Platz freigeben“ ein. Zum Prüfen: im Explorer Rechtsklick auf den Installationsordner → Eigenschaften.' });
    }
    const unused = progs.filter((a) => a.usageClass === 'unused' && a.decision !== 'keep' && a.reco.level !== 'critical');
    if (unused.length) {
      const kb = unused.reduce((s, a) => s + (a.sizeKB || 0), 0);
      const top = unused.slice().sort((a, b) => (b.sizeKB || 0) - (a.sizeKB || 0)).slice(0, 8);
      add({ id: 'sw.unused', area: 'software', severity: unused.length >= 3 ? 'warn' : 'info', task: true, impact: kb > 5 * 1024 * 1024 ? 4 : 2,
        title: unused.length + ' ' + LC.plural(unused.length, 'Programm', 'Programme') + ' seit über ' + inv.unusedDays + ' Tagen ungenutzt' + (kb ? ' (ca. ' + LC.fmtKB(kb) + ')' : ''),
        detail: top.map((a) => a.name + (a.sizeKB ? ' (' + LC.fmtKB(a.sizeKB) + ')' : '')).join(', ') + (unused.length > top.length ? ' …' : '') + '.',
        action: 'Liste öffnen, jeweils „Behalten“ oder „Entfernen“ markieren und Entfernen-Kandidaten über Einstellungen → Apps deinstallieren.', filter: 'unused' });
    }
    const dups = progs.filter((a) => a.isOlderDuplicate && a.decision !== 'keep');
    if (dups.length) {
      add({ id: 'sw.dups', area: 'software', severity: 'warn', task: true, impact: 2, title: dups.length + ' ältere ' + LC.plural(dups.length, 'Version', 'Versionen') + ' doppelt installiert', detail: dups.map((a) => a.name + ' ' + (a.version || '')).join('; ') + '.', action: 'Die älteren Versionen deinstallieren.', filter: 'dups' });
    }
    if (!inv.hasUsageData && progs.length) {
      add({ id: 'sw.no-usage-data', area: 'software', severity: 'info', task: true, impact: 2,
        title: 'Windows liefert keine Nutzungsdaten („zuletzt benutzt“)',
        detail: 'Der Verlauf ist leer – z. B. weil er mit einem Aufräum-Tool gelöscht wurde oder Windows ihn nicht führt. Ungenutzte Programme lassen sich so nicht erkennen.',
        action: 'Trag bei den wichtigsten Programmen das letzte Nutzungsdatum selbst ein, oder scanne in einigen Wochen erneut (der Verlauf baut sich dann wieder auf).' });
    }
    if (snap.updates === null || snap.updates === undefined) {
      add({ id: 'sw.updates-unknown', area: 'software', severity: 'info', impact: 1, title: 'Programm-Updates wurden nicht geprüft', detail: 'winget ist nicht verfügbar oder wurde beim Scan übersprungen (Schnell-Scan).', action: 'Optional: „App-Installer“ aus dem Microsoft Store installieren und vollständig neu scannen.' });
    } else if (stats.updates > 0) {
      add({ id: 'sw.updates', area: 'software', severity: 'info', task: true, impact: 2, title: stats.updates + ' Programm-' + LC.plural(stats.updates, 'Update', 'Updates') + ' verfügbar',
        detail: asArray(snap.updates).slice(0, 10).map((u) => u.name + ' ' + (u.version || '') + ' → ' + (u.available || '')).join('; ') + (snap.updates.length > 10 ? ' …' : '') + '.',
        action: 'Alle aktualisieren (Knopf unten startet winget in einem eigenen Fenster):', command: 'winget upgrade --all', steps: ['Alternativ: Terminal öffnen und den Befehl ausführen (einzelne Programme: winget upgrade --id <ID>).'], filter: 'updates',
        run: { type: 'winget', items: asArray(snap.updates).map((u) => ({ id: u.id, name: u.name, from: u.version, to: u.available })).filter((u) => u.id) } });
    }
    progs.filter((a) => a.decision === 'remove').forEach((a) => {
      add({ id: 'sw.remove:' + a.key, area: 'software', severity: 'info', task: true, impact: 2, userDriven: true, softwareKey: a.key,
        title: a.name + ' deinstallieren', detail: 'Du hast dieses Programm zum Entfernen markiert.' + (a.sizeKB ? ' Gibt ca. ' + LC.fmtKB(a.sizeKB) + ' frei.' : ''),
        action: 'Einstellungen → Apps → Installierte Apps → „' + a.name + '“ → Deinstallieren.', command: a.quietUninstall || a.uninstallString || null });
    });
    const noDesc = progs.filter((a) => !a.description && a.applicable);
    const noPurpose = progs.filter((a) => a.applicable && !a.purpose && (a.usageClass === 'active' || a.usageClass === 'occasional'));
    if (noDesc.length || noPurpose.length) {
      add({ id: 'sw.missing-info', area: 'software', severity: 'info', task: true, impact: 1, title: 'Es fehlen Angaben zu deinen Programmen',
        detail: (noDesc.length ? noDesc.length + ' ohne Beschreibung („Was macht es?“)' : '') + (noDesc.length && noPurpose.length ? ' · ' : '') + (noPurpose.length ? noPurpose.length + ' aktuell genutzte ohne „Wofür nutze ich es?“' : '') + '.',
        action: 'In der Programmliste den Filter „Info fehlt“ wählen und die Lücken füllen – jede Angabe bleibt bei späteren Scans erhalten.', filter: 'missing' });
    }

    /* ----------------------------------------------------------- system / data */
    if (snap.warnings && snap.warnings.length) {
      add({ id: 'scan.warnings', area: 'system', severity: 'info', impact: 1, title: snap.warnings.length + ' ' + LC.plural(snap.warnings.length, 'Bereich', 'Bereiche') + ' konnten nicht gelesen werden', detail: snap.warnings.map((w) => w.area).join(', ') + '.', action: 'Details unter „Daten“ → Datenlücken. Manche Werte gibt es nur im Administrator-Modus.' });
    }
    if (snap.collector && snap.collector.isAdmin === false) {
      add({ id: 'scan.not-admin', area: 'system', severity: 'info', impact: 1, title: 'Scan lief ohne Administratorrechte', detail: 'Dadurch fehlen u. a. SSD-Verschleiß/Temperatur, BitLocker-Status, TPM-Details und der Prefetch-Verlauf („zuletzt benutzt“ für Hintergrundprogramme).', action: 'Optional: LaptopCheck als Administrator starten (Rechtsklick → „Als Administrator ausführen“).' });
    }

    // "open this place in Windows" buttons, matched by finding id (ids with a suffix like gpu.basic:0 match by prefix)
    const OPEN_FOR = [
      [/^startup\.many/, ['startup-apps', 'task-manager']],
      [/^ram\.visible-gap/, ['msconfig']],
      [/^ram\.(pressure|tiny)/, ['task-manager', 'startup-apps']],
      [/^storage\.c-low/, ['storage', 'disk-cleanup']],
      [/^gpu\./, ['windows-update', 'device-manager']],
      [/^os\.(eol|ending|updates-old)/, ['windows-update']],
      [/^os\.powerplan/, ['power']],
      [/^sec\.(defender-off|sig-old)/, ['windows-security']],
      [/^sec\.multi-av/, ['apps-features', 'windows-security']],
      [/^sec\.firewall/, ['firewall']],
      [/^sec\.uac/, ['uac']],
      [/^sec\.bitlocker/, ['bitlocker']],
      [/^sw\.(pup|eol|dups|unused|remove)/, ['apps-features']],
      [/^sw\.updates$/, ['terminal']],
    ];
    for (const f of F) {
      if (f.severity === 'ok' || f.open) continue;
      const hit = OPEN_FOR.find(([re]) => re.test(f.id));
      if (hit) f.open = hit[1];
    }

    // sorting: severity desc, impact desc
    F.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.impact - a.impact);
    for (const f of F) if (f.task == null) f.task = f.severity === 'warn' || f.severity === 'critical';
    return F;
  };

  /* ------------------------------------------------------------------ score & areas */

  LC.computeScore = (findings) => {
    const perArea = {};
    const PENALTY = { critical: 10, warn: 4, info: 0.5, ok: 0 };
    const CAP = { software: 15, startup: 6, system: 3, files: 8, projects: 3, cleanup: 3 };   // no single area may sink the whole score
    for (const f of findings) perArea[f.area] = (perArea[f.area] || 0) + PENALTY[f.severity];
    let loss = 0;
    const parts = [];
    for (const [area, p] of Object.entries(perArea)) {
      const capped = Math.min(p, CAP[area] || 20);
      if (capped > 0) { loss += capped; parts.push({ area, loss: capped }); }
    }
    const score = Math.max(0, Math.round(100 - loss));
    parts.sort((a, b) => b.loss - a.loss);
    const verdict = score >= 90 ? 'Sehr gut' : score >= 75 ? 'Gut' : score >= 55 ? 'Verbesserungsbedarf' : 'Handlungsbedarf';
    return { score, verdict, parts };
  };

  LC.areaSummaries = (findings, hw, inv, stats) => {
    const worst = (area) => findings.filter((f) => f.area === area).reduce((w, f) => (SEV_RANK[f.severity] > SEV_RANK[w] ? f.severity : w), 'ok');
    const top = (area) => findings.filter((f) => f.area === area && f.severity !== 'ok')[0] || null;
    const out = [];
    const ram = hw.ram;
    if (ram) out.push({ area: 'ram', label: 'Arbeitsspeicher', severity: worst('ram'), value: fmtNum(ram.installedBytes / GB, 0) + ' GB', sub: ram.type + (ram.usedPct != null ? ' · ' + Math.round(ram.usedPct) + ' % belegt' : ''), top: top('ram') });
    const c = hw.storage.systemVolume;
    if (c) out.push({ area: 'storage', label: 'Speicher', severity: worst('storage'), value: fmtBytes(c.freeBytes) + ' frei', sub: (hw.storage.systemDisk ? hw.storage.systemDisk.kind + ' · ' : '') + 'C: zu ' + Math.round(100 - c.freePct) + ' % voll', top: top('storage') });
    out.push({ area: 'cpu', label: 'Prozessor', severity: worst('cpu'), value: hw.cpu.cores ? hw.cpu.cores + ' Kerne' : '–', sub: hw.cpu.label || hw.cpu.name || '–', top: top('cpu') });
    if (hw.gpu.length) out.push({ area: 'gpu', label: 'Grafik', severity: worst('gpu'), value: hw.gpu[0].integrated ? 'integriert' : 'dediziert', sub: hw.gpu[0].name, top: top('gpu') });
    if (hw.battery) out.push({ area: 'battery', label: 'Akku', severity: worst('battery'), value: hw.battery.healthPct != null ? Math.round(hw.battery.healthPct) + ' %' : '–', sub: hw.battery.cycles ? hw.battery.cycles + ' Zyklen' : 'Kapazität', top: top('battery') });
    out.push({ area: 'os', label: 'Windows', severity: worst('os'), value: hw.os.label, sub: hw.os.supportEnd ? 'Support bis ' + LC.fmtDate(hw.os.supportEnd) : hw.os.edition || '', top: top('os') });
    out.push({ area: 'security', label: 'Sicherheit', severity: worst('security'), value: hw.security.defenderOn ? 'Defender aktiv' : hw.security.otherAvActive.length ? hw.security.otherAvActive[0].name : hw.security.defender ? 'kein Schutz' : 'unbekannt', sub: hw.security.firewallOff.length ? 'Firewall teilweise aus' : 'Firewall an', top: top('security') });
    out.push({ area: 'software', label: 'Software', severity: worst('software'), value: stats.programs + ' Programme', sub: stats.unused + ' ungenutzt · ' + stats.updates + ' Updates', top: top('software') });
    out.push({ area: 'startup', label: 'Autostart', severity: worst('startup'), value: hw.startup.filter((s) => s.enabled).length + ' Einträge', sub: 'starten mit Windows', top: top('startup') });
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
