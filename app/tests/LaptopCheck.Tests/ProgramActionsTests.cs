using System.Text.Json;
using LaptopCheck.Cleanup;
using LaptopCheck.Core;
using LaptopCheck.Scan;

namespace LaptopCheck.Tests;

public sealed class UninstallCommandTests
{
    [Theory]
    [InlineData("MsiExec.exe /I{9F3A1B2C-0000-4000-8000-123456789ABC}", "msiexec.exe", "/x {9F3A1B2C-0000-4000-8000-123456789ABC}")]
    [InlineData("MsiExec.exe /X{9F3A1B2C-0000-4000-8000-123456789ABC}", "msiexec.exe", "/x {9F3A1B2C-0000-4000-8000-123456789ABC}")]
    [InlineData("\"C:\\Windows\\System32\\msiexec.exe\" /i {9F3A1B2C-0000-4000-8000-123456789ABC}", "msiexec.exe", "/x {9F3A1B2C-0000-4000-8000-123456789ABC}")]
    [InlineData("\"C:\\Program Files\\Foo Bar\\unins000.exe\" /LOG", "C:\\Program Files\\Foo Bar\\unins000.exe", "/LOG")]
    [InlineData("\"C:\\Program Files\\Foo\\uninst.exe\"", "C:\\Program Files\\Foo\\uninst.exe", "")]
    [InlineData("C:\\Program Files\\Bar\\uninstall.exe -u", "C:\\Program Files\\Bar\\uninstall.exe", "-u")]
    public void Real_uninstall_strings_are_split_into_program_and_arguments(string command, string file, string args) =>
        Assert.Equal((file, args), UninstallCommand.Parse(command));

    [Theory]
    [InlineData("cmd.exe /c rd /s /q C:\\")]
    [InlineData("\"C:\\Windows\\System32\\cmd.exe\" /c del *")]
    [InlineData("powershell.exe -Command Remove-Item C:\\ -Recurse")]
    [InlineData("\"C:\\x\\pwsh.exe\" -c 1")]
    [InlineData("wscript.exe evil.vbs")]
    [InlineData("mshta.exe http://evil")]
    [InlineData("regsvr32.exe /s evil.dll")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("rundll32.exe something")]
    [InlineData("MsiExec.exe /I{not-a-guid}")]
    public void Shells_script_hosts_and_unclear_commands_are_never_run(string command) => Assert.Null(UninstallCommand.Parse(command));

    [Fact]
    public void Environment_variables_in_the_path_are_expanded()
    {
        var parsed = UninstallCommand.Parse("%ProgramFiles%\\Foo\\unins000.exe /S");
        Assert.NotNull(parsed);
        Assert.DoesNotContain('%', parsed.Value.File);
        Assert.EndsWith(@"Foo\unins000.exe", parsed.Value.File);
        Assert.Equal("/S", parsed.Value.Args);
    }
}

public sealed class ProgramActionsTests : IDisposable
{
    readonly CleanupSandbox _s = new();

    public void Dispose() => _s.Dispose();

    void ConfirmApp(string id, string rawId, string state = "confirmed", string type = "app") =>
        _s.SaveCleanup((id, new { type, name = "Foo", state, rawId }));

    void ScanSaw(params (string Id, string Name, string Uninstall)[] programs) =>
        File.WriteAllText(_s.Data.UninstallIndex, JsonSerializer.Serialize(programs.Select(p => new { id = p.Id, name = p.Name, uninstallString = p.Uninstall })));

    string Req(object o) => JsonSerializer.Serialize(o);

    // ------------------------------------------------------------------ uninstall

