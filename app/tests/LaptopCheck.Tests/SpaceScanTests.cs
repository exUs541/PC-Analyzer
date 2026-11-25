using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using LaptopCheck.Core;
using LaptopCheck.Scan.Space;

namespace LaptopCheck.Tests;

/// <summary>The storage analysis on a real temporary folder tree.</summary>
public sealed class SpaceScanTests : IDisposable
{
    const int Kb = 1024;
    readonly string _root = Path.Combine(Path.GetTempPath(), "lc-space-" + Guid.NewGuid().ToString("N"));
    static readonly DateTime Now = new(2026, 11, 12, 10, 0, 0);

    public SpaceScanTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    string NewFile(string rel, int size)
    {
        var p = Path.Combine(_root, rel);
        Directory.CreateDirectory(Path.GetDirectoryName(p)!);
        File.WriteAllBytes(p, new byte[size]);
        return p;
    }

    static SpaceScanOptions Small(int maxDepth = 4, int budget = 60) => new(MaxDepth: maxDepth, MinBytes: 100 * Kb, MaxEntries: 50, BudgetSeconds: budget);

    static Dictionary<string, long> Entries(JsonObject r, string root) =>
        r["entries"]!.AsArray().ToDictionary(e => Path.GetRelativePath(root, e!["path"]!.GetValue<string>()), e => e!["bytes"]!.GetValue<long>());

    [Fact]
    public void Adds_up_every_level_and_lists_only_big_folders()
    {
        NewFile(@"Games\Big\a.bin", 300 * Kb);
        NewFile(@"Games\Big\sub\b.bin", 200 * Kb);
        NewFile(@"Games\Small\c.bin", 10 * Kb);
        NewFile(@"Docs\d.txt", 50 * Kb);
        NewFile("pagefile.sys", 400 * Kb);

        var r = SpaceScan.Run(_root, Small(), () => Now);
        var e = Entries(r, _root);

        Assert.Equal(510L * Kb, e["Games"]);
        Assert.Equal(500L * Kb, e[@"Games\Big"]);
        Assert.Equal(200L * Kb, e[@"Games\Big\sub"]);
        Assert.DoesNotContain(@"Games\Small", e.Keys);     // 10 KB: too small to list
        Assert.DoesNotContain("Docs", e.Keys);             // 50 KB
        Assert.Equal(960L * Kb, r["scannedBytes"]!.GetValue<long>());   // including the loose root file
        Assert.False(r["partial"]!.GetValue<bool>());
        Assert.Equal("2026-11-12T10:00:00", r["scannedAt"]!.GetValue<string>());

        var files = r["files"]!.AsArray();
        Assert.Single(files);
        Assert.EndsWith("pagefile.sys", files[0]!["path"]!.GetValue<string>());
        Assert.Equal(400L * Kb, files[0]!["bytes"]!.GetValue<long>());
    }

    [Fact]
    public void Deep_folders_stay_out_of_the_list_but_inside_the_sums()
    {
        NewFile(@"A\B\C\D\E\x.bin", 300 * Kb);

        var e = Entries(SpaceScan.Run(_root, Small(maxDepth: 2), () => Now), _root);

        Assert.Equal(300L * Kb, e["A"]);
        Assert.Equal(300L * Kb, e[@"A\B"]);
        Assert.DoesNotContain(@"A\B\C", e.Keys);
    }

    [Fact]
    public void A_parent_is_never_smaller_than_its_children()
    {
        NewFile(@"P\one\a.bin", 150 * Kb);
        NewFile(@"P\two\b.bin", 150 * Kb);
        NewFile(@"P\loose.bin", 20 * Kb);

        var e = Entries(SpaceScan.Run(_root, Small(), () => Now), _root);

        Assert.True(e["P"] >= e[@"P\one"] + e[@"P\two"]);
        Assert.Equal(320L * Kb, e["P"]);
    }

    [Fact]
    public void The_most_entries_are_the_biggest_ones()
    {
        for (var i = 1; i <= 6; i++) NewFile($@"F{i}\x.bin", (100 + i * 10) * Kb);

        var r = SpaceScan.Run(_root, new SpaceScanOptions(MaxDepth: 4, MinBytes: 100 * Kb, MaxEntries: 3, BudgetSeconds: 60), () => Now);
        var e = Entries(r, _root);

        Assert.Equal(3, e.Count);
        Assert.Contains("F6", e.Keys);
        Assert.DoesNotContain("F1", e.Keys);
    }

    [Fact]
    public void It_stops_at_the_time_budget_and_says_so()
    {
        NewFile(@"A\x.bin", 300 * Kb);

        var r = SpaceScan.Run(_root, Small(budget: -1), () => Now);

        Assert.True(r["partial"]!.GetValue<bool>());
    }

    [Fact]
    public void A_cancelled_scan_throws_instead_of_reporting_nonsense()
    {
        NewFile(@"A\x.bin", 300 * Kb);
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        Assert.ThrowsAny<OperationCanceledException>(() => SpaceScan.Run(_root, Small(), () => Now, cts.Token));
    }

    [Fact]
    public void Cloud_placeholders_take_no_space()
    {
        NewFile(@"Drive\local.bin", 200 * Kb);
        var online = NewFile(@"Drive\online-only.bin", 400 * Kb);
        File.SetAttributes(online, File.GetAttributes(online) | FileAttributes.Offline);

        var e = Entries(SpaceScan.Run(_root, Small(), () => Now), _root);

        Assert.Equal(200L * Kb, e["Drive"]);
    }

    [Fact]
    public void Junctions_are_not_followed_so_nothing_is_counted_twice()
    {
        NewFile(@"Real\x.bin", 300 * Kb);
        var link = Path.Combine(_root, "Link");
        var psi = new ProcessStartInfo("cmd.exe", $"/c mklink /J \"{link}\" \"{Path.Combine(_root, "Real")}\"") { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true };
        using (var p = Process.Start(psi)!) { p.WaitForExit(); }
        Assert.True(Directory.Exists(link), "the test needs mklink /J");

        var r = SpaceScan.Run(_root, Small(), () => Now);
        var e = Entries(r, _root);

        Assert.Equal(300L * Kb, e["Real"]);
        Assert.DoesNotContain("Link", e.Keys);
        Assert.Equal(300L * Kb, r["scannedBytes"]!.GetValue<long>());
    }

    [Fact]
    public void The_drive_numbers_come_from_the_drive_itself()
    {
        NewFile(@"A\x.bin", 300 * Kb);

        var r = SpaceScan.Run(_root, Small(), () => Now);

        Assert.True(r["totalBytes"]!.GetValue<long>() > r["freeBytes"]!.GetValue<long>());
        Assert.True(r["freeBytes"]!.GetValue<long>() > 0);
    }

    [Fact]
    public async Task The_service_stores_space_json_in_the_data_folder()
    {
        NewFile(@"A\x.bin", 300 * Kb);
        var data = new DataPaths(Path.Combine(_root, "..", "lc-space-data-" + Guid.NewGuid().ToString("N")));
        try
        {
            await new SpaceScanService(data, () => _root, Small(), () => Now).RunAsync();

            using var doc = JsonDocument.Parse(File.ReadAllText(data.Space));
            Assert.Equal(1, doc.RootElement.GetProperty("schema").GetInt32());
            Assert.Equal(1, doc.RootElement.GetProperty("entries").GetArrayLength());
        }
        finally
        {
            try { Directory.Delete(data.Dir, true); } catch (IOException) { }
        }
    }
}
