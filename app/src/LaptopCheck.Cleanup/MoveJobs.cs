using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using LaptopCheck.Core;
using LaptopCheck.Scan;
using LaptopCheck.Scan.Files;

namespace LaptopCheck.Cleanup;

internal sealed record MoveItem(string Src, string Dst);

/// <summary>What a move job is allowed to do. Written to data\moves\{id}\manifest.json and checked again before every phase.</summary>
internal sealed record MoveManifest(string Id, string Provider, string Mode, string CloudRoot, IReadOnlyList<string> AllowedRoots, IReadOnlyList<MoveItem> Items)
{
    public JsonObject ToJson(string createdAt) => new()
    {
        ["id"] = Id, ["createdAt"] = createdAt, ["provider"] = Provider, ["mode"] = Mode, ["cloudRoot"] = CloudRoot,
        ["allowedRoots"] = new JsonArray(AllowedRoots.Select(a => (JsonNode?)JsonValue.Create(a)).ToArray()),
        ["items"] = new JsonArray(Items.Select(i => (JsonNode?)new JsonObject { ["src"] = i.Src, ["dst"] = i.Dst }).ToArray()),
    };

    public static MoveManifest Read(string file)
    {
        var text = AtomicFile.ReadText(file) ?? throw new ArgumentException("Manifest not found: " + file);
        var o = Jobs.ParseObject(text);
        return new MoveManifest(
            Jobs.Str(o["id"]), Jobs.Str(o["provider"]), Jobs.Str(o["mode"]), Jobs.Str(o["cloudRoot"]),
            (o["allowedRoots"] as JsonArray ?? []).Select(Jobs.Str).Where(s => s.Length > 0).ToList(),
            (o["items"] as JsonArray ?? []).OfType<JsonObject>().Select(i => new MoveItem(Jobs.Str(i["src"]), Jobs.Str(i["dst"]))).ToList());
    }
}

/// <summary>
/// Safety rules of a move, enforced when the job is created and again, independently, before each phase:
/// the destination lies inside the cloud folder; the source lies inside the user's profile or a configured folder, never in
/// Windows, Program Files, AppData, ...; a source and destination never overlap.
/// </summary>
internal static class MovePolicy
{
    public static IReadOnlyList<string> Blocked(ScanEnvironment env)
    {
        var list = new List<string>();
        foreach (var v in new[] { env.SystemRoot, env.ProgramFiles, env.ProgramFilesX86, env.ProgramData, env.LocalAppData, env.AppData })
        {
            if (!string.IsNullOrEmpty(v)) list.Add(v);
        }
        if (!string.IsNullOrEmpty(env.UserProfile)) list.Add(Path.Combine(env.UserProfile, "AppData"));
        return list;
    }

    /// <exception cref="ArgumentException">The manifest would do something it must not.</exception>
    public static void Assert(MoveManifest m, ScanEnvironment env)
    {
        if (string.IsNullOrEmpty(m.CloudRoot) || !Directory.Exists(m.CloudRoot)) throw new ArgumentException("Cloud folder not found: " + m.CloudRoot);
        if (m.AllowedRoots.Count == 0) throw new ArgumentException("Manifest has no allowedRoots.");
        if (m.Items.Count == 0) throw new ArgumentException("Manifest has no items.");

        foreach (var it in m.Items)
        {
            if (string.IsNullOrEmpty(it.Src) || string.IsNullOrEmpty(it.Dst)) throw new ArgumentException("Item without src/dst.");
            if (!Directory.Exists(it.Src)) throw new ArgumentException("Source folder not found: " + it.Src);
            string fullSrc, fullDst;
            try
            {
                fullSrc = Jobs.Full(it.Src);
                fullDst = Jobs.Full(it.Dst);
            }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
            {
                throw new ArgumentException("Invalid path: " + it.Src + " / " + it.Dst);
            }
            if (Path.GetPathRoot(fullSrc)!.TrimEnd('\\', '/') == fullSrc) throw new ArgumentException("Refusing to move a whole drive: " + it.Src);
            if (!string.IsNullOrEmpty(env.UserProfile) && Jobs.Same(fullSrc, env.UserProfile)) throw new ArgumentException("Refusing to move the whole user profile.");
            if (!m.AllowedRoots.Any(a => PathUtil.IsUnder(fullSrc, a))) throw new ArgumentException("Source is outside the allowed folders: " + it.Src);
            if (Blocked(env).Any(b => PathUtil.IsUnder(fullSrc, b))) throw new ArgumentException("Source is in a protected system folder: " + it.Src);
            if (PathUtil.IsUnder(fullSrc, m.CloudRoot)) throw new ArgumentException("Source is already inside the cloud folder: " + it.Src);
            if (!PathUtil.IsUnder(fullDst, m.CloudRoot) || Jobs.Same(fullDst, m.CloudRoot))
                throw new ArgumentException("Destination must be a sub folder of the cloud folder: " + it.Dst);
            if (PathUtil.IsUnder(fullDst, fullSrc) || PathUtil.IsUnder(fullSrc, fullDst)) throw new ArgumentException("Source and destination overlap.");
        }
    }
}