    [Fact]
    public void Uninstall_starts_only_the_command_the_scan_recorded_for_a_confirmed_program()
    {
        var uninstaller = _s.Write(Path.Combine(_s.Base, "Program Files", "Foo Bar", "unins000.exe"));
        ScanSaw(("reg:HKLM:x64:Foo", "Foo", $"\"{uninstaller}\" /LOG"));
        ConfirmApp("app:foo", "reg:HKLM:x64:Foo");
        var r = JsonDocument.Parse(_s.Context.Launcher == _s.Launcher ? _s.Service.Uninstall(Req(new { id = "app:foo" })) : "{}").RootElement;
        Assert.False(r.GetProperty("dryRun").GetBoolean());
        Assert.Equal("Foo", r.GetProperty("name").GetString());
        var started = Assert.Single(_s.Launcher.Started);
        Assert.Equal((uninstaller, "/LOG"), started);                                // the program's own interactive uninstaller
        Assert.Contains("\"action\":\"uninstall\"", File.ReadAllText(Path.Combine(_s.Data.Dir, "cleanup-log.jsonl")));
    }

    [Fact]
    public void An_msi_modify_entry_becomes_an_uninstall()
    {
        ScanSaw(("reg:HKLM:x64:Blender", "Blender", "MsiExec.exe /I{9F3A1B2C-0000-4000-8000-123456789ABC}"));
        ConfirmApp("app:b", "reg:HKLM:x64:Blender");
        _s.Service.Uninstall(Req(new { id = "app:b" }));
        Assert.Equal(("msiexec.exe", "/x {9F3A1B2C-0000-4000-8000-123456789ABC}"), Assert.Single(_s.Launcher.Started));
    }

    [Fact]
    public void Nothing_is_started_for_unconfirmed_unknown_store_or_dangerous_programs()
    {
        ScanSaw(("reg:HKLM:x64:Evil", "Evil", "cmd.exe /c rd /s /q C:\\"), ("reg:HKLM:x64:Empty", "Empty", ""), ("reg:HKLM:x64:Gone", "Gone", "\"C:\\nowhere\\unins.exe\""));
        _s.SaveCleanup(
            ("app:marked", new { type = "app", name = "x", state = "marked", rawId = "reg:HKLM:x64:Evil" }),
            ("app:evil", new { type = "app", name = "Evil", state = "confirmed", rawId = "reg:HKLM:x64:Evil" }),
            ("app:empty", new { type = "app", name = "Empty", state = "confirmed", rawId = "reg:HKLM:x64:Empty" }),
            ("app:gone", new { type = "app", name = "Gone", state = "confirmed", rawId = "reg:HKLM:x64:Gone" }),
            ("app:store", new { type = "app", name = "Store", state = "confirmed", rawId = "store:Foo_1.0" }),
            ("app:unknown", new { type = "app", name = "Unknown", state = "confirmed", rawId = "reg:HKLM:x64:Unknown" }),
            ("path:x", new { type = "path", name = "x", state = "confirmed", rawId = "" }));
        foreach (var id in new[] { "app:marked", "app:evil", "app:empty", "app:gone", "app:store", "app:unknown", "path:x", "app:missing" })
            Assert.Throws<ArgumentException>(() => _s.Service.Uninstall(Req(new { id })));
        Assert.Empty(_s.Launcher.Started);
    }

    [Fact]
    public void Uninstall_without_scan_data_asks_for_a_scan()
    {
        ConfirmApp("app:foo", "reg:HKLM:x64:Foo");
        var ex = Assert.Throws<ArgumentException>(() => _s.Service.Uninstall(Req(new { id = "app:foo" })));
        Assert.Contains("run a scan", ex.Message);
    }

    [Fact]
    public void The_page_cannot_hand_over_a_command_only_an_id_counts()
    {
        ScanSaw(("reg:HKLM:x64:Foo", "Foo", "\"C:\\nowhere\\unins.exe\""));
        ConfirmApp("app:foo", "reg:HKLM:x64:Foo");
        Assert.Throws<ArgumentException>(() => _s.Service.Uninstall(Req(new { id = "app:foo", command = "cmd.exe /c calc", uninstallString = "calc.exe" })));
        Assert.Empty(_s.Launcher.Started);
    }

