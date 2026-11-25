using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using LaptopCheck.Core;
using LaptopCheck.Scan;
using LaptopCheck.Scan.Files;

namespace LaptopCheck.Cleanup;

/// <summary>
/// The clean-up actions of the dashboard. Every action is checked here again, whatever the page sends: a move only into a detected
/// cloud folder and only from the user's own folders, a removal only for items the user confirmed in the dashboard and that did
/// not change since, and nothing leaves the PC for good without a window that asks for the word ENTFERNEN.
/// </summary>
public sealed class CleanupService(CleanupContext context) : ICleanupActions
{
    readonly ConcurrentDictionary<string, ConcurrentBag<Task>> _jobs = new();

    /// <summary>For tests: completes when all background work started for a job (copy phase, cleanup phase) has finished.</summary>
    public Task WaitForJobAsync(string id) => _jobs.TryGetValue(id, out var tasks) ? Task.WhenAll(tasks) : Task.CompletedTask;

    static bool Dry => Environment.GetEnvironmentVariable("LC_OPEN_DRYRUN") == "1";

    /// <summary>Runs one phase of a job in the background; the page polls the job's files for the outcome.</summary>
    void StartJob(string id, Func<Task> work) => _jobs.GetOrAdd(id, _ => []).Add(Task.Run(async () =>
    {
        try
        {
            await work();
        }
        catch (Exception ex)
        {
            // the runners write their own error result; this is the last net, so a failure can never vanish without a trace
            Jobs.Log(context, new JsonObject { ["action"] = "job-failed", ["id"] = id, ["error"] = ex.ToString() });
        }
    }));

    // ------------------------------------------------------------------ move to the cloud

    public Task<string> StartMoveAsync(string requestJson)
    {
        var req = Jobs.ParseObject(requestJson);
        var cloudRoot = Jobs.Str(req["cloudRoot"]);
        if (cloudRoot.Length == 0) throw new ArgumentException("cloudRoot missing");
        var provider = ProgramActions.Providers(context)
            .FirstOrDefault(p => PathUtil.IsUnder(cloudRoot, p.Root) && PathUtil.IsUnder(p.Root, cloudRoot))
            ?? throw new ArgumentException("This is not a detected cloud folder.");

        var items = (req["items"] as JsonArray ?? []).OfType<JsonObject>().ToList();
        if (items.Count == 0) throw new ArgumentException("No folders selected.");
        if (items.Count > 50) throw new ArgumentException("Too many folders at once (max 50).");

        var allowed = ProgramActions.MoveSourceRoots(context);
        var clean = new List<MoveItem>();
        foreach (var it in items)
        {
            var src = Jobs.Str(it["src"]);
            var dst = Jobs.Str(it["dst"]);
            if (src.Length == 0 || dst.Length == 0) throw new ArgumentException("Item without source or destination.");
            string fullSrc, fullDst;
            try { fullSrc = Jobs.Full(src); fullDst = Jobs.Full(dst); }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { throw new ArgumentException($"Invalid path: {src} / {dst}"); }
            if (!Directory.Exists(fullSrc)) throw new ArgumentException("Source folder does not exist: " + fullSrc);
            if (!allowed.Any(a => PathUtil.IsUnder(fullSrc, a))) throw new ArgumentException("Source is not inside your user folder or a configured folder: " + fullSrc);
            if (!PathUtil.IsUnder(fullDst, provider.Root) || Jobs.Same(fullDst, provider.Root)) throw new ArgumentException("Destination must be a sub folder of " + provider.Root);
            clean.Add(new MoveItem(fullSrc, fullDst));
        }

        var id = Jobs.NewId(context.Now());
        var manifest = new MoveManifest(id, provider.Name, provider.Mode, provider.Root, allowed, clean);
        MovePolicy.Assert(manifest, context.Env);   // the full set of rules, before anything is written

        var dir = Path.Combine(context.MovesDir, id);
        Directory.CreateDirectory(dir);
        Jobs.WriteJson(Path.Combine(dir, "manifest.json"), manifest.ToJson(context.Stamp()));

        JsonNode started;
        if (Dry) started = new JsonObject { ["dryRun"] = true, ["action"] = "move-copy", ["manifest"] = Path.Combine(dir, "manifest.json") };
        else
        {
            StartJob(id, () =>
            {
                new MoveRunner(context).CopyPhase(dir);
                return Task.CompletedTask;
            });
            started = new JsonObject { ["dryRun"] = false };
        }
        return Task.FromResult(new JsonObject { ["id"] = id, ["items"] = clean.Count, ["started"] = started }.ToJsonString(Jobs.Compact));
    }

