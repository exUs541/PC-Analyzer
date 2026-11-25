using System.Diagnostics;
using System.Text.Json.Nodes;

namespace LaptopCheck.Scan.Sections;

/// <summary>Autostart entries, running programs, the folders that tend to fill up.</summary>
internal static class SystemSections
{
    public static JsonArray Startup(ScanContext c)
    {
        var list = new List<JsonNode?>();
        (RegHive Hive, string Sub, string Approved, string Scope)[] locations =
        [
            (RegHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", "Run", "machine"),
            (RegHive.LocalMachine, @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run", "Run32", "machine"),
            (RegHive.CurrentUser, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", "Run", "user"),
        ];
        foreach (var loc in locations)
        {
            using var key = c.Registry.Open(loc.Hive, loc.Sub, RegView.Registry64);
            if (key is null) continue;
            foreach (var name in key.GetValueNames())
            {
                var enabled = true;
                foreach (var hive in new[] { RegHive.CurrentUser, RegHive.LocalMachine })
                {
                    using var ak = c.Registry.Open(hive, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\" + loc.Approved);
                    if (ak?.GetValue(name) is byte[] { Length: > 0 } bytes && (bytes[0] & 1) == 1) enabled = false;
                }
                list.Add(J.O(
                    ("name", name),
                    ("command", Convert.ToString(key.GetValue(name), System.Globalization.CultureInfo.InvariantCulture)),
                    ("location", (loc.Hive == RegHive.LocalMachine ? "HKLM" : "HKCU") + @"\Run"),
                    ("scope", loc.Scope),
                    ("enabled", enabled)));
            }
        }

        (string Path, string Scope)[] folders =
        [
            (Path.Combine(c.Env.AppData, @"Microsoft\Windows\Start Menu\Programs\Startup"), "user"),
            (Path.Combine(c.Env.ProgramData, @"Microsoft\Windows\Start Menu\Programs\StartUp"), "machine"),
        ];
        foreach (var f in folders)
        {
            if (!Directory.Exists(f.Path)) continue;
            foreach (var file in FilesIn(f.Path, "*", recurse: false).Where(p => !Path.GetFileName(p).Equals("desktop.ini", StringComparison.OrdinalIgnoreCase)))
            {
                list.Add(J.O(("name", Path.GetFileNameWithoutExtension(file)), ("command", file), ("location", "Startup folder"), ("scope", f.Scope), ("enabled", true)));
            }
        }
        return J.A(list);
    }

    internal static IEnumerable<string> FilesIn(string dir, string pattern, bool recurse)
    {
        try
        {
            return Directory.EnumerateFiles(dir, pattern, new EnumerationOptions { RecurseSubdirectories = recurse, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint }).ToList();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return []; }
    }

    public static JsonArray Processes(ScanContext c) => J.A(
        c.Probe.Processes()
            .GroupBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .Select(g => (Name: g.Key, Count: g.Count(), Mem: g.Sum(p => p.WorkingSetBytes), Cpu: g.Sum(p => p.CpuSeconds)))
            .OrderByDescending(g => g.Mem)
            .Take(25)
            .Select(g => (JsonNode?)J.O(("name", g.Name), ("count", g.Count), ("workingSetBytes", g.Mem), ("cpuSeconds", Math.Round(g.Cpu, 1)))));

    /// <summary>Sums file sizes below a folder; stops after <paramref name="maxSeconds"/> and reports partial = true.</summary>
    public static (long Bytes, bool Partial) FolderSizeCapped(string path, int maxSeconds)
    {
        var sw = Stopwatch.StartNew();
        long total = 0;
        var partial = false;
        var stack = new Stack<string>();
        stack.Push(path);
        while (stack.Count > 0)
        {
            if (sw.Elapsed.TotalSeconds > maxSeconds) { partial = true; break; }
            var dir = stack.Pop();
            try
            {
                var di = new DirectoryInfo(dir);
                foreach (var fi in di.EnumerateFiles()) total += fi.Length;
                foreach (var sd in di.EnumerateDirectories())
                {
                    if ((sd.Attributes & FileAttributes.ReparsePoint) == 0) stack.Push(sd.FullName);   // skip junctions and symlinks
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
        return (total, partial);
    }

    /// <summary>Like <see cref="FolderSizeCapped"/>, plus when the newest file in the tree was written (UTC ticks, 0 = no file): the real "last used" of a folder.</summary>
    public static (long Bytes, bool Partial, long NewestTicks) FolderStatsCapped(string path, int maxSeconds)
    {
        var sw = Stopwatch.StartNew();
        long total = 0, newest = 0;
        var partial = false;
        var stack = new Stack<string>();
        stack.Push(path);
        while (stack.Count > 0)
        {
            if (sw.Elapsed.TotalSeconds > maxSeconds) { partial = true; break; }
            var dir = stack.Pop();
            try
            {
                var di = new DirectoryInfo(dir);
                foreach (var fi in di.EnumerateFiles())
                {
                    total += fi.Length;
                    var t = fi.LastWriteTimeUtc.Ticks;
                    if (t > newest) newest = t;
                }
                foreach (var sd in di.EnumerateDirectories())
                {
                    if ((sd.Attributes & FileAttributes.ReparsePoint) == 0) stack.Push(sd.FullName);   // skip junctions and symlinks
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
        return (total, partial, newest);
    }

    public static JsonArray Folders(ScanContext c)
    {
        var e = c.Env;
        var downloads = Val.Clean(c.RegValue(RegHive.CurrentUser, @"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders", "{374DE290-123F-4565-9164-39C4925E467B}"))
                        ?? Path.Combine(e.UserProfile, "Downloads");
        (string Id, string Label, string Path, int Secs)[] dirs =
        [
            ("downloads", "Downloads", downloads, 10),
            ("temp-user", "Temp (Benutzer)", e.Temp, 8),
            ("temp-windows", "Temp (Windows)", Path.Combine(e.SystemRoot, "Temp"), 8),
            ("windows-old", "Windows.old", Path.Combine(e.SystemDrive + @"\", "Windows.old"), 8),
            ("wu-download", "Windows-Update-Downloads", Path.Combine(e.SystemRoot, @"SoftwareDistribution\Download"), 8),
            ("package-cache", "Installer-Cache (Package Cache)", Path.Combine(e.ProgramData, "Package Cache"), 8),
            ("crash-dumps", "Absturzberichte", Path.Combine(e.LocalAppData, "CrashDumps"), 5),
            ("appdata-local", @"AppData\Local (Programmdaten/Caches)", e.LocalAppData, 12),
            ("documents", "Dokumente", e.MyDocuments, 8),
            ("pictures", "Bilder", e.MyPictures, 8),
            ("videos", "Videos", e.MyVideos, 8),
            ("desktop", "Desktop", e.Desktop, 6),
        ];

        var list = new List<JsonNode?>();
        foreach (var d in dirs)
        {
            if (string.IsNullOrEmpty(d.Path) || !Directory.Exists(d.Path)) continue;
            c.Report("folder: " + d.Label);
            var s = FolderSizeCapped(d.Path, d.Secs);
            list.Add(J.O(("id", d.Id), ("label", d.Label), ("path", d.Path), ("bytes", s.Bytes), ("partial", s.Partial), ("kind", "folder")));
        }
        foreach (var name in new[] { "hiberfil.sys", "pagefile.sys", "swapfile.sys" })
        {
            var p = Path.Combine(e.SystemDrive + @"\", name);
            try
            {
                var fi = new FileInfo(p);
                if (fi.Exists) list.Add(J.O(("id", name), ("label", name), ("path", p), ("bytes", fi.Length), ("partial", false), ("kind", "file")));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
        var bin = c.Probe.RecycleBinBytes();
        if (bin is not null) list.Add(J.O(("id", "recycle-bin"), ("label", "Papierkorb"), ("path", "shell:RecycleBinFolder"), ("bytes", bin.Value), ("partial", false), ("kind", "bin")));
        return J.A(list);
    }
}
