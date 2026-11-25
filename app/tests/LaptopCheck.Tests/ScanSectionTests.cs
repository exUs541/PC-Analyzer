using System.Text.Json.Nodes;
using LaptopCheck.Scan;
using LaptopCheck.Scan.Sections;

namespace LaptopCheck.Tests;

public class ScanSectionTests : IDisposable
{
    readonly MockPc _pc = new();
    ScanContext Ctx(bool admin = false) => _pc.Context(admin);

    public void Dispose() => _pc.Dispose();

    static string S(JsonNode? n) => n?.ToString() ?? "<null>";

    [Fact]
    public void Rot13_decodes_and_is_its_own_inverse()
    {
        Assert.Equal(@"C:\Program Files", Val.Rot13(@"P:\Cebtenz Svyrf"));
        Assert.Equal("Hello, World! 123", Val.Rot13(Val.Rot13("Hello, World! 123")));
    }

    [Fact]
    public void Device_and_os_facts()
    {
        var sys = HardwareSections.Device(Ctx());
        Assert.Equal("LENOVO", S(sys["manufacturer"]));
        Assert.Equal("ThinkPad T14 Gen 3", S(sys["productVersion"]));
        Assert.Equal("2023-02-14T00:00:00", S(sys["biosDate"]));
        Assert.Equal("[10]", sys["chassisTypes"]!.ToJsonString());
        Assert.Equal(2, (int)sys["firmwareType"]!);

        var os = HardwareSections.Os(Ctx());
        Assert.Equal(26100, (int)os["build"]!);
        Assert.Equal("24H2", S(os["displayVersion"]));
        Assert.Equal("Professional", S(os["edition"]));
        Assert.Equal(5074, (long)os["ubr"]!);
        Assert.Equal(3.0, (double)os["uptimeDays"]!, 1);
        Assert.Equal(1, (int)os["fastStartup"]!);
    }

    [Fact]
    public void Placeholder_texts_of_firmware_vendors_become_null()
    {
        Assert.Null(Val.Clean("To Be Filled By O.E.M."));
        Assert.Null(Val.Clean("  default string "));
        Assert.Null(Val.Clean("   "));
        Assert.Equal("ThinkPad", Val.Clean(" ThinkPad "));
    }

    [Fact]
    public void Cpu_name_is_trimmed()
    {
        var cpu = HardwareSections.Cpu(Ctx());
        Assert.Single(cpu);
        Assert.Equal("12th Gen Intel(R) Core(TM) i7-1260P", S(cpu[0]!["name"]));
        Assert.True((bool)cpu[0]!["virtualization"]!);
    }

    [Fact]
    public void Memory_modules_arrays_and_counters()
    {
        var mem = HardwareSections.Memory(Ctx());
        var modules = (JsonArray)mem["modules"]!;
        Assert.Equal(2, modules.Count);
        Assert.Equal(34359738368L, (long)modules[1]!["capacityBytes"]!);
        Assert.Equal("K4AAG165WA-BCWE", S(modules[0]!["partNumber"]));
        Assert.Equal(1, (long)modules[0]!["rank"]!);
        Assert.Equal(67108864L, (long)((JsonArray)mem["arrays"]!)[0]!["maxCapacityKB"]!);
        Assert.Equal(49695120L * 1024, (long)mem["visibleBytes"]!);
        Assert.Equal(62277025792L, (long)mem["commitLimitBytes"]!);
        Assert.Equal(4.0, (double)mem["pagesInPerSec"]!);
    }

    [Fact]
    public void Gpu_memory_prefers_the_64_bit_registry_value_over_the_capped_adapter_ram()
    {
        var gpu = HardwareSections.Gpu(Ctx());
        Assert.Equal(2, gpu.Count);
        Assert.Equal(2147483648L, (long)gpu[1]!["vramBytes"]!);
        Assert.Equal(134217728L, (long)gpu[0]!["vramBytes"]!);
    }

