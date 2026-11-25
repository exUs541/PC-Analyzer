using System.Text.Encodings.Web;
using System.Text.Json;
using LaptopCheck.Core;
using LaptopCheck.Scan.Real;

namespace LaptopCheck.Scan.Files;

/// <summary>Runs the files scan with the user's settings (config.json) and stores files.json.</summary>
public sealed class FilesScanService(DataPaths data, Func<FilesContext>? contextFactory = null, Action<string>? progress = null) : IFilesScanRunner
{
    static readonly JsonSerializerOptions Compact = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    readonly SemaphoreSlim _gate = new(1, 1);
    readonly JsonStores _stores = new(data);
    readonly Func<FilesContext> _contextFactory = contextFactory ?? (() => RealContext(progress));

    public static FilesContext RealContext(Action<string>? progress = null) => new()
    {
        Env = ScanEnvironment.FromThisPc(),
        Probe = new RealSystemProbe(),
        Registry = new Win32Registry(),
        Processes = new RealProcessRunner(),
        Progress = progress,
    };

    /// <summary>One files scan at a time; a second request waits for the first.</summary>
    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var cfg = AppConfig.Read(_stores);
            var context = _contextFactory();
            var options = new FilesScanOptions(cfg.ExtraRoots, cfg.ExtraCloudRoots, cfg.FilesSecondsPerRoot);
            var result = await Task.Run(() => FilesScan.Run(context, options), cancellationToken);
            AtomicFile.WriteText(data.Files, result.ToJsonString(Compact));
        }
        finally
        {
            _gate.Release();
        }
    }

    public string ProvidersJson()
    {
        var cfg = AppConfig.Read(_stores);
        var c = _contextFactory();
        return CloudProviders.ToJson(CloudProviders.Detect(c.Env, c.Probe, cfg.ExtraCloudRoots));
    }
}
