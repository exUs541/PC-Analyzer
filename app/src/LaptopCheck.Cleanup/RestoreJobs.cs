using System.Security.Cryptography;
using System.Text.Json.Nodes;
using LaptopCheck.Core;
using LaptopCheck.Scan;
using LaptopCheck.Scan.Files;

namespace LaptopCheck.Cleanup;

/// <summary>
/// Copies what only the OLD local Drive folder has (a file that is missing in the live drive) into the live drive, to the same relative path.
/// Safety, enforced here and not by the page:
///  - the two folders come from the provider detection (the page sends no path at all);
///  - nothing is overwritten: a destination that exists is left alone and counted;
///  - every copy is read back and compared by SHA-256; a copy that differs is removed again (only a file this job created);
///  - the destination stays inside the live drive (no "..", no absolute path);
///  - the old folder is never changed.
/// </summary>
internal sealed class RestoreRunner(CleanupContext context)
{
    static string Hash(string path)
    {
        using var s = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16);
        return Convert.ToHexString(SHA256.HashData(s));
    }

    static void Progress(string dir, string phase, int done, int total)
    {
        try { File.WriteAllText(Path.Combine(dir, "progress.json"), $"{{\"phase\":\"{phase}\",\"done\":{done},\"total\":{total}}}"); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    /// <summary>The whole job: compare, copy, verify. Always ends with result.json (state "done" or "error").</summary>
    public void Run(string dir, string oldRoot, string liveRoot)
    {
        var log = new JobLog(Path.Combine(dir, "log.txt"), context.Now);
        var started = context.Now();
        try
        {
            log.Write($"compare {oldRoot} with {liveRoot}");
            Progress(dir, "compare", 0, 0);
            var (missing, partial) = LeftoverCompare.FindMissing(oldRoot, liveRoot);
            if (partial) { Finish(dir, "error", started, liveRoot, error: "The comparison ran out of time, so the list of missing files may be incomplete. Nothing was copied.", log: log); return; }
            log.Write($"{missing.Count} files only exist in the old folder");

            int copied = 0, existing = 0, failed = 0, done = 0;
            long copiedBytes = 0;
            var failures = new JsonArray();
            void Fail(string rel, string why)
            {
                failed++;
                log.Write("FAILED " + rel + ": " + why);
                if (failures.Count < 50) failures.Add(new JsonObject { ["path"] = rel, ["error"] = why });
            }

            foreach (var f in missing)
            {
                Progress(dir, "copy", done++, missing.Count);
                string dst;
                try { dst = Path.GetFullPath(Path.Combine(liveRoot, f.Rel)); }
                catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { Fail(f.Rel, "invalid path"); continue; }
                if (Path.IsPathRooted(f.Rel) || Jobs.ParentSegment().IsMatch(f.Rel) || !PathUtil.IsUnder(dst, liveRoot) || Jobs.Same(dst, liveRoot)) { Fail(f.Rel, "path leaves the drive"); continue; }
                if (File.Exists(dst) || Directory.Exists(dst)) { existing++; log.Write("exists, left alone: " + f.Rel); continue; }

                var created = false;
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
                    using (var src = new FileStream(f.Full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16))
                    using (var to = new FileStream(dst, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16))
                    {
                        created = true;
                        src.CopyTo(to, 1 << 20);
                    }
                    try { File.SetLastWriteTime(dst, File.GetLastWriteTime(f.Full)); } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
                    if (new FileInfo(dst).Length != f.Size || Hash(f.Full) != Hash(dst))
                    {
                        File.Delete(dst);
                        Fail(f.Rel, "the copy differs from the original and was removed");
                        continue;
                    }
                    copied++; copiedBytes += f.Size;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    if (created) { try { File.Delete(dst); } catch (Exception e2) when (e2 is IOException or UnauthorizedAccessException) { } }
                    Fail(f.Rel, ex.Message);
                }
            }
            log.Write($"done: {copied} copied, {existing} existing, {failed} failed");
            Jobs.Log(context, new JsonObject { ["action"] = "restore-done", ["copied"] = copied, ["existing"] = existing, ["failed"] = failed, ["liveRoot"] = liveRoot });
            Finish(dir, "done", started, liveRoot, copied, copiedBytes, existing, failed, failures, missing.Count, log: log);
        }
        catch (Exception ex)
        {
            Finish(dir, "error", started, liveRoot, error: ex.Message, log: log);
        }
    }

    void Finish(string dir, string state, DateTime started, string liveRoot, int copied = 0, long copiedBytes = 0, int existing = 0, int failed = 0, JsonArray? failures = null, int missing = 0, string? error = null, JobLog? log = null)
    {
        log?.Write(state + (error is null ? "" : ": " + error));
        try { File.Delete(Path.Combine(dir, "progress.json")); } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        Jobs.WriteJson(Path.Combine(dir, "result.json"), new JsonObject
        {
            ["state"] = state, ["error"] = error, ["liveRoot"] = liveRoot, ["missing"] = missing,
            ["copied"] = copied, ["copiedBytes"] = copiedBytes, ["existing"] = existing, ["failed"] = failed,
            ["failures"] = failures ?? new JsonArray(), ["seconds"] = Math.Round((context.Now() - started).TotalSeconds, 1),
        });
    }
}