    [Fact]
    public void Disks_and_volumes()
    {
        var disks = HardwareSections.Disks(Ctx());
        Assert.Equal("NVMe", S(disks[0]!["busType"]));
        Assert.Equal(4L, (long)disks[0]!["reliability"]!["wearPct"]!);
        Assert.True((bool)disks[0]!["isBoot"]!);
        Assert.Equal("GPT", S(disks[0]!["partitionStyle"]));
        Assert.Equal("OK", S(disks[0]!["operational"]));

        var vols = HardwareSections.Volumes(Ctx());
        Assert.Equal("C", S(vols[0]!["letter"]));
        Assert.Equal(0, (int)vols[0]!["diskNumber"]!);
    }

    [Fact]
    public void Storage_numbers_get_the_words_the_dashboard_matches_on()
    {
        Assert.Equal("SSD", StorageNames.MediaType((ushort)4));
        Assert.Equal("HDD", StorageNames.MediaType(3));
        Assert.Equal("NVMe", StorageNames.BusType((ushort)17));
        Assert.Equal("SATA", StorageNames.BusType(11u));
        Assert.Equal("Healthy", StorageNames.Health((ushort)0));
        Assert.Equal("Unhealthy", StorageNames.Health((ushort)2));
        Assert.Equal("GPT", StorageNames.PartitionStyle((ushort)2));
        Assert.Equal("Predictive Failure", StorageNames.Operational(5));
    }

    [Fact]
    public void Disks_fall_back_to_the_classic_class_when_the_storage_provider_is_missing()
    {
        _pc.Wmi.Fail("MSFT_PhysicalDisk", new System.Management.ManagementException("not supported"));
        var ctx = Ctx();
        var disks = HardwareSections.Disks(ctx);
        Assert.Equal("SAMSUNG MZVL21T0", S(disks[0]!["model"]));
        Assert.Contains(ctx.Warnings, w => w.Area == "disks");
    }

    [Fact]
    public void Battery_from_the_powercfg_report()
    {
        var bat = HardwareSections.Battery(Ctx())!;
        Assert.Equal(52000L, (long)bat["designMWh"]!);
        Assert.Equal(37500L, (long)bat["fullChargeMWh"]!);
        Assert.Equal(412L, (long)bat["cycleCount"]!);
        Assert.Equal(86L, (long)bat["chargePct"]!);
        Assert.Equal("SMP", S(bat["manufacturer"]));
    }

    [Fact]
    public void No_battery_means_null()
    {
        _pc.Wmi.Add("Win32_Battery");
        Assert.Null(HardwareSections.Battery(Ctx()));
    }

    [Fact]
    public void Network_link_speed_is_written_like_Get_NetAdapter_did()
    {
        Assert.Equal("Intel(R) Wi-Fi 6E AX211 160MHz", S(HardwareSections.Network(Ctx())[0]!["description"]));
        Assert.Equal("1.2 Gbps", NetNames.LinkSpeed(Row.Of(("Speed", 1_200_000_000UL))));
        Assert.Equal("1 Gbps", NetNames.LinkSpeed(Row.Of(("Speed", 1_000_000_000UL))));
        Assert.Equal("866.7 Mbps", NetNames.LinkSpeed(Row.Of(("Speed", 866_700_000UL))));
        Assert.Equal("0 bps", NetNames.LinkSpeed(Row.Of(("Speed", 0UL))));
        Assert.Equal("Native 802.11", NetNames.MediaType(9u));
        Assert.Equal("802.3", NetNames.MediaType((ushort)14));
        Assert.Equal("Disconnected", NetNames.Status(Row.Of(("MediaConnectState", 2u))));
        Assert.Equal("Disabled", NetNames.Status(Row.Of(("InterfaceAdminStatus", 2u))));
    }

