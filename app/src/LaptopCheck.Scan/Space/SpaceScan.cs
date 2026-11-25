using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;

namespace LaptopCheck.Scan.Space;

/// <param name="MaxDepth">Folders deeper than this (counted from the drive root, a top-level folder is 1) are measured but not listed.</param>
/// <param name="MinBytes">Smaller folders are not listed.</param>
/// <param name="MaxEntries">At most this many folders are kept (the biggest ones; a parent is always bigger than its children).</param>
/// <param name="BudgetSeconds">After this the scan stops and says so (partial = true, sizes are then lower bounds).</param>
public sealed record SpaceScanOptions(int MaxDepth = 8, long MinBytes = 300L * 1024 * 1024, int MaxEntries = 700, int BudgetSeconds = 150);

/// <summary>
/// Where did the space of a drive go? Adds up file sizes per folder (in parallel, READ-ONLY) and keeps the big folders down to a depth.
/// Links and junctions are not followed (nothing is counted twice) and cloud placeholders that only exist online take no space here.
/// What cannot be read without administrator rights is listed in <c>unreadable</c> instead of guessed.
/// The dashboard (web/space.js) interprets the result; this only measures.
/// </summary>
public static class SpaceScan
{
    // RecallOnDataAccess | RecallOnOpen | Offline: a cloud file that is not stored on this PC
    const FileAttributes CloudPlaceholder = (FileAttributes)(0x00400000 | 0x00040000 | 0x00001000);

    sealed class State(SpaceScanOptions options, CancellationToken ct)
    {
        public readonly SpaceScanOptions Options = options;
        public readonly CancellationToken Ct = ct;
        public readonly Stopwatch Watch = Stopwatch.StartNew();
        public readonly ConcurrentBag<(string Path, long Bytes, int Depth)> Entries = [];
        public readonly ConcurrentBag<string> Unreadable = [];
        public volatile bool Partial;
    }

    static long Walk(DirectoryInfo dir, int depth, State s)
    {
        s.Ct.ThrowIfCancellationRequested();
        if (s.Watch.Elapsed.TotalSeconds > s.Options.BudgetSeconds) { s.Partial = true; return 0; }

        long total = 0;
        var subs = new List<DirectoryInfo>();
        try
        {
            foreach (var f in dir.EnumerateFiles())
            {
                try { if ((f.Attributes & CloudPlaceholder) == 0) total += f.Length; }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
            foreach (var d in dir.EnumerateDirectories())
            {
                try { if ((d.Attributes & FileAttributes.ReparsePoint) == 0) subs.Add(d); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
        }
        catch (UnauthorizedAccessException) { if (depth <= 3) s.Unreadable.Add(dir.FullName); }
        catch (IOException) { }

        if (depth < 3 && subs.Count > 1)
        {
            // the first levels hold most of the work: measure their sub folders side by side
            long sub = 0;
            Parallel.ForEach(subs, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(2, Environment.ProcessorCount), CancellationToken = s.Ct },
                d => Interlocked.Add(ref sub, Walk(d, depth + 1, s)));
            total += sub;
        }
        else
        {
            foreach (var d in subs) total += Walk(d, depth + 1, s);
        }

        if (depth <= s.Options.MaxDepth && total >= s.Options.MinBytes) s.Entries.Add((dir.FullName, total, depth));
        return total;
    }

    /// <summary>Measures <paramref name="root"/> (usually the system drive, e.g. "C:\").</summary>
    public static JsonObject Run(string root, SpaceScanOptions options, Func<DateTime> now, CancellationToken ct = default)
    {
        var rootDir = new DirectoryInfo(root);
        var s = new State(options, ct);

        // loose files in the root: hiberfil.sys, pagefile.sys, swapfile.sys ...
        var rootFiles = new List<JsonNode?>();
        long rootFileBytes = 0;
        try
        {
            foreach (var f in rootDir.EnumerateFiles())
            {
                try
                {
                    if ((f.Attributes & CloudPlaceholder) != 0) continue;
                    rootFileBytes += f.Length;
                    if (f.Length >= options.MinBytes) rootFiles.Add(J.O(("path", f.FullName), ("bytes", f.Length)));
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }

        var top = new List<DirectoryInfo>();
        try
        {
            foreach (var d in rootDir.EnumerateDirectories())
            {
                try { if ((d.Attributes & FileAttributes.ReparsePoint) == 0) top.Add(d); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }

        long scanned = rootFileBytes;
        try
        {
            Parallel.ForEach(top, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(2, Environment.ProcessorCount), CancellationToken = ct },
                d => Interlocked.Add(ref scanned, Walk(d, 1, s)));
        }
        catch (AggregateException) when (ct.IsCancellationRequested) { throw new OperationCanceledException(ct); }

        long? totalBytes = null, freeBytes = null;
        try
        {
            var drive = new DriveInfo(Path.GetPathRoot(rootDir.FullName)!);
            totalBytes = drive.TotalSize;
            freeBytes = drive.AvailableFreeSpace;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { }

        var entries = s.Entries.OrderByDescending(e => e.Bytes).ThenBy(e => e.Path, StringComparer.OrdinalIgnoreCase).Take(options.MaxEntries)
            .Select(e => (JsonNode?)J.O(("path", e.Path), ("bytes", e.Bytes), ("depth", e.Depth)));
        var unreadable = s.Unreadable.Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(p => p, StringComparer.OrdinalIgnoreCase).Take(40).Select(p => (JsonNode?)JsonValue.Create(p));

        s.Watch.Stop();
        return J.O(
            ("schema", 1),
            ("scannedAt", now().ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture)),
            ("seconds", Math.Round(s.Watch.Elapsed.TotalSeconds, 1)),
            ("root", rootDir.FullName),
            ("totalBytes", totalBytes),
            ("freeBytes", freeBytes),
            ("scannedBytes", scanned),
            ("partial", s.Partial),
            ("options", J.O(("maxDepth", options.MaxDepth), ("minBytes", options.MinBytes), ("maxEntries", options.MaxEntries), ("budgetSeconds", options.BudgetSeconds))),
            ("files", J.A(rootFiles)),
            ("entries", J.A(entries)),
            ("unreadable", J.A(unreadable)));
    }
}
