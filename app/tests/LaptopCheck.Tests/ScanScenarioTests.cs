using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using LaptopCheck.Core;
using LaptopCheck.Scan;

namespace LaptopCheck.Tests;

public class ScanScenarioTests : IDisposable
{
    readonly MockPc _pc = new();

    public void Dispose() => _pc.Dispose();

    static string S(JsonNode? n) => n?.ToString() ?? "<null>";

    [Fact]
    public async Task Full_scan_has_every_section_and_no_warnings()
    {
        var areas = new List<string>();
        var snap = await LaptopScanner.RunAsync(_pc.Context(admin: true, progress: a => { lock (areas) areas.Add(a); }));

        Assert.True(areas.Count >= 15, "progress is reported per section: " + string.Join(",", areas));
        Assert.Empty((JsonArray)snap["warnings"]!);
        Assert.Equal(1, (int)snap["schema"]!);
        Assert.True((bool)snap["collector"]!["isAdmin"]!);
        Assert.Equal("native", S(snap["collector"]!["engine"]));
        Assert.Null(snap["updates"]);                                       // no winget in the mock: "not checked", not "0 updates"
        Assert.Equal("On", S(snap["security"]!["bitlocker"]![0]!["protection"]));
        Assert.True(((JsonArray)snap["software"]!).Count >= 5);
        Assert.True(((JsonArray)snap["usage"]!).Count >= 5);
        Assert.Equal("2026-10-20T10:00:00", S(snap["collectedAt"]));
    }

    [Fact]
    public async Task Quick_scan_skips_folders_sizes_and_updates()
    {
        _pc.Processes.WingetPath = @"C:\winget.exe";
        var snap = await LaptopScanner.RunAsync(_pc.Context(options: new ScanOptions(Quick: true)));
        Assert.Empty((JsonArray)snap["folders"]!);
        Assert.Null(snap["updates"]);
        Assert.DoesNotContain("winget.exe", string.Join('|', _pc.Processes.Calls));
        Assert.True((bool)snap["collector"]!["options"]!["quick"]!);
    }

    [Fact]
    public async Task Json_has_iso_dates_and_real_numbers()
    {
        var snap = await LaptopScanner.RunAsync(_pc.Context());
        var json = snap.ToJsonString();
        Assert.Matches("\"collectedAt\":\"\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\"", json);
        Assert.DoesNotContain("\\/Date(", json);
        Assert.Equal(JsonValueKind.Number, JsonDocument.Parse(json).RootElement.GetProperty("memory").GetProperty("visibleBytes").ValueKind);
    }

    [Fact]
    public async Task Scan_service_stores_snapshot_previous_snapshot_and_indexes()
    {
        var dataDir = Path.Combine(_pc.Root, "data");
        var data = new DataPaths(dataDir);
        var service = new ScanService(data, new ScanOptions(NoWinget: true, SkipSizes: true), (_, _) => _pc.Context());

        await service.RunAsync(quick: false);
        Assert.True(File.Exists(data.Snapshot));
        Assert.False(File.Exists(data.SnapshotPrev));
        var first = File.ReadAllText(data.Snapshot);

        await service.RunAsync(quick: false);
        Assert.Equal(first, File.ReadAllText(data.SnapshotPrev));

        var uninstall = JsonDocument.Parse(File.ReadAllText(data.UninstallIndex)).RootElement;
        Assert.Equal(JsonValueKind.Array, uninstall.ValueKind);
        var chrome = uninstall.EnumerateArray().Single();                    // only programs with an uninstall command are indexed
        Assert.Equal("Google Chrome", chrome.GetProperty("name").GetString());
        Assert.Equal("reg:HKLM:x64:Google Chrome", chrome.GetProperty("id").GetString());
        Assert.Contains("--uninstall", chrome.GetProperty("uninstallString").GetString());
        Assert.Equal("[]", File.ReadAllText(data.WingetIndex));              // winget was not asked
    }

    [Fact]
    public async Task Winget_updates_end_up_in_the_index()
    {
        _pc.Processes.WingetPath = @"C:\winget.exe";
        _pc.Processes.WingetOutput = "Name   Id       Version  Available  Source\n----------------------------------------------\nFoo    Foo.Bar  1.0      2.0        winget\n";
        var data = new DataPaths(Path.Combine(_pc.Root, "data2"));
        var service = new ScanService(data, new ScanOptions(SkipSizes: true), (o, p) => _pc.Context(options: o, progress: p));
        await service.RunAsync(quick: false);
        var index = JsonDocument.Parse(File.ReadAllText(data.WingetIndex)).RootElement.EnumerateArray().Single();
        Assert.Equal("Foo.Bar", index.GetProperty("id").GetString());
    }

    [Fact]
    public async Task Scans_run_one_at_a_time()
    {
        var data = new DataPaths(Path.Combine(_pc.Root, "data3"));
        var running = 0;
        var maxRunning = 0;
        var service = new ScanService(data, new ScanOptions(NoWinget: true, SkipSizes: true), (_, _) =>
        {
            var ctx = _pc.Context(progress: _ =>
            {
                var now = Interlocked.Increment(ref running);
                int seen;
                while (now > (seen = Volatile.Read(ref maxRunning))) Interlocked.CompareExchange(ref maxRunning, now, seen);
                Thread.Sleep(1);
                Interlocked.Decrement(ref running);
            });
            return ctx;
        });
        await Task.WhenAll(service.RunAsync(false), service.RunAsync(false), service.RunAsync(true));
        Assert.True(File.Exists(data.Snapshot));
    }

    /// <summary>
    /// The contract test of the dashboard (tests/contract.test.js) feeds this output into the real analysis code:
    /// every fact of the pretend laptop must survive scan -> JSON -> dashboard.
    /// </summary>
    [Fact]
    public async Task Dashboard_understands_the_scan_output()
    {
        var node = FindNode();
        if (node is null) return;                                           // the dashboard tests need Node.js
        var repo = RepoRoot();
        var snap = await LaptopScanner.RunAsync(_pc.Context(admin: true));
        var file = Path.Combine(_pc.Root, "collector.json");
        File.WriteAllText(file, snap.ToJsonString());

        var psi = new ProcessStartInfo(node, ["--test", Path.Combine(repo, "tests", "contract.test.js")])
        {
            WorkingDirectory = repo, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false,
        };
        psi.Environment["COLLECTOR_JSON"] = file;
        using var p = Process.Start(psi)!;
        var stdout = p.StandardOutput.ReadToEndAsync();
        var stderr = p.StandardError.ReadToEndAsync();
        Assert.True(p.WaitForExit(120_000), "node did not finish");
        var output = await stdout;
        Assert.True(p.ExitCode == 0, output + await stderr);
        Assert.Matches(@"# pass [1-9]", output);                            // the contract tests really ran
    }

    static string? FindNode()
    {
        var exe = OperatingSystem.IsWindows() ? "node.exe" : "node";
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var full = Path.Combine(dir.Trim('"'), exe);
            if (File.Exists(full)) return full;
        }
        return null;
    }

    static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "web", "index.html"))) dir = dir.Parent;
        return dir?.FullName ?? throw new DirectoryNotFoundException("repository root with web/ not found");
    }
}