    [Fact]
    public void Security_facts()
    {
        var sec = SecuritySections.Security(Ctx());
        Assert.True((bool)sec["defender"]!["realTime"]!);
        Assert.Null(sec["defender"]!["fullScanEnd"]);                    // 1601-01-01 is "never"
        var av = (JsonArray)sec["antivirus"]!;
        Assert.True((bool)av[0]!["enabled"]!);                           // productState 397568 = on
        Assert.True((bool)av[0]!["upToDate"]!);
        Assert.False((bool)av[1]!["enabled"]!);                          // productState 393472 = off
        Assert.False((bool)sec["firewall"]![1]!["enabled"]!);
        Assert.Equal(1, (int)sec["secureBoot"]!);
        Assert.True((bool)sec["tpm"]!["present"]!);
        Assert.True((bool)sec["tpm"]!["ready"]!);
        Assert.Equal("2026-09-10T00:00:00", S(sec["lastHotfix"]));
        Assert.Equal(3, (int)sec["hotfixCount"]!);
        Assert.Empty((JsonArray)sec["bitlocker"]!);                      // admin only
        Assert.False((bool)sec["pendingReboot"]!);
    }

    [Fact]
    public void Bitlocker_is_read_as_administrator_only()
    {
        var sec = SecuritySections.Security(Ctx(admin: true));
        var bl = (JsonArray)sec["bitlocker"]!;
        Assert.Equal("C:", S(bl[0]!["mount"]));
        Assert.Equal("FullyEncrypted", S(bl[0]!["status"]));
        Assert.Equal("On", S(bl[0]!["protection"]));
    }

    [Fact]
    public void Tpm_without_admin_rights_still_reports_presence_and_version_from_the_TPM_base_services()
    {
        _pc.Wmi.Fail("Win32_Tpm", new UnauthorizedAccessException("Zugriff verweigert"));
        _pc.Probe.TpmInfo = new TpmDeviceInfo(true, "2.0");
        var tpm = SecuritySections.Security(Ctx())["tpm"]!;
        Assert.True((bool)tpm["present"]!);
        Assert.Equal("2.0", S(tpm["specVersion"]));
        Assert.Null(tpm["ready"]);
    }

    [Fact]
    public void Tpm_stays_null_when_nothing_can_be_read()
    {
        _pc.Wmi.Fail("Win32_Tpm", new UnauthorizedAccessException("Zugriff verweigert"));
        Assert.Null(SecuritySections.Security(Ctx())["tpm"]);
    }

    [Fact]
    public void Defender_failure_is_a_warning_not_a_crash()
    {
        _pc.Wmi.Fail("MSFT_MpComputerStatus", new System.Management.ManagementException("Ungültiger Namespace"));
        var ctx = Ctx();
        var sec = SecuritySections.Security(ctx);
        Assert.Null(sec["defender"]);
        Assert.Contains(ctx.Warnings, w => w.Area == "security" && w.Message.StartsWith("Defender status"));
    }

    [Fact]
    public void Installed_on_dates_of_hotfixes_are_read_in_any_common_notation()
    {
        Assert.Equal(new DateTime(2026, 9, 10), SecuritySections.ParseInstalledOn("9/10/2026"));
        Assert.Equal(new DateTime(2026, 9, 10), SecuritySections.ParseInstalledOn(new DateTime(2026, 9, 10)));
        Assert.Null(SecuritySections.ParseInstalledOn(null));
        Assert.Null(SecuritySections.ParseInstalledOn(""));
        Assert.Null(SecuritySections.ParseInstalledOn("not a date"));
    }

    [Fact]
    public void Power_plan()
    {
        var pp = SecuritySections.PowerPlan(Ctx())!;
        Assert.Equal("381b4222-f694-41f0-9685-ff5bb260df2e", S(pp["guid"]));
        Assert.Equal("Ausbalanciert", S(pp["name"]));
    }

