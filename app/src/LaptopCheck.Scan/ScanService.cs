using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using LaptopCheck.Core;

namespace LaptopCheck.Scan;

/// <summary>Runs a scan and stores the snapshot, the previous snapshot and the two small indexes the removal steps rely on.</summary>
public sealed class ScanService(DataPaths data, ScanOptions baseOptions, Func<ScanOptions, Action<string>?, ScanContext>? contextFactory = null, Action<string>? progress = null) : IScanRunner
{
    static readonly JsonSerializerOptions Compact = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    readonly SemaphoreSlim _gate = new(1, 1);
    readonly Func<ScanOptions, Action<string>?, ScanContext> _contextFactory = contextFactory ?? LaptopScanner.CreateContext;

    /// <summary>One scan at a time; a second request waits for the first.</summary>
    public async Task RunAsync(bool quick, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var options = baseOptions with { Quick = baseOptions.Quick || quick };
            var snapshot = await LaptopScanner.RunAsync(_contextFactory(options, progress));
            Store(snapshot);
        }
        finally
        {
            _gate.Release();
        }
    }

    void Store(JsonObject snapshot)
    {
        if (File.Exists(data.Snapshot)) File.Copy(data.Snapshot, data.SnapshotPrev, true);
        AtomicFile.WriteText(data.Snapshot, snapshot.ToJsonString(Compact));

        // the server only ever runs commands that the scan recorded here
        var uninstall = (snapshot["software"] as JsonArray ?? [])
            .OfType<JsonObject>()
            .Where(s => !string.IsNullOrEmpty(s["uninstallString"]?.GetValue<string>()))
            .Select(s => (JsonNode?)J(("id", s["id"]), ("name", s["name"]), ("uninstallString", s["uninstallString"])));
        AtomicFile.WriteText(data.UninstallIndex, new JsonArray(uninstall.ToArray()).ToJsonString(Compact));

        var wingetIds = (snapshot["updates"] as JsonArray ?? [])
            .OfType<JsonObject>()
            .Where(u => !string.IsNullOrEmpty(u["id"]?.GetValue<string>()))
            .Select(u => (JsonNode?)J(("id", u["id"]), ("name", u["name"])));
        AtomicFile.WriteText(data.WingetIndex, new JsonArray(wingetIds.ToArray()).ToJsonString(Compact));
    }

    static JsonObject J(params (string Key, JsonNode? Value)[] props)
    {
        var o = new JsonObject();
        foreach (var (k, v) in props) o[k] = v?.DeepClone();
        return o;
    }
}
