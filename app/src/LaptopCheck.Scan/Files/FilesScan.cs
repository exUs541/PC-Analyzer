using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LaptopCheck.Core;
using LaptopCheck.Scan.Sections;

namespace LaptopCheck.Scan.Files;

/// <summary>Everything the files scan may use. Real sources in production, fakes in tests.</summary>
public sealed class FilesContext
{
    public required ScanEnvironment Env { get; init; }
    public required ISystemProbe Probe { get; init; }
    public required IRegistry Registry { get; init; }
    public required IProcessRunner Processes { get; init; }
    public Func<DateTime> Now { get; init; } = () => DateTime.Now;
    public Action<string>? Progress { get; init; }
}

public sealed record FilesScanOptions(
    IReadOnlyList<string> ExtraRoots,
    IReadOnlyList<string> ExtraCloudRoots,
    int SecondsPerRoot = AppConfig.DefaultSecondsPerRoot,
    bool SkipRepos = false,
    bool SkipDataDirs = false);

/// <summary>
/// READ-ONLY scan of your files, cloud folders (Google Drive, OneDrive, ...) and local git repositories: nothing is ever
/// written, moved or deleted here. Returns the "files" document the dashboard analyses.
/// </summary>
public static class FilesScan
{
    sealed record Target(string Label, string Path, string Kind, string? Provider, string? ProviderId, string? Mode);

    static readonly string[] GitSkipNames =
    [
        "AppData", "node_modules", ".git", "Windows", "Program Files", "Program Files (x86)", "ProgramData", "$Recycle.Bin", "System Volume Information",
        ".nuget", ".cache", ".npm", ".gradle", ".m2", ".vscode", ".cargo", ".rustup", ".pyenv", "venv", ".venv", "__pycache__", "site-packages", ".docker",
        ".android", ".conda", "miniconda3", "anaconda3", "Library",
    ];

    static readonly string[] DataDirSkip =
    [
        "Microsoft", "Packages", "Temp", "Programs", "ConnectedDevices", "PlaceholderTileLogoFolder", "Publishers", "VirtualStore", "D3DSCache", "Comms",
        "History", "IconCache.db", "Package Cache", "regid.1991-06.com.microsoft", "USOPrivate", "USOShared", "SoftwareDistribution", "ssh", "Application Data",
    ];

