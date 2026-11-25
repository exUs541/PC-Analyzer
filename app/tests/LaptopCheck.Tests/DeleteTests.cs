using System.Diagnostics;
using System.Text.Json.Nodes;
using LaptopCheck.Core;

namespace LaptopCheck.Tests;

/// <summary>The scenario of tests/remove.test.ps1 plus the rules at job creation: only confirmed items, only the user's places, nothing in a cloud folder.</summary>
public sealed class DeleteTests : IDisposable
{
    readonly CleanupSandbox _s = new();

    public DeleteTests()
    {
        _s.Write(Path.Combine(_s.Env.AppData, "Blender Foundation", "Blender", "userpref.blend"), "prefs");
        _s.Write(Path.Combine(_s.Env.AppData, "Blender Foundation", "Blender", "cache", "a.bin"), "cache");
        _s.Write(Path.Combine(_s.Env.LocalAppData, "Microsoft", "Edge", "data.bin"), "edge");
        _s.Write(Path.Combine(_s.Home, "Downloads", "setup.exe"), "installer");
        _s.Write(Path.Combine(_s.Home, "Downloads", "old", "a.zip"), "zip");
        _s.Write(Path.Combine(_s.Home, "dev", "app", "readme.md"), "repo");
        Directory.CreateDirectory(Path.Combine(_s.Home, "dev", "app", ".git"));
        _s.Write(Path.Combine(_s.Home, "dev", "repo-below", "x", "y", "readme.md"), "repo");
        Directory.CreateDirectory(Path.Combine(_s.Home, "dev", "repo-below", "x", "y", ".git"));
        _s.Write(Path.Combine(_s.Home, "Google Drive", "dup.pdf"), "cloud copy");
        _s.WriteConfig(new { extraCloudRoots = new[] { Path.Combine(_s.Home, "Google Drive") } });
        _s.Write(Path.Combine(_s.Base, "outside", "secret.txt"), "not mine");
        _s.Write(Path.Combine(_s.Home, "Documents", "fresh", "new.txt"), "x");
    }

    public void Dispose() => _s.Dispose();

    string P(params string[] parts) => Path.Combine([_s.Home, .. parts]);

    /// <summary>Saves the items as confirmed (as the dashboard would), starts the job and waits for it.</summary>
    async Task<JsonNode> Remove(bool confirm, params (string Path, string Kind)[] items) => await RemoveAt(confirm, null, items);

    async Task<JsonNode> RemoveAt(bool confirm, long? confirmedMs, params (string Path, string Kind)[] items)
    {
        var ids = items.Select((_, i) => "path:" + i).ToArray();
        _s.SaveCleanup(items.Select((it, i) => (ids[i], _s.PathItem(it.Path, it.Kind, "confirmed", confirmedMs))).ToArray());
        _s.Confirmation.Answer = confirm;
        var started = _s.Json(await _s.Service.StartDeleteAsync(System.Text.Json.JsonSerializer.Serialize(new { ids })));
        var id = (string)started["id"]!;
        await _s.Service.WaitForJobAsync(id);
        return _s.Json(_s.Service.DeleteStatus(id))["result"]!;
    }

    // ------------------------------------------------------------------ refused items

    public static IEnumerable<object[]> Refused() =>
    [
        ["user profile itself", "", "dir", "standard folder"],
        ["AppData itself", "AppData", "dir", "standard folder"],
        ["AppData\\Local\\Microsoft", @"AppData\Local\Microsoft\Edge", "dir", "protected place"],
        ["Downloads root", "Downloads", "dir", "standard folder"],
        ["git repository", @"dev\app", "dir", "Git repository"],
        ["folder containing a repository deeper down", @"dev\repo-below", "dir", "Git repository"],
        ["kind mismatch", @"Downloads\setup.exe", "dir", "expected a folder"],
    ];

    [Theory]
    [MemberData(nameof(Refused))]
    public async Task Dangerous_or_unexpected_items_are_refused_and_nothing_is_removed(string what, string rel, string kind, string reason)
    {
        var path = rel.Length == 0 ? _s.Home : Path.Combine(_s.Home, rel);
        var result = await Remove(true, (path, kind));
        Assert.Empty(result["removed"]!.AsArray());
        var skipped = Assert.Single(result["skipped"]!.AsArray())!;
        Assert.Contains(reason, (string)skipped["reason"]!);
        Assert.Empty(_s.Confirmation.Requests);                                      // nothing to remove: nobody is asked
        Assert.Empty(_s.Recycle.Recycled);
        Assert.True(Directory.Exists(path) || File.Exists(path), what);
    }