    [Fact]
    public void In_a_test_run_uninstall_reports_instead_of_starting()
    {
        Environment.SetEnvironmentVariable("LC_OPEN_DRYRUN", "1");
        try
        {
            ScanSaw(("reg:HKLM:x64:Foo", "Foo", "\"C:\\nowhere\\unins.exe\" /S"));
            ConfirmApp("app:foo", "reg:HKLM:x64:Foo");
            var r = JsonDocument.Parse(_s.Service.Uninstall(Req(new { id = "app:foo" }))).RootElement;
            Assert.True(r.GetProperty("dryRun").GetBoolean());
            Assert.Equal("C:\\nowhere\\unins.exe", r.GetProperty("file").GetString());
            Assert.Equal("/S", r.GetProperty("args").GetString());
            Assert.Empty(_s.Launcher.Started);
        }
        finally
        {
            Environment.SetEnvironmentVariable("LC_OPEN_DRYRUN", null);
        }
    }

    // ------------------------------------------------------------------ winget

    void ScanReported(params string[] ids) =>
        File.WriteAllText(_s.Data.WingetIndex, JsonSerializer.Serialize(ids.Select(i => new { id = i, name = i })));

    [Fact]
    public void Winget_runs_only_ids_the_last_scan_reported_and_builds_the_command_itself()
    {
        ScanReported("7zip.7zip", "Epic.Games+Launcher");
        _s.Service.WingetUpgrade(Req(new { ids = new[] { "7zip.7zip", "Epic.Games+Launcher" } }));
        var (file, args) = Assert.Single(_s.Launcher.Started);
        Assert.Equal("cmd.exe", file);
        Assert.Equal("/k \"winget upgrade --id 7zip.7zip -e --accept-source-agreements --accept-package-agreements & " +
                     "winget upgrade --id Epic.Games+Launcher -e --accept-source-agreements --accept-package-agreements\"", args);
        Assert.Contains("winget-upgrade", File.ReadAllText(Path.Combine(_s.Data.Dir, "cleanup-log.jsonl")));
    }

    [Fact]
    public void Winget_all_upgrades_everything_the_scan_found()
    {
        ScanReported("7zip.7zip");
        _s.Service.WingetUpgrade(Req(new { all = true }));
        Assert.Equal("/k \"winget upgrade --all --accept-source-agreements --accept-package-agreements\"", Assert.Single(_s.Launcher.Started).Args);
    }

    [Theory]
    [InlineData("calc & del *")]
    [InlineData("7zip.7zip & calc")]
    [InlineData("7zip.7zip\"")]
    [InlineData("-bad")]
    [InlineData("a")]
    [InlineData("Not.Reported")]
    [InlineData("")]
    public void Winget_refuses_unknown_and_unsafe_ids(string id)
    {
        ScanReported("7zip.7zip");
        Assert.Throws<ArgumentException>(() => _s.Service.WingetUpgrade(Req(new { ids = new[] { id } })));
        Assert.Empty(_s.Launcher.Started);
    }

    [Fact]
    public void Winget_cannot_be_talked_into_unsafe_ids_even_if_the_scan_index_is_edited()
    {
        ScanReported("7zip.7zip & calc");
        Assert.Throws<ArgumentException>(() => _s.Service.WingetUpgrade(Req(new { ids = new[] { "7zip.7zip & calc" } })));
        Assert.Empty(_s.Launcher.Started);
    }

    [Fact]
    public void Winget_needs_a_selection_a_scan_and_a_sensible_count()
    {
        Assert.Throws<ArgumentException>(() => _s.Service.WingetUpgrade(Req(new { ids = Array.Empty<string>() })));
        Assert.Throws<ArgumentException>(() => _s.Service.WingetUpgrade(Req(new { all = true })));          // no scan data yet
        ScanReported(Enumerable.Range(0, 61).Select(i => "Pkg.Id" + i).ToArray());
        var ex = Assert.Throws<ArgumentException>(() => _s.Service.WingetUpgrade(Req(new { ids = Enumerable.Range(0, 61).Select(i => "Pkg.Id" + i) })));
        Assert.Contains("max 60", ex.Message);
    }

    // ------------------------------------------------------------------ re-check a program

