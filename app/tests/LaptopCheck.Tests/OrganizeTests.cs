using System.Text.Json;
using LaptopCheck.Cleanup;
using LaptopCheck.Core;

namespace LaptopCheck.Tests;

public class OrganizeTests : IDisposable
{
    static readonly DateTime Now = new(2026, 10, 25, 12, 0, 0, DateTimeKind.Utc);
    readonly string _tmp = Path.Combine(Path.GetTempPath(), "lc-org-" + Guid.NewGuid().ToString("N"));
    readonly string _downloads;
    readonly FakeRecycle _recycle = new();
    readonly FakeConfirm _confirm = new();
    readonly OrganizeService _svc;

    public OrganizeTests()
    {
        var profile = Path.Combine(_tmp, "profile");
        _downloads = Path.Combine(profile, "Downloads");
        Directory.CreateDirectory(_downloads);
        _svc = new OrganizeService(new DataPaths(Path.Combine(_tmp, "app", "data")), _recycle, _confirm, profile, () => Now);
    }

    public void Dispose()
    {
        try { Directory.Delete(_tmp, true); } catch (IOException) { }
    }

    sealed class FakeRecycle : IRecycleBin
    {
        public List<string> Recycled { get; } = [];
        public void Recycle(string path, bool isDirectory) { Recycled.Add(path); if (isDirectory) Directory.Delete(path, true); else File.Delete(path); }
    }

    sealed class FakeConfirm : IConfirmation
    {
        public bool Answer = true;
        public int Asked;
        public Task<bool> ConfirmAsync(ConfirmationRequest request, CancellationToken cancellationToken = default) { Asked++; return Task.FromResult(Answer); }
    }

    string Make(string rel, string content, int daysOld)
    {
        var p = Path.Combine(_downloads, rel);
        Directory.CreateDirectory(Path.GetDirectoryName(p)!);
        File.WriteAllText(p, content);
        File.SetLastWriteTimeUtc(p, Now.AddDays(-daysOld));
        return p;
    }

    async Task<JsonElement> Analyze()
    {
        var json = await _svc.AnalyzeAsync(JsonSerializer.Serialize(new { roots = new[] { _downloads } }));
        return JsonDocument.Parse(json).RootElement.Clone();
    }

    static JsonElement Item(JsonElement plan, string name) => plan.GetProperty("items").EnumerateArray().First(i => i.GetProperty("name").GetString() == name);
    static string Str(JsonElement e, string p) => e.GetProperty(p).GetString()!;
    static int FileCount(string dir) => Directory.GetFiles(dir, "*", SearchOption.AllDirectories).Length;

    async Task<JsonElement> Apply(JsonElement plan, object? extra = null)
    {
        var o = new Dictionary<string, object?> { ["planId"] = Str(plan, "id") };
        if (extra is not null) foreach (var p in extra.GetType().GetProperties()) o[p.Name] = p.GetValue(extra);
        return JsonDocument.Parse(await _svc.ApplyAsync(JsonSerializer.Serialize(o))).RootElement.Clone();
    }

    [Fact]
    public async Task Loose_files_get_kind_tags_zone_and_a_proposed_folder()
    {
        Make("Rechnung_Strom.pdf", "a", 800);
        Make("urlaub.jpg", "b", 500);
        Make("neu.zip", "c", 10);
        Make("setup.exe", "d", 400);
        var plan = await Analyze();

        var inv = Item(plan, "Rechnung_Strom.pdf");
        Assert.Equal(Path.Combine("Wichtig", "Dokumente", "Finanzen", "2024"), Str(inv, "target"));
        Assert.Contains("wichtig", inv.GetProperty("tags").EnumerateArray().Select(t => t.GetString()));
        Assert.Equal(Path.Combine("Archiv", "Bilder", "2025"), Str(Item(plan, "urlaub.jpg"), "target"));
        Assert.Equal(Path.Combine("Aktuell", "Archive"), Str(Item(plan, "neu.zip"), "target"));
        Assert.Equal(Path.Combine("Archiv", "Installer"), Str(Item(plan, "setup.exe"), "target"));
    }