    [Fact]
    public void Startup_entries_and_their_enabled_flag()
    {
        var st = SystemSections.Startup(Ctx());
        Assert.Equal(3, st.Count);
        Assert.True((bool)st.First(s => S(s!["name"]) == "OneDrive")!["enabled"]!);      // 02
        Assert.False((bool)st.First(s => S(s!["name"]) == "Teams")!["enabled"]!);        // 03
        Assert.Equal(@"HKLM\Run", S(st.First(s => S(s!["name"]) == "SecurityHealth")!["location"]));
    }

    [Fact]
    public void Processes_are_grouped_by_name_and_sorted_by_memory()
    {
        var p = SystemSections.Processes(Ctx());
        Assert.Equal("chrome", S(p[0]!["name"]));
        Assert.Equal(2, (int)p[0]!["count"]!);
        Assert.Equal(1_200_000_000L, (long)p[0]!["workingSetBytes"]!);
        Assert.Equal(150.8, (double)p[0]!["cpuSeconds"]!, 1);
    }

    [Fact]
    public void Registry_software_skips_updates_nameless_entries_and_keeps_honest_nulls()
    {
        var sw = SoftwareSections.FromRegistry(Ctx());
        var names = sw.Items.Select(i => S(i["name"])).ToList();
        Assert.Contains("Google Chrome", names);
        Assert.DoesNotContain("Update for Windows (KB5001234)", names);
        Assert.Equal(1, sw.IgnoredUpdates);

        var chrome = sw.Items.Single(i => S(i["name"]) == "Google Chrome");
        Assert.Equal("2024-03-02T00:00:00", S(chrome["installDate"]));
        Assert.Equal("registry", S(chrome["installDateSource"]));
        Assert.Equal(1258291L, (long)chrome["sizeKB"]!);
        Assert.Equal("registry", S(chrome["sizeSource"]));
        Assert.Equal("machine", S(chrome["scope"]));
        Assert.Equal("reg:HKLM:x64:Google Chrome", S(chrome["id"]));

        Assert.Null(sw.Items.Single(i => S(i["name"]) == "Contoso Report Helper")["installDate"]);   // not invented
        var spotify = sw.Items.Single(i => S(i["name"]) == "Spotify");
        Assert.Equal("user", S(spotify["scope"]));
        Assert.Null(spotify["installDate"]);                                                           // garbage date
        var hidden = sw.Items.Single(i => S(i["name"]) == "Hidden component");
        Assert.True((bool)hidden["isSystemComponent"]!);
    }

    [Fact]
    public void Identical_programs_are_listed_once()
    {
        var key = () => FakeKey.With(new Dictionary<string, object?> { ["DisplayName"] = "Twin", ["DisplayVersion"] = "1", ["Publisher"] = "P" });
        _pc.Registry.Add(RegHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            FakeKey.With(subs: new Dictionary<string, FakeKey> { ["a"] = key(), ["b"] = key() }), RegView.Registry64);
        var sw = SoftwareSections.FromRegistry(Ctx());
        Assert.Single(sw.Items, i => S(i["name"]) == "Twin");
    }

    [Fact]
    public void Install_date_falls_back_to_the_folder_and_then_to_the_key_time()
    {
        var dir = Path.Combine(_pc.Root, "Apps", "Foo", "Bar");
        Directory.CreateDirectory(dir);
        var key = FakeKey.With(new Dictionary<string, object?> { ["DisplayName"] = "Folder app", ["InstallLocation"] = "\"" + dir + "\\\"" });
        var timeOnly = FakeKey.With(new Dictionary<string, object?> { ["DisplayName"] = "Key app" });
        timeOnly.LastWriteTime = new DateTime(2025, 5, 5, 5, 5, 5);
        _pc.Registry.Add(RegHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            FakeKey.With(subs: new Dictionary<string, FakeKey> { ["f"] = key, ["k"] = timeOnly }), RegView.Registry64);
        var items = SoftwareSections.FromRegistry(Ctx()).Items;
        Assert.Equal("folder", S(items.Single(i => S(i["name"]) == "Folder app")["installDateSource"]));
        var k = items.Single(i => S(i["name"]) == "Key app");
        Assert.Equal("keytime", S(k["installDateSource"]));
        Assert.Equal("2025-05-05T05:05:05", S(k["installDate"]));
    }

