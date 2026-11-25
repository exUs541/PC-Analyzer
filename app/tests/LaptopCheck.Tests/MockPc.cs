using LaptopCheck.Scan;

namespace LaptopCheck.Tests;

/// <summary>
/// A pretend Lenovo ThinkPad: the same simulated Windows data as tests/collector.mock.ps1, so the C# scan can be held
/// against the dashboard's contract test. Verifies code paths, property names, byte offsets and JSON shape - NOT Windows API behaviour.
/// </summary>
internal sealed class MockPc : IDisposable
{
    public static readonly DateTime Now = new(2026, 10, 20, 10, 0, 0);

    public string Root { get; } = Path.Combine(Path.GetTempPath(), "lc-pc-" + Guid.NewGuid().ToString("N"));
    public FakeWmi Wmi { get; } = new();
    public FakeRegistry Registry { get; } = new();
    public FakeProcessRunner Processes { get; } = new();
    public FakeProbe Probe { get; } = new();
    public FakeAppx Appx { get; }

    public MockPc()
    {
        var calc = new AppxPackageInfo
        {
            Name = "Microsoft.WindowsCalculator", FullName = "Microsoft.WindowsCalculator_11.0_x64__8wekyb3d8bbwe",
            FamilyName = "Microsoft.WindowsCalculator_8wekyb3d8bbwe", Version = "11.2407.4.0", Architecture = "X64",
            Publisher = "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US",
            InstalledPath = "/nonexistent",
            StartApps = [new AppxApp("Rechner", "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App")],
        };
        var vclibs = new AppxPackageInfo { Name = "Microsoft.VCLibs.140.00", FullName = "x1", FamilyName = "x", Version = "14", Architecture = "X64", Publisher = "CN=Microsoft", IsFramework = true };
        var shell = new AppxPackageInfo { Name = "Microsoft.Windows.ShellExperienceHost", FullName = "y1", FamilyName = "y", Version = "10", Architecture = "X64", Publisher = "CN=Microsoft Windows", IsSystem = true, NonRemovable = true };
        var tool = new AppxPackageInfo
        {
            Name = "SomeDev.Tool", FullName = "SomeDev.Tool_1_x64__abc", FamilyName = "SomeDev.Tool_abc", Version = "1.0", Architecture = "X64",
            Publisher = "CN=1D2F9E36-AAAA-BBBB-CCCC-123456789ABC", PublisherDisplayName = "Some Developer",
        };
        Appx = new FakeAppx(calc, vclibs, shell, tool);
        Build();
    }

    public ScanContext Context(bool admin = false, ScanOptions? options = null, Action<string>? progress = null) => new()
    {
        Wmi = Wmi, Registry = Registry, Processes = Processes, Probe = Probe, Appx = Appx,
        Env = Env(admin), Options = options ?? new ScanOptions(NoWinget: true, SkipSizes: true), Progress = progress,
        Now = () => Now, Delay = _ => { },
    };

    public ScanEnvironment Env(bool admin) => new()
    {
        IsAdmin = admin, ComputerName = "MOCKPC", UserName = "mock", Locale = "de-DE",
        AppData = Path.Combine(Root, "AppData"), LocalAppData = Path.Combine(Root, "LocalAppData"), ProgramData = Path.Combine(Root, "ProgramData"),
        UserProfile = Path.Combine(Root, "User"), SystemRoot = Path.Combine(Root, "Windows"), SystemDrive = Root, Temp = Path.Combine(Root, "Temp"),
        MyDocuments = Path.Combine(Root, "Docs"), MyPictures = Path.Combine(Root, "Pics"), MyVideos = Path.Combine(Root, "Vids"), Desktop = Path.Combine(Root, "Desktop"),
    };

    static byte[] UserAssist(uint runs, uint focusMs, DateTime last)
    {
        var b = new byte[72];
        BitConverter.GetBytes(runs).CopyTo(b, 4);
        BitConverter.GetBytes(focusMs).CopyTo(b, 12);
        BitConverter.GetBytes(last.ToUniversalTime().ToFileTimeUtc()).CopyTo(b, 60);
        return b;
    }

    static byte[] FileTime(DateTime local)
    {
        var b = new byte[8];
        BitConverter.GetBytes(local.ToUniversalTime().ToFileTimeUtc()).CopyTo(b, 0);
        return b;
    }

