using System.Text.Json.Nodes;
using LaptopCheck.Core;
using LaptopCheck.Scan;

namespace LaptopCheck.Cleanup;

internal sealed record DeleteItem(string Path, string Kind, string Name, long ConfirmedMs);

internal sealed record DeleteManifest(string Id, IReadOnlyList<string> AllowedRoots, IReadOnlyList<string> BlockedRoots, IReadOnlyList<DeleteItem> Items)
{
    public JsonObject ToJson(string createdAt) => new()
    {
        ["id"] = Id, ["createdAt"] = createdAt,
        ["allowedRoots"] = new JsonArray(AllowedRoots.Select(a => (JsonNode?)JsonValue.Create(a)).ToArray()),
        ["blockedRoots"] = new JsonArray(BlockedRoots.Select(a => (JsonNode?)JsonValue.Create(a)).ToArray()),
        ["items"] = new JsonArray(Items.Select(i => (JsonNode?)new JsonObject { ["path"] = i.Path, ["kind"] = i.Kind, ["name"] = i.Name, ["confirmedMs"] = i.ConfirmedMs }).ToArray()),
    };

    public static DeleteManifest Read(string file)
    {
        var text = AtomicFile.ReadText(file) ?? throw new ArgumentException("Manifest not found: " + file);
        var o = Jobs.ParseObject(text);
        long ms(JsonNode? n) => n is JsonValue v && v.TryGetValue<long>(out var l) ? l : 0;
        var topMs = ms(o["confirmedMs"]);
        return new DeleteManifest(
            Jobs.Str(o["id"]),
            (o["allowedRoots"] as JsonArray ?? []).Select(Jobs.Str).Where(s => s.Length > 0).ToList(),
            (o["blockedRoots"] as JsonArray ?? []).Select(Jobs.Str).Where(s => s.Length > 0).ToList(),
            (o["items"] as JsonArray ?? []).OfType<JsonObject>().Select(i => new DeleteItem(Jobs.Str(i["path"]), Jobs.Str(i["kind"]), Jobs.Str(i["name"]), ms(i["confirmedMs"]) is > 0 and var x ? x : topMs)).ToList());
    }
}

/// <summary>
/// What may be removed: only inside the user's folder / ProgramData / folders the user configured; never Windows, Program Files, cloud
/// folders (a delete there is synced and removes the cloud copy), the user folder or the standard folders themselves, AppData\*\Microsoft,
/// Packages, .ssh; never a folder that contains a Git repository; never an item that changed after the user confirmed it.
/// </summary>
internal static class DeletePolicy
{
    static IReadOnlyList<string> BlockedTrees(DeleteManifest m, ScanEnvironment env)
    {
        var b = new List<string>();
        foreach (var v in new[] { env.SystemRoot, env.ProgramFiles, env.ProgramFilesX86 }) if (!string.IsNullOrEmpty(v)) b.Add(v);
        b.AddRange(m.BlockedRoots.Where(x => x.Length > 0));
        if (!string.IsNullOrEmpty(env.UserProfile))
        {
            foreach (var rel in new[] { @"AppData\Local\Microsoft", @"AppData\Roaming\Microsoft", @"AppData\Local\Packages", ".ssh", ".gnupg" }) b.Add(Path.Combine(env.UserProfile, rel));
        }
        return b;
    }

    /// <summary>These folders themselves (and everything that contains them) may not be removed.</summary>
    static IReadOnlyList<string> ProtectedFolders(DeleteManifest m, ScanEnvironment env)
    {
        var p = new List<string>();
        if (!string.IsNullOrEmpty(env.UserProfile))
        {
            p.Add(env.UserProfile);
            foreach (var rel in new[] { "AppData", @"AppData\Local", @"AppData\Roaming", @"AppData\LocalLow", "Documents", "Desktop", "Downloads", "Pictures", "Videos", "Music", "OneDrive" })
                p.Add(Path.Combine(env.UserProfile, rel));
        }
        foreach (var v in new[] { env.ProgramData, env.LocalAppData, env.AppData }) if (!string.IsNullOrEmpty(v)) p.Add(v);
        p.AddRange(m.AllowedRoots.Where(a => a.Length > 0));
        return p;
    }