    [Fact]
    public void Store_apps_skip_frameworks_and_system_packages()
    {
        var store = SoftwareSections.FromStore(Ctx());
        Assert.Equal(2, store.Count);
        Assert.Equal("Rechner", S(store[0]["name"]));
        Assert.True((bool)store[0]["hasStartEntry"]!);
        Assert.Equal("Microsoft Corporation", S(store[0]["publisher"]));
        Assert.Equal("Some Developer", S(store[1]["publisher"]));        // GUID publisher -> PublisherDisplayName
        Assert.False((bool)store[1]["hasStartEntry"]!);
        Assert.Equal("SomeDev.Tool", S(store[1]["name"]));
    }

    [Fact]
    public void Usage_evidence_from_user_assist_app_compat_and_mui_cache()
    {
        var u = UsageSections.Collect(Ctx());
        var chrome = (JsonObject)u.Entries.First(e => S(e!["path"]).EndsWith("chrome.exe"))!;
        Assert.Equal(@"{6D809377-6AF0-444B-8957-A3773F02200E}\Google\Chrome\Application\chrome.exe", S(chrome["path"]));
        Assert.Equal(612L, (long)chrome["runCount"]!);                   // offset 4
        Assert.Equal(412L, (long)chrome["focusSec"]!);                   // offset 12
        Assert.Equal("2026-10-19T20:58:00", S(chrome["lastRun"]));       // FILETIME at offset 60
        Assert.DoesNotContain(u.Entries, e => S(e!["path"]).Contains("UEME_"));
        Assert.Equal(2, (int)u.Counts["userAssist"]!);                   // short record and session entry are skipped

        var appCompat = u.Entries.Where(e => S(e!["source"]) == "AppCompat").ToList();
        Assert.Equal(2, appCompat.Count);                                // only .exe entries
        Assert.Equal("2025-02-14T10:00:00", S(appCompat.First(e => S(e!["path"]).EndsWith("firefox.exe"))!["lastRun"]));
        Assert.Equal(@"C:\Program Files\WinRAR\WinRAR.exe", S(u.Entries.Single(e => S(e!["source"]) == "MuiCache")!["path"]));
        Assert.Equal(0, (int)u.Counts["prefetch"]!);
    }

    [Fact]
    public void Prefetch_is_read_for_administrators_and_keeps_the_newest_run()
    {
        var dir = Path.Combine(_pc.Root, "Windows", "Prefetch");
        Directory.CreateDirectory(dir);
        var older = Path.Combine(dir, "CHROME.EXE-AAAAAAAA.pf");
        var newer = Path.Combine(dir, "CHROME.EXE-BBBBBBBB.pf");
        File.WriteAllBytes(older, []);
        File.WriteAllBytes(newer, []);
        File.SetLastWriteTime(older, new DateTime(2026, 1, 1, 8, 0, 0));
        File.SetLastWriteTime(newer, new DateTime(2026, 2, 2, 9, 0, 0));
        File.WriteAllBytes(Path.Combine(dir, "Layout.ini"), []);

        var u = UsageSections.Collect(Ctx(admin: true));
        var pf = u.Entries.Where(e => S(e!["source"]) == "Prefetch").ToList();
        Assert.Single(pf);
        Assert.Equal("chrome.exe", S(pf[0]!["path"]));
        Assert.Equal("2026-02-02T09:00:00", S(pf[0]!["lastRun"]));
    }

    [Fact]
    public void Shortcuts_link_a_name_to_its_program()
    {
        var sc = SoftwareSections.Shortcuts(Ctx());
        Assert.Single(sc);
        Assert.Equal("Google Chrome", S(sc[0]!["name"]));
        Assert.EndsWith("chrome.exe", S(sc[0]!["target"]));
    }

