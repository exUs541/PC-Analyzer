using System.Net;
using System.Text.Json.Nodes;
using LaptopCheck.Core;
using LaptopCheck.Scan.Files;

namespace LaptopCheck.Tests;

/// <summary>Comparing two folders: every file lands in exactly one bucket, nothing is ever written, the service refuses folders that cannot be compared.</summary>
public sealed class FolderCompareTests : IDisposable
{
    readonly string _base = Path.Combine(Path.GetTempPath(), "lc-compare-" + Guid.NewGuid().ToString("N"));
    string A => Path.Combine(_base, "alt");
    string B => Path.Combine(_base, "neu");

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

    static long N(JsonNode? n, params string[] path) { foreach (var p in path) n = n![p]; return (long)n!; }

    /// <summary>Same files, plus one of every kind of difference.</summary>
    void Scenario()
    {
        Put(A, @"Steuer\2024.pdf", "identical"); Put(B, @"Steuer\2024.pdf", "identical");
        Put(A, @"Steuer\notiz.txt", "short"); Put(B, @"Steuer\notiz.txt", "a much longer version of the note");          // changed
        Put(A, @"Urlaub\foto1.jpg", "only in the old folder");                                                                   // only A
        Put(A, @"Urlaub\foto2.jpg", "another one only in the old folder");
        Put(B, @"Neu\readme.md", "only in the new folder");                                                                      // only B
        Put(A, @"Fotos\bild.jpg", "moved picture"); Put(B, @"Bilder\2026\bild.jpg", "moved picture");                          // moved
        Put(A, "desktop.ini", "junk"); Put(A, "Reise.gdoc", "stub");                                                            // ignored
        Put(A, @"Leer\null.txt", ""); Put(B, @"Leer\andere.txt", "");                                                            // empty files are no "moved" pair
    }

    [Fact]
    public void Every_file_lands_in_exactly_one_bucket()
    {
        Scenario();
        var r = FolderCompare.Run(A, B, deep: false, ignoreJunk: true, seconds: 60);
        var s = r["summary"]!;
        Assert.Equal(1, N(s, "same", "files"));
        Assert.Equal(1, N(s, "changed", "files"));
        Assert.Equal(3, N(s, "onlyA", "files"));            // foto1, foto2 and the empty null.txt (empty files are never a "moved" pair)
        Assert.Equal(2, N(s, "onlyB", "files"));            // readme.md and the empty andere.txt
        Assert.Equal(1, N(s, "moved", "files"));
        Assert.Equal(2, N(s, "ignored"));
        // A: 2024.pdf, notiz.txt, foto1, foto2, bild.jpg, null.txt = 6 ; B: 2024.pdf, notiz.txt, readme.md, bild.jpg, andere.txt = 5
        Assert.Equal(6, N(s, "filesA")); Assert.Equal(5, N(s, "filesB"));
        var inA = N(s, "same", "files") + N(s, "changed", "files") + N(s, "moved", "files") + N(s, "onlyA", "files");
        Assert.Equal(N(s, "filesA"), inA);
        var inB = N(s, "same", "files") + N(s, "changed", "files") + N(s, "moved", "files") + N(s, "onlyB", "files");
        Assert.Equal(N(s, "filesB"), inB);
        Assert.False((bool)r["partial"]!);
    }

    [Fact]
    public void The_lists_name_the_files_and_what_moved_where()
    {
        Scenario();
        var r = FolderCompare.Run(A, B, false, true, 60);
        Assert.Contains(((JsonArray)r["onlyA"]!).Select(x => (string)x!["p"]!), p => p == @"Urlaub\foto1.jpg");
        Assert.Contains(((JsonArray)r["onlyA"]!).Select(x => (string)x!["p"]!), p => p == @"Leer\null.txt");
        Assert.Contains(((JsonArray)r["onlyB"]!).Select(x => (string)x!["p"]!), p => p == @"Neu\readme.md");
        var ch = (JsonObject)((JsonArray)r["changed"]!)[0]!;
        Assert.Equal(@"Steuer\notiz.txt", (string)ch["p"]!);
        Assert.True((long)ch["sb"]! > (long)ch["sa"]!);
        var mv = (JsonObject)((JsonArray)r["moved"]!)[0]!;
        Assert.Equal(@"Fotos\bild.jpg", (string)mv["a"]!); Assert.Equal(@"Bilder\2026\bild.jpg", (string)mv["b"]!);
    }