    public Task<string> StartMoveCleanupAsync(string jobId)
    {
        Jobs.CheckId(jobId);
        var dir = Path.Combine(context.MovesDir, jobId);
        var result = Jobs.ReadRaw(Path.Combine(dir, "result.json")) ?? throw new ArgumentException("The copy phase has not finished yet.");
        var r = JsonNode.Parse(result)!;
        if (Jobs.Str(r["state"]) != "copied" || (r["totals"]?["verified"]?.GetValue<long>() ?? 0) <= 0) throw new ArgumentException("Nothing verified to remove.");

        JsonNode started;
        if (Dry) started = new JsonObject { ["dryRun"] = true, ["action"] = "move-cleanup", ["manifest"] = Path.Combine(dir, "manifest.json") };
        else
        {
            StartJob(jobId, () => new MoveRunner(context).CleanupPhaseAsync(dir));
            started = new JsonObject { ["dryRun"] = false };
        }
        return Task.FromResult(new JsonObject { ["id"] = jobId, ["started"] = started }.ToJsonString(Jobs.Compact));
    }

    public string MoveStatus(string jobId)
    {
        Jobs.CheckId(jobId);
        var dir = Path.Combine(context.MovesDir, jobId);
        if (!Directory.Exists(dir)) throw new ArgumentException("unknown job");
        return StatusJson(jobId, dir, withCleanup: true);
    }

    static string StatusJson(string id, string dir, bool withCleanup)
    {
        var result = Jobs.ReadRaw(Path.Combine(dir, "result.json"));
        var sb = new System.Text.StringBuilder("{\"id\":\"" + id + "\",\"result\":" + (result ?? "null"));
        if (withCleanup)
        {
            sb.Append(",\"cleanup\":").Append(Jobs.ReadRaw(Path.Combine(dir, "cleanup.json")) ?? "null");
            // progress only means something while the copy is running
            sb.Append(",\"progress\":").Append(result is null ? Jobs.ReadRaw(Path.Combine(dir, "progress.json")) ?? "null" : "null");
        }
        return sb.Append('}').ToString();
    }

    public string MoveList()
    {
        var rows = new JsonArray();
        if (Directory.Exists(context.MovesDir))
        {
            foreach (var d in new DirectoryInfo(context.MovesDir).EnumerateDirectories().OrderByDescending(x => x.Name, StringComparer.Ordinal).Take(30))
            {
                JsonNode? res = null, cl = null;
                try { if (Jobs.ReadRaw(Path.Combine(d.FullName, "result.json")) is { } t) res = JsonNode.Parse(t); } catch (System.Text.Json.JsonException) { }
                try { if (Jobs.ReadRaw(Path.Combine(d.FullName, "cleanup.json")) is { } t) cl = JsonNode.Parse(t); } catch (System.Text.Json.JsonException) { }
                rows.Add(new JsonObject
                {
                    ["id"] = d.Name,
                    ["state"] = Jobs.Str(cl?["state"]) is { Length: > 0 } cs ? cs : Jobs.Str(res?["state"]) is { Length: > 0 } rs ? rs : "started",
                    ["totals"] = res?["totals"]?.DeepClone(),
                    ["removed"] = cl?["removed"]?.DeepClone(),
                    ["removedBytes"] = cl?["removedBytes"]?.DeepClone(),
                });
            }
        }
        return rows.ToJsonString(Jobs.Compact);
    }

    // ------------------------------------------------------------------ copy the files only the old Drive folder has into the live drive

    int _restoreRunning;

    public Task<string> StartRestoreAsync(string requestJson)
    {
        // the page sends nothing that matters: both folders come from the provider detection
        var providers = ProgramActions.Providers(context);
        var old = providers.FirstOrDefault(p => p.Mode == CloudProviders.LeftoverMode) ?? throw new ArgumentException("There is no old Drive folder.");
        var live = providers.FirstOrDefault(p => p.Id == old.Id && p.Mode == "stream") ?? providers.FirstOrDefault(p => p.Id == old.Id && p.Mode != CloudProviders.LeftoverMode)
            ?? throw new ArgumentException("The live Drive was not found.");
        if (!Directory.Exists(old.Root)) throw new ArgumentException("The old Drive folder does not exist: " + old.Root);
        if (!Directory.Exists(live.Root)) throw new ArgumentException("The live Drive is not reachable: " + live.Root);
        if (Interlocked.CompareExchange(ref _restoreRunning, 1, 0) != 0) throw new ArgumentException("A copy to the Drive is already running.");

        var id = Jobs.NewId(context.Now());
        var dir = Path.Combine(context.RestoresDir, id);
        try
        {
            Directory.CreateDirectory(dir);
            Jobs.WriteJson(Path.Combine(dir, "manifest.json"), new JsonObject { ["id"] = id, ["createdAt"] = context.Stamp(), ["oldRoot"] = old.Root, ["liveRoot"] = live.Root });
            Jobs.Log(context, new JsonObject { ["action"] = "restore-start", ["id"] = id, ["oldRoot"] = old.Root, ["liveRoot"] = live.Root });
        }
        catch { Interlocked.Exchange(ref _restoreRunning, 0); throw; }

        if (Dry)
        {
            Interlocked.Exchange(ref _restoreRunning, 0);
            return Task.FromResult(new JsonObject { ["id"] = id, ["started"] = new JsonObject { ["dryRun"] = true, ["action"] = "restore" } }.ToJsonString(Jobs.Compact));
        }
        StartJob(id, () =>
        {
            try { new RestoreRunner(context).Run(dir, old.Root, live.Root); }
            finally { Interlocked.Exchange(ref _restoreRunning, 0); }
            return Task.CompletedTask;
        });
        return Task.FromResult(new JsonObject { ["id"] = id, ["started"] = new JsonObject { ["dryRun"] = false } }.ToJsonString(Jobs.Compact));
    }

