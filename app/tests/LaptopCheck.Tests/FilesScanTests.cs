using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using LaptopCheck.Core;
using LaptopCheck.Scan;
using LaptopCheck.Scan.Files;
using LaptopCheck.Scan.Real;

namespace LaptopCheck.Tests;

/// <summary>
/// The scenario of tests/files.test.ps1 on a real temporary file tree (and real git): documents, downloads, a cloud folder with
/// duplicates and messy names, three git repositories, program data folders.
/// </summary>
public sealed class FilesScenario : IDisposable
{
    public string Base { get; } = Path.Combine(Path.GetTempPath(), "lc-files-" + Guid.NewGuid().ToString("N"));
    public string Home => Path.Combine(Base, "home");
    public string Cloud => Path.Combine(Base, "cloud", "Meine Ablage");
    internal FakeProbe Probe { get; } = new();
    public bool GitAvailable { get; }
    public JsonObject Result { get; }
    public List<string> Said { get; } = [];

    public FilesScenario()
    {
        void NewFile(string path, int size)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllBytes(path, new byte[size]);
        }
        const int Mb = 1024 * 1024;
        var home = Home;
        var appData = Path.Combine(home, "AppData", "Roaming");
        var localAppData = Path.Combine(home, "AppData", "Local");

        // local: documents, downloads, desktop, a repo
        NewFile($@"{home}\Documents\Steuer\2024\steuer.pdf", 300000);
        NewFile($@"{home}\Documents\Steuer\2024\Rechnung.pdf", 2000);
        NewFile($@"{home}\Documents\Steuer\Kopie von altes.docx", 5000);
        NewFile($@"{home}\Documents\Notizen\ideen.txt", 1500);
        NewFile($@"{home}\Documents\Zeugnis.pdf", 120000);
        NewFile($@"{home}\Downloads\setup.exe", 400000);
        NewFile($@"{home}\Downloads\backup.iso", 26 * Mb);
        NewFile($@"{home}\Downloads\urlaub.mp4", 27 * Mb);
        NewFile($@"{home}\Downloads\thumbs\IMG_001.jpg", 150000);
        NewFile($@"{home}\Desktop\todo.txt", 1200);
        NewFile($@"{home}\Desktop\3d\szene.blend", 5000);
        NewFile($@"{home}\Desktop\3d\auto.blend", 7000);
        NewFile($@"{home}\Desktop\3d\render\frame1.png", 900);
        // program data folders
        NewFile($@"{appData}\Blender Foundation\Blender\4.2\config\userpref.blend", 30000);
        NewFile($@"{localAppData}\Microsoft\skipme\x.bin", 10);
        NewFile($@"{localAppData}\Ollama\models\m.bin", 60000);
        NewFile($@"{home}\.gradle\caches\a.jar", 20000);
        NewFile($@"{home}\visible-folder\not-a-dot.txt", 10);
        Directory.CreateDirectory($@"{home}\Documents\Leer");
        // cloud: has steuer.pdf again (same name + size), loose files, bad names, deep tree
        NewFile($@"{Cloud}\steuer.pdf", 300000);
        NewFile($@"{Cloud}\Unbenannt.docx", 3000);
        NewFile($@"{Cloud}\loses1.txt", 1100);
        NewFile($@"{Cloud}\loses2.txt", 1200);
        NewFile($@"{Cloud}\Archiv\2020\a\b\c\d\tief.pdf", 4000);
        NewFile($@"{Cloud}\Archiv\projekt (1).docx", 2500);
        NewFile($@"{Cloud}\Notiz.gdoc", 800);
        Directory.CreateDirectory($@"{Cloud}\Neuer Ordner");

        // a git repo with node_modules, remote, one commit and one uncommitted change
        var repo = $@"{home}\dev\myrepo";
        NewFile($@"{repo}\readme.md", 500);
        NewFile($@"{repo}\package.json", 20);
        NewFile($@"{repo}\app.sln", 20);
        NewFile($@"{repo}\ProjectSettings\ProjectVersion.txt", 20);
        NewFile($@"{repo}\node_modules\dep\index.js", 40000);