    [Fact]
    public async Task Sub_folders_stay_together_old_ones_go_to_the_archive_and_git_projects_stay()
    {
        Make(Path.Combine("alt", "x.txt"), "x", 900);
        Make(Path.Combine("frisch", "y.txt"), "y", 5);
        Make(Path.Combine("proj", "z.txt"), "z", 900);
        Directory.CreateDirectory(Path.Combine(_downloads, "proj", ".git"));
        var plan = await Analyze();

        Assert.Equal(Path.Combine("Archiv", "Ordner"), Str(Item(plan, "alt"), "target"));
        Assert.Equal("keep", Str(Item(plan, "frisch"), "action"));
        Assert.Equal("keep", Str(Item(plan, "proj"), "action"));
    }

    [Fact]
    public async Task Duplicates_are_found_by_content_and_only_the_extra_copies_are_proposed_to_move()
    {
        Make("a.txt", "same content", 100);
        Make("a - Kopie.txt", "same content", 50);
        Make(Path.Combine("ordner", "b.txt"), "other", 100);
        Make("b-lose.txt", "other", 100);
        var plan = await Analyze();

        Assert.Equal("move", Str(Item(plan, "a.txt"), "action"));
        var copy = Item(plan, "a - Kopie.txt");
        Assert.Equal("duplicate", Str(copy, "action"));
        Assert.Equal(Path.Combine("_Duplikate", "Dokumente"), Str(copy, "target"));
        Assert.Equal("duplicate", Str(Item(plan, "b-lose.txt"), "action"));   // the copy inside a folder is the original and stays
        Assert.Equal(2, plan.GetProperty("duplicates").GetInt32());
    }

    [Fact]
    public async Task Applying_moves_everything_deletes_nothing_and_undo_puts_it_all_back()
    {
        Make("Rechnung.pdf", "r", 800);
        Make("foto.jpg", "f", 400);
        Make("kopie.jpg", "f", 300);
        var before = FileCount(_downloads);
        var plan = await Analyze();

        var result = await Apply(plan);
        Assert.Equal(3, result.GetProperty("moved").GetInt32());
        Assert.Empty(result.GetProperty("errors").EnumerateArray());
        Assert.Equal(before, FileCount(_downloads));   // nothing was deleted
        Assert.True(File.Exists(Path.Combine(_downloads, "Wichtig", "Dokumente", "Finanzen", "2024", "Rechnung.pdf")));
        Assert.True(File.Exists(Path.Combine(_downloads, "_Duplikate", "Bilder", "kopie.jpg")));
        Assert.False(File.Exists(Path.Combine(_downloads, "foto.jpg")));

        var undo = JsonDocument.Parse(_svc.Undo(JsonSerializer.Serialize(new { runId = Str(result, "runId") }))).RootElement;
        Assert.Equal(3, undo.GetProperty("restored").GetInt32());
        Assert.True(File.Exists(Path.Combine(_downloads, "foto.jpg")));
        Assert.False(Directory.Exists(Path.Combine(_downloads, "Wichtig")));   // the folders the run made are gone again
        Assert.Throws<ArgumentException>(() => _svc.Undo(JsonSerializer.Serialize(new { runId = Str(result, "runId") })));
    }

    [Fact]
    public async Task An_existing_file_at_the_target_is_never_overwritten()
    {
        Make("foto.jpg", "new", 400);
        var existing = Path.Combine(_downloads, "Archiv", "Bilder", "2025");
        Directory.CreateDirectory(existing);
        File.WriteAllText(Path.Combine(existing, "foto.jpg"), "old");
        var plan = await Analyze();
        await Apply(plan);
        Assert.Equal("old", File.ReadAllText(Path.Combine(existing, "foto.jpg")));
        Assert.Equal("new", File.ReadAllText(Path.Combine(existing, "foto (2).jpg")));
    }

    [Fact]
    public async Task Folder_names_can_be_changed_and_single_items_skipped()
    {
        Make("foto.jpg", "f", 400);
        Make("video.mp4", "v", 400);
        var plan = await Analyze();
        var key = _downloads + "|" + Str(Item(plan, "foto.jpg"), "target");
        var result = await Apply(plan, new { folderMap = new Dictionary<string, string> { [key] = Path.Combine("Meine Bilder", "Urlaub") }, skipIds = new[] { Str(Item(plan, "video.mp4"), "id") } });

        Assert.True(File.Exists(Path.Combine(_downloads, "Meine Bilder", "Urlaub", "foto.jpg")));
        Assert.True(File.Exists(Path.Combine(_downloads, "video.mp4")));
        Assert.Equal(1, result.GetProperty("moved").GetInt32());
    }