/// <summary>
/// Copies folders into a cloud folder, VERIFIES them (SHA-256 of every file), and only on request, after a typed confirmation, moves
/// the verified originals to the Recycle Bin. Existing files at the destination are never overwritten; an original is only removed
/// if the copy is still byte-identical AND the original did not change since the check.
/// </summary>
internal sealed class MoveRunner(CleanupContext c)
{
    static IEnumerable<string> FilesBelow(string dir, JobLog log)
    {
        // recursive file list; tolerant to access-denied folders; does not follow junctions or symlinks
        var result = new List<string>();
        var stack = new Stack<string>();
        stack.Push(dir);
        while (stack.Count > 0)
        {
            var d = stack.Pop();
            try
            {
                var di = new DirectoryInfo(d);
                foreach (var fi in di.EnumerateFiles()) result.Add(fi.FullName);
                foreach (var sd in di.EnumerateDirectories())
                {
                    if ((sd.Attributes & FileAttributes.ReparsePoint) == 0) stack.Push(sd.FullName);
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                log.Write("cannot read folder (skipped): " + d);
            }
        }
        return result;
    }

    static string Sha256(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 20);
        return Convert.ToHexString(SHA256.HashData(fs)).ToLowerInvariant();
    }

    JobLog LogFor(string jobDir) => new(Path.Combine(jobDir, "log.txt"), c.Now);

    // ------------------------------------------------------------------ phase: copy (+ verify)

    public void CopyPhase(string jobDir)
    {
        var log = LogFor(jobDir);
        var resultFile = Path.Combine(jobDir, "result.json");
        MoveManifest m;
        try
        {
            m = MoveManifest.Read(Path.Combine(jobDir, "manifest.json"));
            MovePolicy.Assert(m, c.Env);
        }
        catch (ArgumentException ex)
        {
            log.Write("ERROR: " + ex.Message);
            Jobs.WriteJson(resultFile, new JsonObject { ["id"] = Path.GetFileName(jobDir), ["phase"] = "copy", ["state"] = "error", ["error"] = ex.Message, ["finishedAt"] = c.Stamp() });
            return;
        }

        try
        {
            var started = c.Stamp();
            var verifiedLines = new List<string>();
            var itemResults = new List<JsonObject>();
            long[] totals = new long[9];   // files bytes copied skipped conflicts failed verified verifiedBytes mismatched
            log.Write($"Cloud folder: {m.CloudRoot}   ({m.Provider}, {m.Mode})");

            var allFiles = m.Items.Select(it => (Item: it, Src: Jobs.Full(it.Src), Dst: Jobs.Full(it.Dst))).Select(x => (x.Src, x.Dst, Files: FilesBelow(x.Src, log).ToList())).ToList();
            var totalFiles = allFiles.Sum(x => x.Files.Count);
            var done = 0;

            foreach (var (src, dst, files) in allFiles)
            {
                log.Write($"=== {src}  ->  {dst}");
                long bytes = 0, copied = 0, skipped = 0, conflicts = 0, failed = 0, verified = 0, verifiedBytes = 0, mismatched = 0;
                foreach (var f in files)
                {
                    done++;
                    var rel = f[src.Length..].TrimStart('\\', '/');
                    var target = Path.Combine(dst, rel);
                    try
                    {
                        var fi = new FileInfo(f);
                        var len = fi.Length;
                        bytes += len;
                        var srcTicks = fi.LastWriteTimeUtc.Ticks;
                        if (File.Exists(target))
                        {
                            // never overwrite: identical content counts as "already there", anything else is a conflict
                            if (new FileInfo(target).Length != len)
                            {
                                conflicts++;
                                log.Write("CONFLICT (different file already at destination, original kept): " + rel);
                                continue;
                            }
                            skipped++;
                        }
                        else
                        {
                            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                            File.Copy(f, target, overwrite: false);
                            File.SetLastWriteTimeUtc(target, fi.LastWriteTimeUtc);
                            try { File.SetCreationTimeUtc(target, fi.CreationTimeUtc); } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
                            copied++;
                        }
                        // verify: byte-identical?
                        var h1 = Sha256(f);
                        var h2 = Sha256(target);
                        if (h1 == h2)
                        {
                            verified++;
                            verifiedBytes += len;
                            verifiedLines.Add(string.Join('\t', src, dst, rel, len, srcTicks, h1));
                        }
                        else
                        {
                            mismatched++;
                            log.Write("MISMATCH after copy (original kept): " + rel);
                        }
                    }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                    {
                        failed++;
                        log.Write($"FAILED: {rel} - {ex.Message}");
                    }
                    if (done % 50 == 0 || done == totalFiles) WriteProgress(jobDir, "copy", done, totalFiles);
                }

                itemResults.Add(new JsonObject
                {
                    ["src"] = src, ["dst"] = dst, ["files"] = files.Count, ["bytes"] = bytes, ["copied"] = copied, ["skipped"] = skipped, ["conflicts"] = conflicts,
                    ["failed"] = failed, ["verified"] = verified, ["verifiedBytes"] = verifiedBytes, ["mismatched"] = mismatched,
                });
                long[] add = [files.Count, bytes, copied, skipped, conflicts, failed, verified, verifiedBytes, mismatched];
                for (var i = 0; i < totals.Length; i++) totals[i] += add[i];
                log.Write($"    {files.Count} files, {Jobs.FormatSize(bytes)}: copied {copied}, already there {skipped}, conflicts {conflicts}, failed {failed}, verified {verified}");
            }

            File.WriteAllLines(Path.Combine(jobDir, "verified.tsv"), verifiedLines, new UTF8Encoding(false));
            var result = new JsonObject
            {
                ["id"] = m.Id, ["phase"] = "copy", ["state"] = "copied", ["startedAt"] = started, ["finishedAt"] = c.Stamp(),
                ["cloudRoot"] = m.CloudRoot, ["provider"] = m.Provider, ["mode"] = m.Mode,
                ["items"] = new JsonArray(itemResults.Select(i => (JsonNode?)i).ToArray()),
                ["totals"] = new JsonObject
                {
                    ["files"] = totals[0], ["bytes"] = totals[1], ["copied"] = totals[2], ["skipped"] = totals[3], ["conflicts"] = totals[4], ["failed"] = totals[5],
                    ["verified"] = totals[6], ["verifiedBytes"] = totals[7], ["mismatched"] = totals[8],
                },
            };
            Jobs.WriteJson(resultFile, result);
            log.Write($"DONE. Verified copies: {totals[6]} files ({Jobs.FormatSize(totals[7])}). Originals were NOT touched.");
        }
        catch (Exception ex)
        {
            // a job always ends with a result file, whatever went wrong: the page waits for it
            log.Write("ERROR: " + ex);
            Jobs.WriteJson(resultFile, new JsonObject { ["id"] = m.Id, ["phase"] = "copy", ["state"] = "error", ["error"] = ex.Message, ["finishedAt"] = c.Stamp() });
        }
        finally
        {
            try { File.Delete(Path.Combine(jobDir, "progress.json")); } catch (IOException) { }
        }
    }

