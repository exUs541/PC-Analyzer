using System.Text.Json.Nodes;
using LaptopCheck.Core;
using LaptopCheck.Scan;
using LaptopCheck.Scan.Files;

namespace LaptopCheck.Tests;

/// <summary>The places where things pile up unnoticed (top of the system drive, program folders, LocalLow, own profile folders) and what a folder's "last used" is.</summary>
public sealed class FolderPlacesTests : IDisposable
{
    readonly string _base = Path.Combine(Path.GetTempPath(), "lc-places-" + Guid.NewGuid().ToString("N"));
    string Home => Path.Combine(_base, "home");

    public void Dispose()
    {
        try { Directory.Delete(_base, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    string NewFile(string rel, int size = 3000, DateTime? written = null)
    {
        var p = Path.Combine(_base, rel);
        Directory.CreateDirectory(Path.GetDirectoryName(p)!);
        File.WriteAllBytes(p, new byte[size]);
        if (written is not null) File.SetLastWriteTimeUtc(p, written.Value);
        return p;
    }

    FilesContext Context() => new()
    {
        Env = new ScanEnvironment
        {
            UserProfile = Home, LocalAppData = Path.Combine(Home, "AppData", "Local"), AppData = Path.Combine(Home, "AppData", "Roaming"),
            ProgramData = Path.Combine(_base, "ProgramData"), SystemRoot = Path.Combine(_base, "Windows"), SystemDrive = _base,
            ProgramFiles = Path.Combine(_base, "Program Files"), ProgramFilesX86 = Path.Combine(_base, "Program Files (x86)"), Temp = Path.Combine(_base, "Temp"),
        },
        Probe = new FakeProbe(), Registry = new FakeRegistry(), Processes = new LaptopCheck.Core.RealProcessRunner(),
    };

    static string Local(DateTime utc) => utc.ToLocalTime().ToString("yyyy-MM-ddTHH:mm");

    static JsonObject Pick(JsonArray a, string where, string name) =>
        a.OfType<JsonObject>().Single(d => (string?)d["where"] == where && (string?)d["name"] == name);

    [Fact]
    public void Places_lists_the_unnoticed_corners_and_skips_what_is_known()
    {
        NewFile(@"Mono\a.bin");                                  // a stray top-level folder
        NewFile(@"Windows\w.bin");                               // system: skipped
        NewFile(@"Program Files\OldTool\t.exe");
        NewFile(@"Program Files\Common Files\c.dll");            // skipped
        NewFile(@"Program Files (x86)\Other\o.exe");
        NewFile(@"home\Local Sites\s.bin");                      // own folder in the profile
        NewFile(@"home\Documents\d.txt");                        // standard folder: skipped
        NewFile(@"home\.gradle\g.bin");                          // hidden profile folder: belongs to DataDirs
        NewFile(@"home\CloudDrive\x.bin");                       // a live cloud folder: not "unknown"
        NewFile(@"home\AppData\Local\Programs\Foo\f.bin");
        NewFile(@"home\AppData\LocalLow\Game\g.bin");

        var places = FilesScan.Places(Context(), [Path.Combine(Home, "CloudDrive")]);

        Assert.Equal(3000, (long)Pick(places, "RootC", "Mono")["bytes"]!);
        Assert.DoesNotContain(places, p => (string?)p["where"] == "RootC" && (string?)p["name"] == "home");   // contains the live cloud folder: not "unknown"
        Assert.DoesNotContain(places, p => (string?)p["name"] == "Windows");
        Pick(places, "ProgramFiles", "OldTool"); Pick(places, "ProgramFiles", "Other");
        Assert.DoesNotContain(places, p => (string?)p["name"] == "Common Files");
        Pick(places, "UserFolder", "Local Sites");
        Assert.DoesNotContain(places, p => (string?)p["name"] is "Documents" or ".gradle" or "AppData" or "CloudDrive");
        Pick(places, "LocalPrograms", "Foo"); Pick(places, "LocalLow", "Game");
    }

    [Fact]
    public void Every_folder_has_a_creation_date_and_the_write_time_of_its_newest_file()
    {
        var old = new DateTime(2020, 5, 5, 12, 0, 0, DateTimeKind.Utc);
        var recent = new DateTime(2026, 11, 1, 8, 30, 0, DateTimeKind.Utc);
        NewFile(@"Mono\sub\old.bin", written: old);
        NewFile(@"Mono\deep\er\new.bin", written: recent);       // the NEWEST file lies deep inside: the folder's own date would not show it

        var mono = Pick(FilesScan.Places(Context(), []), "RootC", "Mono");

        Assert.StartsWith(Local(recent), (string?)mono["newest"]);               // like all dates of the scan: local time
        Assert.NotNull((string?)mono["created"]);
        Assert.NotNull((string?)mono["modified"]);
        Assert.False((bool)mono["partial"]!);
    }

    [Fact]
    public void Program_data_folders_get_the_same_two_dates()
    {
        var written = new DateTime(2025, 3, 3, 9, 0, 0, DateTimeKind.Utc);
        NewFile(@"home\.gradle\caches\a.jar", written: written);
        NewFile(@"home\AppData\Roaming\Blender Foundation\b.blend", written: written);

        var dirs = FilesScan.DataDirs(Context());

        var gradle = Pick(dirs, "UserProfile", ".gradle");
        Assert.StartsWith(Local(written), (string?)gradle["newest"]);
        Assert.NotNull((string?)gradle["created"]);
        Assert.StartsWith(Local(written), (string?)Pick(dirs, "AppData", "Blender Foundation")["newest"]);
        Assert.DoesNotContain(dirs, d => (string?)d["name"] == "Local Sites");   // normal profile folders are Places, not program data
    }

    [Fact]
    public void An_empty_folder_has_no_newest_file_and_zero_bytes()
    {
        Directory.CreateDirectory(Path.Combine(_base, "Battlestate Games"));

        var e = Pick(FilesScan.Places(Context(), []), "RootC", "Battlestate Games");

        Assert.Equal(0, (long)e["bytes"]!);
        Assert.Null((string?)e["newest"]);
    }

    [Fact]
    public void The_files_scan_contains_places()
    {
        NewFile(@"Mono\a.bin");
        var result = FilesScan.Run(Context(), new FilesScanOptions([], [], SecondsPerRoot: 5, SkipRepos: true));
        Assert.Contains(((JsonArray)result["places"]!).OfType<JsonObject>(), p => (string?)p["name"] == "Mono");
        Assert.NotNull(result["dataDirs"]);
    }
}