    [Fact]
    public async Task A_target_that_leaves_the_folder_is_refused()
    {
        Make("foto.jpg", "f", 400);
        var plan = await Analyze();
        var key = _downloads + "|" + Str(Item(plan, "foto.jpg"), "target");
        var result = await Apply(plan, new { folderMap = new Dictionary<string, string> { [key] = Path.Combine("..", "Raus") } });
        Assert.Equal(0, result.GetProperty("moved").GetInt32());
        Assert.True(File.Exists(Path.Combine(_downloads, "foto.jpg")));
        Assert.Null(OrganizeServiceTarget("a/../b"));
        Assert.Null(OrganizeServiceTarget("C:\\Windows"));
        Assert.NotNull(OrganizeServiceTarget("Gut/Pfad"));
    }

    static string? OrganizeServiceTarget(string s) => typeof(OrganizeService).GetMethod("CleanTarget", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!.Invoke(null, [s]) as string;

    [Fact]
    public async Task A_file_that_changed_after_the_analysis_is_left_alone()
    {
        var p = Make("foto.jpg", "f", 400);
        var plan = await Analyze();
        File.WriteAllText(p, "changed meanwhile");
        var result = await Apply(plan);
        Assert.Equal(0, result.GetProperty("moved").GetInt32());
        Assert.Single(result.GetProperty("errors").EnumerateArray());
        Assert.True(File.Exists(p));
    }

    [Fact]
    public async Task Marked_files_go_to_the_recycle_bin_only_after_the_confirmation_and_are_not_moved()
    {
        var p = Make("weg.txt", "x", 400);
        Make("bleibt.txt", "y", 400);
        var plan = await Analyze();
        _confirm.Answer = false;
        var declined = await Apply(plan, new { deleteIds = new[] { Str(Item(plan, "weg.txt"), "id") } });
        Assert.True(declined.GetProperty("deleteDeclined").GetBoolean());
        Assert.Empty(_recycle.Recycled);
        Assert.True(File.Exists(p));   // declined: neither deleted nor moved

        _confirm.Answer = true;
        var ok = await Apply(plan, new { deleteIds = new[] { Str(Item(plan, "weg.txt"), "id") } });
        Assert.Equal(1, ok.GetProperty("deleted").GetInt32());
        Assert.Equal([p], _recycle.Recycled);
        Assert.True(File.Exists(Path.Combine(_downloads, "Archiv", "Dokumente", "Allgemein", "2025", "bleibt.txt")));
    }

    [Fact]
    public async Task Nothing_is_asked_when_nothing_is_marked_for_deletion()
    {
        Make("a.txt", "x", 400);
        await Apply(await Analyze());
        Assert.Equal(0, _confirm.Asked);
    }

    [Fact]
    public async Task Drives_the_whole_profile_windows_and_missing_folders_are_refused()
    {
        foreach (var bad in new[] { Path.GetPathRoot(_tmp)!, Path.Combine(_tmp, "profile"), Environment.GetFolderPath(Environment.SpecialFolder.Windows), Path.Combine(_tmp, "gibt-es-nicht"), Path.Combine(_tmp, "app", "data") })
            await Assert.ThrowsAsync<ArgumentException>(() => _svc.AnalyzeAsync(JsonSerializer.Serialize(new { roots = new[] { bad } })));
    }

    [Fact]
    public async Task A_second_analysis_leaves_the_result_of_the_first_run_alone()
    {
        Make("foto.jpg", "f", 400);
        await Apply(await Analyze());
        var again = await Analyze();
        Assert.Empty(again.GetProperty("items").EnumerateArray());   // Archiv/ now holds it; nothing loose is left
    }

    [Fact]
    public void Known_folders_are_listed_with_their_paths()
    {
        var list = JsonDocument.Parse(_svc.Folders()).RootElement;
        Assert.Contains(list.EnumerateArray(), f => Str(f, "id") == "downloads" && f.GetProperty("exists").GetBoolean());
    }
}
