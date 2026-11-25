using System.Globalization;
using System.Text.Json.Nodes;
using System.Xml;
using LaptopCheck.Core;

namespace LaptopCheck.Scan.Sections;

/// <summary>Device, Windows, processor, memory, graphics, storage, battery and network.</summary>
internal static class HardwareSections
{
    static WmiRow First(ScanContext c, string cls) => c.Wmi.Query($"SELECT * FROM {cls}").FirstOrDefault() ?? new WmiRow();

    public static JsonObject Device(ScanContext c)
    {
        var cs = First(c, "Win32_ComputerSystem");
        var bios = First(c, "Win32_BIOS");
        var board = First(c, "Win32_BaseBoard");
        var enc = First(c, "Win32_SystemEnclosure");
        var prod = First(c, "Win32_ComputerSystemProduct");
        return J.O(
            ("manufacturer", cs.Clean("Manufacturer")),
            ("model", cs.Clean("Model")),
            ("family", cs.Clean("SystemFamily")),
            ("sku", cs.Clean("SystemSKUNumber")),
            ("productVersion", prod.Clean("Version")),
            ("serial", bios.Clean("SerialNumber")),
            ("pcSystemType", cs.Int("PCSystemType")),
            ("chassisTypes", enc.Numbers("ChassisTypes").Select(n => (object?)(int)n).ToList()),
            ("biosVendor", bios.Clean("Manufacturer")),
            ("biosVersion", bios.Clean("SMBIOSBIOSVersion")),
            ("biosDate", Val.Iso(bios.Date("ReleaseDate"), c.Now())),
            ("boardManufacturer", board.Clean("Manufacturer")),
            ("boardProduct", board.Clean("Product")),
            ("firmwareType", c.Probe.FirmwareType()));
    }