    [Fact]
    public void Winget_table_english_with_spinner_artefacts()
    {
        var en = "   - \r   \\ \r\n\r\nName            Id                 Version     Available   Source\r\n" +
                 "--------------------------------------------------------------------\r\n" +
                 "Google Chrome   Google.Chrome      130.0.1     141.0.2     winget\r\n" +
                 "7-Zip           7zip.7zip          23.01       24.08       winget\r\n" +
                 "2 upgrades available.\r\n";
        var rows = WingetSections.ParseUpgradeTable(en);
        Assert.Equal(2, rows.Count);
        Assert.Equal("Google.Chrome", S(rows[0]["id"]));
        Assert.Equal("141.0.2", S(rows[0]["available"]));
        Assert.Equal("7-Zip", S(rows[1]["name"]));
        Assert.Equal("winget", S(rows[1]["source"]));
    }

    [Fact]
    public void Winget_table_german_headers()
    {
        var de = "Name                      ID               Version   Verfügbar  Quelle\n" +
                 "------------------------------------------------------------\n" +
                 "Mozilla Firefox (x64 de)  Mozilla.Firefox  131.0.3   132.0      winget\n" +
                 "1 Aktualisierungen verfügbar.\n";
        var rows = WingetSections.ParseUpgradeTable(de);
        Assert.Single(rows);
        Assert.Equal("Mozilla.Firefox", S(rows[0]["id"]));
        Assert.Equal("Mozilla Firefox (x64 de)", S(rows[0]["name"]));
    }

    [Fact]
    public void Winget_without_a_table_gives_no_rows()
    {
        Assert.Empty(WingetSections.ParseUpgradeTable("No installed package found matching input criteria."));
        Assert.Empty(WingetSections.ParseUpgradeTable(""));
    }

    [Fact]
    public void Winget_unavailable_or_timed_out_is_null_not_zero_updates()
    {
        Assert.Null(WingetSections.Updates(Ctx()));                       // not on PATH
        _pc.Processes.WingetPath = @"C:\winget.exe";
        _pc.Processes.WingetTimeout = true;
        var ctx = Ctx();
        Assert.Null(WingetSections.Updates(ctx));
        Assert.Contains(ctx.Warnings, w => w.Area == "updates");
    }

    [Fact]
    public void Winget_runs_when_available()
    {
        _pc.Processes.WingetPath = @"C:\winget.exe";
        _pc.Processes.WingetOutput = "Name   Id       Version  Available  Source\n----------------------------------------------\nFoo    Foo.Bar  1.0      2.0        winget\n";
        var rows = WingetSections.Updates(Ctx())!;
        Assert.Single(rows);
        Assert.Equal("Foo.Bar", S(rows[0]!["id"]));
    }

    [Fact]
    public void Folder_size_sums_nested_files_and_survives_a_missing_folder()
    {
        var tmp = Path.Combine(_pc.Root, "fs");
        Directory.CreateDirectory(Path.Combine(tmp, "a", "b"));
        File.WriteAllBytes(Path.Combine(tmp, "x.bin"), new byte[1000]);
        File.WriteAllBytes(Path.Combine(tmp, "a", "y.bin"), new byte[2000]);
        File.WriteAllBytes(Path.Combine(tmp, "a", "b", "z.bin"), new byte[3000]);
        var s = SystemSections.FolderSizeCapped(tmp, 5);
        Assert.Equal(6000, s.Bytes);
        Assert.False(s.Partial);
        Assert.Equal(0, SystemSections.FolderSizeCapped(Path.Combine(tmp, "does-not-exist"), 5).Bytes);
    }