    static string? TicksIso(long ticks)
    {
        if (ticks <= 0 || ticks == long.MaxValue) return null;
        try { return new DateTime(ticks, DateTimeKind.Utc).ToLocalTime().ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture); }
        catch (ArgumentOutOfRangeException) { return null; }
    }

    public static IReadOnlyList<(string Label, string Path)> KnownUserFolders(FilesContext c)
    {
        var downloads = Val.Clean(RegValue(c, @"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders", "{374DE290-123F-4565-9164-39C4925E467B}"));
        if (downloads is null && !string.IsNullOrEmpty(c.Env.UserProfile)) downloads = Path.Combine(c.Env.UserProfile, "Downloads");
        (string, string?)[] pairs =
        [
            ("Dokumente", c.Env.MyDocuments), ("Desktop", c.Env.Desktop), ("Downloads", downloads),
            ("Bilder", c.Env.MyPictures), ("Videos", c.Env.MyVideos), ("Musik", c.Env.MyMusic),
        ];
        return pairs.Where(p => !string.IsNullOrEmpty(p.Item2) && Directory.Exists(p.Item2)).Select(p => (p.Item1, p.Item2!)).ToList();
    }

    static object? RegValue(FilesContext c, string subKey, string name)
    {
        using var k = c.Registry.Open(RegHive.CurrentUser, subKey);
        try { return k?.GetValue(name); }
        catch { return null; }
    }

    static JsonObject FolderJson(FolderAgg a, string rootLabel) => J.O(
        ("root", rootLabel), ("path", a.Path), ("depth", a.Depth), ("files", a.Files), ("bytes", a.Bytes),
        ("onlineBytes", a.OnlineBytes), ("matchFiles", a.MatchFiles), ("matchBytes", a.MatchBytes),
        ("newest", TicksIso(a.NewestTicks)), ("oldest", TicksIso(a.OldestTicks)),
        ("cf", a.CatFiles.Select(x => (object?)x).ToList()), ("cb", a.CatBytes.Select(x => (object?)x).ToList()));

    /// <summary>Immediate sub-folders of the places where programs keep their data (AppData, ProgramData, dot-folders in the profile).</summary>
    public static JsonArray DataDirs(FilesContext c, int totalSeconds = 45, int perDirSeconds = 4)
    {
        var parents = new List<(string Where, string Path, bool DotOnly)>();
        void AddParent(string label, string path, bool dotOnly)
        {
            if (!string.IsNullOrEmpty(path) && Directory.Exists(path)) parents.Add((label, path, dotOnly));
        }
        AddParent("LocalAppData", c.Env.LocalAppData, false);
        AddParent("AppData", c.Env.AppData, false);
        AddParent("ProgramData", c.Env.ProgramData, false);
        AddParent("UserProfile", c.Env.UserProfile, true);

        var sw = Stopwatch.StartNew();
        var candidates = new List<(string Where, DirectoryInfo Dir)>();
        foreach (var par in parents)
        {
            IEnumerable<DirectoryInfo> dirs;
            try { dirs = new DirectoryInfo(par.Path).EnumerateDirectories("*", new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = 0 }).ToList(); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { continue; }
            foreach (var d in dirs)
            {
                if (Array.Exists(DataDirSkip, s => s.Equals(d.Name, StringComparison.OrdinalIgnoreCase))) continue;
                if (par.DotOnly && !d.Name.StartsWith('.')) continue;
                if ((d.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                candidates.Add((par.Where, d));
            }
        }

        return MeasureDirs(candidates, sw, totalSeconds, perDirSeconds, 400);
    }

    /// <summary>
    /// Size, creation date and the write time of the NEWEST file for each folder (the folder's own date only changes when something is added
    /// or removed directly in it, so it says little about use). Sorted by size; what the time budget did not reach is left out.
    /// </summary>
    static JsonArray MeasureDirs(List<(string Where, DirectoryInfo Dir)> candidates, Stopwatch sw, int totalSeconds, int perDirSeconds, int take)
    {
        var results = new (string Where, string Name, string Path, long Bytes, bool Partial, string? Modified, string? Created, string? Newest)?[candidates.Count];
        Parallel.For(0, candidates.Count, new ParallelOptions { MaxDegreeOfParallelism = 4 }, i =>
        {
            if (sw.Elapsed.TotalSeconds > totalSeconds) return;
            var (where, d) = candidates[i];
            long bytes = 0, newest = 0;
            var partial = false;
            try { (bytes, partial, newest) = SystemSections.FolderStatsCapped(d.FullName, perDirSeconds); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            string? mod = null, created = null;
            try { mod = TicksIso(d.LastWriteTimeUtc.Ticks); created = TicksIso(d.CreationTimeUtc.Ticks); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            results[i] = (where, d.Name, d.FullName, bytes, partial, mod, created, newest > 0 ? TicksIso(newest) : null);
        });

        return J.A(results.Where(r => r.HasValue).Select(r => r!.Value).OrderByDescending(r => r.Bytes).Take(take).Select(r =>
            (JsonNode?)J.O(("where", r.Where), ("name", r.Name), ("path", r.Path), ("bytes", r.Bytes), ("partial", r.Partial), ("modified", r.Modified), ("created", r.Created), ("newest", r.Newest))));
    }

    static readonly string[] RootSkip =
    [
        "Windows", "Program Files", "Program Files (x86)", "ProgramData", "Users", "Recovery", "System Volume Information", "$Recycle.Bin", "$WinREAgent",
        "Documents and Settings", "PerfLogs", "Config.Msi", "Intel", "inetpub", "MSOCache",
    ];

    static readonly string[] ProgramFilesSkip =
    [
        "Common Files", "WindowsApps", "ModifiableWindowsApps", "Windows Defender", "Windows Defender Advanced Threat Protection", "Windows Mail", "Windows Media Player",
        "Windows NT", "Windows Photo Viewer", "Windows Sidebar", "WindowsPowerShell", "Internet Explorer", "Microsoft Update Health Tools", "Reference Assemblies",
        "Uninstall Information", "UNP", "MSBuild", "Windows Portable Devices",
    ];

    static readonly string[] ProfileSkip =
    [
        "AppData", "Desktop", "Documents", "Downloads", "Music", "Pictures", "Videos", "Favorites", "Links", "Contacts", "Searches", "Saved Games", "3D Objects",
    ];

    /// <summary>
    /// Places where things pile up that nobody remembers installing: the top level of the system drive, program folders, AppData\LocalLow,
    /// AppData\Local\Programs and your own folders in the profile. (Program data below AppData/ProgramData and hidden profile folders: <see cref="DataDirs"/>.)
    /// </summary>
    public static JsonArray Places(FilesContext c, IReadOnlyList<string> excludeRoots, int totalSeconds = 40, int perDirSeconds = 4)
    {
        var parents = new List<(string Where, string Path, string[] Skip, bool NoDots)>();
        void Add(string label, string? path, string[] skip, bool noDots = false)
        {
            if (!string.IsNullOrEmpty(path) && Directory.Exists(path)) parents.Add((label, path, skip, noDots));
        }
        Add("RootC", string.IsNullOrEmpty(c.Env.SystemDrive) ? null : c.Env.SystemDrive.TrimEnd('\\') + @"\", RootSkip);
        Add("ProgramFiles", c.Env.ProgramFiles, ProgramFilesSkip);
        Add("ProgramFiles", c.Env.ProgramFilesX86, ProgramFilesSkip);
        Add("LocalPrograms", string.IsNullOrEmpty(c.Env.LocalAppData) ? null : Path.Combine(c.Env.LocalAppData, "Programs"), []);
        Add("LocalLow", string.IsNullOrEmpty(c.Env.UserProfile) ? null : Path.Combine(c.Env.UserProfile, "AppData", "LocalLow"), []);
        Add("UserFolder", c.Env.UserProfile, ProfileSkip, noDots: true);

        var sw = Stopwatch.StartNew();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var candidates = new List<(string Where, DirectoryInfo Dir)>();
        foreach (var par in parents)
        {
            IEnumerable<DirectoryInfo> dirs;
            try { dirs = new DirectoryInfo(par.Path).EnumerateDirectories("*", new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = 0 }).ToList(); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { continue; }
            foreach (var d in dirs)
            {
                if (Array.Exists(par.Skip, s => s.Equals(d.Name, StringComparison.OrdinalIgnoreCase))) continue;
                if (par.NoDots && d.Name.StartsWith('.')) continue;                                  // hidden profile folders: DataDirs
                if (par.Where == "UserFolder" && Regex.IsMatch(d.Name, @"^(OneDrive|NTUSER|ntuser)", RegexOptions.IgnoreCase)) continue;
                if ((d.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                if (excludeRoots.Any(r => PathUtil.IsUnder(d.FullName, r) || PathUtil.IsUnder(r, d.FullName))) continue;   // a live cloud folder is not "unknown"
                if (seen.Add(d.FullName)) candidates.Add((par.Where, d));
            }
        }
        return MeasureDirs(candidates, sw, totalSeconds, perDirSeconds, 300);
    }

    static JsonArray ExtStats(FilesContext c, FileScanner scan, int max = 150) => J.A(scan.TopExts(max).Select(kv =>
    {
        var st = kv.Value;
        var dirs = st.Dirs.OrderByDescending(d => d.Value).Take(5).Select(d => (JsonNode?)J.O(("p", d.Key), ("n", d.Value)));
        return (JsonNode?)J.O(
            ("ext", kv.Key), ("files", st.Files), ("bytes", st.Bytes), ("newest", TicksIso(st.Newest)), ("cloudFiles", st.CloudFiles),
            ("handler", c.Probe.FileHandler(kv.Key)), ("dirs", J.A(dirs)));
    }));

    static JsonArray Repos(FilesContext c, FilesScanOptions o, IReadOnlyList<string> cloudRoots)
    {
        c.Progress?.Invoke("git repositories");
        var searchRoots = new List<string> { c.Env.UserProfile };
        searchRoots.AddRange(o.ExtraRoots.Where(x => !string.IsNullOrEmpty(x) && Directory.Exists(x)));
        searchRoots.AddRange(cloudRoots);   // a git repository inside a cloud folder is a classic source of sync conflicts
        var paths = FileScanner.FindGitRepos(searchRoots, 6, 40, GitSkipNames);
        var gitExe = c.Processes.FindOnPath("git.exe");

        var budget = Stopwatch.StartNew();
        var infos = new JsonObject?[paths.Count];
        Parallel.For(0, paths.Count, new ParallelOptions { MaxDegreeOfParallelism = 4 }, i =>
        {
            if (budget.Elapsed.TotalSeconds > 90) return;
            infos[i] = GitRepos.Info(c, paths[i], gitExe, cloudRoots);
        });
        return J.A(infos.Where(i => i is not null));
    }

    public static JsonObject Run(FilesContext c, FilesScanOptions o)
    {
        var sw = Stopwatch.StartNew();
        var providers = CloudProviders.Detect(c.Env, c.Probe, o.ExtraCloudRoots);
        // an old mirror folder that is not synced any more is reported (providers) but is not a cloud: nothing in it counts as "already in the cloud"
        var live = providers.Where(p => p.Mode != CloudProviders.LeftoverMode).ToList();
        var cloudRoots = live.Select(p => p.Root).ToList();
        var scan = new FileScanner(25L * 1024 * 1024, 262144, 6000, 400000);

        // independent of the folder walk: start them right away
        var reposTask = o.SkipRepos || string.IsNullOrEmpty(c.Env.UserProfile) ? Task.FromResult(J.A([])) : Task.Run(() => Repos(c, o, cloudRoots));
        var dataDirsTask = o.SkipDataDirs ? Task.FromResult(J.A([])) : Task.Run(() =>
        {
            c.Progress?.Invoke("program data folders");
            return DataDirs(c);
        });
        var placesTask = o.SkipDataDirs ? Task.FromResult(J.A([])) : Task.Run(() =>
        {
            c.Progress?.Invoke("places (system drive, programs, profile)");
            return Places(c, cloudRoots);
        });
        // old mirror folders: how much of them already lies in the live drive of the same account (read-only, time-boxed)
        var compareTask = Task.Run(() =>
        {
            var res = new Dictionary<string, JsonObject>(StringComparer.OrdinalIgnoreCase);
            foreach (var old in providers.Where(p => p.Mode == CloudProviders.LeftoverMode))
            {
                var lv = live.FirstOrDefault(p => p.Id == old.Id && p.Mode == "stream") ?? live.FirstOrDefault(p => p.Id == old.Id);
                if (lv is null || !Directory.Exists(old.Root) || !Directory.Exists(lv.Root)) continue;
                c.Progress?.Invoke("comparing the old folder with the drive");
                res[old.Root] = LeftoverCompare.Run(old.Root, lv.Root);
            }
            return res;
        });

        // roots: cloud first (feeds the name+size index), then local folders (those living inside a cloud root count as cloud)
        var targets = live.Select(p => new Target(p.Name, p.Root, "cloud", p.Name, p.Id, p.Mode)).ToList();
        var localDefs = KnownUserFolders(c).ToList();
        foreach (var x in o.ExtraRoots)
        {
            if (string.IsNullOrEmpty(x) || !Directory.Exists(x)) continue;
            var sameFolderTwice = localDefs.Any(e => PathUtil.IsUnder(x, e.Path) && PathUtil.IsUnder(e.Path, x));
            if (!sameFolderTwice) localDefs.Add((Path.GetFileName(x.TrimEnd('\\', '/')), x));
        }
        foreach (var d in localDefs)
        {
            if (live.Any(p => PathUtil.IsUnder(d.Path, p.Root))) continue;   // already covered by the cloud scan of that provider
            targets.Add(new Target(d.Label, d.Path, "local", null, null, null));
        }
        // drop roots that sit inside another root of the same kind
        var kept = targets.Where(t => !targets.Any(other =>
            !ReferenceEquals(other, t) && other.Kind == t.Kind && PathUtil.IsUnder(t.Path, other.Path) && !PathUtil.IsUnder(other.Path, t.Path))).ToList();

        var roots = new List<JsonNode?>();
        var folders = new List<JsonNode?>();
        var cloudTree = new List<JsonNode?>();
        foreach (var t in kept)
        {
            c.Progress?.Invoke("files: " + t.Label);
            var r = scan.ScanRoot(t.Path, t.Label, t.Kind, t.Provider, o.SecondsPerRoot);
            roots.Add(J.O(
                ("label", t.Label), ("path", t.Path), ("kind", t.Kind), ("provider", t.Provider), ("mode", t.Mode),
                ("files", r.Files), ("bytes", r.Bytes), ("onlineBytes", r.OnlineBytes), ("partial", r.Partial), ("seconds", Math.Round(r.Seconds, 1))));
            var depth0 = r.Folders.Where(f => f.Depth == 0);
            var d1 = r.Folders.Where(f => f.Depth == 1).OrderByDescending(f => f.Bytes).Take(250);
            var d2 = r.Folders.Where(f => f.Depth == 2).OrderByDescending(f => f.Bytes).Take(300);
            foreach (var a in depth0.Concat(d1).Concat(d2)) folders.Add(FolderJson(a, t.Label));
            if (t.Kind == "cloud")
            {
                var issues = new JsonObject();
                foreach (var (k, v) in r.NameIssueCounts) issues[k] = v;
                cloudTree.Add(J.O(
                    ("provider", t.Provider), ("providerId", t.ProviderId), ("mode", t.Mode), ("root", t.Path), ("files", r.Files), ("bytes", r.Bytes),
                    ("rootFiles", r.RootFiles), ("maxDepth", r.MaxDepth), ("emptyDirs", r.EmptyDirs), ("nativeDocs", r.NativeDocs), ("partial", r.Partial),
                    ("topFolders", r.TopFolders.Select(x => (object?)x).ToList()), ("nameIssues", issues),
                    ("nameIssueSamples", r.NameIssueSamples.Select(x => (object?)x).ToList())));
            }
        }

        JsonNode? FileJson(FileRec d) => J.O(("p", d.Path), ("s", d.Size), ("m", TicksIso(d.Ticks)), ("c", FileScanner.CatNames[d.Cat]), ("cloud", d.CloudPath));
        var docs = scan.TopDocs(6000).Select(FileJson).ToList();
        var big = scan.TopBig(300).Select(FileJson).ToList();
        var dupes = scan.TopDupes(120).Select(d => (JsonNode?)J.O(
            ("name", d.Name), ("size", d.Size), ("count", d.Count), ("inCloud", d.InCloud), ("inLocal", d.InLocal), ("paths", d.Paths.Select(p => (object?)p).ToList()))).ToList();

        var repos = reposTask.GetAwaiter().GetResult();
        var dataDirs = dataDirsTask.GetAwaiter().GetResult();
        var places = placesTask.GetAwaiter().GetResult();
        var compares = compareTask.GetAwaiter().GetResult();
        var exts = ExtStats(c, scan);

        return J.O(
            ("scannedAt", c.Now().ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture)),
            ("seconds", Math.Round(sw.Elapsed.TotalSeconds, 1)),
            ("catNames", FileScanner.CatNames.Select(n => (object?)n).ToList()),
            ("providers", J.A(providers.Select(p =>
            {
                var pj = p.ToJson();
                if (compares.TryGetValue(p.Root, out var cmp)) pj["compare"] = cmp;
                return (JsonNode?)pj;
            }))),
            ("roots", J.A(roots)),
            ("folders", J.A(folders)),
            ("docs", J.A(docs)),
            ("big", J.A(big)),
            ("dupes", J.A(dupes)),
            ("cloudTree", J.A(cloudTree)),
            ("gitRepos", repos),
            ("exts", exts),
            ("dataDirs", dataDirs),
            ("places", places),
            ("gitAvailable", c.Processes.FindOnPath("git.exe") is not null));
    }
}