    public static JsonObject Os(ScanContext c)
    {
        var os = First(c, "Win32_OperatingSystem");
        const string cv = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
        var boot = os.Date("LastBootUpTime");
        double? uptime = boot is null ? null : Math.Round((c.Now() - boot.Value).TotalDays, 1);
        return J.O(
            ("caption", os.Clean("Caption")),
            ("version", os.Clean("Version")),
            ("build", os.Int("BuildNumber")),
            ("ubr", Val.LongOrNull(c.RegValue(RegHive.LocalMachine, cv, "UBR"))),
            ("displayVersion", Val.Clean(c.RegValue(RegHive.LocalMachine, cv, "DisplayVersion"))),
            ("edition", Val.Clean(c.RegValue(RegHive.LocalMachine, cv, "EditionID"))),
            ("architecture", os.Clean("OSArchitecture")),
            ("installDate", Val.Iso(os.Date("InstallDate"), c.Now())),
            ("lastBoot", Val.Iso(boot, c.Now())),
            ("uptimeDays", uptime),
            ("fastStartup", c.RegValue(RegHive.LocalMachine, @"SYSTEM\CurrentControlSet\Control\Session Manager\Power", "HiberbootEnabled")),
            ("uacEnabled", c.RegValue(RegHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System", "EnableLUA")),
            ("locale", c.Env.Locale));
    }

    public static JsonArray Cpu(ScanContext c) => J.A(c.Wmi.Query("SELECT * FROM Win32_Processor").Select(p => (JsonNode?)J.O(
        ("name", p.Clean("Name")),
        ("manufacturer", p.Clean("Manufacturer")),
        ("cores", p.Int("NumberOfCores")),
        ("logical", p.Int("NumberOfLogicalProcessors")),
        ("maxMHz", p.Int("MaxClockSpeed")),
        ("socket", p.Clean("SocketDesignation")),
        ("l2KB", p.Int("L2CacheSize")),
        ("l3KB", p.Int("L3CacheSize")),
        ("virtualization", p.Bool("VirtualizationFirmwareEnabled")))));

    public static JsonObject Memory(ScanContext c)
    {
        var cs = First(c, "Win32_ComputerSystem");
        var os = First(c, "Win32_OperatingSystem");

        var modules = c.Wmi.Query("SELECT * FROM Win32_PhysicalMemory").Select(m =>
        {
            long? rank = m.Long("Attributes") is { } attr ? attr & 0xF : null;
            return (JsonNode?)J.O(
                ("locator", m.Clean("DeviceLocator")),
                ("bank", m.Clean("BankLabel")),
                ("capacityBytes", m.Long("Capacity")),
                ("speed", m.Int("Speed")),
                ("configuredSpeed", m.Int("ConfiguredClockSpeed")),
                ("manufacturer", m.Clean("Manufacturer")),
                ("partNumber", m.Clean("PartNumber")),
                ("smbiosType", m.Int("SMBIOSMemoryType")),
                ("formFactor", m.Int("FormFactor")),
                ("voltageMv", m.Int("ConfiguredVoltage")),
                ("rank", rank),
                ("dataWidth", m.Int("DataWidth")),
                ("totalWidth", m.Int("TotalWidth")));
        }).ToList();

        var arrays = c.Wmi.Query("SELECT * FROM Win32_PhysicalMemoryArray").Select(a =>
        {
            var maxKb = a.Long("MaxCapacityEx");
            if (maxKb is null or 0) maxKb = a.Long("MaxCapacity");
            return (JsonNode?)J.O(("maxCapacityKB", maxKb), ("slots", a.Int("MemoryDevices")), ("ecc", a.Int("MemoryErrorCorrection")));
        }).ToList();

        // performance counters through WMI (not localized, unlike Get-Counter): 3 samples take about 2 s
        var pagesIn = new List<double>();
        var cpuLoad = new List<double>();
        WmiRow? commit = null;
        for (var i = 0; i < 3; i++)
        {
            c.Delay(TimeSpan.FromMilliseconds(800));
            try
            {
                var pm = c.Wmi.Query("SELECT * FROM Win32_PerfFormattedData_PerfOS_Memory").FirstOrDefault();
                if (pm is not null) { pagesIn.Add(pm.Long("PagesInputPersec") ?? 0); commit = pm; }
                var pc = c.Wmi.Query("SELECT * FROM Win32_PerfFormattedData_PerfOS_Processor WHERE Name='_Total'").FirstOrDefault();
                if (pc is not null) cpuLoad.Add(pc.Long("PercentProcessorTime") ?? 0);
            }
            catch (Exception ex) when (ex is System.Management.ManagementException or InvalidOperationException or UnauthorizedAccessException) { }
        }

        var pageFiles = c.Wmi.Query("SELECT * FROM Win32_PageFileUsage").Select(p => (JsonNode?)J.O(
            ("name", p.Text("Name")),
            ("allocatedMB", p.Int("AllocatedBaseSize")),
            ("usedMB", p.Int("CurrentUsage")),
            ("peakMB", p.Int("PeakUsage")))).ToList();

        return J.O(
            ("totalPhysicalBytes", cs.Long("TotalPhysicalMemory")),
            ("visibleBytes", (os.Long("TotalVisibleMemorySize") ?? 0) * 1024),
            ("freeBytes", (os.Long("FreePhysicalMemory") ?? 0) * 1024),
            ("commitBytes", commit?.Long("CommittedBytes")),
            ("commitLimitBytes", commit?.Long("CommitLimit")),
            ("pagesInPerSec", pagesIn.Count > 0 ? Math.Round(pagesIn.Average(), 1) : (double?)null),
            ("cpuLoadPct", cpuLoad.Count > 0 ? Math.Round(cpuLoad.Average(), 1) : (double?)null),
            ("modules", J.A(modules)),
            ("arrays", J.A(arrays)),
            ("pageFiles", J.A(pageFiles)));
    }

    public static JsonArray Gpu(ScanContext c)
    {
        // AdapterRAM is a 32-bit field (caps at 4 GB): prefer the 64-bit value from the driver key
        var vram = new Dictionary<string, long>();
        using (var classKey = c.Registry.Open(RegHive.LocalMachine, @"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"))
        {
            if (classKey is not null)
            {
                foreach (var name in classKey.GetSubKeyNames())
                {
                    if (name.Length != 4 || !name.All(char.IsAsciiDigit)) continue;
                    using var k = classKey.OpenSubKey(name);
                    if (k is null) continue;
                    try
                    {
                        var desc = k.GetValue("DriverDesc");
                        var mem = k.GetValue("HardwareInformation.qwMemorySize");
                        long? bytes = mem is byte[] { Length: >= 8 } b ? BitConverter.ToInt64(b, 0) : Val.LongOrNull(mem);
                        if (desc is not null && bytes is > 0) vram[Convert.ToString(desc, CultureInfo.InvariantCulture)!] = bytes.Value;
                    }
                    catch (Exception ex) when (ex is InvalidCastException or FormatException) { }
                }
            }
        }

        return J.A(c.Wmi.Query("SELECT * FROM Win32_VideoController").Select(g =>
        {
            long? bytes = null;
            var name = g.Text("Name") ?? "";
            if (vram.TryGetValue(name, out var v)) bytes = v;
            else if (g.Long("AdapterRAM") is > 0 and var ar) bytes = ar;
            return (JsonNode?)J.O(
                ("name", g.Clean("Name")),
                ("vendor", g.Clean("AdapterCompatibility")),
                ("driverVersion", g.Clean("DriverVersion")),
                ("driverDate", Val.Iso(g.Date("DriverDate"), c.Now())),
                ("vramBytes", bytes),
                ("hRes", g.Long("CurrentHorizontalResolution")),
                ("vRes", g.Long("CurrentVerticalResolution")),
                ("refreshHz", g.Long("CurrentRefreshRate")),
                ("status", g.Clean("Status")),
                ("pnpId", g.Clean("PNPDeviceID")));
        }));
    }

    const string StorageNs = @"root\Microsoft\Windows\Storage";

    public static JsonArray Disks(ScanContext c)
    {
        var diskByNum = new Dictionary<string, WmiRow>();
        try
        {
            foreach (var d in c.Wmi.Query("SELECT * FROM MSFT_Disk", StorageNs)) diskByNum[d.Text("Number") ?? ""] = d;
        }
        catch (Exception ex) when (ex is System.Management.ManagementException or UnauthorizedAccessException) { }

        var physical = new List<WmiRow>();
        try { physical = c.Wmi.Query("SELECT * FROM MSFT_PhysicalDisk", StorageNs).ToList(); }
        catch (Exception ex) when (ex is System.Management.ManagementException or UnauthorizedAccessException)
        {
            c.Warn("disks", "MSFT_PhysicalDisk: " + ex.Message);
        }

        var disks = new List<JsonNode?>();
        foreach (var pd in physical)
        {
            diskByNum.TryGetValue(pd.Text("DeviceId") ?? "", out var d);
            JsonObject? rel = null;
            try
            {
                var r = pd.Path is { } path ? c.Wmi.Related(path, "MSFT_StorageReliabilityCounter").FirstOrDefault() : null;
                if (r is not null)
                {
                    rel = J.O(
                        ("wearPct", r.Long("Wear")),
                        ("temperatureC", r.Long("Temperature")),
                        ("powerOnHours", r.Long("PowerOnHours")),
                        ("readErrors", r.Long("ReadErrorsTotal")),
                        ("writeErrors", r.Long("WriteErrorsTotal")));
                }
            }
            catch (Exception ex) when (ex is System.Management.ManagementException or UnauthorizedAccessException) { }

            disks.Add(J.O(
                ("number", pd.Int("DeviceId")),
                ("model", pd.Clean("FriendlyName")),
                ("mediaType", StorageNames.MediaType(pd.Raw("MediaType"))),
                ("busType", StorageNames.BusType(pd.Raw("BusType"))),
                ("sizeBytes", pd.Long("Size")),
                ("health", StorageNames.Health(pd.Raw("HealthStatus"))),
                ("operational", string.Join(",", pd.Numbers("OperationalStatus").Select(n => StorageNames.Operational(n)).Concat(
                    pd.Raw("OperationalStatus") is string[] names ? names : []))),
                ("spindleSpeed", pd.Long("SpindleSpeed")),
                ("firmware", pd.Clean("FirmwareVersion")),
                ("partitionStyle", d is null ? null : StorageNames.PartitionStyle(d.Raw("PartitionStyle"))),
                ("isBoot", d?.Bool("IsBoot")),
                ("isSystem", d?.Bool("IsSystem")),
                ("reliability", rel)));
        }

        if (physical.Count == 0)
        {
            // systems without the Storage provider
            foreach (var dd in c.Wmi.Query("SELECT * FROM Win32_DiskDrive"))
            {
                disks.Add(J.O(
                    ("number", dd.Int("Index")), ("model", dd.Clean("Model")), ("mediaType", dd.Text("MediaType") ?? ""),
                    ("busType", dd.Text("InterfaceType") ?? ""), ("sizeBytes", dd.Long("Size")), ("health", dd.Text("Status") ?? ""),
                    ("operational", null), ("spindleSpeed", null), ("firmware", dd.Clean("FirmwareRevision")),
                    ("partitionStyle", null), ("isBoot", null), ("isSystem", null), ("reliability", null)));
            }
        }
        return J.A(disks);
    }

    public static JsonArray Volumes(ScanContext c)
    {
        var diskOfLetter = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var p in c.Wmi.Query("SELECT DriveLetter, DiskNumber FROM MSFT_Partition", StorageNs))
            {
                var code = p.Long("DriveLetter") ?? 0;
                if (code > 0) diskOfLetter[((char)code).ToString()] = p.Int("DiskNumber");
            }
        }
        catch (Exception ex) when (ex is System.Management.ManagementException or UnauthorizedAccessException) { }

        return J.A(c.Wmi.Query("SELECT * FROM Win32_LogicalDisk WHERE DriveType=3 OR DriveType=2").Select(v =>
        {
            var letter = (v.Text("DeviceID") ?? "").TrimEnd(':');
            return (JsonNode?)J.O(
                ("letter", letter),
                ("label", v.Clean("VolumeName")),
                ("fileSystem", v.Clean("FileSystem")),
                ("sizeBytes", v.Long("Size")),
                ("freeBytes", v.Long("FreeSpace")),
                ("driveType", v.Int("DriveType")),
                ("diskNumber", diskOfLetter.TryGetValue(letter, out var n) ? n : (int?)null));
        }));
    }

