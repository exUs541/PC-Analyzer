using System.Text.Json;
using System.Text.Json.Nodes;
using LaptopCheck.Cleanup;
using LaptopCheck.Core;

namespace LaptopCheck.Tests;

/// <summary>The scenario of tests/move.test.ps1: dangerous requests are refused, copies are verified and never overwrite, originals only go when still identical.</summary>
public sealed class MoveTests : IDisposable
{
    readonly CleanupSandbox _s = new();
    readonly string _srcA;
    readonly string _dstA;

    public MoveTests()
    {
        _srcA = Path.Combine(_s.Home, "Documents", "Steuer 2024");
        _dstA = Path.Combine(_s.Cloud, "02 Finanzen", "Steuer 2024");
        _s.Write(Path.Combine(_srcA, "steuer.txt"), "Einkommen 2024");
        _s.Write(Path.Combine(_srcA, "Belege", "rechnung 1.txt"), "Rechnung eins");
        _s.Write(Path.Combine(_srcA, "Belege", "it's mine.txt"), "apostrophe ' in name");
        _s.Write(Path.Combine(_srcA, "Belege", "umlaut-äöü.txt"), "umlaute");
        _s.Write(Path.Combine(_srcA, "conflict.txt"), "original content");
        _s.Write(Path.Combine(_srcA, "same.txt"), "identical content");
        File.SetLastWriteTime(Path.Combine(_srcA, "steuer.txt"), new DateTime(2019, 3, 4, 10, 20, 30));
        _s.Write(Path.Combine(_dstA, "conflict.txt"), "a different file already in the cloud");
        _s.Write(Path.Combine(_dstA, "same.txt"), "identical content");
        File.SetLastWriteTime(Path.Combine(_dstA, "same.txt"), File.GetLastWriteTime(Path.Combine(_srcA, "same.txt")));
    }

    public void Dispose() => _s.Dispose();

    string Request(params (string Src, string Dst)[] items) =>
        JsonSerializer.Serialize(new { cloudRoot = _s.Cloud, items = items.Select(i => new { src = i.Src, dst = i.Dst }) });

    async Task<string> StartCopy()
    {
        var started = _s.Json(await _s.Service.StartMoveAsync(Request((_srcA, _dstA))));
        var id = (string)started["id"]!;
        await _s.Service.WaitForJobAsync(id);
        return id;
    }

    [Fact]
    public async Task Dangerous_requests_are_refused_and_nothing_is_created()
    {
        var elsewhere = Path.Combine(_s.Base, "elsewhere");
        var appData = _s.Write(Path.Combine(_s.Env.AppData, "SomeApp", "data.bin"));
        var cases = new (string What, (string Src, string Dst) Item)[]
        {
            ("source outside the allowed roots", (_s.Base, Path.Combine(_s.Cloud, "x"))),
            ("source = user profile", (_s.Home, Path.Combine(_s.Cloud, "x"))),
            ("destination outside the cloud folder", (_srcA, elsewhere)),
            ("destination = cloud root itself", (_srcA, _s.Cloud)),
            ("source already inside the cloud", (_dstA, Path.Combine(_s.Cloud, "y"))),
            ("path traversal in the destination", (_srcA, Path.Combine(_s.Cloud, "..", "escape"))),
            ("overlapping source and destination", (_srcA, Path.Combine(_srcA, "sub"))),
            ("source in AppData", (Path.GetDirectoryName(appData)!, Path.Combine(_s.Cloud, "z"))),
            ("source missing", (Path.Combine(_s.Home, "nope"), Path.Combine(_s.Cloud, "z"))),
        };
        foreach (var (what, item) in cases)
        {
            await Assert.ThrowsAsync<ArgumentException>(() => _s.Service.StartMoveAsync(Request(item)));
            Assert.True(!Directory.Exists(Path.Combine(_s.Data.Dir, "moves")) || !Directory.EnumerateDirectories(Path.Combine(_s.Data.Dir, "moves")).Any(), "no job created: " + what);
        }
        Assert.False(Directory.Exists(Path.Combine(_s.Cloud, "x")));
        Assert.False(Directory.Exists(Path.Combine(_s.Base, "escape")));
        Assert.False(Directory.Exists(elsewhere));
    }

