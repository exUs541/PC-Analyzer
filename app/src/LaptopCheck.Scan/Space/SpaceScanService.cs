using System.Text.Encodings.Web;
using System.Text.Json;
using LaptopCheck.Core;

namespace LaptopCheck.Scan.Space;

/// <summary>Runs the storage analysis of the system drive and stores space.json.</summary>
public sealed class SpaceScanService(DataPaths data, Func<string>? rootProvider = null, SpaceScanOptions? options = null, Func<DateTime>? now = null) : ISpaceScanRunner
{
    static readonly JsonSerializerOptions Compact = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    readonly SemaphoreSlim _gate = new(1, 1);

    /// <summary>One analysis at a time; a second request waits for the first.</summary>
    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var root = rootProvider?.Invoke() ?? ScanEnvironment.FromThisPc().SystemDrive + @"\";
            var result = await Task.Run(() => SpaceScan.Run(root, options ?? new SpaceScanOptions(), now ?? (() => DateTime.Now), cancellationToken), cancellationToken);
            AtomicFile.WriteText(data.Space, result.ToJsonString(Compact));
        }
        finally
        {
            _gate.Release();
        }
    }
}