    /// <summary>Null when the item may be removed, otherwise the reason it is refused.</summary>
    public static string? Refusal(DeleteItem it, DeleteManifest m, ScanEnvironment env)
    {
        if (string.IsNullOrEmpty(it.Path)) return "no path";
        string full;
        try { full = Jobs.Full(it.Path); }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { return "invalid path"; }
        if (Jobs.ParentSegment().IsMatch(it.Path)) return "path contains ..";
        if (!m.AllowedRoots.Any(a => PathUtil.IsUnder(full, a))) return "outside the allowed folders";
        foreach (var bl in BlockedTrees(m, env))
        {
            if (PathUtil.IsUnder(full, bl)) return "protected place (" + bl + ")";
        }
        foreach (var pf in ProtectedFolders(m, env))
        {
            if (Jobs.Same(full, pf)) return "this is a standard folder - remove its contents, not the folder";
            if (PathUtil.IsUnder(pf, full)) return "contains a protected folder";
        }
        if (Path.GetPathRoot(full)!.TrimEnd('\\', '/') == full) return "a whole drive";
        return null;
    }

    /// <summary>A .git folder or file within the first levels (node_modules and links are not entered).</summary>
    public static bool ContainsRepo(string dir)
    {
        var level = new List<string> { dir };
        for (var d = 0; d <= 4; d++)
        {
            var next = new List<string>();
            foreach (var x in level)
            {
                try
                {
                    if (File.Exists(Path.Combine(x, ".git")) || Directory.Exists(Path.Combine(x, ".git"))) return true;
                    foreach (var sd in new DirectoryInfo(x).EnumerateDirectories())
                    {
                        if ((sd.Attributes & FileAttributes.ReparsePoint) == 0 && sd.Name != "node_modules") next.Add(sd.FullName);
                    }
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
            level = next;
            if (level.Count == 0) break;
        }
        return false;
    }

    /// <summary>Size, newest write time and file count of a folder tree; junctions are not followed.</summary>
    public static (long Bytes, long NewestTicks, int Files) TreeInfo(string dir)
    {
        long bytes = 0, newest = 0;
        var count = 0;
        var stack = new Stack<string>();
        stack.Push(dir);
        while (stack.Count > 0)
        {
            var d = stack.Pop();
            try
            {
                var di = new DirectoryInfo(d);
                foreach (var fi in di.EnumerateFiles())
                {
                    bytes += fi.Length;
                    count++;
                    var t = fi.LastWriteTimeUtc.Ticks;
                    if (t > newest) newest = t;
                }
                foreach (var sd in di.EnumerateDirectories())
                {
                    if ((sd.Attributes & FileAttributes.ReparsePoint) == 0) stack.Push(sd.FullName);
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
        return (bytes, newest, count);
    }
}

/// <summary>Sends the confirmed items to the Recycle Bin after a typed confirmation. Nothing is deleted for good.</summary>
internal sealed class DeleteRunner(CleanupContext c)
{
    sealed record Planned(string Path, string Kind, long Bytes, int Files, long ConfirmedTicks);

    public async Task RunAsync(string jobDir)
    {
        var log = new JobLog(Path.Combine(jobDir, "log.txt"), c.Now);
        var resultFile = Path.Combine(jobDir, "result.json");
        DeleteManifest m;
        try
        {
            m = DeleteManifest.Read(Path.Combine(jobDir, "manifest.json"));
            if (m.Items.Count == 0) throw new ArgumentException("Manifest has no items.");
            if (m.Items.Count > 200) throw new ArgumentException("Too many items (max 200).");
        }
        catch (ArgumentException ex)
        {
            log.Write("ERROR: " + ex.Message);
            Jobs.WriteJson(resultFile, new JsonObject { ["id"] = Path.GetFileName(jobDir), ["state"] = "error", ["error"] = ex.Message, ["finishedAt"] = c.Stamp() });
            return;
        }

        try
        {
            log.Write("Remove-ToRecycle: job " + m.Id);
            var plan = new List<Planned>();
            var skipped = new List<JsonObject>();
            void Skip(string path, string reason, string line)
            {
                skipped.Add(new JsonObject { ["path"] = path, ["reason"] = reason });
                log.Write(line);
            }

            foreach (var it in m.Items)
            {
                long confirmedTicks = 0;
                try { if (it.ConfirmedMs > 0) confirmedTicks = DateTimeOffset.FromUnixTimeMilliseconds(it.ConfirmedMs).UtcDateTime.Ticks; }
                catch (ArgumentOutOfRangeException) { }
                if (confirmedTicks <= 0) { Skip(it.Path, "no confirmation time", "REFUSED (no confirmation time): " + it.Path); continue; }
                var why = DeletePolicy.Refusal(it, m, c.Env);
                if (why is not null) { Skip(it.Path, why, $"REFUSED: {it.Path}  ({why})"); continue; }

                var full = Jobs.Full(it.Path);
                var isDir = Directory.Exists(full);
                var isFile = File.Exists(full);
                if (!isDir && !isFile) { Skip(full, "already gone", "Already gone: " + full); continue; }
                if (isDir && it.Kind != "dir") { Skip(full, "is a folder, expected a file", "REFUSED (kind mismatch): " + full); continue; }
                if (isFile && it.Kind != "file") { Skip(full, "is a file, expected a folder", "REFUSED (kind mismatch): " + full); continue; }
                if ((File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) { Skip(full, "link / junction", "REFUSED (link/junction): " + full); continue; }

                long bytes, newest;
                var files = 1;
                if (isDir)
                {
                    if (DeletePolicy.ContainsRepo(full)) { Skip(full, "contains a Git repository", "REFUSED (contains a Git repository): " + full); continue; }
                    (bytes, newest, files) = DeletePolicy.TreeInfo(full);
                }
                else
                {
                    var fi = new FileInfo(full);
                    bytes = fi.Length;
                    newest = fi.LastWriteTimeUtc.Ticks;
                }
                if (newest > confirmedTicks) { Skip(full, "changed after you confirmed it", "SKIPPED (changed after confirmation): " + full); continue; }
                plan.Add(new Planned(full, it.Kind, bytes, files, confirmedTicks));
            }

            if (plan.Count == 0)
            {
                log.Write("Nothing to remove.");
                WriteResult(resultFile, m.Id, [], skipped, [], 0, cancelled: false);
                return;
            }

            var total = plan.Sum(p => p.Bytes);
            var request = new ConfirmationRequest(
                "LaptopCheck - in den Papierkorb legen",
                $"Diese {plan.Count} Objekte ({Jobs.FormatSize(total)}) werden in den PAPIERKORB gelegt:",
                [.. plan.Select(p => $"{p.Path}   [{(p.Kind == "dir" ? p.Files + " Dateien" : "Datei")}, {Jobs.FormatSize(p.Bytes)}]"),
                 "", "Nichts wird endgültig gelöscht: Aus dem Papierkorb kannst du alles wiederherstellen."],
                null,
                ConfirmationRequest.RemoveWord);
            if (!await c.Confirmation.ConfirmAsync(request))
            {
                log.Write("Abgebrochen - es wurde nichts entfernt.");
                WriteResult(resultFile, m.Id, [], skipped, [], 0, cancelled: true);
                return;
            }

            var removed = new List<JsonObject>();
            var failed = new List<JsonObject>();
            long removedBytes = 0;
            foreach (var p in plan)
            {
                try
                {
                    // the confirmation window may have been open for a while: look once more at the very last moment
                    var newest = p.Kind == "dir" ? DeletePolicy.TreeInfo(p.Path).NewestTicks : File.Exists(p.Path) ? new FileInfo(p.Path).LastWriteTimeUtc.Ticks : 0;
                    if (newest > p.ConfirmedTicks)
                    {
                        skipped.Add(new JsonObject { ["path"] = p.Path, ["reason"] = "changed after you confirmed it" });
                        log.Write("SKIPPED (changed after confirmation): " + p.Path);
                        continue;
                    }
                    c.Recycle.Recycle(p.Path, p.Kind == "dir");
                    removed.Add(new JsonObject { ["path"] = p.Path, ["bytes"] = p.Bytes });
                    removedBytes += p.Bytes;
                    log.Write("Recycled: " + p.Path);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or OperationCanceledException or InvalidOperationException)
                {
                    failed.Add(new JsonObject { ["path"] = p.Path, ["error"] = ex.Message });
                    log.Write($"FAILED: {p.Path} - {ex.Message}");
                }
            }
            WriteResult(resultFile, m.Id, removed, skipped, failed, removedBytes, cancelled: false);
            log.Write($"DONE. {removed.Count} item(s) ({Jobs.FormatSize(removedBytes)}) in the Recycle Bin, {skipped.Count} refused/skipped, {failed.Count} failed.");
        }
        catch (Exception ex)
        {
            // a job always ends with a result file, whatever went wrong: the page waits for it
            log.Write("ERROR: " + ex);
            Jobs.WriteJson(resultFile, new JsonObject { ["id"] = m.Id, ["state"] = "error", ["error"] = ex.Message, ["finishedAt"] = c.Stamp() });
        }
    }

    void WriteResult(string file, string id, List<JsonObject> removed, List<JsonObject> skipped, List<JsonObject> failed, long removedBytes, bool cancelled)
    {
        var doc = new JsonObject
        {
            ["id"] = id, ["state"] = "done", ["finishedAt"] = c.Stamp(),
            ["removed"] = new JsonArray(removed.Select(x => (JsonNode?)x).ToArray()),
            ["skipped"] = new JsonArray(skipped.Select(x => (JsonNode?)x).ToArray()),
            ["failed"] = new JsonArray(failed.Select(x => (JsonNode?)x).ToArray()),
            ["removedBytes"] = removedBytes,
        };
        if (cancelled) doc["cancelled"] = true;
        Jobs.WriteJson(file, doc);
    }
}