    [Fact]
    public async Task A_folder_that_is_not_a_detected_cloud_folder_is_refused()
    {
        var other = Path.Combine(_s.Base, "notcloud");
        Directory.CreateDirectory(other);
        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _s.Service.StartMoveAsync(
            JsonSerializer.Serialize(new { cloudRoot = other, items = new[] { new { src = _srcA, dst = Path.Combine(other, "d") } } })));
        Assert.Contains("not a detected cloud folder", ex.Message);
    }

    [Theory]
    [InlineData("""{"items":[]}""", "cloudRoot missing")]
    [InlineData("not json", "invalid request")]
    public async Task Malformed_requests_are_refused(string body, string message)
    {
        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _s.Service.StartMoveAsync(body));
        Assert.Contains(message, ex.Message);
    }

    [Fact]
    public async Task Empty_and_oversized_selections_are_refused()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => _s.Service.StartMoveAsync(JsonSerializer.Serialize(new { cloudRoot = _s.Cloud, items = Array.Empty<object>() })));
        var many = Enumerable.Range(0, 51).Select(i => new { src = _srcA, dst = Path.Combine(_s.Cloud, "d" + i) });
        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _s.Service.StartMoveAsync(JsonSerializer.Serialize(new { cloudRoot = _s.Cloud, items = many })));
        Assert.Contains("max 50", ex.Message);
    }

    [Fact]
    public async Task Copy_phase_verifies_every_file_and_never_overwrites()
    {
        var id = await StartCopy();
        var res = _s.Json(_s.MoveFile(id, "result.json"));
        Assert.Equal("copied", (string)res["state"]!);
        var t = res["totals"]!;
        Assert.Equal(6, (int)t["files"]!);
        Assert.Equal(4, (int)t["copied"]!);                                         // four new files
        Assert.Equal(1, (int)t["skipped"]!);                                        // one identical file already there
        Assert.Equal(1, (int)t["conflicts"]!);                                      // one different file at the destination
        Assert.Equal(5, (int)t["verified"]!);                                       // 4 copied + 1 identical
        Assert.Equal(0, (int)t["failed"]!);
        Assert.Equal(0, (int)t["mismatched"]!);

        Assert.Equal("a different file already in the cloud", File.ReadAllText(Path.Combine(_dstA, "conflict.txt")));   // NOT overwritten
        Assert.Equal("Rechnung eins", File.ReadAllText(Path.Combine(_dstA, "Belege", "rechnung 1.txt")));
        Assert.True(File.Exists(Path.Combine(_dstA, "Belege", "it's mine.txt")));
        Assert.Equal(new DateTime(2019, 3, 4, 10, 20, 30), File.GetLastWriteTime(Path.Combine(_dstA, "steuer.txt")));   // modification time kept
        Assert.True(File.Exists(Path.Combine(_srcA, "steuer.txt")));                // originals untouched

        var tsv = File.ReadAllLines(Path.Combine(_s.MoveDir(id), "verified.tsv"));
        Assert.Equal(5, tsv.Length);
        Assert.DoesNotContain(tsv, l => l.Contains("conflict.txt"));
        Assert.All(tsv, l => Assert.Equal(6, l.Split('\t').Length));
        Assert.False(File.Exists(Path.Combine(_s.MoveDir(id), "progress.json")));   // progress file is cleaned up
        Assert.Contains("Originals were NOT touched", _s.MoveFile(id, "log.txt"));
    }

    [Fact]
    public async Task Status_and_list_describe_the_job()
    {
        var id = await StartCopy();
        var status = _s.Json(_s.Service.MoveStatus(id));
        Assert.Equal(id, (string)status["id"]!);
        Assert.Equal("copied", (string)status["result"]!["state"]!);
        Assert.Null(status["cleanup"]);
        var list = _s.Json(_s.Service.MoveList()).AsArray();
        Assert.Equal(id, (string)list[0]!["id"]!);
        Assert.Equal("copied", (string)list[0]!["state"]!);
        Assert.Equal(5, (int)list[0]!["totals"]!["verified"]!);
        Assert.Throws<ArgumentException>(() => _s.Service.MoveStatus("../../x"));
        Assert.Throws<ArgumentException>(() => _s.Service.MoveStatus("20260101-000000-abcd"));       // well-formed but unknown
    }

    /// <summary>The steps between the check and the removal: a changed original, a vanished copy, a copy that differs.</summary>
    async Task<string> CopiedAndTampered()
    {
        var id = await StartCopy();
        File.SetLastWriteTime(Path.Combine(_srcA, "Belege", "rechnung 1.txt"), new DateTime(2026, 1, 1));   // original changed after the check
        File.Delete(Path.Combine(_dstA, "Belege", "it's mine.txt"));                                           // the copy vanished
        File.WriteAllText(Path.Combine(_dstA, "same.txt"), "IDENTICAL CONTENT");                               // the copy differs (same size)
        return id;
    }

    [Fact]
    public async Task Cleanup_removes_only_what_is_still_verified_and_unchanged()
    {
        var id = await CopiedAndTampered();
        _s.Confirmation.Answer = true;
        await _s.Service.StartMoveCleanupAsync(id);
        await _s.Service.WaitForJobAsync(id);

        var c = _s.Json(_s.MoveFile(id, "cleanup.json"));
        Assert.Equal("cleaned", (string)c["state"]!);
        Assert.Equal(2, (int)c["removed"]!);                                        // steuer.txt and the umlaut file
        Assert.Equal(1, (int)c["skippedChanged"]!);
        Assert.Equal(1, (int)c["skippedMissingCopy"]!);
        Assert.Equal(1, (int)c["skippedMismatch"]!);
        Assert.False(File.Exists(Path.Combine(_srcA, "steuer.txt")));
        Assert.True(File.Exists(Path.Combine(_srcA, "Belege", "rechnung 1.txt")));
        Assert.True(File.Exists(Path.Combine(_srcA, "Belege", "it's mine.txt")));
        Assert.True(File.Exists(Path.Combine(_srcA, "same.txt")));
        Assert.True(File.Exists(Path.Combine(_srcA, "conflict.txt")));
        Assert.Equal(2, Directory.GetFileSystemEntries(_s.Trash).Length);            // in the (test) Recycle Bin, not deleted
        Assert.True(Directory.Exists(_srcA));                                       // the source root itself is never removed
        Assert.Equal("copied", (string)_s.Json(_s.MoveFile(id, "result.json"))["state"]!);   // cleanup does not overwrite the copy result
    }

    [Fact]
    public async Task Cleanup_asks_with_a_tick_box_and_the_exact_word()
    {
        var id = await StartCopy();
        _s.Confirmation.Answer = true;
        await _s.Service.StartMoveCleanupAsync(id);
        await _s.Service.WaitForJobAsync(id);
        var request = Assert.Single(_s.Confirmation.Requests);
        Assert.Equal("ENTFERNEN", request.RequiredWord);
        Assert.NotNull(request.CheckboxText);
        Assert.Contains("PAPIERKORB", request.Heading);
        Assert.Contains("5 ", request.Heading);
        Assert.False(request.IsSatisfiedBy(false, "ENTFERNEN"));                    // the box must be ticked as well
        Assert.True(request.IsSatisfiedBy(true, "ENTFERNEN"));
    }

    [Fact]
    public async Task Cleanup_without_confirmation_removes_nothing()
    {
        var id = await StartCopy();
        _s.Confirmation.Answer = false;
        await _s.Service.StartMoveCleanupAsync(id);
        await _s.Service.WaitForJobAsync(id);
        Assert.Equal("cancelled", (string)_s.Json(_s.MoveFile(id, "cleanup.json"))["state"]!);
        Assert.True(File.Exists(Path.Combine(_srcA, "steuer.txt")));
        Assert.Empty(_s.Recycle.Recycled);
        Assert.False(Directory.Exists(_s.Trash));
    }

    [Fact]
    public async Task Cleanup_needs_a_finished_copy_with_verified_files()
    {
        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _s.Service.StartMoveCleanupAsync("20260101-000000-abcd"));
        Assert.Contains("not finished", ex.Message);

        var id = await StartCopy();
        File.WriteAllText(Path.Combine(_s.MoveDir(id), "result.json"), """{"state":"copied","totals":{"verified":0}}""");
        var ex2 = await Assert.ThrowsAsync<ArgumentException>(() => _s.Service.StartMoveCleanupAsync(id));
        Assert.Contains("Nothing verified", ex2.Message);
        File.WriteAllText(Path.Combine(_s.MoveDir(id), "result.json"), """{"state":"error","error":"x"}""");
        await Assert.ThrowsAsync<ArgumentException>(() => _s.Service.StartMoveCleanupAsync(id));
        await Assert.ThrowsAsync<ArgumentException>(() => _s.Service.StartMoveCleanupAsync("../../etc"));
    }

    [Fact]
    public async Task A_verified_list_that_was_edited_cannot_reach_other_files()
    {
        var id = await StartCopy();
        var outside = _s.Write(Path.Combine(_s.Home, "Documents", "wichtig.txt"), "do not touch");
        var cloudCopy = _s.Write(Path.Combine(_dstA, "wichtig-kopie.txt"), "do not touch");
        var info = new FileInfo(outside);
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(outside))).ToLowerInvariant();
        // a line that points out of the job's folders with "..", and one with a source folder that is not part of the job
        var evil = new[]
        {
            string.Join('\t', _srcA, _dstA, @"..\wichtig.txt", info.Length, info.LastWriteTimeUtc.Ticks, hash),
            string.Join('\t', Path.Combine(_s.Home, "Documents"), _dstA, "wichtig.txt", info.Length, info.LastWriteTimeUtc.Ticks, hash),
        };
        File.AppendAllLines(Path.Combine(_s.MoveDir(id), "verified.tsv"), evil);
        _s.Confirmation.Answer = true;
        await _s.Service.StartMoveCleanupAsync(id);
        await _s.Service.WaitForJobAsync(id);
        Assert.True(File.Exists(outside));
        Assert.Equal(2, (int)_s.Json(_s.MoveFile(id, "cleanup.json"))["failed"]!);
        Assert.True(File.Exists(cloudCopy));
    }

    [Fact]
    public async Task Source_folders_that_became_empty_are_removed_but_never_the_source_root()
    {
        var src = Path.Combine(_s.Home, "Documents", "Nur eine Datei");
        _s.Write(Path.Combine(src, "unten", "tief", "a.txt"), "a");
        var started = _s.Json(await _s.Service.StartMoveAsync(Request((src, Path.Combine(_s.Cloud, "Nur eine Datei")))));
        var id = (string)started["id"]!;
        await _s.Service.WaitForJobAsync(id);
        _s.Confirmation.Answer = true;
        await _s.Service.StartMoveCleanupAsync(id);
        await _s.Service.WaitForJobAsync(id);
        Assert.False(File.Exists(Path.Combine(src, "unten", "tief", "a.txt")));
        Assert.False(Directory.Exists(Path.Combine(src, "unten")));                  // emptied sub folders go
        Assert.True(Directory.Exists(src));                                          // the root stays
    }

    [Fact]
    public async Task A_job_manifest_that_was_changed_on_disk_is_refused_again_before_the_copy()
    {
        var started = _s.Json(await _s.Service.StartMoveAsync(Request((_srcA, _dstA))));
        var id = (string)started["id"]!;
        await _s.Service.WaitForJobAsync(id);
        // an attacker (or a bug) rewrites the manifest between creating and running a phase
        var manifestFile = Path.Combine(_s.MoveDir(id), "manifest.json");
        var m = JsonNode.Parse(File.ReadAllText(manifestFile))!;
        m["items"]![0]!["dst"] = Path.Combine(_s.Base, "elsewhere");
        File.WriteAllText(manifestFile, m.ToJsonString());
        File.Delete(Path.Combine(_s.MoveDir(id), "result.json"));
        File.WriteAllText(Path.Combine(_s.MoveDir(id), "result.json"), """{"state":"copied","totals":{"verified":3}}""");

        _s.Confirmation.Answer = true;
        await _s.Service.StartMoveCleanupAsync(id);
        await _s.Service.WaitForJobAsync(id);
        var c = _s.Json(_s.MoveFile(id, "cleanup.json"));
        Assert.Equal("error", (string)c["state"]!);
        Assert.Contains("Destination must be a sub folder", (string)c["error"]!);
        Assert.Empty(_s.Confirmation.Requests);                                      // not even asked
        Assert.True(File.Exists(Path.Combine(_srcA, "steuer.txt")));
    }

    [Fact]
    public async Task In_a_test_run_the_job_is_only_written_not_started()
    {
        Environment.SetEnvironmentVariable("LC_OPEN_DRYRUN", "1");
        try
        {
            var started = _s.Json(await _s.Service.StartMoveAsync(Request((_srcA, _dstA))));
            Assert.True((bool)started["started"]!["dryRun"]!);
            var id = (string)started["id"]!;
            Assert.True(File.Exists(Path.Combine(_s.MoveDir(id), "manifest.json")));
            Assert.False(File.Exists(Path.Combine(_s.MoveDir(id), "result.json")));
            Assert.False(File.Exists(Path.Combine(_dstA, "steuer.txt")));
        }
        finally
        {
            Environment.SetEnvironmentVariable("LC_OPEN_DRYRUN", null);
        }
    }

    [Theory]
    [InlineData("ENTFERNEN", true)]
    [InlineData("entfernen", false)]
    [InlineData("Entfernen", false)]
    [InlineData("ENTFERNEN ", false)]
    [InlineData(" ENTFERNEN", false)]
    [InlineData("ENTFERNE", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void The_word_has_to_be_typed_exactly(string? typed, bool expected)
    {
        var withoutBox = new ConfirmationRequest("t", "h", [], null, "ENTFERNEN");
        Assert.Equal(expected, withoutBox.IsSatisfiedBy(false, typed));
        var withBox = new ConfirmationRequest("t", "h", [], "stimmt", "ENTFERNEN");
        Assert.Equal(expected, withBox.IsSatisfiedBy(true, typed));
        Assert.False(withBox.IsSatisfiedBy(false, typed));                           // the statement has to be ticked as well
    }

    [Fact]
    public async Task Without_a_window_nothing_is_ever_confirmed()
    {
        Assert.False(await new DenyAllConfirmation().ConfirmAsync(new ConfirmationRequest("t", "h", [], null, "ENTFERNEN")));
    }
}
