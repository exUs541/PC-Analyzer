using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace LaptopCheck.Scan.Files;

/// <summary>
/// READ-ONLY: compares two folders and says what the difference is. Only names, sizes and dates are read (and, when asked for, the content
/// of files that exist on both sides with the same size). Nothing is opened for writing, copied, moved or deleted.
///
/// Every file ends in exactly one bucket (relative path, case-insensitive):
///   same     in both, same size (and, with deep=true, same content)
///   changed  in both, but another size (or another content)
///   moved    only on one side at this path, but a file with the same name and size lies somewhere else on the other side
///   onlyA    only in A      onlyB   only in B
/// Files without content of their own (desktop.ini, Drive shortcut stubs, Office lock files ...) are left out when ignoreJunk is set.
/// </summary>
public static class FolderCompare
{
    const long MaxHashBytes = 4L * 1024 * 1024 * 1024;

    internal readonly record struct Rec(string Rel, string Name, long Size, DateTime Written, string Full);

    sealed class DirStat
    {
        public long SameN, SameB, AN, AB, BN, BB, ChN, ChB, MvN, MvB;
        public bool HasDiff => AN + BN + ChN + MvN > 0;
    }

    /// <summary>Every file below root. Links (junctions, symbolic links) are not followed; cloud placeholders are real files here.</summary>
    internal static List<Rec> Walk(string root, Stopwatch sw, int seconds, Action markPartial, Action<int>? progress = null)
    {
        var list = new List<Rec>();
        var prefix = root.TrimEnd('\\', '/') + "\\";
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            if (sw.Elapsed.TotalSeconds > seconds) { markPartial(); break; }
            var dir = stack.Pop();
            try
            {
                foreach (var e in new DirectoryInfo(dir).EnumerateFileSystemInfos())
                {
                    if (e is DirectoryInfo d)
                    {
                        if (d.LinkTarget is not null) continue;            // junction or symbolic link: not followed
                        stack.Push(d.FullName);
                    }
                    else if (e is FileInfo f)
                    {
                        var full = f.FullName;
                        list.Add(new Rec(full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ? full[prefix.Length..] : f.Name, f.Name, SafeLength(f), f.LastWriteTime, full));
                    }
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* unreadable folder: skipped */ }
            progress?.Invoke(list.Count);
        }
        return list;
    }

    static long SafeLength(FileInfo f)
    {
        try { return f.Length; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return 0; }
    }