    [Fact]
    public void Folders_add_up_including_their_parents()
    {
        Scenario();
        var r = FolderCompare.Run(A, B, false, true, 60);
        var dirs = ((JsonArray)r["dirs"]!).ToDictionary(x => (string)x!["d"]!, x => x!, StringComparer.OrdinalIgnoreCase);
        Assert.Equal(2, N(dirs["Urlaub"], "onlyA", "files"));
        Assert.Equal(1, N(dirs["Steuer"], "changed", "files")); Assert.Equal(1, N(dirs["Steuer"], "same", "files"));
        Assert.Equal(1, N(dirs["Bilder"], "moved", "files")); Assert.Equal(1, N(dirs["Bilder\\2026"], "moved", "files"));
        Assert.Equal(1, N(dirs["Fotos"], "moved", "files"));
        // the root row is the sum of everything that differs
        Assert.Equal(N(r["summary"], "onlyA", "files"), N(dirs[""], "onlyA", "files"));
        Assert.Equal(N(r["summary"], "changed", "files"), N(dirs[""], "changed", "files"));
        Assert.False(dirs.ContainsKey("Nope"));
    }

    [Fact]
    public void Case_of_names_does_not_matter_and_identical_folders_have_no_difference()
    {
        Put(A, @"Docs\Brief.PDF", "same"); Put(B, @"docs\brief.pdf", "same");
        var r = FolderCompare.Run(A, B, false, true, 60);
        Assert.Equal(1, N(r["summary"], "same", "files"));
        Assert.Equal(0, N(r["summary"], "onlyA", "files") + N(r["summary"], "onlyB", "files") + N(r["summary"], "changed", "files") + N(r["summary"], "moved", "files"));
        Assert.Empty((JsonArray)r["dirs"]!);
    }

    [Fact]
    public void Deep_mode_finds_a_file_that_has_the_same_size_but_other_content_and_normal_mode_does_not()
    {
        Put(A, "daten.bin", "AAAAAAAAAA"); Put(B, "daten.bin", "BBBBBBBBBB");
        Assert.Equal(1, N(FolderCompare.Run(A, B, false, true, 60)["summary"], "same", "files"));       // path + size: looks the same
        var deep = FolderCompare.Run(A, B, true, true, 60);
        Assert.Equal(0, N(deep["summary"], "same", "files"));
        Assert.Equal(1, N(deep["summary"], "changed", "files"));
        Assert.Equal("content", (string)((JsonArray)deep["changed"]!)[0]!["why"]!);
    }

    [Fact]
    public void Junk_is_only_left_out_when_asked_for()
    {
        Put(A, "desktop.ini", "x"); Put(A, "a.txt", "a"); Put(B, "a.txt", "a");
        Assert.Equal(1, N(FolderCompare.Run(A, B, false, true, 60)["summary"], "filesA"));
        var all = FolderCompare.Run(A, B, false, false, 60);
        Assert.Equal(2, N(all["summary"], "filesA")); Assert.Equal(1, N(all["summary"], "onlyA", "files"));
    }

    [Fact]
    public void Nothing_in_the_compared_folders_is_ever_changed()
    {
        Scenario();
        string Snapshot() => string.Join("|", Directory.EnumerateFiles(_base, "*", SearchOption.AllDirectories).OrderBy(x => x).Select(f => f + ":" + new FileInfo(f).Length + ":" + File.GetLastWriteTimeUtc(f).Ticks));
        var before = Snapshot();
        FolderCompare.Run(A, B, true, true, 60);
        Assert.Equal(before, Snapshot());
    }

    // ---- the service