    public static JsonObject? Battery(ScanContext c)
    {
        var batteries = c.Wmi.Query("SELECT * FROM Win32_Battery");
        if (batteries.Count == 0) return null;
        var b = batteries[0];
        long? design = null, full = null, cycles = null;
        string? chem = null, maker = null;

        // 1) powercfg battery report as XML (works for normal users)
        var tmp = Path.Combine(Path.GetTempPath(), "lc-battery-" + Guid.NewGuid().ToString("N") + ".xml");
        try
        {
            c.Processes.Run("powercfg.exe", ["/batteryreport", "/xml", "/output", tmp, "/duration", "1"], TimeSpan.FromSeconds(30), RealProcessRunner.OemEncoding());
            if (File.Exists(tmp))
            {
                var xml = new XmlDocument();
                xml.Load(tmp);
                var node = xml.GetElementsByTagName("Battery").Cast<XmlNode>().FirstOrDefault();
                if (node is not null)
                {
                    foreach (XmlNode ch in node.ChildNodes)
                    {
                        switch (ch.LocalName)
                        {
                            case "DesignCapacity": design = Val.LongOrNull(ch.InnerText); break;
                            case "FullChargeCapacity": full = Val.LongOrNull(ch.InnerText); break;
                            case "CycleCount": cycles = Val.LongOrNull(ch.InnerText); break;
                            case "Chemistry": chem = Val.Clean(ch.InnerText); break;
                            case "Manufacturer": maker = Val.Clean(ch.InnerText); break;
                        }
                    }
                }
            }
        }
        catch (Exception ex) when (ex is XmlException or IOException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            c.Warn("battery", "powercfg battery report: " + ex.Message);
        }
        finally
        {
            try { File.Delete(tmp); } catch (IOException) { }
        }

        // 2) fallback: root\wmi classes
        if (design is null or 0 || full is null or 0)
        {
            try
            {
                var s = c.Wmi.Query("SELECT * FROM BatteryStaticData", "root/wmi").FirstOrDefault();
                var f = c.Wmi.Query("SELECT * FROM BatteryFullChargedCapacity", "root/wmi").FirstOrDefault();
                if (s is not null) design = s.Long("DesignedCapacity");
                if (f is not null) full = f.Long("FullChargedCapacity");
                try
                {
                    var cc = c.Wmi.Query("SELECT * FROM BatteryCycleCount", "root/wmi").FirstOrDefault();
                    if (cc is not null) cycles = cc.Long("CycleCount");
                }
                catch (Exception ex) when (ex is System.Management.ManagementException) { }
            }
            catch (Exception ex) when (ex is System.Management.ManagementException or UnauthorizedAccessException)
            {
                c.Warn("battery", @"root\wmi battery data: " + ex.Message);
            }
        }

        return J.O(
            ("present", true),
            ("name", b.Clean("Name")),
            ("manufacturer", maker),
            ("chemistry", chem),
            ("designMWh", design),
            ("fullChargeMWh", full),
            ("cycleCount", cycles),
            ("chargePct", b.Long("EstimatedChargeRemaining")),
            ("batteryStatus", b.Long("BatteryStatus")));   // 1 = discharging, 2 = AC, 3 = full, ...
    }

