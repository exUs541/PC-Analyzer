/* hardware.js - interprets the hardware part of the snapshot:
 *   LC.analyzeHardware  -> structured, display-ready facts per component
 *   LC.buildUpgrades    -> upgrade advisor (what to buy, what to check) + bottleneck ranking
 *   LC.summaryMetrics   -> small record appended to the history for trend charts
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { GB, asArray, fmtBytes } = LC;

  /* ------------------------------------------------------------------ memory constants */

  const MEM_TYPE = { 18: 'DDR', 19: 'DDR2', 20: 'DDR2 FB-DIMM', 24: 'DDR3', 26: 'DDR4', 27: 'LPDDR', 28: 'LPDDR2', 29: 'LPDDR3', 30: 'LPDDR4', 34: 'DDR5', 35: 'LPDDR5', 36: 'HBM3' };
  const LP_TYPES = new Set([27, 28, 29, 30, 35]);
  const FORM = { 8: 'DIMM', 12: 'SO-DIMM', 14: 'SMD (aufgelötet)', 21: 'BGA (aufgelötet)', 22: 'FPBGA (aufgelötet)' };
  const SOLDERED_FORMS = new Set([14, 21, 22]);

  const INTEL_YEAR = { 2: 2011, 3: 2012, 4: 2013, 5: 2014, 6: 2015, 7: 2016, 8: 2017, 9: 2018, 10: 2019, 11: 2020, 12: 2021, 13: 2022, 14: 2023 };
  const RYZEN_YEAR = { 1000: 2017, 2000: 2018, 3000: 2019, 4000: 2020, 5000: 2021, 6000: 2022, 7000: 2023, 8000: 2024, 9000: 2025 };

  /* ------------------------------------------------------------------ cpu */

  LC.parseCpu = (name) => {
    const n = String(name || '');
    const r = { name: n.replace(/\s+/g, ' ').trim(), vendor: null, label: null, gen: null, year: null, win11: null, lowEnd: false };
    if (/intel/i.test(n)) {
      r.vendor = 'Intel';
      let gen = null;
      let m = n.match(/(\d{1,2})(?:st|nd|rd|th) Gen/i);
      if (m) gen = +m[1];
      if (gen == null) {
        m = n.match(/\bi[3579]-(10|11)\d{2}G\d/i);
        if (m) gen = +m[1];
      }
      if (gen == null) {
        m = n.match(/\bi[3579]-(\d{4,5})/i);
        if (m) gen = m[1].length === 5 ? +m[1].slice(0, 2) : +m[1].slice(0, 1);
      }
      if (/Core\(TM\) Ultra|Core Ultra/i.test(n)) { r.year = 2024; r.label = 'Intel Core Ultra'; r.win11 = true; }
      else if (/Core\(TM\) [3579] \d{3}/i.test(n)) { r.year = 2024; r.label = 'Intel Core (neue Namensgebung ab 2024)'; r.win11 = true; }
      else if (gen != null) {
        r.gen = gen;
        r.year = INTEL_YEAR[gen] || null;
        const fam = (n.match(/\b(i[3579])-/i) || [])[1];
        r.label = 'Intel Core ' + (fam || '') + ' (' + gen + '. Generation' + (r.year ? ', ca. ' + r.year : '') + ')';
        r.win11 = gen >= 8;
      } else if (/Celeron|Pentium|\bN\d{2,4}\b|Atom/i.test(n)) { r.lowEnd = true; r.label = 'Intel Einsteiger-CPU (Celeron/Pentium/N-Serie)'; r.year = null; }
      else r.label = 'Intel-Prozessor';
    } else if (/AMD|Ryzen|Athlon/i.test(n)) {
      r.vendor = 'AMD';
      let m = n.match(/Ryzen\s+(?:AI\s+)?(?:Z\d\s+)?(?:Threadripper\s+)?(?:PRO\s+)?[3579]\s+(?:PRO\s+)?(?:HX\s+)?(\d)(\d{3})/i);
      if (/Ryzen AI/i.test(n)) { r.year = 2024; r.label = 'AMD Ryzen AI'; r.win11 = true; }
      else if (m) {
        const series = +m[1] * 1000;
        r.gen = series;
        r.year = RYZEN_YEAR[series] || null;
        r.label = 'AMD Ryzen ' + series + 'er-Serie' + (r.year ? ' (ca. ' + r.year + ')' : '');
        r.win11 = series >= 3000 ? true : series === 2000 ? null : false;
      } else if (/Athlon|A[468]-|E[12]-/i.test(n)) { r.lowEnd = true; r.label = 'AMD Einsteiger-CPU'; }
      else r.label = 'AMD-Prozessor';
    } else if (/Snapdragon|Qualcomm/i.test(n)) {
      r.vendor = 'Qualcomm'; r.label = 'Qualcomm Snapdragon (ARM)'; r.win11 = true; r.year = 2024;
    } else if (/Apple/i.test(n)) { r.vendor = 'Apple'; r.label = 'Apple Silicon'; }
    return r;
  };

  /* ------------------------------------------------------------------ device / os */

  const LAPTOP_CHASSIS = new Set([8, 9, 10, 14, 30, 31, 32]);

  function analyzeDevice(snap, now) {
    const s = snap.system || {};
    const maker = (s.manufacturer || '').replace(/\binc\.?|corporation|corp\.?|co\.,? ltd\.?/gi, '').trim();
    let model = s.model;
    // Lenovo stores the marketing name in "Version", the machine type in "Model"
    if (/lenovo/i.test(s.manufacturer || '') && s.productVersion && !/^(none|invalid)/i.test(s.productVersion)) model = s.productVersion;
    else if (s.family && model && /^[A-Z0-9]{6,}$/.test(model) && !/lenovo/i.test(s.manufacturer || '')) model = model + ' (' + s.family + ')';
    const title = [maker, model].filter(Boolean).join(' ') || 'Dieses Gerät';
    const chassis = asArray(s.chassisTypes);
    const hasBattery = !!(snap.battery && snap.battery.present);
    const isLaptop = chassis.some((c) => LAPTOP_CHASSIS.has(c)) || s.pcSystemType === 2 || hasBattery;
    const biosDate = LC.parseDate(s.biosDate);
    return {
      title,
      manufacturer: s.manufacturer || null,
      model: s.model || null,
      machineType: s.model || null,
      family: s.family || null,
      serial: s.serial || null,
      isLaptop,
      bios: { vendor: s.biosVendor || null, version: s.biosVersion || null, date: s.biosDate || null, ageYears: biosDate ? Math.round(((now - biosDate) / 31557600000) * 10) / 10 : null },
      board: [s.boardManufacturer, s.boardProduct].filter(Boolean).join(' ') || null,
      uefi: s.firmwareType === 2 ? true : s.firmwareType === 1 ? false : null,
    };
  }

  const EDITION = { core: 'Home', coren: 'Home', professional: 'Pro', professionaln: 'Pro', professionalworkstation: 'Pro for Workstations', enterprise: 'Enterprise', education: 'Education', enterprises: 'Enterprise LTSC', cloud: 'S/Cloud' };

  function analyzeOs(snap, now) {
    const os = snap.os || {};
    const build = os.build || 0;
    const isWin11 = build >= 22000;
    const known = LC.WIN_BUILDS.find((b) => b.build === build);
    let entry = known;
    if (!entry && build > 26200) entry = { label: 'Windows 11 (neuer als 25H2)', end: null };
    if (!entry && build >= 19041 && build < 19045) entry = LC.WIN_BUILDS.filter((b) => b.build <= build).sort((a, b) => b.build - a.build)[0];
    const edKey = String(os.edition || '').toLowerCase();
    const edition = EDITION[edKey] || os.edition || null;
    const longTerm = /enterprise|education/i.test(edition || '');
    let end = entry ? entry.end : null;
    let state = 'unknown';
    let daysLeft = null;
    if (build && !entry) { state = build < 19041 ? 'ended' : 'unknown'; }
    if (end && !longTerm) {
      daysLeft = LC.daysBetween(now, end);
      state = daysLeft < 0 ? 'ended' : daysLeft < 120 ? 'ending' : 'ok';
    } else if (end && longTerm) {
      state = 'unknown';
    } else if (entry && !end) state = 'ok';
    return {
      name: isWin11 ? 'Windows 11' : build >= 10240 ? 'Windows 10' : os.caption || 'Windows',
      label: entry ? entry.label : os.caption || 'Windows',
      caption: os.caption || null,
      displayVersion: os.displayVersion || null,
      build,
      ubr: os.ubr || null,
      edition,
      longTerm,
      architecture: os.architecture || null,
      is32bit: /32/.test(os.architecture || '') && !/64/.test(os.architecture || ''),
      isWin11,
      supportEnd: end,
      supportState: state,
      daysLeft,
      installDate: os.installDate || null,
      uptimeDays: os.uptimeDays,
      fastStartup: os.fastStartup === 1,
      uac: os.uacEnabled === 1 ? true : os.uacEnabled === 0 ? false : null,
    };
  }

  /* ------------------------------------------------------------------ memory */

  function analyzeRam(snap, notes, history) {
    const m = snap.memory;
    if (!m) return null;
    const mods = asArray(m.modules).map((x) => {
      const cap = x.capacityBytes || 0;
      const typeName = MEM_TYPE[x.smbiosType] || (x.smbiosType ? 'Typ ' + x.smbiosType : 'unbekannt');
      const lp = LP_TYPES.has(x.smbiosType);
      const locator = (x.locator || '') + ' ' + (x.bank || '');
      const soldered = lp || SOLDERED_FORMS.has(x.formFactor) || /onboard|on board|soldered|memory ?down|system board/i.test(locator);
      const formKnown = x.formFactor === 8 || x.formFactor === 12 || SOLDERED_FORMS.has(x.formFactor);
      return {
        locator: x.locator || x.bank || '–',
        bank: x.bank || null,
        capacityBytes: cap,
        capGB: cap / GB,
        typeName,
        smbiosType: x.smbiosType,
        lp,
        form: FORM[x.formFactor] || (soldered ? 'aufgelötet' : 'unbekannt'),
        formFactor: x.formFactor,
        formKnown,
        soldered,
        speed: x.speed || null,
        configuredSpeed: x.configuredSpeed || x.speed || null,
        voltage: x.voltageMv ? x.voltageMv / 1000 : null,
        manufacturer: x.manufacturer && !/^(0+|undefined|unknown)$/i.test(x.manufacturer) ? x.manufacturer : null,
        part: x.partNumber || null,
        rank: x.rank || null,
        channelHint: (/channel\s*([ab])|\bch\s*([ab])\b|controller\d?-channel(\d)/i.exec(locator) || [])[0] || null,
      };
    });
    const installed = mods.reduce((a, b) => a + b.capacityBytes, 0);
    const visible = m.visibleBytes || m.totalPhysicalBytes || 0;
    const total = m.totalPhysicalBytes || visible;
    const free = m.freeBytes != null ? m.freeBytes : null;
    const used = visible && free != null ? visible - free : null;
    const usedPct = used != null && visible ? (used / visible) * 100 : null;
    const arr = asArray(m.arrays)[0] || {};
    const maxGB = arr.maxCapacityKB ? arr.maxCapacityKB / 1024 / 1024 : null;

    const soldered = mods.filter((x) => x.soldered);
    const removable = mods.filter((x) => !x.soldered);
    const slotsReported = arr.slots || null;
    const removableSlots = slotsReported != null ? Math.max(slotsReported - soldered.length, removable.length) : null;
    const freeSlots = removableSlots != null ? Math.max(0, removableSlots - removable.length) : null;

    // type = most common among modules
    const typeCount = {};
    mods.forEach((x) => { typeCount[x.typeName] = (typeCount[x.typeName] || 0) + 1; });
    const type = Object.keys(typeCount).sort((a, b) => typeCount[b] - typeCount[a])[0] || 'unbekannt';

    // channel estimate
    let channels = 'unknown';
    let channelNote = '';
    const hints = mods.map((x) => (x.channelHint || '').toLowerCase());
    const distinctHints = new Set(hints.filter(Boolean).map((h) => h.replace(/\s+/g, '')));
    if (mods.length === 0) channels = 'unknown';
    else if (mods.every((x) => x.soldered && x.lp)) { channels = 'integrated'; channelNote = 'Aufgelöteter LPDDR-Speicher: Kanalbreite ist fest und nicht veränderbar.'; }
    else if (mods.length === 1) { channels = 'single'; channelNote = 'Nur ein Speichermodul → Single-Channel (halbe Speicherbandbreite).'; }
    else if (distinctHints.size >= 2 && mods.every((x) => x.capacityBytes === mods[0].capacityBytes)) { channels = 'dual'; channelNote = 'Module sitzen in unterschiedlichen Kanälen und sind gleich groß → Dual-Channel.'; }
    else if (mods.every((x) => x.capacityBytes === mods[0].capacityBytes)) { channels = 'dual-likely'; channelNote = 'Mehrere gleich große Module → vermutlich Dual-Channel (Windows zeigt das nicht direkt an; mit CPU-Z/HWiNFO prüfbar).'; }
    else { channels = 'flex'; channelNote = 'Module unterschiedlich groß → nur teilweise Dual-Channel („Flex-Modus“): der gleich große Anteil läuft schnell, der Rest langsamer.'; }

    const rated = Math.max(0, ...mods.map((x) => x.speed || 0)) || null;
    const configured = mods.length ? Math.min(...mods.map((x) => x.configuredSpeed || x.speed || 0)) || null : null;
    const slowerThanRated = !!(rated && configured && configured < rated * 0.9);

    const expectedGB = notes && notes.hardware && notes.hardware.ramExpectedGB ? +notes.hardware.ramExpectedGB : null;

    // pressure score
    const commitPct = m.commitBytes && m.commitLimitBytes ? (m.commitBytes / m.commitLimitBytes) * 100 : null;
    const hist = asArray(history).slice(-10).map((h) => h.ramUsedPct).filter((x) => x != null);
    const histAvg = hist.length >= 2 ? hist.reduce((a, b) => a + b, 0) / hist.length : null;
    let pressure = 0;
    const why = [];
    if (usedPct != null) {
      if (usedPct >= 90) { pressure += 45; why.push('Arbeitsspeicher aktuell zu ' + Math.round(usedPct) + ' % belegt'); }
      else if (usedPct >= 80) { pressure += 30; why.push('Arbeitsspeicher aktuell zu ' + Math.round(usedPct) + ' % belegt'); }
      else if (usedPct >= 70) { pressure += 15; why.push('Arbeitsspeicher aktuell zu ' + Math.round(usedPct) + ' % belegt'); }
    }
    if (commitPct != null) {
      if (commitPct >= 85) { pressure += 25; why.push('zugesagter Speicher (Commit) bei ' + Math.round(commitPct) + ' % des Limits'); }
      else if (commitPct >= 70) { pressure += 10; why.push('Commit bei ' + Math.round(commitPct) + ' %'); }
    }
    if (m.pagesInPerSec != null) {
      if (m.pagesInPerSec >= 100) { pressure += 20; why.push('Windows lagert viel aus (' + Math.round(m.pagesInPerSec) + ' Seiten/s von der Festplatte nachgeladen)'); }
      else if (m.pagesInPerSec >= 20) { pressure += 8; why.push('leichtes Auslagern (' + Math.round(m.pagesInPerSec) + ' Seiten/s)'); }
    }
    if (histAvg != null && histAvg >= 80) { pressure += 15; why.push('im Schnitt der letzten Scans ' + Math.round(histAvg) + ' % belegt'); }
    pressure = LC.clamp(pressure, 0, 100);

    const procs = asArray(snap.processes).slice(0, 8).map((p) => ({ name: p.name, count: p.count, bytes: p.workingSetBytes }));

    return {
      modules: mods,
      installedBytes: installed,
      visibleBytes: visible,
      totalPhysicalBytes: total,
      reservedBytes: Math.max(0, installed - (total || visible)),
      freeBytes: free,
      usedBytes: used,
      usedPct,
      commitPct,
      pagesInPerSec: m.pagesInPerSec,
      cpuLoadPct: m.cpuLoadPct,
      type,
      soldered,
      removable,
      slotsReported,
      removableSlots,
      freeSlots,
      maxGB,
      channels,
      channelNote,
      ratedSpeed: rated,
      configuredSpeed: configured,
      slowerThanRated,
      expectedGB,
      pageFiles: asArray(m.pageFiles),
      pressure,
      pressureLevel: pressure >= 60 ? 'high' : pressure >= 30 ? 'medium' : 'low',
      pressureWhy: why,
      histAvgUsedPct: histAvg,
      topProcesses: procs,
    };
  }

  /* ------------------------------------------------------------------ storage */

  function diskKind(d) {
    const bus = String(d.busType || '').toLowerCase();
    const media = String(d.mediaType || '').toLowerCase();
    const model = String(d.model || '').toLowerCase();
    if (bus === 'nvme' || /nvme/.test(model)) return { kind: 'NVMe-SSD', ssd: true, external: false };
    if (bus === 'usb') return { kind: 'USB-Laufwerk (extern)', ssd: /ssd/.test(model), external: true };
    if (media === 'ssd' || /solid|ssd/.test(media) || /\bssd\b/.test(model)) return { kind: bus === 'sata' || bus === 'ata' ? 'SATA-SSD' : 'SSD', ssd: true, external: false };
    if (media === 'hdd' || /hard/.test(media) || (d.spindleSpeed && d.spindleSpeed > 0 && d.spindleSpeed < 20000)) return { kind: 'Festplatte (HDD)', ssd: false, hdd: true, external: false };
    if (bus === 'raid') return { kind: 'unbekannt (RAID/Intel-RST-Modus)', ssd: null, external: false };
    return { kind: 'unbekannt', ssd: null, external: false };
  }

  /** Cloud apps (Google Drive for desktop ...) mount a virtual drive that has no disk of its own: it reports the size and free space of the real disk. */
  const isVirtualCloudDrive = (v) => v.diskNumber == null && /^(google drive|onedrive|dropbox|proton drive|icloud|mega|nextcloud|pcloud)/i.test(v.label || '');

  function analyzeStorage(snap) {
    const allVols = asArray(snap.volumes).map((v) => ({
      letter: v.letter,
      label: v.label,
      fs: v.fileSystem,
      sizeBytes: v.sizeBytes,
      freeBytes: v.freeBytes,
      usedBytes: v.sizeBytes != null && v.freeBytes != null ? v.sizeBytes - v.freeBytes : null,
      freePct: v.sizeBytes ? (v.freeBytes / v.sizeBytes) * 100 : null,
      removable: v.driveType === 2,
      diskNumber: v.diskNumber,
    }));
    // virtual cloud drives are not storage: kept apart so they are neither shown as a second "almost full" disk nor counted as one
    const virtualVolumes = allVols.filter(isVirtualCloudDrive);
    const vols = allVols.filter((v) => !isVirtualCloudDrive(v));
    const disks = asArray(snap.disks).map((d) => {
      const k = diskKind(d);
      const rel = d.reliability || null;
      const healthy = !d.health || /healthy|ok/i.test(d.health);
      return {
        number: d.number,
        model: d.model || 'Unbekanntes Laufwerk',
        ...k,
        sizeBytes: d.sizeBytes,
        health: d.health || null,
        healthy,
        operational: d.operational || null,
        wearPct: rel ? rel.wearPct : null,
        tempC: rel ? rel.temperatureC : null,
        powerOnHours: rel ? rel.powerOnHours : null,
        readErrors: rel ? rel.readErrors : null,
        writeErrors: rel ? rel.writeErrors : null,
        hasReliability: !!rel,
        isSystem: !!(d.isBoot || d.isSystem),
        partitionStyle: d.partitionStyle || null,
        volumes: vols.filter((v) => v.diskNumber != null && v.diskNumber === d.number),
      };
    });
    const c = vols.find((v) => (v.letter || '').toUpperCase() === 'C') || vols[0] || null;
    let sysDisk = disks.find((d) => d.volumes.includes(c)) || disks.find((d) => d.isSystem) || (disks.length === 1 ? disks[0] : null);
    return { disks, volumes: vols, virtualVolumes, systemVolume: c, systemDisk: sysDisk, folders: asArray(snap.folders) };
  }

  /* ------------------------------------------------------------------ gpu, battery, network, security */

  function analyzeGpu(snap, now) {
    return asArray(snap.gpu).map((g) => {
      const name = g.name || 'Unbekannte Grafik';
      const basic = /Microsoft Basic (Display|Render)/i.test(name);
      const integrated = /Intel\(R\)? (UHD|Iris|HD Graphics|Xe|Arc\(TM\) Graphics)|Radeon\(TM\) Graphics|Radeon Graphics|Vega \d+ Graphics|Adreno|UHD Graphics/i.test(name) && !/Arc\(TM\) [AB]\d/i.test(name);
      const driverDate = LC.parseDate(g.driverDate);
      return {
        name,
        vendor: g.vendor || null,
        integrated,
        basic,
        driverVersion: g.driverVersion || null,
        driverDate: g.driverDate || null,
        driverAgeDays: driverDate ? LC.daysBetween(driverDate, now) : null,
        vramBytes: g.vramBytes || null,
        resolution: g.hRes && g.vRes ? g.hRes + ' × ' + g.vRes : null,
        refreshHz: g.refreshHz || null,
        status: g.status || null,
      };
    });
  }

  function analyzeBattery(snap) {
    const b = snap.battery;
    if (!b || !b.present) return null;
    const health = b.designMWh && b.fullChargeMWh ? (b.fullChargeMWh / b.designMWh) * 100 : null;
    return {
      name: b.name,
      manufacturer: b.manufacturer,
      chemistry: b.chemistry,
      designWh: b.designMWh ? b.designMWh / 1000 : null,
      fullWh: b.fullChargeMWh ? b.fullChargeMWh / 1000 : null,
      healthPct: health,
      cycles: b.cycleCount,
      chargePct: b.chargePct,
      charging: b.batteryStatus === 2 || b.batteryStatus === 6 || b.batteryStatus === 7 || b.batteryStatus === 8,
      level: health == null ? 'unknown' : health >= 80 ? 'good' : health >= 60 ? 'fair' : 'poor',
    };
  }

  function analyzeNetwork(snap) {
    return asArray(snap.network).map((n) => {
      const wifi = /wi-?fi|wireless|wlan|802\.11/i.test(n.description || '') || /802\.11|wireless/i.test(n.mediaType || '');
      const gen = wifi ? LC.wifiGeneration(n.description) : null;
      return { name: n.name, description: n.description, wifi, wifiGen: gen, wifiLabel: LC.wifiLabel(gen), status: n.status, linkSpeed: n.linkSpeed };
    });
  }

  function analyzeSecurity(snap, now) {
    const s = snap.security || {};
    const av = asArray(s.antivirus);
    const d = s.defender;
    const otherAv = av.filter((x) => !/defender/i.test(x.name));
    const otherActive = otherAv.filter((x) => x.enabled);
    const sigAge = d && d.signatureUpdated ? LC.daysBetween(d.signatureUpdated, now) : null;
    const lastUpdate = s.lastUpdateInstall || s.lastHotfix || null;
    return {
      defender: d,
      defenderOn: d ? !!(d.antivirusEnabled && d.realTime) : null,
      signatureAgeDays: sigAge,
      antivirus: av,
      otherAvActive: otherActive,
      firewall: asArray(s.firewall),
      firewallOff: asArray(s.firewall).filter((f) => !f.enabled).map((f) => f.profile),
      secureBoot: s.secureBoot === 1 ? true : s.secureBoot === 0 ? false : null,
      tpm: s.tpm || null,
      bitlocker: asArray(s.bitlocker),
      pendingReboot: !!s.pendingReboot,
      lastUpdate,
      updateAgeDays: lastUpdate ? LC.daysBetween(lastUpdate, now) : null,
      hotfixCount: s.hotfixCount || 0,
    };
  }

  /* ------------------------------------------------------------------ main */

  LC.analyzeHardware = (snap, notes, history, opts) => {
    const now = opts && opts.now ? new Date(opts.now) : new Date();
    const cpu0 = asArray(snap.cpu)[0] || {};
    const cpu = {
      ...LC.parseCpu(cpu0.name),
      cores: cpu0.cores || null,
      threads: cpu0.logical || null,
      maxGHz: cpu0.maxMHz ? Math.round(cpu0.maxMHz / 100) / 10 : null,
      socket: cpu0.socket || null,
      virtualization: cpu0.virtualization,
      l3MB: cpu0.l3KB ? cpu0.l3KB / 1024 : null,
    };
    cpu.ageYears = cpu.year ? now.getFullYear() - cpu.year : null;

    const hw = {
      now,
      device: analyzeDevice(snap, now),
      os: analyzeOs(snap, now),
      cpu,
      ram: analyzeRam(snap, notes, history),
      gpu: analyzeGpu(snap, now),
      storage: analyzeStorage(snap),
      battery: analyzeBattery(snap),
      network: analyzeNetwork(snap),
      security: analyzeSecurity(snap, now),
      powerPlan: snap.powerPlan || null,
      startup: asArray(snap.startup),
    };
    hw.win11 = win11Readiness(snap, hw);
    hw.deviceAgeYears = cpu.ageYears != null ? cpu.ageYears : hw.device.bios.ageYears != null ? Math.floor(hw.device.bios.ageYears) : null;
    return hw;
  };

  function win11Readiness(snap, hw) {
    const checks = [];
    const sec = hw.security;
    checks.push({ label: 'Prozessor', ok: hw.cpu.win11, detail: hw.cpu.label || hw.cpu.name });
    checks.push({ label: 'TPM 2.0', ok: sec.tpm ? !!(sec.tpm.present && (!sec.tpm.specVersion || /2\.0/.test(sec.tpm.specVersion))) : null, detail: sec.tpm ? (sec.tpm.present ? 'vorhanden' + (sec.tpm.specVersion ? ' (' + String(sec.tpm.specVersion).split(',')[0] + ')' : '') : 'nicht vorhanden') : 'unbekannt (Scan als Administrator liefert das)' });
    checks.push({ label: 'UEFI + Secure Boot', ok: hw.device.uefi === false ? false : sec.secureBoot, detail: hw.device.uefi === false ? 'altes BIOS statt UEFI' : sec.secureBoot == null ? 'unbekannt' : sec.secureBoot ? 'Secure Boot aktiv' : 'Secure Boot aus (im BIOS aktivierbar)' });
    const ramGB = hw.ram ? hw.ram.installedBytes / GB : null;
    checks.push({ label: 'Arbeitsspeicher ≥ 4 GB', ok: ramGB == null ? null : ramGB >= 3.9, detail: ramGB == null ? 'unbekannt' : LC.fmtNum(ramGB) + ' GB' });
    const sysVol = hw.storage.systemVolume;
    checks.push({ label: 'Speicher ≥ 64 GB', ok: sysVol && sysVol.sizeBytes ? sysVol.sizeBytes / GB >= 63 : null, detail: sysVol && sysVol.sizeBytes ? fmtBytes(sysVol.sizeBytes) : 'unbekannt' });
    const known = checks.filter((c) => c.ok != null);
    return { checks, ok: known.length && known.every((c) => c.ok) ? (known.length === checks.length ? true : null) : known.some((c) => c.ok === false) ? false : null };
  }

  /* ------------------------------------------------------------------ upgrade advisor */

  const PROFILE_MIN_GB = { office: 16, mixed: 16, gaming: 16, dev: 32, creative: 32 };
  LC.USAGE_PROFILES = {
    office: 'Büro / Internet / Streaming',
    mixed: 'Gemischt (Büro, ein bisschen Mehr)',
    gaming: 'Gaming',
    dev: 'Entwicklung / VMs / Docker',
    creative: 'Foto-/Video-/3D-Bearbeitung',
  };

  const SIZES = [8, 16, 32, 48, 64];

  function ramTarget(ram, profile) {
    const minGB = PROFILE_MIN_GB[profile] || 16;
    const basis = ram.histAvgUsedPct != null ? Math.max(ram.usedPct || 0, ram.histAvgUsedPct) : ram.usedPct || 0;
    const usedGB = (basis / 100) * (ram.visibleBytes / GB);
    const needed = usedGB * 1.4;
    const std = [16, 24, 32, 48, 64, 96, 128];
    const byUse = std.find((s) => s >= needed) || 128;
    return Math.max(minGB, byUse);
  }

  function ramUpgrade(hw, notes) {
    const ram = hw.ram;
    if (!ram || !ram.modules.length) return null;
    const profile = (notes && notes.hardware && notes.hardware.usageProfile) || 'mixed';
    const have = ram.installedBytes / GB;
    const target = ramTarget(ram, profile);
    const allSoldered = ram.removable.length === 0;
    const maxGB = ram.maxGB;
    const out = {
      id: 'ram',
      area: 'ram',
      title: 'Arbeitsspeicher (RAM)',
      current: LC.fmtNum(have, 0) + ' GB ' + ram.type,
      targetGB: target,
      profile,
      checks: [],
      shopping: [],
      steps: [],
      links: [],
    };
    const q = (hw.device.title || '') + ' RAM upgrade maximum supported memory';
    out.links.push({ label: 'Maximalen RAM für dein Modell recherchieren', url: LC.searchUrl(q) });
    out.links.push({ label: 'Service-/Wartungshandbuch suchen', url: LC.searchUrl((hw.device.title || '') + ' service manual memory SO-DIMM slots') });

    if (allSoldered) {
      out.feasible = false;
      out.verdict = 'nicht möglich';
      out.benefit = 0;
      out.cost = '–';
      out.difficulty = '–';
      out.why = 'Der Arbeitsspeicher ist fest aufgelötet (' + ram.type + '). Er lässt sich nicht erweitern oder tauschen.';
      out.advice = have >= target
        ? 'Kein Handlungsbedarf: ' + LC.fmtNum(have, 0) + ' GB reichen für dein Profil.'
        : 'Nicht erweiterbar. Entlaste ihn: Autostart-Programme und Browser-Tabs reduzieren, Hintergrund-Apps beenden. Beim nächsten Gerät mindestens ' + target + ' GB wählen.';
      return out;
    }

    const freeSlots = ram.freeSlots;
    const typeName = ram.type;
    const formName = ram.removable[0] ? (ram.removable[0].formFactor === 8 ? 'DIMM' : 'SO-DIMM') : 'SO-DIMM';
    const solderedGB = ram.soldered.reduce((a, b) => a + b.capGB, 0);
    const speed = ram.ratedSpeed;
    const volt = ram.removable[0] && ram.removable[0].voltage ? ' (' + LC.fmtNum(ram.removable[0].voltage) + ' V)' : '';
    const specStr = typeName + (speed ? '-' + speed : '') + ' ' + formName + volt;
    const exist = ram.removable[0];
    const existStr = exist ? [exist.manufacturer, exist.part].filter(Boolean).join(' ') : '';

    // options
    const options = [];
    const sizes = SIZES;
    if (freeSlots > 0 && exist) {
      // A: fill the free slot(s) with identical modules
      const s = exist.capGB;
      const res = have + s * freeSlots;
      options.push({ id: 'A', text: freeSlots + ' × ' + LC.fmtNum(s, 0) + ' GB ' + specStr + ' zusätzlich (möglichst identisch zum vorhandenen Modul' + (existStr ? ': ' + existStr : '') + ')', resultGB: res, buy: freeSlots * s, matching: true });
      // A2: bigger module in free slot (breaks symmetry, but cheap)
      const s2 = sizes.find((x) => x > s && have + x >= target);
      if (s2 && freeSlots === 1) options.push({ id: 'A2', text: '1 × ' + s2 + ' GB ' + specStr + ' zusätzlich (größer als das vorhandene – funktioniert, aber nur der gleich große Teil läuft im schnellen Dual-Channel)', resultGB: have + s2, buy: s2, matching: false });
    }
    // B: replace all removable modules by a matched kit
    const count = ram.removableSlots || ram.removable.length || 2;
    const sB = sizes.find((x) => solderedGB + x * count >= target) || sizes[sizes.length - 1];
    options.push({ id: 'B', text: count === 1
      ? '1 × ' + sB + ' GB ' + specStr + ' (ersetzt dein vorhandenes ' + LC.fmtNum(exist ? exist.capGB : 0, 0) + '-GB-Modul) → ' + LC.fmtNum(solderedGB + sB, 0) + ' GB gesamt'
      : count + ' × ' + sB + ' GB ' + specStr + ' als Kit (alle vorhandenen Module ersetzen) → ' + LC.fmtNum(solderedGB + sB * count, 0) + ' GB gesamt', resultGB: solderedGB + sB * count, buy: count * sB, matching: true });

    const reaching = options.filter((o) => o.resultGB >= target - 0.1 && (!maxGB || o.resultGB <= maxGB + 0.1));
    const best = reaching[0] || options[0];
    out.options = options;
    out.best = best;
    out.shopping.push(best.text);
    if (speed) out.shopping.push('Geschwindigkeit: mindestens ' + typeName + '-' + speed + '. Schnellere Module laufen nur, wenn CPU/BIOS es erlauben – sonst werden sie automatisch gedrosselt (kein Schaden, aber rausgeworfenes Geld).');
    out.shopping.push('Bauform: ' + formName + ' (Laptop) – ' + (formName === 'SO-DIMM' ? 'nicht mit normalen Desktop-DIMMs verwechseln.' : 'Desktop-Bauform.'));
    out.shopping.push('Zum Einbau: kleiner Kreuzschlitz-/Torx-Schraubendreher, antistatisches Armband oder vorher an einem Heizkörper erden; ggf. Plastik-Spudger fürs Gehäuse.');

    out.checks.push('Maximal unterstützten RAM bestätigen: ' + (maxGB ? 'Das BIOS meldet ' + LC.fmtNum(maxGB, 0) + ' GB – diese Angabe ist bei Laptops oft ungenau; im Handbuch/Datenblatt deines Modells nachsehen.' : 'Das BIOS meldet keinen Wert; im Handbuch deines Modells nachsehen.'));
    out.checks.push('Anzahl freier Steckplätze bestätigen' + (ram.slotsReported ? ': BIOS meldet ' + ram.slotsReported + ' Plätze, ' + ram.removable.length + ' belegt' + (ram.soldered.length ? ' (+ ' + ram.soldered.length + ' aufgelötet)' : '') + '.' : '.') + ' Manche Laptops melden mehr Plätze, als wirklich existieren.');
    if (ram.channels === 'single') out.checks.push('Aktuell nur 1 Modul → zweites, identisches Modul bringt zusätzlich Dual-Channel (spürbar vor allem mit integrierter Grafik).');
    if (ram.channels === 'flex') out.checks.push('Aktuell unterschiedlich große Module: Mit zwei gleich großen läuft alles im Dual-Channel.');
    out.checks.push('Garantie: Gehäuse öffnen kann Garantie/Siegel betreffen – Hersteller-Regeln lesen. Vor dem Öffnen Akku trennen bzw. Gerät ausschalten und Netzteil abziehen.');
    out.steps.push('Nach dem Einbau: Task-Manager → Leistung → Arbeitsspeicher: Größe, Geschwindigkeit und „Steckplätze verwendet“ prüfen. Danach diese App neu scannen.');
    out.steps.push('Stabilität testen: MemTest86 (USB-Stick) oder Windows-Speicherdiagnose laufen lassen.');
    out.links.push({ label: 'Kompatible Module suchen (Hersteller-Konfigurator)', url: LC.searchUrl('Crucial OR Kingston memory configurator ' + (hw.device.title || '')) });

    const needMore = have < target - 0.1;
    const pressureHigh = ram.pressureLevel === 'high';
    const pressureMed = ram.pressureLevel === 'medium';
    if (!needMore && !pressureHigh) {
      out.verdict = 'nicht nötig';
      out.benefit = ram.channels === 'single' && ram.removable.length === 1 ? 2 : 1;
      out.cost = '€';
      out.difficulty = 'leicht–mittel';
      out.why = 'Mit ' + LC.fmtNum(have, 0) + ' GB liegst du über dem Bedarf deines Profils (' + target + ' GB). Mehr RAM würde im Alltag kaum etwas bringen.' + (ram.channels === 'single' ? ' Einziger Pluspunkt: ein zweites gleiches Modul würde Dual-Channel ermöglichen.' : '');
      out.advice = 'Aktuell kein Upgrade nötig.';
    } else {
      out.verdict = 'empfohlen';
      out.benefit = pressureHigh || have <= 8 ? 5 : needMore && have <= 16 ? 4 : 3;
      out.cost = best.buy <= 16 ? '€' : best.buy <= 32 ? '€€' : '€€€';
      out.difficulty = 'leicht–mittel';
      const reasons = [];
      if (needMore) reasons.push('für dein Profil („' + LC.USAGE_PROFILES[profile] + '“) sind ca. ' + target + ' GB sinnvoll, du hast ' + LC.fmtNum(have, 0));
      if (ram.pressureWhy.length) reasons.push(ram.pressureWhy.join('; '));
      out.why = 'RAM-Upgrade lohnt sich: ' + reasons.join(' – ') + '.';
      out.advice = 'Empfehlung: ' + best.text + '.';
      if (maxGB && best.resultGB > maxGB + 0.1) out.checks.unshift('Achtung: Das Ziel (' + LC.fmtNum(best.resultGB, 0) + ' GB) liegt über dem BIOS-Limit (' + LC.fmtNum(maxGB, 0) + ' GB). Prüfe, ob das Modell mehr verträgt – das BIOS-Limit ist oft nur eine Mindestangabe.');
    }
    out.pressureMed = pressureMed;
    return out;
  }

  function storageUpgrade(hw) {
    const st = hw.storage;
    const d = st.systemDisk;
    const c = st.systemVolume;
    if (!d && !c) return null;
    const out = { id: 'storage', area: 'storage', title: 'Speicher (SSD/Festplatte)', checks: [], shopping: [], steps: [], links: [], current: d ? d.kind + (d.sizeBytes ? ', ' + fmtBytes(d.sizeBytes) : '') : '–' };
    out.links.push({ label: 'Passende SSD für dein Modell recherchieren', url: LC.searchUrl((hw.device.title || '') + ' SSD upgrade M.2 2280 NVMe or SATA compatible') });
    const usedGB = c && c.usedBytes ? c.usedBytes / GB : null;
    const targetGB = usedGB ? [512, 1024, 2048, 4096].find((s) => s >= usedGB * 2) || 4096 : 1024;
    const targetLabel = targetGB >= 1024 ? targetGB / 1024 + ' TB' : targetGB + ' GB';
    const bad = d && (!d.healthy || (d.wearPct != null && d.wearPct >= 80));
    if (d && d.hdd) {
      out.verdict = 'empfohlen'; out.benefit = 5; out.cost = '€€'; out.difficulty = 'mittel';
      out.why = 'Dein System läuft auf einer mechanischen Festplatte. Der Umstieg auf eine SSD ist das größte Einzel-Upgrade für gefühlte Geschwindigkeit: Start, Programme und Updates werden um ein Vielfaches schneller.';
      out.advice = 'Empfehlung: SSD mit ' + targetLabel + ' einbauen und das System klonen oder Windows neu installieren.';
      out.shopping.push('SSD ' + targetLabel + ' – je nach Gerät 2,5″ SATA-SSD (7 mm) oder M.2-SSD. Steckplatz-Typ vorher prüfen (Handbuch oder Gehäuse öffnen).');
      out.shopping.push('Zum Klonen: SATA-auf-USB-Adapter (bei 2,5″) bzw. M.2-USB-Gehäuse + Klon-Software (z. B. Clonezilla, Macrium-Alternativen) – oder USB-Stick (8 GB+) für eine Windows-Neuinstallation.');
    } else if (bad) {
      out.verdict = 'empfohlen'; out.benefit = 5; out.cost = '€€'; out.difficulty = 'mittel';
      out.why = 'Das Systemlaufwerk meldet Probleme' + (d.wearPct != null && d.wearPct >= 80 ? ' (Verschleiß ' + d.wearPct + ' %)' : ' (Gesundheitsstatus: ' + d.health + ')') + '. Bei einem Ausfall sind Daten gefährdet.';
      out.advice = 'Zuerst Backup, dann Laufwerk ersetzen (SSD ' + targetLabel + ').';
      out.shopping.push('Gleiche Bauform wie das vorhandene Laufwerk: ' + (d.kind === 'NVMe-SSD' ? 'M.2 2280 NVMe (Länge 2280 vs. 2242/2230 beachten)' : d.kind === 'SATA-SSD' ? '2,5″ SATA oder M.2 SATA' : 'siehe Handbuch') + '.');
    } else if (c && c.freePct != null && c.freePct < 15) {
      out.verdict = 'empfohlen'; out.benefit = 4; out.cost = '€€'; out.difficulty = 'mittel';
      out.why = 'Laufwerk C: ist zu ' + Math.round(100 - c.freePct) + ' % voll (' + fmtBytes(c.freeBytes) + ' frei). Zu wenig freier Platz bremst Windows und verkürzt die SSD-Lebensdauer.';
      out.advice = 'Erst aufräumen (siehe Aufgaben). Reicht das nicht: SSD mit ' + targetLabel + ' einbauen.';
      out.shopping.push('SSD ' + targetLabel + ' im selben Format wie die jetzige (' + (d ? d.kind : '–') + ').');
    } else if (d && d.kind === 'SATA-SSD') {
      out.verdict = 'optional'; out.benefit = 2; out.cost = '€€'; out.difficulty = 'mittel';
      out.why = 'SATA-SSD → NVMe-SSD bringt im Alltag nur wenig; vor allem bei großen Dateikopien merkbar.';
      out.advice = 'Nur sinnvoll, wenn das Gerät einen freien M.2-NVMe-Steckplatz hat und du viel mit großen Dateien arbeitest.';
    } else {
      out.verdict = 'nicht nötig'; out.benefit = 1; out.cost = '€'; out.difficulty = 'mittel';
      out.why = 'Das Systemlaufwerk ist eine ' + (d ? d.kind : 'SSD') + ' mit ausreichend freiem Platz' + (c && c.freePct != null ? ' (' + Math.round(c.freePct) + ' % frei)' : '') + '.';
      out.advice = 'Aktuell kein Upgrade nötig.';
    }
    out.checks.push('Prüfen, welche Bauform dein Gerät aufnimmt: M.2 2280/2242/2230, NVMe oder SATA, 2,5″ – steht im Handbuch.');
    out.checks.push('Vor dem Wechsel Backup anlegen und BitLocker-Wiederherstellungsschlüssel sichern (falls verschlüsselt).');
    out.checks.push('Ein zweiter M.2-Steckplatz erlaubt oft, die alte SSD zu behalten und nur eine zusätzliche einzubauen.');
    return out;
  }

  function batteryUpgrade(hw) {
    const b = hw.battery;
    if (!b) return null;
    const out = { id: 'battery', area: 'battery', title: 'Akku', current: b.healthPct != null ? Math.round(b.healthPct) + ' % der ursprünglichen Kapazität' : 'Kapazität unbekannt', checks: [], shopping: [], steps: [], links: [] };
    out.links.push({ label: 'Original-Ersatzakku für dein Modell suchen', url: LC.searchUrl((hw.device.title || '') + ' replacement battery part number') });
    if (b.healthPct != null && b.healthPct < 60) {
      out.verdict = 'empfohlen'; out.benefit = 4; out.cost = '€€'; out.difficulty = 'mittel';
      out.why = 'Der Akku hat nur noch ' + Math.round(b.healthPct) + ' % seiner Kapazität' + (b.cycles ? ' nach ' + b.cycles + ' Ladezyklen' : '') + '. Die Laufzeit ist entsprechend kurz.';
      out.advice = 'Akku tauschen, wenn du unterwegs arbeitest.';
    } else if (b.healthPct != null && b.healthPct < 80) {
      out.verdict = 'optional'; out.benefit = 2; out.cost = '€€'; out.difficulty = 'mittel';
      out.why = 'Der Akku hat ' + Math.round(b.healthPct) + ' % seiner Kapazität – spürbar verschlissen, aber noch brauchbar.';
      out.advice = 'Tauschen, sobald dir die Laufzeit nicht mehr reicht. Bis dahin: Ladelimit auf 80 % setzen, falls dein Hersteller-Tool das anbietet.';
    } else {
      out.verdict = 'nicht nötig'; out.benefit = 1; out.cost = '€€'; out.difficulty = 'mittel';
      out.why = b.healthPct != null ? 'Der Akku ist mit ' + Math.round(b.healthPct) + ' % Kapazität in gutem Zustand.' : 'Akkuzustand konnte nicht bestimmt werden.';
      out.advice = 'Aktuell kein Tausch nötig.';
    }
    out.shopping.push('Ersatzakku mit der exakten Teilenummer deines Modells (Aufkleber auf dem Akku bzw. Handbuch). Original oder renommierter Hersteller – keine No-Name-Akkus (Brandgefahr).');
    out.checks.push('Prüfen, ob der Akku steckbar oder verschraubt/verklebt ist. Bei verklebten Akkus lieber Fachwerkstatt.');
    out.checks.push('Gerät vor dem Tausch ausschalten und Netzteil trennen; alten Akku beim Wertstoffhof/Händler entsorgen (nicht in den Hausmüll).');
    return out;
  }

  function wifiUpgrade(hw) {
    const w = hw.network.find((n) => n.wifi && n.wifiGen);
    if (!w || w.wifiGen >= 6) return null;
    return {
      id: 'wifi', area: 'network', title: 'WLAN-Karte', current: w.description + ' (' + w.wifiLabel + ')',
      verdict: 'optional', benefit: 2, cost: '€', difficulty: 'mittel',
      why: 'Deine WLAN-Karte unterstützt nur ' + w.wifiLabel + '. Mit Wi-Fi 6/6E sind Durchsatz und Stabilität in vollen Funknetzen besser – relevant nur, wenn dein Router das auch kann.',
      advice: 'Nur sinnvoll, wenn die Karte steckbar ist (M.2 2230 „E-Key“) und dein Hersteller keine Karten-Sperrliste (Whitelist) nutzt. Alternative: USB-WLAN-Stick.',
      shopping: ['Intel AX210/AX211 (Wi-Fi 6E) oder BE200 (Wi-Fi 7), M.2 2230 E-Key'],
      checks: ['Prüfen, ob die Karte steckbar ist (viele neue Geräte haben sie aufgelötet).', 'Antennenanschlüsse: meist 2 × MHF4.'], steps: [], links: [{ label: 'Kompatibilität recherchieren', url: LC.searchUrl((hw.device.title || '') + ' wifi card replacement compatible AX210') }],
    };
  }

  function maintenanceUpgrade(hw) {
    if (!hw.device.isLaptop || hw.deviceAgeYears == null || hw.deviceAgeYears < 3) return null;
    return {
      id: 'cooling', area: 'cpu', title: 'Kühlung reinigen / Wärmeleitpaste', current: 'Gerät ca. ' + hw.deviceAgeYears + ' Jahre alt',
      verdict: hw.deviceAgeYears >= 4 ? 'optional' : 'nicht nötig', benefit: hw.deviceAgeYears >= 5 ? 3 : 2, cost: '€', difficulty: 'mittel',
      why: 'Nach einigen Jahren verstopft Staub die Lüfter und die Wärmeleitpaste altert. Folgen: laute Lüfter, Drosselung unter Last, schwankende Leistung.',
      advice: 'Wenn der Laptop unter Last heiß/laut wird oder sich merklich verlangsamt: Lüfter und Kühlkörper reinigen, ggf. neue Wärmeleitpaste. Das kostet fast nichts und kann Leistung zurückbringen.',
      shopping: ['Druckluft/Pinsel, hochwertige Wärmeleitpaste (z. B. Kristall- oder Nicht-leitfähige Paste), Isopropanol 99 %, Torx-/Kreuzschraubendreher-Set'],
      checks: ['Temperatur unter Last mit HWiNFO oder Core Temp beobachten – dauerhaft > 90 °C ist zu viel.', 'Garantie beachten; bei Geräten mit verlöteter/verklebter Konstruktion Fachwerkstatt.'], steps: [],
      links: [{ label: 'Anleitung zum Öffnen deines Modells suchen', url: LC.searchUrl((hw.device.title || '') + ' disassembly fan cleaning repaste') }],
    };
  }

  function fixedParts(hw) {
    const list = [];
    const c = hw.cpu;
    list.push({
      id: 'cpu', area: 'cpu', title: 'Prozessor (CPU)', current: c.label || c.name,
      verdict: 'nicht möglich', benefit: 0, cost: '–', difficulty: '–',
      why: 'In Laptops ist die CPU praktisch immer auf die Hauptplatine gelötet und nicht austauschbar.',
      advice: c.ageYears != null && c.ageYears >= 7
        ? 'Dein Prozessor ist ca. ' + c.ageYears + ' Jahre alt. RAM/SSD verbessern das Gefühl noch, aber für die nächste Anschaffung lohnt ein neues Gerät.'
        : 'Nicht änderbar – dafür lohnt sich die Optimierung von RAM, SSD, Energieplan und Kühlung.',
      shopping: [], checks: [], steps: [], links: [],
    });
    const g = hw.gpu[0];
    if (g) list.push({
      id: 'gpu', area: 'gpu', title: 'Grafik (GPU)', current: g.name + (g.vramBytes ? ' · ' + fmtBytes(g.vramBytes) : ''),
      verdict: 'nicht möglich', benefit: 0, cost: '–', difficulty: '–',
      why: 'Die Grafik ist in Laptops aufgelötet bzw. Teil der CPU.',
      advice: 'Bei Bedarf externe Grafikkarte (eGPU) über Thunderbolt/USB4 – teuer und nur mit passendem Anschluss. Treiber aktuell halten.',
      shopping: [], checks: [], steps: [], links: [],
    });
    return list;
  }

  LC.buildUpgrades = (hw, notes) => {
    const items = [ramUpgrade(hw, notes), storageUpgrade(hw), batteryUpgrade(hw), wifiUpgrade(hw), maintenanceUpgrade(hw)].filter(Boolean);
    const ORDER = { empfohlen: 0, optional: 1, 'nicht nötig': 2, 'nicht möglich': 3 };
    items.sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || b.benefit - a.benefit);
    const fixed = fixedParts(hw);
    return { items, fixed, bottlenecks: bottlenecks(hw, notes) };
  };

  /* ------------------------------------------------------------------ bottlenecks ("is my combination balanced?") */

  function bottlenecks(hw, notes) {
    const list = [];
    const profile = (notes && notes.hardware && notes.hardware.usageProfile) || 'mixed';
    const ram = hw.ram;
    if (ram && ram.installedBytes) {
      const gb = ram.installedBytes / GB;
      let s = gb < 8 ? 90 : gb < 12 ? 75 : gb < 16 ? 70 : gb < 24 ? 35 : gb < 32 ? 25 : gb < 48 ? 15 : 5;
      s += Math.min(30, ram.pressure * 0.4);
      if (ram.channels === 'single') s += 10;
      if (gb < (PROFILE_MIN_GB[profile] || 16)) s += 10;
      list.push({ area: 'ram', label: 'Arbeitsspeicher', score: LC.clamp(Math.round(s), 0, 100), upgradable: ram.removable.length > 0, why: LC.fmtNum(gb, 0) + ' GB ' + ram.type + (ram.channels === 'single' ? ', Single-Channel' : '') + (ram.pressureWhy.length ? '; ' + ram.pressureWhy[0] : '') });
    }
    const st = hw.storage;
    if (st.systemDisk || st.systemVolume) {
      const d = st.systemDisk, c = st.systemVolume;
      let s = d && d.hdd ? 95 : d && d.kind === 'SATA-SSD' ? 30 : d && d.kind === 'NVMe-SSD' ? 10 : 25;
      if (c && c.freePct != null) s += c.freePct < 10 ? 40 : c.freePct < 20 ? 20 : 0;
      if (d && (!d.healthy || (d.wearPct != null && d.wearPct >= 80))) s += 40;
      list.push({ area: 'storage', label: 'Speicher', score: LC.clamp(s, 0, 100), upgradable: true, why: (d ? d.kind : 'Laufwerk') + (c && c.freePct != null ? ', ' + Math.round(c.freePct) + ' % frei' : '') });
    }
    const cpu = hw.cpu;
    if (cpu.name) {
      let s = cpu.ageYears == null ? 35 : cpu.ageYears >= 8 ? 80 : cpu.ageYears >= 6 ? 55 : cpu.ageYears >= 4 ? 30 : cpu.ageYears >= 2 ? 20 : 10;
      if (cpu.lowEnd) s += 20;
      if (cpu.cores && cpu.cores <= 2) s += 20;
      list.push({ area: 'cpu', label: 'Prozessor', score: LC.clamp(s, 0, 100), upgradable: false, why: (cpu.label || cpu.name) + (cpu.cores ? ', ' + cpu.cores + ' Kerne' : '') });
    }
    const g = hw.gpu[0];
    if (g) {
      const heavy = profile === 'gaming' || profile === 'creative';
      let s = g.basic ? 80 : g.integrated ? (heavy ? 60 : 15) : 10;
      list.push({ area: 'gpu', label: 'Grafik', score: s, upgradable: false, why: g.name + (g.integrated ? ' (integriert)' : '') });
    }
    if (hw.battery && hw.battery.healthPct != null) {
      const h = hw.battery.healthPct;
      list.push({ area: 'battery', label: 'Akku', score: h >= 85 ? 10 : h >= 70 ? 40 : h >= 50 ? 70 : 90, upgradable: true, why: Math.round(h) + ' % Kapazität' });
    }
    const w = hw.network.find((n) => n.wifi && n.wifiGen);
    if (w) list.push({ area: 'network', label: 'WLAN', score: w.wifiGen <= 4 ? 50 : w.wifiGen === 5 ? 25 : 5, upgradable: false, why: w.wifiLabel });
    list.sort((a, b) => b.score - a.score);
    return list;
  }

  /* ------------------------------------------------------------------ history record */

  LC.summaryMetrics = (snap, hw, inv, stats, score) => ({
    t: snap.collectedAt,
    score: score != null ? score : null,
    ramUsedPct: hw.ram && hw.ram.usedPct != null ? Math.round(hw.ram.usedPct) : null,
    cFreePct: hw.storage.systemVolume && hw.storage.systemVolume.freePct != null ? Math.round(hw.storage.systemVolume.freePct * 10) / 10 : null,
    cFreeGB: hw.storage.systemVolume && hw.storage.systemVolume.freeBytes != null ? Math.round((hw.storage.systemVolume.freeBytes / GB) * 10) / 10 : null,
    batteryHealthPct: hw.battery && hw.battery.healthPct != null ? Math.round(hw.battery.healthPct) : null,
    programs: stats ? stats.programs : null,
    unused: stats ? stats.unused : null,
    startupEnabled: stats ? stats.startupEnabled : null,
    uptimeDays: hw.os.uptimeDays != null ? hw.os.uptimeDays : null,
  });
})(typeof window !== 'undefined' ? window : globalThis);
