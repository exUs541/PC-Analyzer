using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LaptopCheck.Core;
using LaptopCheck.Scan;

namespace LaptopCheck.Cleanup;

/// <summary>Everything the clean-up actions may use. Real sources in production, fakes in tests.</summary>
public sealed class CleanupContext
{
    public required DataPaths Data { get; init; }
    public required ScanEnvironment Env { get; init; }
    public required ISystemProbe Probe { get; init; }
    public required IRegistry Registry { get; init; }
    public required IRecycleBin Recycle { get; init; }
    public required ILauncher Launcher { get; init; }
    public required IConfirmation Confirmation { get; init; }
    public Func<DateTime> Now { get; init; } = () => DateTime.Now;

    public JsonStores Stores => new(Data);
    public string MovesDir => Data.Of("moves");
    public string DeletesDir => Data.Of("deletes");
    public string RestoresDir => Data.Of("restores");
    public string LogFile => Data.Of("cleanup-log.jsonl");
    public string Stamp() => Now().ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);
    public AppConfig Config => AppConfig.Read(Stores);
}

internal static partial class Jobs
{
    public static readonly JsonSerializerOptions Compact = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    public static readonly JsonSerializerOptions Pretty = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, WriteIndented = true };

    [GeneratedRegex(@"^\d{8}-\d{6}-[a-z]{4}$")]
    private static partial Regex IdShape();

    [GeneratedRegex(@"(^|[\\/])\.\.([\\/]|$)")]
    public static partial Regex ParentSegment();

    /// <summary>yyyyMMdd-HHmmss-xxxx: sortable, and safe to use as a folder name (checked again whenever one comes back from the page).</summary>
    public static string NewId(DateTime now)
    {
        var letters = new char[4];
        for (var i = 0; i < letters.Length; i++) letters[i] = (char)('a' + Random.Shared.Next(26));
        return now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + "-" + new string(letters);
    }

    public static void CheckId(string? id)
    {
        if (id is null || !IdShape().IsMatch(id)) throw new ArgumentException("invalid job id");
    }

    public static string Full(string path) => Path.GetFullPath(path).TrimEnd('\\', '/');

    public static bool Same(string? a, string? b)
    {
        if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
        try { return Full(a).Equals(Full(b), StringComparison.OrdinalIgnoreCase); }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { return false; }
    }

    public static string FormatSize(double bytes) =>
        bytes >= 1024.0 * 1024 * 1024 ? (bytes / (1024.0 * 1024 * 1024)).ToString("N2", CultureInfo.InvariantCulture) + " GB"
        : bytes >= 1024.0 * 1024 ? (bytes / (1024.0 * 1024)).ToString("N1", CultureInfo.InvariantCulture) + " MB"
        : (bytes / 1024.0).ToString("N0", CultureInfo.InvariantCulture) + " KB";

    public static void WriteJson(string path, JsonNode doc) => AtomicFile.WriteText(path, doc.ToJsonString(Pretty));

    public static string? ReadRaw(string path) => AtomicFile.ReadText(path) is { } t && AtomicFile.IsValidJson(t) ? t : null;

    /// <summary>One line per action in data\cleanup-log.jsonl: what was started, when. A failure to write it never stops the action.</summary>
    public static void Log(CleanupContext c, JsonObject entry)
    {
        try
        {
            entry["at"] = c.Stamp();
            File.AppendAllText(c.LogFile, entry.ToJsonString(Compact) + Environment.NewLine);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    public static JsonObject ParseObject(string json)
    {
        try { return JsonNode.Parse(json) as JsonObject ?? throw new ArgumentException("invalid request"); }
        catch (JsonException) { throw new ArgumentException("invalid request"); }
    }

    public static string Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
}

/// <summary>Job log: a text file next to the manifest, one timestamped line per event.</summary>
internal sealed class JobLog(string file, Func<DateTime> now)
{
    public void Write(string text)
    {
        try { File.AppendAllText(file, $"[{now():HH:mm:ss}] {text}{Environment.NewLine}"); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
}
