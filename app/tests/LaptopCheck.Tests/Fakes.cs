using System.Text;
using LaptopCheck.Core;
using LaptopCheck.Scan;

namespace LaptopCheck.Tests;

internal static class Row
{
    public static WmiRow Of(params (string Name, object? Value)[] props)
    {
        var row = new WmiRow();
        foreach (var (n, v) in props) row[n] = v;
        return row;
    }
}

internal sealed class FakeWmi : IWmi
{
    readonly Dictionary<string, List<WmiRow>> _rows = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, Exception> _failures = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, List<WmiRow>> _related = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, WmiRow> _methods = new(StringComparer.OrdinalIgnoreCase);

    public FakeWmi Add(string cls, params WmiRow[] rows)
    {
        _rows[cls] = rows.ToList();
        return this;
    }

    public FakeWmi Fail(string cls, Exception ex)
    {
        _failures[cls] = ex;
        return this;
    }

    public FakeWmi AddRelated(string path, string cls, params WmiRow[] rows)
    {
        _related[path + "|" + cls] = rows.ToList();
        return this;
    }

    public FakeWmi AddMethod(string path, string method, WmiRow result)
    {
        _methods[path + "|" + method] = result;
        return this;
    }

    public IReadOnlyList<WmiRow> Query(string wql, string ns = @"root\cimv2")
    {
        var m = System.Text.RegularExpressions.Regex.Match(wql, @"FROM\s+(\w+)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var cls = m.Groups[1].Value;
        if (_failures.TryGetValue(cls, out var ex)) throw ex;
        return _rows.TryGetValue(cls, out var rows) ? rows : throw new InvalidOperationException("mock: unexpected class " + cls);
    }

    public IReadOnlyList<WmiRow> Related(string path, string relatedClass) =>
        _related.TryGetValue(path + "|" + relatedClass, out var rows) ? rows : [];

    public WmiRow Invoke(string path, string method) =>
        _methods.TryGetValue(path + "|" + method, out var r) ? r : new WmiRow();
}

internal sealed class FakeKey : IRegKey
{
    public Dictionary<string, object?> Values { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, FakeKey> Subs { get; } = new(StringComparer.OrdinalIgnoreCase);
    public DateTime? LastWriteTime { get; set; }

    public static FakeKey With(IDictionary<string, object?>? values = null, IDictionary<string, FakeKey>? subs = null)
    {
        var k = new FakeKey();
        if (values != null) foreach (var (n, v) in values) k.Values[n] = v;
        if (subs != null) foreach (var (n, s) in subs) k.Subs[n] = s;
        return k;
    }

    public string[] GetValueNames() => Values.Keys.ToArray();
    public string[] GetSubKeyNames() => Subs.Keys.ToArray();
    public object? GetValue(string name) => Values.TryGetValue(name, out var v) ? v : null;

    public IRegKey? OpenSubKey(string name)
    {
        var parts = name.Split('\\', 2);
        if (!Subs.TryGetValue(parts[0], out var sub)) return null;
        return parts.Length == 1 ? sub : sub.OpenSubKey(parts[1]);
    }

    public void Dispose() { }
}

internal sealed class FakeRegistry : IRegistry
{
    readonly Dictionary<string, FakeKey> _keys = new(StringComparer.OrdinalIgnoreCase);

    static string Id(RegHive hive, string path, RegView view) => $"{hive}|{path}|{(view == RegView.Registry32 ? "32" : "64")}";

    public FakeRegistry Add(RegHive hive, string path, FakeKey key, RegView view = RegView.Default)
    {
        _keys[Id(hive, path, view)] = key;
        return this;
    }

    public IRegKey? Open(RegHive hive, string subKey, RegView view = RegView.Default) =>
        _keys.TryGetValue(Id(hive, subKey, view), out var k) ? k : null;
}

internal sealed class FakeProcessRunner : IProcessRunner
{
    public string BatteryXml { get; set; } = "";
    public string ActiveScheme { get; set; } = "";
    public string? WingetPath { get; set; }
    public string WingetOutput { get; set; } = "";
    public bool WingetTimeout { get; set; }
    public List<string> Calls { get; } = [];

    public ProcessResult Run(string file, IReadOnlyList<string> args, TimeSpan timeout, Encoding? encoding = null)
    {
        Calls.Add(Path.GetFileName(file) + " " + string.Join(' ', args));
        if (file.EndsWith("powercfg.exe", StringComparison.OrdinalIgnoreCase))
        {
            if (args.Contains("/batteryreport"))
            {
                File.WriteAllText(args[args.ToList().IndexOf("/output") + 1], BatteryXml);
                return new ProcessResult(0, "", false);
            }
            if (args.Contains("/getactivescheme")) return new ProcessResult(0, ActiveScheme, false);
        }
        if (file.EndsWith("winget.exe", StringComparison.OrdinalIgnoreCase))
            return WingetTimeout ? new ProcessResult(-1, "", true) : new ProcessResult(0, WingetOutput, false);
        throw new InvalidOperationException("mock: unexpected process " + file);
    }

    public ProcessResult RunWithInput(string file, IReadOnlyList<string> args, string input, TimeSpan timeout, IReadOnlyDictionary<string, string>? environment = null) =>
        throw new InvalidOperationException("mock: unexpected process " + file);

    public string? FindOnPath(string exeName) => exeName.Equals("winget.exe", StringComparison.OrdinalIgnoreCase) ? WingetPath : null;
}

internal sealed class FakeProbe : ISystemProbe
{
    public int Firmware { get; set; } = 2;
    public long? RecycleBin { get; set; } = 4096;
    public TpmDeviceInfo? TpmInfo { get; set; }
    public Dictionary<string, ShortcutTarget> Shortcuts { get; } = new(StringComparer.OrdinalIgnoreCase);
    public List<ProcInfo> ProcessList { get; } = [];

    public int FirmwareType() => Firmware;
    public long? RecycleBinBytes() => RecycleBin;
    public TpmDeviceInfo? Tpm() => TpmInfo;
    public ShortcutTarget? ReadShortcut(string lnkPath) => Shortcuts.TryGetValue(lnkPath, out var t) ? t : null;
    public IReadOnlyList<ProcInfo> Processes() => ProcessList;
    public List<DriveEntry> DriveList { get; } = [];
    public Dictionary<string, string> Handlers { get; } = new(StringComparer.OrdinalIgnoreCase);
    public IReadOnlyList<DriveEntry> Drives() => DriveList;
    public string? FileHandler(string extension) => Handlers.TryGetValue(extension, out var h) ? h : null;
}

internal sealed class FakeAppx(params AppxPackageInfo[] packages) : IAppxSource
{
    public IReadOnlyList<AppxPackageInfo> GetPackages() => packages;
}