    async Task StartWith(string path, string kind)
    {
        _s.SaveCleanup(("path:0", _s.PathItem(path, kind)));
        await _s.Service.StartDeleteAsync("""{"ids":["path:0"]}""");
    }

    [Fact]
    public async Task A_cloud_folder_is_never_touched_a_delete_there_would_remove_the_cloud_copy()
    {
        var cloudFile = P("Google Drive", "dup.pdf");
        var ex = await Assert.ThrowsAsync<ArgumentException>(() => StartWith(cloudFile, "file"));
        Assert.Contains("cloud", ex.Message);
        Assert.True(File.Exists(cloudFile));
    }

    [Fact]
    public async Task Path_traversal_is_refused_at_the_door()
    {
        var sneaky = P("Downloads", "..", "..", "outside", "secret.txt");
        await Assert.ThrowsAsync<ArgumentException>(() => StartWith(sneaky, "file"));
        Assert.True(File.Exists(Path.Combine(_s.Base, "outside", "secret.txt")));
    }

    [Fact]
    public async Task A_link_is_refused_and_its_target_stays_untouched()
    {
        var target = Path.Combine(_s.Home, "Documents", "target-folder");
        _s.Write(Path.Combine(target, "keep.txt"), "keep");
        var link = P("Downloads", "link");
        var mk = Process.Start(new ProcessStartInfo("cmd.exe", $"/c mklink /J \"{link}\" \"{target}\"") { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true })!;
        mk.WaitForExit();
        if (mk.ExitCode != 0) return;                                                // a junction could not be made on this PC
        var result = await Remove(true, (link, "dir"));
        Assert.Empty(result["removed"]!.AsArray());
        Assert.Equal("link / junction", (string)result["skipped"]![0]!["reason"]!);
        Assert.True(File.Exists(Path.Combine(target, "keep.txt")));
        Directory.Delete(link);                                                      // removes the junction only
    }

    // ------------------------------------------------------------------ confirmation

    [Fact]
    public async Task Without_the_typed_confirmation_nothing_is_removed()
    {
        var result = await Remove(false, (P("Downloads", "setup.exe"), "file"));
        Assert.True(File.Exists(P("Downloads", "setup.exe")));
        Assert.Empty(result["removed"]!.AsArray());
        Assert.True((bool)result["cancelled"]!);
        var request = Assert.Single(_s.Confirmation.Requests);
        Assert.Equal("ENTFERNEN", request.RequiredWord);
        Assert.Null(request.CheckboxText);
        Assert.Contains(request.Lines, l => l.Contains("setup.exe"));
        Assert.Contains("PAPIERKORB", request.Heading);
    }

    [Fact]
    public async Task Items_changed_after_the_confirmation_are_kept()
    {
        var result = await RemoveAt(true, SandboxConfirmed(TimeSpan.FromHours(-1)), (P("Documents", "fresh"), "dir"));
        Assert.True(File.Exists(P("Documents", "fresh", "new.txt")));
        Assert.Matches("changed after", (string)result["skipped"]![0]!["reason"]!);
    }

    static long SandboxConfirmed(TimeSpan fromNow) => CleanupSandbox.ConfirmedIn(fromNow);

    [Fact]
    public async Task An_item_that_changes_while_the_window_is_open_is_kept()
    {
        _s.Confirmation.DuringConfirm = () => File.WriteAllText(P("Downloads", "setup.exe"), "changed while the window was open and now newer than the confirmation");
        var result = await RemoveAt(true, SandboxConfirmed(TimeSpan.FromSeconds(-30)), (P("Downloads", "setup.exe"), "file"));
        // the file was older than the confirmation when the plan was made, but is newer when it would be removed
        Assert.True(File.Exists(P("Downloads", "setup.exe")));
        Assert.Empty(result["removed"]!.AsArray());
        Assert.Matches("changed after", (string)result["skipped"]![0]!["reason"]!);
    }

    // ------------------------------------------------------------------ the normal case

