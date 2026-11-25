using System.Text.Json;

namespace LaptopCheck.Core;

/// <summary>
/// The user's settings (config.json): extra folders to scan, extra cloud folders, GitHub accounts, scan time budget.
/// Anything missing or of the wrong type falls back to the default, so a hand-edited file never breaks a scan.
/// </summary>
public sealed record AppConfig(
    IReadOnlyList<string> ExtraRoots,
    IReadOnlyList<string> ExtraCloudRoots,
    IReadOnlyList<string> GithubUsers,
    string? GithubApiBase,
    int FilesSecondsPerRoot,
    bool AutoUpdate = true)
{
    public const int DefaultSecondsPerRoot = 40;

    public static AppConfig Default { get; } = new([], [], [], null, DefaultSecondsPerRoot);

    public static AppConfig Read(JsonStores stores) => Parse(stores.Read("config"));

    public static AppConfig Parse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return Default;
            var seconds = DefaultSecondsPerRoot;
            if (root.TryGetProperty("filesSecondsPerRoot", out var s) && s.ValueKind == JsonValueKind.Number && s.TryGetDouble(out var d))
                seconds = (int)d;
            return new AppConfig(
                Strings(root, "extraRoots"),
                Strings(root, "extraCloudRoots"),
                Strings(root, "githubUsers"),
                root.TryGetProperty("githubApiBase", out var api) && api.ValueKind == JsonValueKind.String && api.GetString() is { Length: > 0 } b ? b : null,
                Math.Clamp(seconds, 5, 300),
                !(root.TryGetProperty("autoUpdate", out var au) && au.ValueKind == JsonValueKind.False));   // only an explicit false switches it off
        }
        catch (JsonException)
        {
            return Default;
        }
    }

    static List<string> Strings(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array) return [];
        return arr.EnumerateArray()
            .Where(e => e.ValueKind == JsonValueKind.String)
            .Select(e => e.GetString()!)
            .Where(x => x.Length > 0)
            .ToList();
    }
}