    static string Hash(string path)
    {
        using var s = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16);
        return Convert.ToHexString(SHA256.HashData(s));
    }

    static string Iso(DateTime d) => d.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);

    static string DirOf(string rel)
    {
        var i = rel.LastIndexOf('\\');
        return i < 0 ? "" : rel[..i];
    }

    static JsonObject Count(long n, long bytes) => J.O(("files", n), ("bytes", bytes));

    /// <param name="progress">Called now and then with a short text (what is being read).</param>
    public static JsonObject Run(string a, string b, bool deep = false, bool ignoreJunk = true, int seconds = 240, Action<string>? progress = null)
    {
        var sw = Stopwatch.StartNew();
        var partialA = false;
        var partialB = false;
        progress?.Invoke("reading both folders");
        var bTask = Task.Run(() => Walk(b, sw, seconds, () => partialB = true));
        var listA = Walk(a, sw, seconds, () => partialA = true);
        var listB = bTask.GetAwaiter().GetResult();

        long ignored = 0;
        List<Rec> Filter(List<Rec> l)
        {
            if (!ignoreJunk) return l;
            var kept = l.Where(f => !LeftoverCompare.IsJunk(f.Rel, f.Name)).ToList();
            ignored += l.Count - kept.Count;
            return kept;
        }
        listA = Filter(listA);
        listB = Filter(listB);

        var byRelB = new Dictionary<string, Rec>(StringComparer.OrdinalIgnoreCase);
        foreach (var f in listB) byRelB[f.Rel] = f;
        var matchedB = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var dirs = new Dictionary<string, DirStat>(StringComparer.OrdinalIgnoreCase);
        void Add(string rel, Action<DirStat> act)
        {
            var d = DirOf(rel);
            for (; ; d = DirOf(d))
            {
                if (!dirs.TryGetValue(d, out var s)) dirs[d] = s = new DirStat();
                act(s);
                if (d.Length == 0) break;
            }
        }

        long sameN = 0, sameB = 0, chN = 0, chB = 0, unverified = 0;
        var same = new List<(Rec A, Rec B)>();            // same size: confirmed by content only with deep
        var changed = new List<(Rec A, Rec B, string Why)>();
        var onlyA = new List<Rec>();
        foreach (var fa in listA)
        {
            if (byRelB.TryGetValue(fa.Rel, out var fb))
            {
                matchedB.Add(fa.Rel);
                if (fa.Size != fb.Size) changed.Add((fa, fb, "size"));
                else same.Add((fa, fb));
            }
            else onlyA.Add(fa);
        }

        // content check of the files that look the same (only when asked for: it reads them, and on a cloud drive that downloads them)
        if (deep && same.Count > 0)
        {
            progress?.Invoke("comparing content of " + same.Count + " files");
            var differing = new ConcurrentBag<(Rec A, Rec B)>();
            var skipped = 0L;
            Parallel.ForEach(same, new ParallelOptions { MaxDegreeOfParallelism = 4 }, pair =>
            {
                if (sw.Elapsed.TotalSeconds > seconds) { Interlocked.Increment(ref skipped); return; }
                if (pair.A.Size > MaxHashBytes) { Interlocked.Increment(ref skipped); return; }
                try { if (Hash(pair.A.Full) != Hash(pair.B.Full)) differing.Add(pair); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { Interlocked.Increment(ref skipped); }
            });
            unverified = skipped;
            if (skipped > 0 && sw.Elapsed.TotalSeconds > seconds) { partialA = true; }
            var diff = new HashSet<string>(differing.Select(d => d.A.Rel), StringComparer.OrdinalIgnoreCase);
            if (diff.Count > 0)
            {
                changed.AddRange(same.Where(p => diff.Contains(p.A.Rel)).Select(p => (p.A, p.B, "content")));
                same.RemoveAll(p => diff.Contains(p.A.Rel));
            }
        }
        foreach (var (fa, _) in same) { sameN++; sameB += fa.Size; Add(fa.Rel, s => { s.SameN++; s.SameB += fa.Size; }); }
        foreach (var (fa, fb, _) in changed)
        {
            chN++; chB += Math.Max(fa.Size, fb.Size);
            Add(fa.Rel, s => { s.ChN++; s.ChB += Math.Max(fa.Size, fb.Size); });
        }

        var onlyB = listB.Where(f => !matchedB.Contains(f.Rel)).ToList();

        // a file only on one side that lies elsewhere on the other side (same name and size): moved or renamed folder, not a real difference
        var moved = new List<(Rec A, Rec B)>();
        var poolB = onlyB.Where(f => f.Size > 0).GroupBy(f => f.Name + "|" + f.Size, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);
        var stillA = new List<Rec>();
        var usedB = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var fa in onlyA)
        {
            if (fa.Size > 0 && poolB.TryGetValue(fa.Name + "|" + fa.Size, out var cands) && cands.Count > 0)
            {
                var parentA = Path.GetFileName(DirOf(fa.Rel));
                var pick = cands.FirstOrDefault(c => string.Equals(Path.GetFileName(DirOf(c.Rel)), parentA, StringComparison.OrdinalIgnoreCase)) ;
                if (pick.Rel is null) pick = cands[0];
                cands.Remove(pick);
                usedB.Add(pick.Rel);
                moved.Add((fa, pick));
            }
            else stillA.Add(fa);
        }
        var stillB = onlyB.Where(f => !usedB.Contains(f.Rel)).ToList();
        foreach (var (fa, fb) in moved)
        {
            Add(fa.Rel, s => { s.MvN++; s.MvB += fa.Size; });
            Add(fb.Rel, s => { s.MvN++; s.MvB += fb.Size; });
        }
        foreach (var f in stillA) Add(f.Rel, s => { s.AN++; s.AB += f.Size; });
        foreach (var f in stillB) Add(f.Rel, s => { s.BN++; s.BB += f.Size; });

        const int CapList = 5000, CapMoved = 3000, CapDirs = 8000;
        JsonArray Files(IEnumerable<Rec> src, out bool cut)
        {
            var all = src.OrderByDescending(f => f.Size).ThenBy(f => f.Rel, StringComparer.OrdinalIgnoreCase).ToList();
            cut = all.Count > CapList;
            return J.A(all.Take(CapList).Select(f => (JsonNode?)J.O(("p", f.Rel), ("s", f.Size), ("m", Iso(f.Written)))));
        }
        var aJson = Files(stillA, out var cutA);
        var bJson = Files(stillB, out var cutB);
        var chAll = changed.OrderByDescending(c => Math.Max(c.A.Size, c.B.Size)).ThenBy(c => c.A.Rel, StringComparer.OrdinalIgnoreCase).ToList();
        var mvAll = moved.OrderByDescending(m => m.A.Size).ThenBy(m => m.A.Rel, StringComparer.OrdinalIgnoreCase).ToList();
        var dirRows = dirs.Where(kv => kv.Value.HasDiff).OrderBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase).ToList();

        long bytesA = listA.Sum(f => f.Size), bytesB = listB.Sum(f => f.Size);
        return J.O(
            ("a", a), ("b", b), ("deep", deep), ("ignoreJunk", ignoreJunk), ("scannedAt", Iso(DateTime.Now)), ("seconds", Math.Round(sw.Elapsed.TotalSeconds, 1)),
            ("partialA", partialA), ("partialB", partialB), ("partial", partialA || partialB),
            ("summary", J.O(
                ("filesA", (long)listA.Count), ("bytesA", bytesA), ("filesB", (long)listB.Count), ("bytesB", bytesB),
                ("same", Count(sameN, sameB)), ("changed", Count(chN, chB)),
                ("moved", Count(moved.Count, moved.Sum(m => m.A.Size))),
                ("onlyA", Count(stillA.Count, stillA.Sum(f => f.Size))), ("onlyB", Count(stillB.Count, stillB.Sum(f => f.Size))),
                ("ignored", ignored), ("unverified", unverified))),
            ("onlyA", aJson), ("onlyB", bJson), ("cutOnlyA", cutA), ("cutOnlyB", cutB),
            ("changed", J.A(chAll.Take(CapList).Select(c => (JsonNode?)J.O(("p", c.A.Rel), ("sa", c.A.Size), ("sb", c.B.Size), ("ma", Iso(c.A.Written)), ("mb", Iso(c.B.Written)), ("why", c.Why))))),
            ("cutChanged", chAll.Count > CapList),
            ("moved", J.A(mvAll.Take(CapMoved).Select(m => (JsonNode?)J.O(("a", m.A.Rel), ("b", m.B.Rel), ("s", m.A.Size))))),
            ("cutMoved", mvAll.Count > CapMoved),
            ("dirs", J.A(dirRows.Take(CapDirs).Select(kv => (JsonNode?)J.O(
                ("d", kv.Key), ("same", Count(kv.Value.SameN, kv.Value.SameB)), ("onlyA", Count(kv.Value.AN, kv.Value.AB)), ("onlyB", Count(kv.Value.BN, kv.Value.BB)),
                ("changed", Count(kv.Value.ChN, kv.Value.ChB)), ("moved", Count(kv.Value.MvN, kv.Value.MvB)))))),
            ("cutDirs", dirRows.Count > CapDirs));
    }
}
