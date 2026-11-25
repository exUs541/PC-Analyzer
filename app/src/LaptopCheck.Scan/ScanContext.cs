using System.Text.Json.Nodes;
using LaptopCheck.Core;

namespace LaptopCheck.Scan;

/// <summary>Everything a scan section may use. Real sources in production, fakes in tests.</summary>
public sealed class ScanContext
{
    readonly List<(string Area, string Message)> _warnings = [];

    public required IWmi Wmi { get; init; }
    public required IRegistry Registry { get; init; }
    public required IProcessRunner Processes { get; init; }
    public required ISystemProbe Probe { get; init; }
    public required IAppxSource Appx { get; init; }
    public required ScanEnvironment Env { get; init; }
    public ScanOptions Options { get; init; } = new();
    public Action<string>? Progress { get; init; }
    public Func<DateTime> Now { get; init; } = () => DateTime.Now;
    public Action<TimeSpan> Delay { get; init; } = Thread.Sleep;

    public IReadOnlyList<(string Area, string Message)> Warnings
    {
        get { lock (_warnings) return _warnings.ToList(); }
    }

    public void Warn(string area, string message)
    {
        lock (_warnings) _warnings.Add((area, message));
    }

    public void Report(string what) => Progress?.Invoke(what);

    /// <summary>Runs one section; a failing section becomes a warning and the fallback instead of aborting the scan.</summary>
    public T Section<T>(string area, Func<T> code, T fallback)
    {
        Report(area);
        try { return code(); }
        catch (Exception ex)
        {
            Warn(area, ex.Message);
            return fallback;
        }
    }

    public JsonArray WarningsJson() =>
        J.A(Warnings.Select(w => (JsonNode?)J.O(("area", w.Area), ("message", w.Message))));

    public object? RegValue(RegHive hive, string subKey, string name, RegView view = RegView.Default)
    {
        using var k = Registry.Open(hive, subKey, view);
        if (k is null) return null;
        try { return k.GetValue(name); }
        catch { return null; }
    }

    public bool RegKeyExists(RegHive hive, string subKey)
    {
        using var k = Registry.Open(hive, subKey);
        return k is not null;
    }
}