    [Fact]
    public async Task The_service_refuses_folders_that_cannot_be_compared_and_keeps_the_last_result()
    {
        Scenario();
        var data = new DataPaths(Path.Combine(_base, "data"));
        var s = new CompareService(data, 60);
        Assert.Equal("null", s.Last());
        string Req(string a, string b) => new JsonObject { ["a"] = a, ["b"] = b }.ToJsonString();
        foreach (var (what, a, b) in new[]
        {
            ("empty", "", B), ("missing", Path.Combine(_base, "gibt-es-nicht"), B), ("same", A, A), ("A inside B", Path.Combine(A, "Steuer"), A),
            ("relative", "alt", B), ("traversal", A + @"\..\alt", B),
        })
            await Assert.ThrowsAsync<ArgumentException>(() => s.RunAsync(Req(a, b)));
        await Assert.ThrowsAsync<ArgumentException>(() => s.RunAsync("not json"));

        var text = await s.RunAsync(Req(A, B));
        Assert.Equal(1, N(JsonNode.Parse(text), "summary", "same", "files"));
        Assert.Equal(text, s.Last());                                                              // stored for "show the last result"
        Assert.False(File.Exists(Path.Combine(A, "compare.json")));                                // written only into the data folder
    }

    [Fact]
    public async Task The_endpoints_route_to_the_service_the_picker_and_need_the_token()
    {
        var picker = new FakePicker();
        await using var env = await TestEnv.StartAsync(compareFactory: _ => new FakeCompare(), folderPicker: picker);
        async Task<HttpResponseMessage> Send(HttpMethod m, string path, string? body = null, bool token = true) => await env.Http.SendAsync(env.Request(m, path, withToken: token, body: body));

        Assert.Equal("{\"summary\":\"run\"}", await (await Send(HttpMethod.Post, "/api/compare", "{\"a\":\"x\",\"b\":\"y\"}")).Content.ReadAsStringAsync());
        Assert.Equal("null", await (await Send(HttpMethod.Get, "/api/compare/last")).Content.ReadAsStringAsync());
        Assert.Equal("{\"path\":\"C:\\\\Gewaehlt\"}", await (await Send(HttpMethod.Post, "/api/pick-folder", "{\"title\":\"A waehlen\",\"start\":\"D:\\\\\"}")).Content.ReadAsStringAsync());
        Assert.Equal("A waehlen|D:\\", picker.Last);
        picker.Cancel = true;
        Assert.Equal("{\"path\":null}", await (await Send(HttpMethod.Post, "/api/pick-folder", "{}")).Content.ReadAsStringAsync());
        foreach (var (m, p) in new[] { (HttpMethod.Post, "/api/compare"), (HttpMethod.Get, "/api/compare/last"), (HttpMethod.Post, "/api/pick-folder") })
            Assert.Equal(HttpStatusCode.Forbidden, (await Send(m, p, "{}", token: false)).StatusCode);
    }

    [Fact]
    public async Task Without_the_module_the_endpoints_answer_501_and_a_refused_request_is_a_400()
    {
        await using var none = await TestEnv.StartAsync();
        Assert.Equal(HttpStatusCode.NotImplemented, (await none.Http.SendAsync(none.Request(HttpMethod.Post, "/api/compare", body: "{}"))).StatusCode);

        await using var real = await TestEnv.StartAsync(compareFactory: d => new CompareService(d, 30));
        var bad = await real.Http.SendAsync(real.Request(HttpMethod.Post, "/api/compare", body: "{\"a\":\"\",\"b\":\"\"}"));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Contains("kein Ordner", await bad.Content.ReadAsStringAsync());
    }

    sealed class FakeCompare : ICompareActions
    {
        public Task<string> RunAsync(string requestJson, CancellationToken cancellationToken = default) => Task.FromResult("{\"summary\":\"run\"}");
        public string Last() => "null";
    }

    sealed class FakePicker : IFolderPicker
    {
        public string? Last;
        public bool Cancel;
        public string? Pick(string title, string? startPath) { Last = title + "|" + startPath; return Cancel ? null : "C:\\Gewaehlt"; }
    }
}