    public static JsonArray Network(ScanContext c)
    {
        try
        {
            var rows = c.Wmi.Query("SELECT * FROM MSFT_NetAdapter WHERE HardwareInterface=TRUE", @"root\StandardCimv2");
            return J.A(rows.Select(n => (JsonNode?)J.O(
                ("name", n.Text("Name")),
                ("description", n.Text("InterfaceDescription")),
                ("status", NetNames.Status(n)),
                ("linkSpeed", NetNames.LinkSpeed(n)),
                ("mediaType", NetNames.MediaType(n.Raw("NdisPhysicalMedium"))))));
        }
        catch (Exception ex) when (ex is System.Management.ManagementException or UnauthorizedAccessException)
        {
            return J.A(c.Wmi.Query("SELECT * FROM Win32_NetworkAdapter WHERE PhysicalAdapter=TRUE").Select(n => (JsonNode?)J.O(
                ("name", n.Text("NetConnectionID")),
                ("description", n.Text("Name")),
                ("status", n.Text("NetEnabled")),
                ("linkSpeed", n.Text("Speed")),
                ("mediaType", null))));
        }
    }
}

/// <summary>The words the Storage module of PowerShell used for the numeric WMI values (the dashboard matches on them).</summary>
internal static class StorageNames
{
    static string Pick(object? raw, IReadOnlyDictionary<long, string> table, string unknown)
    {
        if (raw is string s) return s;
        var n = Val.LongOrNull(raw);
        if (n is null) return "";
        return table.TryGetValue(n.Value, out var name) ? name : unknown;
    }