    static void WriteProgress(string jobDir, string phase, int done, int total)
    {
        try { File.WriteAllText(Path.Combine(jobDir, "progress.json"), $"{{\"phase\":\"{phase}\",\"done\":{done},\"total\":{total}}}"); }
        catch (IOException) { }
    }

    // ------------------------------------------------------------------ phase: cleanup (originals to the Recycle Bin)

    public async Task CleanupPhaseAsync(string jobDir)
    {
        var log = LogFor(jobDir);
        var cleanupFile = Path.Combine(jobDir, "cleanup.json");
        var verifiedFile = Path.Combine(jobDir, "verified.tsv");
        MoveManifest m;
        try
        {
            m = MoveManifest.Read(Path.Combine(jobDir, "manifest.json"));
            MovePolicy.Assert(m, c.Env);   // a failed Cleanup must not overwrite the result of the Copy phase: it writes cleanup.json only
            if (!File.Exists(verifiedFile)) throw new ArgumentException("No verified.tsv found - run the Copy phase first.");
        }
        catch (ArgumentException ex)
        {
            log.Write("ERROR: " + ex.Message);
            Jobs.WriteJson(cleanupFile, new JsonObject { ["id"] = Path.GetFileName(jobDir), ["phase"] = "cleanup", ["state"] = "error", ["error"] = ex.Message, ["finishedAt"] = c.Stamp() });
            return;
        }

        try
        {
            var lines = File.ReadAllLines(verifiedFile, Encoding.UTF8).Where(l => l.Trim().Length > 0).Select(l => l.Split('\t')).Where(p => p.Length >= 6).ToList();
            var total = lines.Sum(p => long.Parse(p[3]));
            var request = new ConfirmationRequest(
                "LaptopCheck - Originale entfernen",
                $"{lines.Count} geprüfte Dateien ({Jobs.FormatSize(total)}) werden von diesem PC in den PAPIERKORB gelegt.",
                [
                    "Jede Datei wird direkt vor dem Entfernen noch einmal geprüft: Die Kopie im Cloud-Ordner muss weiterhin byte-identisch sein,",
                    "und das Original darf sich seit der Prüfung nicht geändert haben. Alles, was nicht passt, bleibt liegen.",
                    "Der Papierkorb behält die Dateien; leere ihn erst, wenn in der Cloud alles in Ordnung ist.",
                    "", .. m.Items.Select(i => $"{i.Src}  ->  {i.Dst}"),
                ],
                "Mein Cloud-Dienst zeigt „alles synchronisiert“ an und ich habe ein paar Dateien im Browser geprüft.",
                ConfirmationRequest.RemoveWord);
            if (!await c.Confirmation.ConfirmAsync(request))
            {
                log.Write("Abgebrochen - es wurde nichts entfernt.");
                Jobs.WriteJson(cleanupFile, new JsonObject { ["id"] = m.Id, ["phase"] = "cleanup", ["state"] = "cancelled", ["finishedAt"] = c.Stamp(), ["removed"] = 0, ["removedBytes"] = 0 });
                return;
            }

            int removed = 0, skippedChanged = 0, skippedMissingCopy = 0, skippedMismatch = 0, failed = 0;
            long removedBytes = 0;
            var touchedDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var p in lines)
            {
                var src = p[0]; var dst = p[1]; var rel = p[2]; var len = long.Parse(p[3]); var ticks = long.Parse(p[4]); var hash = p[5];
                try
                {
                    var srcFile = Path.Combine(src, rel);
                    var dstFile = Path.Combine(dst, rel);
                    // a verified.tsv that was edited must never reach outside the folders of this job
                    if (!m.Items.Any(i => Jobs.Same(i.Src, src) && Jobs.Same(i.Dst, dst)) || !PathUtil.IsUnder(srcFile, src) || !PathUtil.IsUnder(dstFile, dst))
                    {
                        failed++;
                        log.Write("Entry outside the job folders - skipped: " + rel);
                        continue;
                    }
                    if (!PathUtil.IsUnder(dstFile, m.CloudRoot)) { failed++; log.Write("Destination outside cloud folder - skipped: " + rel); continue; }
                    if (!File.Exists(srcFile)) continue;   // already gone
                    var fi = new FileInfo(srcFile);
                    if (fi.Length != len || fi.LastWriteTimeUtc.Ticks != ticks) { skippedChanged++; log.Write("Original changed since the check - kept: " + rel); continue; }
                    if (!File.Exists(dstFile)) { skippedMissingCopy++; log.Write("Copy missing in cloud folder - original kept: " + rel); continue; }
                    if (Sha256(dstFile) != hash) { skippedMismatch++; log.Write("Copy differs - original kept: " + rel); continue; }
                    c.Recycle.Recycle(srcFile, isDirectory: false);
                    removed++;
                    removedBytes += len;
                    touchedDirs.Add(Path.GetDirectoryName(srcFile)!);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or OperationCanceledException)
                {
                    failed++;
                    log.Write($"FAILED to remove: {rel} - {ex.Message}");
                }
            }

            // remove source folders that became empty (only truly empty ones; never a source root itself)
            var roots = lines.Select(p => p[0].TrimEnd('\\', '/')).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            foreach (var d in touchedDirs.OrderByDescending(x => x.Length))
            {
                // a folder that became empty may leave its parent empty too: go up, but never to or above a source root
                var cur = d;
                while (cur is not null && roots.Any(r => PathUtil.IsUnder(cur, r)) && !roots.Any(r => Jobs.Same(cur, r)))
                {
                    try
                    {
                        if (!Directory.Exists(cur) || Directory.EnumerateFileSystemEntries(cur).Any()) break;
                        Directory.Delete(cur, recursive: false);
                    }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { break; }
                    cur = Path.GetDirectoryName(cur);
                }
            }

            Jobs.WriteJson(cleanupFile, new JsonObject
            {
                ["id"] = m.Id, ["phase"] = "cleanup", ["state"] = "cleaned", ["finishedAt"] = c.Stamp(), ["removed"] = removed, ["removedBytes"] = removedBytes,
                ["skippedChanged"] = skippedChanged, ["skippedMissingCopy"] = skippedMissingCopy, ["skippedMismatch"] = skippedMismatch, ["failed"] = failed,
            });
            log.Write($"DONE. {removed} files ({Jobs.FormatSize(removedBytes)}) moved to the Recycle Bin. Kept untouched: {skippedChanged} changed, {skippedMissingCopy} copy missing, {skippedMismatch} copy differs. Failed: {failed}.");
        }
        catch (Exception ex)
        {
            // a job always ends with a result file, whatever went wrong: the page waits for it
            log.Write("ERROR: " + ex);
            Jobs.WriteJson(cleanupFile, new JsonObject { ["id"] = m.Id, ["phase"] = "cleanup", ["state"] = "error", ["error"] = ex.Message, ["finishedAt"] = c.Stamp() });
        }
    }
}