    [Fact]
    public void A_program_is_measured_again_from_the_windows_program_list()
    {
        var folder = Path.Combine(_s.Base, "Apps", "Foo", "bin");
        _s.Write(Path.Combine(folder, "a.bin"), new string('x', 3000));
        _s.Registry.Add(RegHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", FakeKey.With(subs: new Dictionary<string, FakeKey>
        {
            ["Foo"] = FakeKey.With(new Dictionary<string, object?> { ["InstallLocation"] = folder, ["EstimatedSize"] = 62_000_000, ["DisplayVersion"] = "1.2" }),
        }), RegView.Registry64);
        var r = JsonDocument.Parse(_s.Service.CheckApp(Req(new { id = "reg:HKLM:x64:Foo" }))).RootElement;
        Assert.Equal(62_000_000, r.GetProperty("registryEstimatedSizeKB").GetInt64());
        Assert.Equal("1.2", r.GetProperty("displayVersion").GetString());
        Assert.True(r.GetProperty("measurable").GetBoolean());
        Assert.Equal(3000, r.GetProperty("folderBytes").GetInt64());
        Assert.False(r.GetProperty("folderPartial").GetBoolean());
    }

    [Fact]
    public void A_program_in_a_system_folder_is_not_measured()
    {
        _s.Registry.Add(RegHive.CurrentUser, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", FakeKey.With(subs: new Dictionary<string, FakeKey>
        {
            ["Bar"] = FakeKey.With(new Dictionary<string, object?> { ["InstallLocation"] = @"C:\Windows" }),
        }), RegView.Registry64);
        var r = JsonDocument.Parse(_s.Service.CheckApp(Req(new { id = "reg:HKCU:x64:Bar" }))).RootElement;
        Assert.False(r.GetProperty("measurable").GetBoolean());
        Assert.Equal(JsonValueKind.Null, r.GetProperty("folderBytes").ValueKind);
    }

    [Theory]
    [InlineData("store:Foo_1.0")]
    [InlineData("app:foo")]
    [InlineData("reg:HKXX:x64:Foo")]
    [InlineData("")]
    public void Only_programs_from_the_program_list_can_be_re_measured(string id) =>
        Assert.Throws<ArgumentException>(() => _s.Service.CheckApp(Req(new { id })));

    [Fact]
    public void A_program_that_vanished_from_the_list_is_reported()
    {
        _s.Registry.Add(RegHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", FakeKey.With(), RegView.Registry64);
        var ex = Assert.Throws<ArgumentException>(() => _s.Service.CheckApp(Req(new { id = "reg:HKLM:x64:Gone" })));
        Assert.Contains("no longer", ex.Message);
    }

    // ------------------------------------------------------------------ show in Explorer

    [Fact]
    public void Explorer_is_asked_to_select_never_to_run()
    {
        var f = _s.Write(Path.Combine(_s.Home, "Downloads", "setup.exe"));
        _s.Service.Reveal(Req(new { path = f }));
        Assert.Equal(("explorer.exe", $"/select,\"{f}\""), Assert.Single(_s.Launcher.Started));
    }

    [Fact]
    public void Cloud_folders_can_be_shown_too()
    {
        var f = _s.Write(Path.Combine(_s.Cloud, "x.pdf"));
        _s.Service.Reveal(Req(new { path = f }));
        Assert.Single(_s.Launcher.Started);
    }

    [Theory]
    [InlineData("outside")]
    [InlineData("traversal")]
    [InlineData("missing")]
    [InlineData("empty")]
    public void Places_that_cannot_be_shown_are_refused(string what)
    {
        _s.Write(Path.Combine(_s.Base, "outside", "secret.txt"));
        var path = what switch
        {
            "outside" => Path.Combine(_s.Base, "outside", "secret.txt"),
            "traversal" => Path.Combine(_s.Home, "Downloads", "..", "..", "outside", "secret.txt"),
            "missing" => Path.Combine(_s.Home, "nope.txt"),
            _ => "",
        };
        Assert.Throws<ArgumentException>(() => _s.Service.Reveal(Req(new { path })));
        Assert.Empty(_s.Launcher.Started);
    }
}