    static readonly Dictionary<long, string> Media = new() { [0] = "Unspecified", [3] = "HDD", [4] = "SSD", [5] = "SCM" };
    static readonly Dictionary<long, string> Bus = new()
    {
        [0] = "Unknown", [1] = "SCSI", [2] = "ATAPI", [3] = "ATA", [4] = "1394", [5] = "SSA", [6] = "Fibre Channel", [7] = "USB",
        [8] = "RAID", [9] = "iSCSI", [10] = "SAS", [11] = "SATA", [12] = "SD", [13] = "MMC", [14] = "MAX", [15] = "File Backed Virtual",
        [16] = "Storage Spaces", [17] = "NVMe", [18] = "SCM", [19] = "UFS",
    };
    static readonly Dictionary<long, string> HealthNames = new() { [0] = "Healthy", [1] = "Warning", [2] = "Unhealthy", [5] = "Unknown" };
    static readonly Dictionary<long, string> Part = new() { [0] = "Unknown", [1] = "MBR", [2] = "GPT" };
    static readonly Dictionary<long, string> Oper = new()
    {
        [0] = "Unknown", [1] = "Other", [2] = "OK", [3] = "Degraded", [4] = "Stressed", [5] = "Predictive Failure", [6] = "Error",
        [7] = "Non-Recoverable Error", [8] = "Starting", [9] = "Stopping", [10] = "Stopped", [11] = "In Service", [12] = "No Contact",
        [13] = "Lost Communication", [14] = "Aborted", [15] = "Dormant", [16] = "Supporting Entity in Error", [17] = "Completed",
    };