    [Fact]
    public async Task Confirmed_items_go_to_the_recycle_bin_and_everything_else_stays()
    {
        var result = await Remove(true,
            (P("Downloads", "setup.exe"), "file"),
            (Path.Combine(_s.Env.AppData, "Blender Foundation"), "dir"),
            (P("Downloads", "old"), "dir"),
            (P("Downloads", "never-existed.zip"), "file"));

        Assert.Equal("done", (string)result["state"]!);
        Assert.Equal(3, result["removed"]!.AsArray().Count);
        Assert.False(File.Exists(P("Downloads", "setup.exe")));
        Assert.False(Directory.Exists(Path.Combine(_s.Env.AppData, "Blender Foundation")));
        Assert.True(File.Exists(Path.Combine(_s.Env.LocalAppData, "Microsoft", "Edge", "data.bin")));    // protected folder untouched
        Assert.Equal(3, Directory.GetFileSystemEntries(_s.Trash).Length);
        Assert.Equal(9 + 5 + 5 + 3, (long)result["removedBytes"]!);                                       // prefs + cache + installer + zip
        Assert.Single(result["skipped"]!.AsArray(), s => (string)s!["reason"]! == "already gone");
        Assert.Empty(result["failed"]!.AsArray());
    }

    [Fact]
    public async Task A_failure_of_one_item_does_not_stop_the_others_and_is_reported()
    {
        _s.Recycle.Fail = p => p.EndsWith("setup.exe");
        var result = await Remove(true, (P("Downloads", "setup.exe"), "file"), (P("Downloads", "old"), "dir"));
        Assert.Single(result["removed"]!.AsArray());
        var failed = Assert.Single(result["failed"]!.AsArray())!;
        Assert.EndsWith("setup.exe", (string)failed["path"]!);
        Assert.Contains("Papierkorb", (string)failed["error"]!);
        Assert.True(File.Exists(P("Downloads", "setup.exe")));
    }

    [Fact]
    public async Task Everything_is_recorded_in_the_clean_up_log()
    {
        await Remove(true, (P("Downloads", "setup.exe"), "file"));
        var log = File.ReadAllText(Path.Combine(_s.Data.Dir, "cleanup-log.jsonl"));
        Assert.Contains("\"action\":\"delete-job\"", log);
        Assert.Contains("setup.exe", log);
    }

    // ------------------------------------------------------------------ what the server accepts at all

    [Fact]
    public async Task Only_confirmed_path_items_are_accepted()
    {
        var file = P("Downloads", "setup.exe");
        _s.SaveCleanup(
            ("marked", _s.PathItem(file, "file", "marked")),
            ("app", new { type = "app", name = "Foo", state = "confirmed", rawId = "reg:HKLM:x64:Foo" }),
            ("nokind", new { type = "path", kind = "weird", name = "x", path = file, state = "confirmed", confirmedMs = CleanupSandbox.ConfirmedIn(TimeSpan.FromMinutes(1)) }),
            ("notime", new { type = "path", kind = "file", name = "x", path = file, state = "confirmed" }));
        foreach (var id in new[] { "marked", "app", "nokind", "notime", "missing" })
            await Assert.ThrowsAsync<ArgumentException>(() => _s.Service.StartDeleteAsync($"{{\"ids\":[\"{id}\"]}}"));
        await Assert.ThrowsAsync<ArgumentException>(() => _s.Service.StartDeleteAsync("""{"ids":[]}"""));
        Assert.True(File.Exists(file));
        Assert.False(Directory.Exists(Path.Combine(_s.Data.Dir, "deletes")));
    }

    [Fact]
    public async Task At_most_100_items_at_once()
    {
        var ids = string.Join(",", Enumerable.Range(0, 101).Select(i => $"\"p{i}\""));
        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _s.Service.StartDeleteAsync($"{{\"ids\":[{ids}]}}"));
        Assert.Contains("max 100", ex.Message);
    }

    [Fact]
    public async Task Items_outside_the_users_places_are_refused_at_the_door()
    {
        var ex = await Assert.ThrowsAsync<ArgumentException>(() => StartWith(Path.Combine(_s.Base, "outside", "secret.txt"), "file"));
        Assert.Contains("Not inside your user folder", ex.Message);
    }

    [Fact]
    public async Task Configured_extra_folders_are_allowed()
    {
        var extra = Path.Combine(_s.Base, "d-drive", "cache");
        _s.Write(Path.Combine(extra, "x.tmp"), "tmp");
        _s.WriteConfig(new { extraRoots = new[] { Path.Combine(_s.Base, "d-drive") }, extraCloudRoots = Array.Empty<string>() });
        var result = await Remove(true, (extra, "dir"));
        Assert.Single(result["removed"]!.AsArray());
    }

    [Fact]
    public void Status_of_an_unknown_job_is_an_error()
    {
        Assert.Throws<ArgumentException>(() => _s.Service.DeleteStatus("20260101-000000-abcd"));
        Assert.Throws<ArgumentException>(() => _s.Service.DeleteStatus("..\\x"));
    }
}
