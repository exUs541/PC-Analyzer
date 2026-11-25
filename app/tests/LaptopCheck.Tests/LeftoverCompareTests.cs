using System.Text.Json.Nodes;
using LaptopCheck.Scan.Files;

namespace LaptopCheck.Tests;

/// <summary>The old mirror folder against the live drive: what is redundant, what is only there (and would be lost).</summary>
public sealed class LeftoverCompareTests : IDisposable
{
    readonly string _base = Path.Combine(Path.GetTempPath(), "lc-leftover-" + Guid.NewGuid().ToString("N"));
    string Old => Path.Combine(_base, "My Drive");
    string Live => Path.Combine(_base, "G", "Meine Ablage");

    public void Dispose()
    {
        try { Directory.Delete(_base, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    static void Put(string root, string rel, int size)
    {
        var p = Path.Combine(root, rel);
        Directory.CreateDirectory(Path.GetDirectoryName(p)!);
        File.WriteAllBytes(p, new byte[size]);
    }

    [Fact]
    public void Every_file_of_the_old_folder_lands_in_exactly_one_bucket()
    {
        Directory.CreateDirectory(Live);
        // identical in both
        Put(Old, @"30_Personal\cv.pdf", 5000); Put(Live, @"30_Personal\cv.pdf", 5000);
        Put(Old, @"40_Projects\plan.xlsx", 7000); Put(Live, @"40_Projects\plan.xlsx", 7000);
        // same name and size, but the folder was moved in the drive
        Put(Old, @"Fotos\bild.jpg", 9000); Put(Live, @"Bilder\2026\bild.jpg", 9000);
        // same path, other size: a changed file is NOT redundant
        Put(Old, @"30_Personal\notes.txt", 100); Put(Live, @"30_Personal\notes.txt", 250);
        // only in the old folder
        Put(Old, @"99_Other\Urlaub\video.mp4", 20000);
        Put(Old, @"99_Other\Urlaub\foto.jpg", 4000);
        // no content of its own
        Put(Old, "desktop.ini", 50); Put(Old, @".tmp.driveupload\123", 10); Put(Old, @"Doc\~$lock.docx", 10); Put(Old, "Reise.gdoc", 200);
        // something only the live drive has
        Put(Live, "nur-im-drive.pdf", 123);

        var r = LeftoverCompare.Run(Old, Live, 60);

        Assert.Equal(10L, (long)r["files"]!);
        Assert.Equal(2L, (long)r["same"]!["files"]!);
        Assert.Equal(12000L, (long)r["same"]!["bytes"]!);
        Assert.Equal(1L, (long)r["nameSize"]!["files"]!);
        Assert.Equal(4L, (long)r["junk"]!["files"]!);
        Assert.Equal(3L, (long)r["only"]!["files"]!);                       // video, foto and the changed notes.txt
        Assert.Equal(24100L, (long)r["only"]!["bytes"]!);
        Assert.False((bool)r["partial"]!);
        long f = (long)r["same"]!["files"]! + (long)r["nameSize"]!["files"]! + (long)r["junk"]!["files"]! + (long)r["only"]!["files"]!;
        Assert.Equal((long)r["files"]!, f);                                 // nothing counted twice, nothing lost
    }

    [Fact]
    public void Missing_files_are_listed_per_folder_and_biggest_first()
    {
        Directory.CreateDirectory(Live);
        Put(Old, @"99_Other\Urlaub\video.mp4", 20000);
        Put(Old, @"99_Other\Urlaub\foto.jpg", 4000);
        Put(Old, @"30_Personal\small.txt", 10);

        var r = LeftoverCompare.Run(Old, Live, 60);
        var dirs = (JsonArray)r["onlyDirs"]!;
        Assert.Equal(2, dirs.Count);
        Assert.EndsWith(@"99_Other\Urlaub", (string)dirs[0]!["dir"]!);
        Assert.Equal(2L, (long)dirs[0]!["files"]!);
        Assert.Equal(24000L, (long)dirs[0]!["bytes"]!);
        var top = (JsonArray)r["onlyTop"]!;
        Assert.EndsWith("video.mp4", (string)top[0]!["p"]!);
        Assert.Equal(20000L, (long)top[0]!["s"]!);
        Assert.Matches(@"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$", (string)top[0]!["m"]!);
        Assert.Equal(0L, (long)r["onlyDirsMore"]!);
    }

    [Fact]
    public void An_old_folder_that_is_completely_in_the_drive_has_nothing_to_lose()
    {
        Put(Old, @"a\x.pdf", 1000); Put(Live, @"a\x.pdf", 1000);
        Put(Old, @"b\y.pdf", 2000); Put(Live, @"B\Y.PDF", 2000);        // Windows paths ignore the case
        var r = LeftoverCompare.Run(Old, Live, 60);
        Assert.Equal(0L, (long)r["only"]!["files"]!);
        Assert.Equal(2L, (long)r["same"]!["files"]!);
        Assert.Empty((JsonArray)r["onlyDirs"]!);
    }

    [Fact]
    public void A_missing_live_folder_does_not_crash_and_never_claims_that_something_is_in_the_drive()
    {
        Put(Old, "a.pdf", 1000);
        var r = LeftoverCompare.Run(Old, Path.Combine(_base, "gibt-es-nicht"), 60);
        Assert.Equal(1L, (long)r["only"]!["files"]!);
        Assert.Equal(0L, (long)r["same"]!["files"]!);
    }
}