    public static string MediaType(object? raw) => Pick(raw, Media, "Unspecified");
    public static string BusType(object? raw) => Pick(raw, Bus, "Unknown");
    public static string Health(object? raw) => Pick(raw, HealthNames, "Unknown");
    public static string PartitionStyle(object? raw) => Pick(raw, Part, "Unknown");
    public static string Operational(long code) => Oper.TryGetValue(code, out var n) ? n : code.ToString(CultureInfo.InvariantCulture);
}

/// <summary>Network adapter wording as Get-NetAdapter printed it.</summary>
internal static class NetNames
{
    static readonly string[] Media =
    [
        "Unspecified", "Wireless LAN", "Cable Modem", "Phone Line", "Power Line", "DSL", "Fibre Channel", "IEEE 1394", "Wireless WAN",
        "Native 802.11", "Bluetooth", "InfiniBand", "WiMax", "UWB", "802.3", "802.5", "IrDA", "Wired WAN", "Wired CoWAN", "Other",
    ];

    public static string? MediaType(object? raw)
    {
        if (raw is string s) return s;
        var n = Val.LongOrNull(raw);
        return n is >= 0 && n < Media.Length ? Media[n.Value] : null;
    }

    public static string Status(WmiRow n)
    {
        if (n.Raw("Status") is string text && text.Length > 0) return text;
        if (n.Long("InterfaceAdminStatus") == 2) return "Disabled";
        if (n.Long("MediaConnectState") == 1 || n.Long("InterfaceOperationalStatus") == 1) return "Up";
        return n.Long("MediaConnectState") == 2 ? "Disconnected" : "Not Present";
    }

    public static string LinkSpeed(WmiRow n)
    {
        if (n.Raw("LinkSpeed") is string text && text.Length > 0) return text;
        var bps = n.Long("Speed") ?? Math.Max(n.Long("ReceiveLinkSpeed") ?? 0, n.Long("TransmitLinkSpeed") ?? 0);
        string Fmt(double v, string unit) => Math.Round(v, 1).ToString("0.#", CultureInfo.InvariantCulture) + " " + unit;
        return bps >= 1_000_000_000 ? Fmt(bps / 1e9, "Gbps")
            : bps >= 1_000_000 ? Fmt(bps / 1e6, "Mbps")
            : bps >= 1_000 ? Fmt(bps / 1e3, "Kbps")
            : bps + " bps";
    }
}