    [Fact]
    public void Suspicious_installer_sizes_are_remeasured_and_corrected()
    {
        // a 62 MB driver that reports its size in BYTES shows up as 62 GB
        var prog = Path.Combine(_pc.Root, "Prog", "gaomon", "driver");
        Directory.CreateDirectory(prog);
        File.WriteAllBytes(Path.Combine(prog, "driver.bin"), new byte[5 * 1024 * 1024]);
        JsonObject Item(string name, long? kb, string? source, string loc) => J.O(("name", name), ("sizeKB", kb), ("sizeSource", source), ("installLocation", loc));
        var items = new List<JsonObject>
        {
            Item("GAOMON Tablet", 62L * 1024 * 1024, "registry", prog),
            Item("Really Big Game", 60L * 1024 * 1024, "registry", Path.Combine(_pc.Root, "Prog", "missing", "game")),
            Item("Honest IDE", 3L * 1024 * 1024, "registry", prog),
            Item("Small", 4000, "registry", prog),
            Item("No size", null, null, prog),
            Item("Profile root", null, null, @"C:\Users\Anna"),
        };
        SoftwareSections.AddFolderSizes(items);

        Assert.Equal("folder-corrected", S(items[0]["sizeSource"]));
        Assert.Equal(5120L, (long)items[0]["sizeKB"]!);
        Assert.Equal(62L * 1024 * 1024, (long)items[0]["sizeRegistryKB"]!);      // the claimed value stays for the dashboard
        Assert.Equal("registry", S(items[1]["sizeSource"]));                       // cannot be verified: kept as claimed
        Assert.Equal("folder-corrected", S(items[2]["sizeSource"]));
        Assert.Equal("registry", S(items[3]["sizeSource"]));                       // small claims are not re-measured
        Assert.Equal("folder", S(items[4]["sizeSource"]));
        Assert.Null(items[5]["sizeKB"]);                                           // profile folders are never "program size"
    }

    [Theory]
    [InlineData(@"C:\Windows", false)]
    [InlineData(@"C:\Program Files", false)]
    [InlineData(@"C:\Users\Anna", false)]
    [InlineData(@"C:\Users\Anna\Documents", false)]
    [InlineData(@"C:\Users\Anna\AppData\Local", false)]
    [InlineData(@"D:\", false)]
    [InlineData("", false)]
    public void Only_real_program_folders_are_measured(string path, bool expected) =>
        Assert.Equal(expected, SoftwareSections.IsMeasurableInstallFolder(path));

    [Fact]
    public void Folders_section_lists_existing_folders_system_files_and_the_recycle_bin()
    {
        var env = _pc.Env(false);
        Directory.CreateDirectory(env.Temp);
        File.WriteAllBytes(Path.Combine(env.Temp, "t.tmp"), new byte[500]);
        File.WriteAllBytes(Path.Combine(_pc.Root, "hiberfil.sys"), new byte[100]);
        var folders = SystemSections.Folders(Ctx());
        var temp = folders.First(f => S(f!["id"]) == "temp-user")!;
        Assert.Equal(500L, (long)temp["bytes"]!);
        Assert.False((bool)temp["partial"]!);
        Assert.Equal("folder", S(temp["kind"]));
        Assert.Equal(100L, (long)folders.First(f => S(f!["id"]) == "hiberfil.sys")!["bytes"]!);
        Assert.Equal(4096L, (long)folders.First(f => S(f!["id"]) == "recycle-bin")!["bytes"]!);
        Assert.DoesNotContain(folders, f => S(f!["id"]) == "windows-old");       // does not exist
    }

    [Fact]
    public async Task A_failing_section_becomes_a_warning_and_the_scan_goes_on()
    {
        _pc.Wmi.Fail("Win32_Processor", new System.Management.ManagementException("kaputt"));
        var ctx = Ctx();
        var snap = await LaptopScanner.RunAsync(ctx);
        Assert.Empty((JsonArray)snap["cpu"]!);
        Assert.NotNull(snap["system"]);
        var warnings = (JsonArray)snap["warnings"]!;
        Assert.Single(warnings);
        Assert.Equal("cpu", S(warnings[0]!["area"]));
    }
}
