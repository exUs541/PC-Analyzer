using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;

namespace LaptopCheck.Scan.Files;

/// <summary>
/// READ-ONLY: how much of an old mirror folder (CloudProviders.LeftoverMode, e.g. C:\Users\x\My Drive) already lies in the live cloud
/// drive of the same account (e.g. G:\Meine Ablage)? Only names, sizes and dates are read - nothing is opened, copied or changed.
///
/// Every file of the old folder lands in one bucket:
///   same      same relative path and same size in the live drive             -> the local copy is redundant
///   nameSize  not at that path, but a file with the same name and size exists somewhere in the live drive (moved/renamed folder)
///   junk      desktop.ini, Drive's temp upload folder, Office lock files, shortcut stubs (.gdoc ...): no content of its own
///   only      NOT in the live drive: this is what would be lost if the old folder were deleted
/// </summary>
public static class LeftoverCompare
{
    static readonly HashSet<string> JunkNames = new(StringComparer.OrdinalIgnoreCase) { "desktop.ini", "thumbs.db", ".ds_store" };
    static readonly HashSet<string> StubExts = new(StringComparer.OrdinalIgnoreCase)
    { ".gdoc", ".gsheet", ".gslides", ".gdraw", ".gform", ".gsite", ".gmap", ".gjam", ".gscript", ".gtable", ".gshortcut" };

    internal static bool IsJunk(string rel, string name) =>
        JunkNames.Contains(name) || name.StartsWith("~$", StringComparison.Ordinal) || StubExts.Contains(Path.GetExtension(name))
        || rel.StartsWith(".tmp.driveupload", StringComparison.OrdinalIgnoreCase) || rel.Contains("\\.tmp.driveupload\\", StringComparison.OrdinalIgnoreCase);

    readonly record struct Rec(string Rel, string Name, long Size, DateTime Written, string Full);

    static IEnumerable<Rec> Walk(string root, bool skipReparse, Stopwatch sw, int seconds, Action markPartial)
    {
        var opt = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, ReturnSpecialDirectories = false, AttributesToSkip = skipReparse ? FileAttributes.ReparsePoint : 0 };
        var prefix = root.TrimEnd('\\', '/') + "\\";
        IEnumerator<FileInfo> it;
        try { it = new DirectoryInfo(root).EnumerateFiles("*", opt).GetEnumerator(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { yield break; }
        using (it)
        {
            while (true)
            {
                if (sw.Elapsed.TotalSeconds > seconds) { markPartial(); yield break; }
                Rec rec;
                try
                {
                    if (!it.MoveNext()) yield break;
                    var f = it.Current;
                    var full = f.FullName;
                    rec = new Rec(full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ? full[prefix.Length..] : f.Name, f.Name, f.Length, f.LastWriteTime, full);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { continue; }
                yield return rec;
            }
        }
    }

    /// <summary>One walk over both folders: every file of the old folder in its bucket (see the class comment).</summary>
    sealed record Classified(List<Rec> Local, long Same, long SameBytes, long NameSize, long NameSizeBytes, long Junk, long JunkBytes, List<Rec> Only, bool LocalPartial, bool LivePartial, double Seconds);

    static Classified Classify(string localRoot, string liveRoot, int seconds)
    {
        var sw = Stopwatch.StartNew();
        var livePartial = false;
        var localPartial = false;

        // both folders are walked at the same time; each has the whole time budget
        var liveTask = Task.Run(() =>
        {
            var byPath = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var byName = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var f in Walk(liveRoot, false, sw, seconds, () => livePartial = true))
            {
                byPath.Add(f.Rel + "|" + f.Size);
                byName.Add(f.Name + "|" + f.Size);
            }
            return (byPath, byName);
        });
        var local = Walk(localRoot, true, sw, seconds, () => localPartial = true).ToList();
        var (livePaths, liveNames) = liveTask.GetAwaiter().GetResult();

        long sameF = 0, sameB = 0, nsF = 0, nsB = 0, junkF = 0, junkB = 0;
        var only = new List<Rec>();
        foreach (var f in local)
        {
            if (IsJunk(f.Rel, f.Name)) { junkF++; junkB += f.Size; }
            else if (livePaths.Contains(f.Rel + "|" + f.Size)) { sameF++; sameB += f.Size; }
            else if (liveNames.Contains(f.Name + "|" + f.Size)) { nsF++; nsB += f.Size; }
            else only.Add(f);
        }
        return new Classified(local, sameF, sameB, nsF, nsB, junkF, junkB, only, localPartial, livePartial, sw.Elapsed.TotalSeconds);
    }

    /// <summary>A file that only the old folder has (so it would be lost with it).</summary>
    public sealed record MissingFile(string Rel, string Full, long Size);

    /// <summary>The files only the old folder has. Partial: the time budget ran out, so the list may be incomplete.</summary>
    public static (List<MissingFile> Files, bool Partial) FindMissing(string localRoot, string liveRoot, int seconds = 150)
    {
        var c = Classify(localRoot, liveRoot, seconds);
        return (c.Only.Select(f => new MissingFile(f.Rel, f.Full, f.Size)).ToList(), c.LocalPartial || c.LivePartial);
    }

    public static JsonObject Run(string localRoot, string liveRoot, int seconds = 150)
    {
        var c = Classify(localRoot, liveRoot, seconds);
        long files = c.Local.Count, bytes = c.Local.Sum(f => f.Size), onlyF = c.Only.Count, onlyB = c.Only.Sum(f => f.Size);
        var (sameF, sameB, nsF, nsB, junkF, junkB, only) = (c.Same, c.SameBytes, c.NameSize, c.NameSizeBytes, c.Junk, c.JunkBytes, c.Only);
        var localPartial = c.LocalPartial;
        var livePartial = c.LivePartial;

        var dirs = only.GroupBy(f => Path.GetDirectoryName(f.Full) ?? localRoot, StringComparer.OrdinalIgnoreCase)
            .Select(g => (Dir: g.Key, Files: g.LongCount(), Bytes: g.Sum(x => x.Size)))
            .OrderByDescending(d => d.Bytes).ThenBy(d => d.Dir, StringComparer.OrdinalIgnoreCase).ToList();
        string Iso(DateTime d) => d.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);

        return J.O(
            ("localRoot", localRoot), ("liveRoot", liveRoot), ("files", files), ("bytes", bytes),
            ("same", J.O(("files", sameF), ("bytes", sameB))),
            ("nameSize", J.O(("files", nsF), ("bytes", nsB))),
            ("junk", J.O(("files", junkF), ("bytes", junkB))),
            ("only", J.O(("files", onlyF), ("bytes", onlyB))),
            ("partial", localPartial || livePartial), ("livePartial", livePartial), ("seconds", Math.Round(c.Seconds, 1)),
            ("onlyDirs", J.A(dirs.Take(60).Select(d => (JsonNode?)J.O(("dir", d.Dir), ("files", d.Files), ("bytes", d.Bytes))))),
            ("onlyDirsMore", (long)Math.Max(0, dirs.Count - 60)),
            ("onlyTop", J.A(only.OrderByDescending(f => f.Size).Take(100).Select(f => (JsonNode?)J.O(("p", f.Full), ("s", f.Size), ("m", Iso(f.Written)))))));
    }
}