    public string RestoreStatus(string jobId)
    {
        Jobs.CheckId(jobId);
        var dir = Path.Combine(context.RestoresDir, jobId);
        if (!Directory.Exists(dir)) throw new ArgumentException("unknown job");
        var result = Jobs.ReadRaw(Path.Combine(dir, "result.json"));
        return "{\"id\":\"" + jobId + "\",\"result\":" + (result ?? "null") + ",\"progress\":" + (result is null ? Jobs.ReadRaw(Path.Combine(dir, "progress.json")) ?? "null" : "null") + "}";
    }

    // ------------------------------------------------------------------ remove confirmed items

    public Task<string> StartDeleteAsync(string requestJson)
    {
        var req = Jobs.ParseObject(requestJson);
        var ids = (req["ids"] as JsonArray ?? []).Select(Jobs.Str).ToList();
        if (ids.Count == 0) throw new ArgumentException("Nothing selected.");
        if (ids.Count > 100) throw new ArgumentException("Too many items at once (max 100).");

        var cloudRoots = ProgramActions.CloudRoots(context);
        var allowed = ProgramActions.RemovableRoots(context);
        var items = new List<DeleteItem>();
        foreach (var id in ids)
        {
            var it = ProgramActions.CleanupItem(context, id) ?? throw new ArgumentException("Unknown item: " + id);
            if (Jobs.Str(it["type"]) != "path") throw new ArgumentException("Not a file/folder item: " + id);
            if (Jobs.Str(it["state"]) != "confirmed") throw new ArgumentException("Not confirmed yet: " + Jobs.Str(it["name"]));
            var kind = Jobs.Str(it["kind"]);
            if (kind != "dir" && kind != "file") throw new ArgumentException("Invalid item kind: " + id);
            var path = Jobs.Str(it["path"]);
            if (path.Length == 0 || Jobs.ParentSegment().IsMatch(path)) throw new ArgumentException("Invalid path: " + path);
            string full;
            try { full = Jobs.Full(path); }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { throw new ArgumentException("Invalid path: " + path); }
            if (!allowed.Any(a => PathUtil.IsUnder(full, a))) throw new ArgumentException("Not inside your user folder or a configured folder: " + full);
            if (cloudRoots.Any(cr => PathUtil.IsUnder(full, cr)))
                throw new ArgumentException("Inside a cloud folder - deleting there would also delete the cloud copy: " + full);
            var ms = it["confirmedMs"] switch
            {
                JsonValue v when v.TryGetValue<long>(out var l) => l,
                JsonValue v when v.TryGetValue<string>(out var s) && long.TryParse(s, out var l) => l,
                _ => 0L,
            };
            if (ms <= 0) throw new ArgumentException("Item has no confirmation time: " + Jobs.Str(it["name"]));
            items.Add(new DeleteItem(full, kind, Jobs.Str(it["name"]), ms));
        }

        var jobId = Jobs.NewId(context.Now());
        var manifest = new DeleteManifest(jobId, allowed, cloudRoots, items);
        var dir = Path.Combine(context.DeletesDir, jobId);
        Directory.CreateDirectory(dir);
        Jobs.WriteJson(Path.Combine(dir, "manifest.json"), manifest.ToJson(context.Stamp()));
        Jobs.Log(context, new JsonObject { ["action"] = "delete-job", ["id"] = jobId, ["items"] = new JsonArray(items.Select(i => (JsonNode?)JsonValue.Create(i.Path)).ToArray()) });

        JsonNode started;
        if (Dry) started = new JsonObject { ["dryRun"] = true, ["action"] = "delete", ["manifest"] = Path.Combine(dir, "manifest.json") };
        else
        {
            StartJob(jobId, () => new DeleteRunner(context).RunAsync(dir));
            started = new JsonObject { ["dryRun"] = false };
        }
        return Task.FromResult(new JsonObject { ["id"] = jobId, ["items"] = items.Count, ["started"] = started }.ToJsonString(Jobs.Compact));
    }

    public string DeleteStatus(string jobId)
    {
        Jobs.CheckId(jobId);
        var dir = Path.Combine(context.DeletesDir, jobId);
        if (!Directory.Exists(dir)) throw new ArgumentException("unknown job");
        return StatusJson(jobId, dir, withCleanup: false);
    }

    // ------------------------------------------------------------------ programs

    public string Uninstall(string requestJson) => ProgramActions.Uninstall(context, requestJson);

    public string WingetUpgrade(string requestJson) => ProgramActions.WingetUpgrade(context, requestJson);

    public string CheckApp(string requestJson) => ProgramActions.CheckApp(context, requestJson);

    public string Reveal(string requestJson) => ProgramActions.Reveal(context, requestJson);
}