    void Build()
    {
        Directory.CreateDirectory(Root);

        // ------------------------------------------------------------ registry
        const string uninst = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
        Registry.Add(RegHive.LocalMachine, uninst, FakeKey.With(subs: new Dictionary<string, FakeKey>
        {
            ["Google Chrome"] = FakeKey.With(new Dictionary<string, object?>
            {
                ["DisplayName"] = "Google Chrome", ["DisplayVersion"] = "130.0.6723.92", ["Publisher"] = "Google LLC", ["InstallDate"] = "20240302",
                ["InstallLocation"] = @"C:\Program Files\Google\Chrome\Application", ["DisplayIcon"] = @"C:\Program Files\Google\Chrome\Application\chrome.exe,0",
                ["EstimatedSize"] = 1258291, ["UninstallString"] = "\"C:\\Program Files\\Google\\Chrome\\Application\\130.0\\Installer\\setup.exe\" --uninstall",
            }),
            ["{AAAA-1}"] = FakeKey.With(new Dictionary<string, object?> { ["DisplayName"] = "Contoso Report Helper", ["DisplayVersion"] = "2.1" }),
            ["KB5001234"] = FakeKey.With(new Dictionary<string, object?> { ["DisplayName"] = "Update for Windows (KB5001234)", ["ParentKeyName"] = "OperatingSystem" }),
            ["{AAAA-2}"] = FakeKey.With(new Dictionary<string, object?> { ["DisplayName"] = "Hidden component", ["SystemComponent"] = 1 }),
            ["{AAAA-3}"] = FakeKey.With(new Dictionary<string, object?> { ["DisplayName"] = null }),
            ["Java8"] = FakeKey.With(new Dictionary<string, object?>
            {
                ["DisplayName"] = "Java 8 Update 311 (64-bit)", ["DisplayVersion"] = "8.0.3110.11", ["Publisher"] = "Oracle Corporation", ["InstallDate"] = "20211102",
            }),
        }), RegView.Registry64);
        Registry.Add(RegHive.CurrentUser, uninst, FakeKey.With(subs: new Dictionary<string, FakeKey>
        {
            ["Spotify"] = FakeKey.With(new Dictionary<string, object?>
            {
                ["DisplayName"] = "Spotify", ["DisplayVersion"] = "1.2.48", ["Publisher"] = "Spotify AB", ["InstallDate"] = "garbage",
            }),
        }), RegView.Registry64);

        // UserAssist (ROT13 names, 72-byte records), compatibility store, MuiCache
        var chromeLast = new DateTime(2026, 10, 19, 20, 58, 0);
        var ua = new Dictionary<string, object?>
        {
            [Val_Rot13(@"{6D809377-6AF0-444B-8957-A3773F02200E}\Google\Chrome\Application\chrome.exe")] = UserAssist(612, 412000, chromeLast),
            [Val_Rot13("UEME_CTLSESSION")] = UserAssist(1, 1, chromeLast),
            [Val_Rot13("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App")] = UserAssist(5, 120000, chromeLast),
            ["short"] = new byte[] { 1, 2, 3 },
        };
        Registry.Add(RegHive.CurrentUser, @"Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist", FakeKey.With(subs: new Dictionary<string, FakeKey>
        {
            ["{CEBFF5CD-ACE2-4F4F-9178-9926F41749EA}"] = FakeKey.With(subs: new Dictionary<string, FakeKey> { ["Count"] = FakeKey.With(ua) }),
        }));
        var ft = FileTime(new DateTime(2025, 2, 14, 10, 0, 0));
        Registry.Add(RegHive.CurrentUser, @"Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Compatibility Assistant\Store", FakeKey.With(new Dictionary<string, object?>
        {
            [@"C:\Program Files\Mozilla Firefox\firefox.exe"] = ft, [@"C:\notes.txt"] = ft, [@"C:\Tools\old.exe"] = new byte[] { 1, 2 },
        }));
        Registry.Add(RegHive.CurrentUser, @"Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache", FakeKey.With(new Dictionary<string, object?>
        {
            [@"C:\Program Files\WinRAR\WinRAR.exe.FriendlyAppName"] = "WinRAR archiver", ["LangID"] = new byte[] { 9, 4 },
        }));

        // startup (+ StartupApproved: 03 = disabled, 02 = enabled)
        Registry.Add(RegHive.CurrentUser, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", FakeKey.With(new Dictionary<string, object?>
        {
            ["OneDrive"] = "\"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe\" /background",
            ["Teams"] = @"C:\Users\a\AppData\Local\Microsoft\Teams\Update.exe --processStart Teams.exe",
        }), RegView.Registry64);
        Registry.Add(RegHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", FakeKey.With(new Dictionary<string, object?>
        {
            ["SecurityHealth"] = @"%windir%\system32\SecurityHealthSystray.exe",
        }), RegView.Registry64);
        Registry.Add(RegHive.CurrentUser, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run", FakeKey.With(new Dictionary<string, object?>
        {
            ["Teams"] = new byte[] { 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }, ["OneDrive"] = new byte[] { 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
        }));

        // misc values
        Registry.Add(RegHive.LocalMachine, @"SOFTWARE\Microsoft\Windows NT\CurrentVersion", FakeKey.With(new Dictionary<string, object?>
        {
            ["UBR"] = 5074, ["DisplayVersion"] = "24H2", ["EditionID"] = "Professional",
        }));
        Registry.Add(RegHive.LocalMachine, @"SYSTEM\CurrentControlSet\Control\Session Manager\Power", FakeKey.With(new Dictionary<string, object?> { ["HiberbootEnabled"] = 1 }));
        Registry.Add(RegHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System", FakeKey.With(new Dictionary<string, object?> { ["EnableLUA"] = 1 }));
        Registry.Add(RegHive.LocalMachine, @"SYSTEM\CurrentControlSet\Control\SecureBoot\State", FakeKey.With(new Dictionary<string, object?> { ["UEFISecureBootEnabled"] = 1 }));
        Registry.Add(RegHive.LocalMachine, @"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}", FakeKey.With(subs: new Dictionary<string, FakeKey>
        {
            ["0000"] = FakeKey.With(new Dictionary<string, object?>
            {
                ["DriverDesc"] = "NVIDIA GeForce RTX 3060 Laptop GPU", ["HardwareInformation.qwMemorySize"] = BitConverter.GetBytes(2L * 1024 * 1024 * 1024),
            }),
            ["Properties"] = FakeKey.With(new Dictionary<string, object?> { ["DriverDesc"] = "x" }),
        }));

        // ------------------------------------------------------------ WMI
        var diskPath = @"\\MOCKPC\ROOT\Microsoft\Windows\Storage:MSFT_PhysicalDisk.ObjectId=""{1}\\MOCKPC\ROOT\Microsoft\Windows\Storage\:PD:{abc}""";
        Wmi.Add("Win32_ComputerSystem", Row.Of(("Manufacturer", "LENOVO"), ("Model", "21CFCTO1WW"), ("SystemFamily", "ThinkPad T14 Gen 3"), ("SystemSKUNumber", "LENOVO_MT_21CF"), ("PCSystemType", (ushort)2), ("TotalPhysicalMemory", 50889011200UL)))
            .Add("Win32_BIOS", Row.Of(("Manufacturer", "LENOVO"), ("SMBIOSBIOSVersion", "R23ET60W (1.30 )"), ("ReleaseDate", new DateTime(2023, 2, 14)), ("SerialNumber", "PF3ABCDE")))
            .Add("Win32_BaseBoard", Row.Of(("Manufacturer", "LENOVO"), ("Product", "21CFCTO1WW")))
            .Add("Win32_SystemEnclosure", Row.Of(("ChassisTypes", new ushort[] { 10 })))
            .Add("Win32_ComputerSystemProduct", Row.Of(("Version", "ThinkPad T14 Gen 3"), ("IdentifyingNumber", "X")))
            .Add("Win32_OperatingSystem", Row.Of(("Caption", "Microsoft Windows 11 Pro"), ("Version", "10.0.26100"), ("BuildNumber", "26100"), ("OSArchitecture", "64-bit"),
                ("InstallDate", new DateTime(2023, 4, 2)), ("LastBootUpTime", Now.AddDays(-3)), ("TotalVisibleMemorySize", 49695120UL), ("FreePhysicalMemory", 14891234UL)))
            .Add("Win32_Processor", Row.Of(("Name", "12th Gen Intel(R) Core(TM) i7-1260P   "), ("Manufacturer", "GenuineIntel"), ("NumberOfCores", 12u), ("NumberOfLogicalProcessors", 16u),
                ("MaxClockSpeed", 2100u), ("SocketDesignation", "U3E1"), ("L2CacheSize", 9216u), ("L3CacheSize", 18432u), ("VirtualizationFirmwareEnabled", true)))
            .Add("Win32_PhysicalMemory",
                Row.Of(("DeviceLocator", "Onboard"), ("BankLabel", "BANK 0"), ("Capacity", 17179869184UL), ("Speed", 3200u), ("ConfiguredClockSpeed", 3200u), ("Manufacturer", "Samsung"),
                    ("PartNumber", "K4AAG165WA-BCWE "), ("SMBIOSMemoryType", (ushort)26), ("FormFactor", (ushort)0), ("ConfiguredVoltage", 1200u), ("Attributes", 1u), ("DataWidth", (ushort)64), ("TotalWidth", (ushort)64)),
                Row.Of(("DeviceLocator", "DIMM A"), ("BankLabel", "BANK 1"), ("Capacity", 34359738368UL), ("Speed", 3200u), ("ConfiguredClockSpeed", 3200u), ("Manufacturer", "Micron"),
                    ("PartNumber", "16ATF4G64HZ-3G2R1"), ("SMBIOSMemoryType", (ushort)26), ("FormFactor", (ushort)12), ("ConfiguredVoltage", 1200u), ("Attributes", 2u), ("DataWidth", (ushort)64), ("TotalWidth", (ushort)64)))
            .Add("Win32_PhysicalMemoryArray", Row.Of(("MaxCapacity", 67108864u), ("MaxCapacityEx", 67108864UL), ("MemoryDevices", (ushort)2), ("MemoryErrorCorrection", (ushort)3)))
            .Add("Win32_PerfFormattedData_PerfOS_Memory", Row.Of(("PagesInputPersec", 4u), ("CommittedBytes", 30601641984UL), ("CommitLimit", 62277025792UL)))
            .Add("Win32_PerfFormattedData_PerfOS_Processor", Row.Of(("PercentProcessorTime", 12UL)))
            .Add("Win32_PageFileUsage", Row.Of(("Name", @"C:\pagefile.sys"), ("AllocatedBaseSize", 8192u), ("CurrentUsage", 1200u), ("PeakUsage", 3100u)))
            .Add("Win32_VideoController",
                Row.Of(("Name", "Intel(R) Iris(R) Xe Graphics"), ("AdapterCompatibility", "Intel Corporation"), ("DriverVersion", "31.0.101.4502"), ("DriverDate", new DateTime(2023, 6, 15)),
                    ("AdapterRAM", 134217728u), ("CurrentHorizontalResolution", 1920u), ("CurrentVerticalResolution", 1200u), ("CurrentRefreshRate", 60u), ("Status", "OK"), ("PNPDeviceID", @"PCI\VEN_8086")),
                Row.Of(("Name", "NVIDIA GeForce RTX 3060 Laptop GPU"), ("AdapterCompatibility", "NVIDIA"), ("DriverVersion", "32.0.15.6094"), ("DriverDate", new DateTime(2024, 10, 1)),
                    ("AdapterRAM", 4293918720u), ("CurrentHorizontalResolution", null), ("CurrentVerticalResolution", null), ("CurrentRefreshRate", null), ("Status", "OK"), ("PNPDeviceID", @"PCI\VEN_10DE")))
            .Add("MSFT_Disk", Row.Of(("Number", 0u), ("PartitionStyle", "GPT"), ("IsBoot", true), ("IsSystem", true)))
            .Add("MSFT_PhysicalDisk", Row.Of(("__PATH", diskPath), ("DeviceId", "0"), ("FriendlyName", "Samsung SSD 980 PRO 1TB"), ("MediaType", "SSD"), ("BusType", "NVMe"),
                ("Size", 1000204886016UL), ("HealthStatus", "Healthy"), ("OperationalStatus", new[] { "OK" }), ("SpindleSpeed", 0u), ("FirmwareVersion", "5B2QGXA7")))
            .AddRelated(diskPath, "MSFT_StorageReliabilityCounter",
                Row.Of(("Wear", (byte)4), ("Temperature", (ushort)41), ("PowerOnHours", 5230u), ("ReadErrorsTotal", 0UL), ("WriteErrorsTotal", 0UL)))
            .Add("MSFT_Partition", Row.Of(("DriveLetter", 'C'), ("DiskNumber", 0u)), Row.Of(("DriveLetter", (char)0), ("DiskNumber", 0u)))
            .Add("Win32_LogicalDisk", Row.Of(("DeviceID", "C:"), ("VolumeName", "Windows"), ("FileSystem", "NTFS"), ("Size", 1000000000000UL), ("FreeSpace", 126000000000UL), ("DriveType", 3u)))
            .Add("Win32_Battery", Row.Of(("Name", "SDS 5B10W13975"), ("EstimatedChargeRemaining", (ushort)86), ("BatteryStatus", (ushort)2)))
            .Add("MSFT_NetAdapter", Row.Of(("Name", "WLAN"), ("InterfaceDescription", "Intel(R) Wi-Fi 6E AX211 160MHz"), ("Status", "Up"), ("LinkSpeed", "1.2 Gbps"), ("NdisPhysicalMedium", "Native 802.11")))
            .Add("MSFT_MpComputerStatus", Row.Of(("AMServiceEnabled", true), ("AntivirusEnabled", true), ("RealTimeProtectionEnabled", true), ("IsTamperProtected", true),
                ("AntivirusSignatureLastUpdated", new DateTime(2026, 10, 18, 7, 12, 0)), ("QuickScanEndTime", new DateTime(2026, 10, 14, 12, 0, 0)), ("FullScanEndTime", new DateTime(1601, 1, 1))))
            .Add("AntiVirusProduct", Row.Of(("displayName", "Windows Defender"), ("productState", 397568u)), Row.Of(("displayName", "McAfee"), ("productState", 393472u)))
            .Add("MSFT_NetFirewallProfile", Row.Of(("Name", "Domain"), ("Enabled", "True")), Row.Of(("Name", "Public"), ("Enabled", "False")))
            .Add("Win32_Tpm", Row.Of(("SpecVersion", "2.0, 0, 1.38"), ("IsEnabled_InitialValue", true), ("IsActivated_InitialValue", true), ("IsOwned_InitialValue", true)))
            .Add("Win32_QuickFixEngineering", Row.Of(("HotFixID", "KB1"), ("InstalledOn", new DateTime(2026, 9, 10))), Row.Of(("HotFixID", "KB2"), ("InstalledOn", new DateTime(2026, 8, 1))), Row.Of(("HotFixID", "KB3"), ("InstalledOn", null)))
            .Add("Win32_EncryptableVolume", Row.Of(("__PATH", "BL:C"), ("DriveLetter", "C:")))
            .AddMethod("BL:C", "GetProtectionStatus", Row.Of(("ProtectionStatus", 1u)))
            .AddMethod("BL:C", "GetConversionStatus", Row.Of(("ConversionStatus", 1u)))
            .Add("Win32_DiskDrive", Row.Of(("Index", 0u), ("Model", "SAMSUNG MZVL21T0"), ("MediaType", "Fixed hard disk media"), ("InterfaceType", "SCSI"), ("Size", 1024209543168UL), ("Status", "OK"), ("FirmwareRevision", "x")));

        // ------------------------------------------------------------ processes
        Processes.BatteryXml = "<?xml version=\"1.0\"?><BatteryReport xmlns=\"http://schemas.microsoft.com/battery/2012\"><Batteries><Battery><Id>X</Id><Manufacturer>SMP</Manufacturer><Chemistry>LiP</Chemistry>" +
                               "<DesignCapacity>52000</DesignCapacity><FullChargeCapacity>37500</FullChargeCapacity><CycleCount>412</CycleCount></Battery></Batteries></BatteryReport>";
        Processes.ActiveScheme = "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Ausbalanciert)";

        // ------------------------------------------------------------ probe: processes, one Start Menu shortcut on disk
        Probe.ProcessList.AddRange([new ProcInfo("chrome", 900_000_000, 120.55), new ProcInfo("chrome", 300_000_000, 30.2), new ProcInfo("code", 500_000_000, 10)]);
        var startMenu = Path.Combine(Root, "ProgramData", @"Microsoft\Windows\Start Menu\Programs");
        Directory.CreateDirectory(startMenu);
        var lnk = Path.Combine(startMenu, "Google Chrome.lnk");
        File.WriteAllBytes(lnk, []);
        Probe.Shortcuts[lnk] = new ShortcutTarget(@"C:\Program Files\Google\Chrome\Application\chrome.exe", "");
    }

    static string Val_Rot13(string text) => string.Create(text.Length, text, (span, t) =>
    {
        for (var i = 0; i < t.Length; i++)
        {
            var c = t[i];
            span[i] = c is >= 'a' and <= 'z' ? (char)((c - 'a' + 13) % 26 + 'a') : c is >= 'A' and <= 'Z' ? (char)((c - 'A' + 13) % 26 + 'A') : c;
        }
    });

    public void Dispose()
    {
        try { Directory.Delete(Root, true); } catch (IOException) { }
    }
}
