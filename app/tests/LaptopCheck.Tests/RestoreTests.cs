using System.Text.Json.Nodes;
using LaptopCheck.Cleanup;
using LaptopCheck.Core;
using LaptopCheck.Scan;

namespace LaptopCheck.Tests;

/// <summary>Copying what only the old local Drive folder has into the live drive: same path, nothing overwritten, every copy verified, the page sends no path.</summary>
public sealed class RestoreTests : IDisposable
{
    readonly string _base = Path.Combine(Path.GetTempPath(), "lc-restore-" + Guid.NewGuid().ToString("N"));
    string Home => Path.Combine(_base, "home");
    string Old => Path.Combine(Home, "My Drive");
    string VirtualDrive => Path.Combine(_base, "G");
    string Live => Path.Combine(VirtualDrive, "Meine Ablage");

    public void Dispose()
    {
        try { Directory.Delete(_base, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    static void Put(string root, string rel, string text)
    {
        var p = Path.Combine(root, rel);
        Directory.CreateDirectory(Path.GetDirectoryName(p)!);
        File.WriteAllText(p, text);
    }

    /// <summary>A PC where Drive streams to G: and a leftover mirror lies in the profile (one account).</summary>
    CleanupService Service(out CleanupContext ctx, bool leftover = true)
    {
        Environment.SetEnvironmentVariable("LC_OPEN_DRYRUN", null);
        var env = new ScanEnvironment
        {
            UserProfile = Home, AppData = Path.Combine(Home, "AppData", "Roaming"), LocalAppData = Path.Combine(Home, "AppData", "Local"),
            ProgramData = Path.Combine(_base, "ProgramData"), SystemRoot = Path.Combine(_base, "Windows"), SystemDrive = _base,
            ProgramFiles = Path.Combine(_base, "Program Files"), ProgramFilesX86 = Path.Combine(_base, "Program Files (x86)"),
        };
        Directory.CreateDirectory(Path.Combine(env.LocalAppData, "Google", "DriveFS", "100000000000000000"));
        Directory.CreateDirectory(Live);
        if (leftover) Directory.CreateDirectory(Old);
        var probe = new FakeProbe();
        probe.DriveList.Add(new DriveEntry(VirtualDrive, "Google Drive"));
        ctx = new CleanupContext
        {
            Data = new DataPaths(Path.Combine(_base, "data")), Env = env, Probe = probe, Registry = new FakeRegistry(), Recycle = new FolderRecycle(Path.Combine(_base, "trash")),
            Launcher = new RecordingLauncher(), Confirmation = new ScriptedConfirmation(),
        };
        return new CleanupService(ctx);
    }

    static async Task<JsonNode> Finish(CleanupService s, string startJson)
    {
        var id = (string)JsonNode.Parse(startJson)!["id"]!;
        await s.WaitForJobAsync(id);
        return JsonNode.Parse(s.RestoreStatus(id))!["result"]!;
    }

    [Fact]
    public async Task Missing_files_are_copied_to_the_same_path_and_verified_and_the_old_folder_is_untouched()
    {
        var s = Service(out var ctx);
        Put(Old, @"30_Personal\cv.pdf", "identical"); Put(Live, @"30_Personal\cv.pdf", "identical");
        Put(Old, @"99_Other\Urlaub\foto.jpg", "only in the old folder");
        Put(Old, @"20_Family\Ausweis\pass.pdf", "very important");
        Put(Old, "desktop.ini", "junk"); Put(Old, "Reise.gdoc", "stub");

        var r = await Finish(s, await s.StartRestoreAsync("{}"));

        Assert.Equal("done", (string)r["state"]!);
        Assert.Equal(2, (int)r["copied"]!);
        Assert.Equal(0, (int)r["failed"]!);
        Assert.Equal("only in the old folder", File.ReadAllText(Path.Combine(Live, @"99_Other\Urlaub\foto.jpg")));
        Assert.Equal("very important", File.ReadAllText(Path.Combine(Live, @"20_Family\Ausweis\pass.pdf")));
        Assert.False(File.Exists(Path.Combine(Live, "desktop.ini")));      // junk is not content
        Assert.False(File.Exists(Path.Combine(Live, "Reise.gdoc")));
        Assert.Equal(5, Directory.EnumerateFiles(Old, "*", SearchOption.AllDirectories).Count());   // the old folder is never changed
        Assert.True(File.Exists(Path.Combine(ctx.RestoresDir, (string)JsonNode.Parse(await s.StartRestoreAsync("{}"))!["id"]!, "manifest.json")));
    }

    [Fact]
    public async Task A_second_run_copies_nothing_more_and_a_changed_file_in_the_drive_is_never_overwritten()
    {
        var s = Service(out _);
        Put(Old, @"a\new.txt", "new in old folder");
        Put(Old, @"a\notes.txt", "old version");           // same path, other size in the drive
        Put(Live, @"a\notes.txt", "the newer and longer version in the drive");

        var first = await Finish(s, await s.StartRestoreAsync("{}"));
        Assert.Equal(1, (int)first["copied"]!);
        Assert.Equal(1, (int)first["existing"]!);          // left alone, counted
        Assert.Equal("the newer and longer version in the drive", File.ReadAllText(Path.Combine(Live, @"a\notes.txt")));

        var second = await Finish(s, await s.StartRestoreAsync("{}"));
        Assert.Equal(0, (int)second["copied"]!);
        Assert.Equal(1, (int)second["existing"]!);
        Assert.Equal("new in old folder", File.ReadAllText(Path.Combine(Live, @"a\new.txt")));
    }

    [Fact]
    public async Task Without_an_old_folder_or_without_a_live_drive_nothing_starts()
    {
        var none = Service(out _, leftover: false);
        await Assert.ThrowsAsync<ArgumentException>(() => none.StartRestoreAsync("{}"));
        Assert.False(Directory.Exists(Path.Combine(_base, "data", "restores")) && Directory.EnumerateDirectories(Path.Combine(_base, "data", "restores")).Any());
    }

    [Fact]
    public async Task The_page_cannot_steer_the_job_with_paths()
    {
        var s = Service(out _);
        Put(Old, "x.txt", "x");
        var outside = Path.Combine(_base, "elsewhere");
        // whatever the page sends is ignored: the folders come from the provider detection
        var r = await Finish(s, await s.StartRestoreAsync("{\"liveRoot\":\"" + outside.Replace("\\", "\\\\") + "\",\"oldRoot\":\"C:\\\\Windows\"}"));
        Assert.Equal("done", (string)r["state"]!);
        Assert.False(Directory.Exists(outside));
        Assert.True(File.Exists(Path.Combine(Live, "x.txt")));
    }

    [Fact]
    public void Status_of_an_unknown_or_malformed_job_is_refused()
    {
        var s = Service(out _);
        Assert.Throws<ArgumentException>(() => s.RestoreStatus("../../etc"));
        Assert.Throws<ArgumentException>(() => s.RestoreStatus("20260101-000000-abcd"));
    }
}