        var git = new RealProcessRunner().FindOnPath("git.exe");
        GitAvailable = git is not null;
        if (git is not null)
        {
            void Git(params string[] args) => new RealProcessRunner().Run(git, args, TimeSpan.FromSeconds(30));
            Git("-C", repo, "init", "-q");
            Git("-C", repo, "config", "user.email", "test@example.com");
            Git("-C", repo, "config", "user.name", "Test");
            Git("-C", repo, "remote", "add", "origin", "https://github.com/demo-user/ComputerManager.git");
            Git("-C", repo, "add", "readme.md");
            Git("-C", repo, "commit", "-q", "-m", "init");
            File.AppendAllText($@"{repo}\readme.md", "change");
            Git("init", "-q", $@"{home}\dev\nogit-remote");
            Git("init", "-q", $@"{Cloud}\synced-repo");   // a repo inside the cloud folder: a bad idea, should be flagged
        }
        else
        {
            foreach (var d in new[] { $@"{home}\dev\nogit-remote\.git", $@"{Cloud}\synced-repo\.git", $@"{repo}\.git" }) Directory.CreateDirectory(d);
        }

        var env = Env();
        var context = new FilesContext
        {
            Env = env, Probe = Probe, Registry = new FakeRegistry(), Processes = new RealProcessRunner(),
            Progress = s => { lock (Said) Said.Add(s); },
        };
        Probe.Handlers[".blend"] = "blender.exe";
        Result = FilesScan.Run(context, new FilesScanOptions(
            [$@"{home}\Documents", $@"{home}\Downloads", $@"{home}\Desktop"], [Cloud], SecondsPerRoot: 20));
    }

    public ScanEnvironment Env() => new()
    {
        UserProfile = Home, LocalAppData = Path.Combine(Home, "AppData", "Local"), AppData = Path.Combine(Home, "AppData", "Roaming"),
        ProgramData = Path.Combine(Base, "ProgramData"), SystemRoot = Path.Combine(Base, "Windows"), SystemDrive = Base, Temp = Path.Combine(Base, "Temp"),
    };

    public void Dispose()
    {
        try
        {
            foreach (var f in Directory.EnumerateFiles(Base, "*", SearchOption.AllDirectories)) File.SetAttributes(f, FileAttributes.Normal);   // git objects are read-only
            Directory.Delete(Base, true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
}

public class FilesScanTests(FilesScenario s) : IClassFixture<FilesScenario>
{
    static string Str(JsonNode? n) => n?.ToString() ?? "<null>";
    static long Long(JsonNode? n) => (long)n!;
    JsonArray Arr(string name) => (JsonArray)s.Result[name]!;
    JsonObject Folder(string root, int depth, string? pathEnd = null) =>
        Arr("folders").OfType<JsonObject>().First(f => Str(f["root"]) == root && (int)f["depth"]! == depth && (pathEnd is null || Str(f["path"]).EndsWith(pathEnd)));

    [Fact]
    public void Configured_cloud_root_is_reported_as_provider()
    {
        var found = CloudProviders.Detect(s.Env(), s.Probe, [s.Cloud]);
        var custom = Assert.Single(found, p => p.Id == "custom");
        Assert.Equal(Path.GetFullPath(s.Cloud), custom.Root);
        Assert.Equal("configured by you", custom.DetectedBy);
    }

    [Theory]
    [InlineData("git@github.com:demo-bulk/demo-app.git", "demo-bulk/demo-app")]
    [InlineData("https://github.com/demo-user/ComputerManager", "demo-user/ComputerManager")]
    [InlineData("https://github.com/demo-user/ComputerManager.git", "demo-user/ComputerManager")]
    [InlineData("https://gitlab.com/x/y.git", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void Github_remote_urls_become_owner_slash_repo(string? url, string? expected) =>
        Assert.Equal(expected, GitRepos.FullNameOf(url));

    [Fact]
    public void Path_under_root_is_exact_about_prefix_siblings()
    {
        Assert.True(PathUtil.IsUnder(s.Cloud + @"\Archiv", s.Cloud));
        Assert.True(PathUtil.IsUnder(s.Cloud, s.Cloud));
        Assert.False(PathUtil.IsUnder(s.Cloud + @"-other\x", s.Cloud));
        Assert.False(PathUtil.IsUnder(null, s.Cloud));
    }

    [Fact]
    public void Providers_roots_and_progress()
    {
        Assert.True(s.Said.Count >= 4, "progress: " + string.Join(", ", s.Said));
        Assert.Equal(12, Arr("catNames").Count);
        var cloudRoots = Arr("roots").OfType<JsonObject>().Where(r => Str(r["kind"]) == "cloud").ToList();
        Assert.Single(cloudRoots);
        var local = Arr("roots").OfType<JsonObject>().Where(r => Str(r["kind"]) == "local").Select(r => Str(r["label"])).Order().ToList();
        Assert.Equal(["Desktop", "Documents", "Downloads"], local);
    }

    [Fact]
    public void Folder_statistics_per_category()
    {
        var docs = Folder("Documents", 0);
        Assert.Equal(5, Long(docs["files"]));
        Assert.Equal(300000 + 2000 + 5000 + 1500 + 120000, Long(docs["bytes"]));
        Assert.Equal(3, Long(docs["cf"]![3]));                                   // pdf count

        var steuer = Folder("Documents", 1, "Steuer");
        Assert.Equal(3, Long(steuer["files"]));
        Assert.Equal(1, Long(steuer["matchFiles"]));                              // steuer.pdf also exists in the cloud (name + size)
        Assert.Equal(300000, Long(steuer["matchBytes"]));
        Assert.Equal(2, Long(Folder("Documents", 2, "2024")["files"]));

        var dl = Folder("Downloads", 0);
        Assert.Equal(400000, Long(dl["cb"]![8]));                                 // installer
        Assert.Equal(26 * 1024 * 1024, Long(dl["cb"]![7]));                       // archive (iso)
        Assert.Equal(27 * 1024 * 1024, Long(dl["cb"]![5]));                       // video
    }

    [Fact]
    public void Big_files_and_documents_with_their_cloud_copy()
    {
        var big = Arr("big").OfType<JsonObject>().ToList();
        Assert.Equal(2, big.Count);                                               // >= 25 MB
        Assert.Equal("video", Str(big[0]["c"]));                                  // biggest first

        var docs = Arr("docs").OfType<JsonObject>().ToList();
        Assert.Single(docs, d => Str(d["p"]).EndsWith("steuer.pdf") && d["cloud"] is not null);
        Assert.Single(docs, d => Str(d["p"]).EndsWith("Zeugnis.pdf") && d["cloud"] is null);
        Assert.DoesNotContain(docs, d => Str(d["p"]).Contains("cloud"));          // cloud files are not local documents
    }

    [Fact]
    public void Cloud_tree_counts_loose_files_depth_and_messy_names()
    {
        var ct = (JsonObject)Arr("cloudTree")[0]!;
        Assert.Equal(5, Long(ct["rootFiles"]));                                   // steuer.pdf, Unbenannt.docx, loses1/2, Notiz.gdoc
        Assert.Equal(6, (int)ct["maxDepth"]!);
        Assert.Equal(1, Long(ct["nativeDocs"]));
        Assert.True(Long(ct["emptyDirs"]) >= 1);
        var issues = (JsonObject)ct["nameIssues"]!;
        Assert.True(issues.ContainsKey("unbenannt"));
        Assert.True(issues.ContainsKey("neuer ordner"));
        Assert.True(issues.ContainsKey("numbered copy (1)"));
        Assert.Contains("Archiv", ((JsonArray)ct["topFolders"]!).Select(Str));
    }

    [Theory]
    [InlineData("Unbenannt.docx", "unbenannt")]
    [InlineData("Neuer Ordner", "neuer ordner")]
    [InlineData("Kopie von x.txt", "kopie von")]
    [InlineData("bericht - Kopie.docx", " - kopie")]
    [InlineData("projekt (1).docx", "numbered copy (1)")]
    [InlineData("projekt (12).docx", "numbered copy (1)")]
    [InlineData("projekt (1234567).docx", null)]
    [InlineData("normal.docx", null)]
    [InlineData("(1).txt", null)]
    public void Name_issues(string name, string? expected) => Assert.Equal(expected, FileScanner.IssueOf(name));

    [Fact]
    public void Duplicates_across_cloud_and_local()
    {
        var dup = Assert.Single(Arr("dupes").OfType<JsonObject>(), d => Str(d["name"]) == "steuer.pdf");
        Assert.True((bool)dup["inCloud"]! && (bool)dup["inLocal"]!);
        Assert.Equal(2, (int)dup["count"]!);
    }

    [Fact]
    public void Git_repositories_with_remote_state_and_project_markers()
    {
        var repos = Arr("gitRepos").OfType<JsonObject>().ToList();
        Assert.Equal(3, repos.Count);                                             // myrepo, nogit-remote, synced-repo
        var r1 = repos.First(r => Str(r["path"]).EndsWith("myrepo"));
        Assert.Equal("demo-user/ComputerManager", Str(r1["fullName"]));
        Assert.True(Long(r1["nodeModulesBytes"]) == 40000);
        Assert.True(Long(r1["sizeBytes"]) >= 40500);
        var markers = ((JsonArray)r1["markers"]!).Select(Str).ToList();
        Assert.Contains("package.json", markers);
        Assert.Contains("*.sln", markers);
        Assert.Contains("ProjectSettings", markers);
        Assert.DoesNotContain("Dockerfile", markers);

        Assert.Null(repos.First(r => Str(r["path"]).EndsWith("nogit-remote"))["fullName"]);
        Assert.NotNull(repos.First(r => Str(r["path"]).EndsWith("synced-repo"))["inCloudRoot"]);   // a repo inside a cloud folder is flagged
        Assert.Null(r1["inCloudRoot"]);
        if (!s.GitAvailable) return;

        Assert.True((bool)r1["dirty"]!);
        Assert.Equal(1, (int)r1["changedFiles"]!);                                // one modified tracked file
        Assert.Equal(4, (int)r1["untrackedFiles"]!);                              // node_modules, package.json, app.sln, ProjectSettings
        Assert.True((bool)r1["noUpstream"]!);                                     // never pushed
        Assert.NotNull(r1["branch"]);
        Assert.NotNull(r1["lastCommit"]);
    }

    [Fact]
    public void File_types_with_folders_and_handler()
    {
        var exts = Arr("exts").OfType<JsonObject>().ToList();
        var blend = Assert.Single(exts, e => Str(e["ext"]) == ".blend");
        Assert.Equal(2, Long(blend["files"]));                                    // the .blend in AppData is outside the scanned roots
        Assert.Equal(12000, Long(blend["bytes"]));
        var dirs = (JsonArray)blend["dirs"]!;
        Assert.Single(dirs);
        Assert.Equal(2, (int)dirs[0]!["n"]!);
        Assert.EndsWith("3d", Str(dirs[0]!["p"]));
        Assert.Equal("blender.exe", Str(blend["handler"]));

        var pdf = Assert.Single(exts, e => Str(e["ext"]) == ".pdf");
        Assert.True(Long(pdf["cloudFiles"]) >= 1);                                // cloud copy counted separately
        Assert.Equal(3, Long(pdf["files"]));                                      // local pdf count, cloud file excluded
        Assert.DoesNotContain(exts, e => Str(e["ext"]) == ".readme");
    }

    [Fact]
    public void Program_data_folders()
    {
        var dd = Arr("dataDirs").OfType<JsonObject>().ToList();
        Assert.Single(dd, d => Str(d["name"]) == "Blender Foundation" && Str(d["where"]) == "AppData");
        Assert.Equal(30000, Long(dd.First(d => Str(d["name"]) == "Blender Foundation")["bytes"]));
        Assert.Single(dd, d => Str(d["name"]) == "Ollama" && Str(d["where"]) == "LocalAppData");
        Assert.DoesNotContain(dd, d => Str(d["name"]) == "Microsoft");            // skipped
        Assert.Single(dd, d => Str(d["name"]) == ".gradle" && Str(d["where"]) == "UserProfile");
        Assert.DoesNotContain(dd, d => Str(d["name"]) == "visible-folder");       // normal profile folder is not program data
        Assert.True(Long(dd[0]["bytes"]) >= Long(dd[^1]["bytes"]));               // sorted by size
    }

    [Fact]
    public void Dashboard_understands_the_files_scan()
    {
        var node = new[] { "node.exe" }.SelectMany(exe => (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries).Select(d => Path.Combine(d.Trim('"'), exe))).FirstOrDefault(File.Exists);
        if (node is null || !s.GitAvailable) return;                              // the dashboard tests need Node.js, the contract needs real repos
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "web", "index.html"))) dir = dir.Parent;
        var repo = dir!.FullName;
        var file = Path.Combine(s.Base, "files-scan.json");
        File.WriteAllText(file, s.Result.ToJsonString());

        var psi = new ProcessStartInfo(node, ["--test", Path.Combine(repo, "tests", "files.test.js")])
        {
            WorkingDirectory = repo, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false,
        };
        psi.Environment["FILES_JSON"] = file;
        using var p = Process.Start(psi)!;
        var stdout = p.StandardOutput.ReadToEnd();
        var stderr = p.StandardError.ReadToEnd();
        Assert.True(p.WaitForExit(120_000), "node did not finish");
        Assert.True(p.ExitCode == 0, stdout + stderr);
        Assert.DoesNotMatch(@"# skipped [1-9]", stdout);                          // the contract test must not be skipped
        Assert.Matches(@"# pass [1-9]", stdout);
    }
}

public class FilesServiceTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "lc-fsvc-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    FilesContext Context(string home) => new()
    {
        Env = new ScanEnvironment { UserProfile = home, LocalAppData = Path.Combine(home, "L"), AppData = Path.Combine(home, "A"), ProgramData = Path.Combine(_dir, "PD"), Temp = Path.Combine(_dir, "T") },
        Probe = new FakeProbe(), Registry = new FakeRegistry(), Processes = new FakeProcessRunner(),
    };

    [Fact]
    public async Task Service_uses_the_settings_from_config_and_stores_files_json()
    {
        var home = Path.Combine(_dir, "home");
        var extra = Path.Combine(_dir, "extra");
        Directory.CreateDirectory(Path.Combine(home, "Downloads"));
        File.WriteAllBytes(Path.Combine(extra, "x.txt").PrepareDir(), new byte[2000]);
        var data = new DataPaths(Path.Combine(_dir, "data"));
        AtomicFile.WriteText(data.Of("config.json"), JsonSerializer.Serialize(new { extraRoots = new[] { extra }, filesSecondsPerRoot = 30 }));

        var service = new FilesScanService(data, () => Context(home));
        await service.RunAsync();

        var json = JsonNode.Parse(File.ReadAllText(data.Files))!;
        var roots = ((JsonArray)json["roots"]!).OfType<JsonObject>().ToList();
        Assert.Contains(roots, r => r["label"]!.ToString() == "extra" && (long)r["files"]! == 1);
        Assert.DoesNotContain(roots, r => r["label"]!.ToString() == "Downloads" && (long)r["files"]! > 0);
    }

    [Fact]
    public async Task Providers_json_lists_the_configured_cloud_folder()
    {
        var home = Path.Combine(_dir, "home");
        var cloud = Path.Combine(_dir, "mycloud");
        Directory.CreateDirectory(home);
        Directory.CreateDirectory(cloud);
        var data = new DataPaths(Path.Combine(_dir, "data"));
        AtomicFile.WriteText(data.Of("config.json"), JsonSerializer.Serialize(new { extraCloudRoots = new[] { cloud } }));
        var service = new FilesScanService(data, () => Context(home));
        var providers = JsonNode.Parse(service.ProvidersJson())!.AsArray();
        Assert.Equal("custom", providers[0]!["id"]!.ToString());
        await Task.CompletedTask;
    }
}

internal static class TestPathExtensions
{
    public static string PrepareDir(this string file)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        return file;
    }
}
