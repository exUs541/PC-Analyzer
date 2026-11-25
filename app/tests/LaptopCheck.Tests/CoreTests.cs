using LaptopCheck.Core;

namespace LaptopCheck.Tests;

public class CoreTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "lc-core-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    [Fact]
    public void WriteText_creates_the_folder_and_swaps_atomically()
    {
        var file = Path.Combine(_dir, "sub", "x.json");
        AtomicFile.WriteText(file, "1");
        AtomicFile.WriteText(file, "2");
        Assert.Equal("2", File.ReadAllText(file));
        Assert.False(File.Exists(file + ".tmp"));
        Assert.False(File.Exists(file + ".bak"));
    }

    [Fact]
    public void WriteText_keeps_exactly_the_previous_version_as_backup()
    {
        var file = Path.Combine(_dir, "x.json");
        AtomicFile.WriteText(file, "1", keepBackup: true);
        AtomicFile.WriteText(file, "2", keepBackup: true);
        AtomicFile.WriteText(file, "3", keepBackup: true);
        Assert.Equal("2", File.ReadAllText(file + ".bak"));
    }

    [Theory]
    [InlineData("{}", true)]
    [InlineData("[1,2,{\"a\":null}]", true)]
    [InlineData("null", true)]
    [InlineData("\"text\"", true)]
    [InlineData("", false)]
    [InlineData("{", false)]
    [InlineData("{} trailing", false)]
    [InlineData("{'a':1}", false)]
    public void IsValidJson(string text, bool expected) => Assert.Equal(expected, AtomicFile.IsValidJson(text));

    [Fact]
    public void Umlauts_survive_a_roundtrip_without_a_byte_order_mark()
    {
        var file = Path.Combine(_dir, "u.json");
        AtomicFile.WriteText(file, "{\"n\":\"Größe äöü\"}");
        Assert.Equal("{\"n\":\"Größe äöü\"}", AtomicFile.ReadText(file));
        Assert.NotEqual(0xEF, File.ReadAllBytes(file)[0]);
    }

    [Fact]
    public void Stores_know_exactly_the_six_documents()
    {
        Assert.Equal(["notes", "history", "config", "projects", "repos", "cleanup"], JsonStores.Names);
        Assert.False(JsonStores.IsStore("snapshot"));
        Assert.Throws<ArgumentException>(() => new JsonStores(new DataPaths(_dir)).PathOf("../x"));
    }

    [Fact]
    public void DataPaths_resolve_prefers_the_explicit_folder()
    {
        var p = DataPaths.Resolve(_dir);
        Assert.Equal(Path.GetFullPath(_dir), p.Dir);
        Assert.True(Directory.Exists(_dir));
    }

    [Fact]
    public void Config_defaults_when_nothing_is_saved()
    {
        var c = AppConfig.Parse("null");
        Assert.Empty(c.ExtraRoots);
        Assert.Empty(c.ExtraCloudRoots);
        Assert.Equal(40, c.FilesSecondsPerRoot);
        Assert.Null(c.GithubApiBase);
        Assert.Equal(40, AppConfig.Parse("{ not json").FilesSecondsPerRoot);
    }

    [Fact]
    public void Config_reads_lists_and_clamps_the_time_budget()
    {
        var c = AppConfig.Parse("""{"extraRoots":["D:\\a","",3,"E:\\b"],"extraCloudRoots":["F:\\c"],"githubUsers":["me"],"githubApiBase":"https://ghe.example/api","filesSecondsPerRoot":9999}""");
        Assert.Equal([@"D:\a", @"E:\b"], c.ExtraRoots);
        Assert.Equal([@"F:\c"], c.ExtraCloudRoots);
        Assert.Equal(["me"], c.GithubUsers);
        Assert.Equal("https://ghe.example/api", c.GithubApiBase);
        Assert.Equal(300, c.FilesSecondsPerRoot);
        Assert.Equal(5, AppConfig.Parse("""{"filesSecondsPerRoot":1}""").FilesSecondsPerRoot);
    }

    [Fact]
    public void Config_ignores_values_of_the_wrong_type()
    {
        var c = AppConfig.Parse("""{"extraRoots":"D:\\a","filesSecondsPerRoot":"fast","githubApiBase":5}""");
        Assert.Empty(c.ExtraRoots);
        Assert.Equal(40, c.FilesSecondsPerRoot);
        Assert.Null(c.GithubApiBase);
    }

    [Fact]
    public void Version_has_no_commit_suffix()
    {
        Assert.DoesNotContain('+', AppInfo.Version);
        Assert.NotEqual("0.0.0", AppInfo.Version);
    }
}
