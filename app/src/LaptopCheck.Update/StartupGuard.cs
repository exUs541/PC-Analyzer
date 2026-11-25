using System.Text.Json;
using System.Text.Json.Nodes;
using LaptopCheck.Core;

namespace LaptopCheck.Update;

/// <summary>
/// Notices a version that cannot start: a start counts as failed until the dashboard has loaded ("healthy"). After three failed
/// starts in a row of the same version the app goes into repair mode and first looks for a newer version, which usually is the fix.
/// </summary>
public sealed class StartupGuard(DataPaths data, string version)
{
    public const int RepairAfter = 3;

    string File_ => data.Of("startup.json");

    /// <summary>Registers this start. Returns how many starts of this version in a row did not become healthy, this one included.</summary>
    public int RegisterStart()
    {
        int attempts = 1;
        try
        {
            if (JsonNode.Parse(AtomicFile.ReadText(File_) ?? "null") is JsonObject o
                && o["version"]?.GetValue<string>() == version
                && o["healthy"]?.GetValue<bool>() == false)
            {
                attempts = (o["attempts"]?.GetValue<int>() ?? 0) + 1;
            }
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException) { }
        Write(attempts, healthy: false);
        return attempts;
    }

    public bool ShouldRepair(int attempts) => attempts >= RepairAfter;

    /// <summary>The dashboard loaded: this start worked.</summary>
    public void MarkHealthy() => Write(0, healthy: true);

    void Write(int attempts, bool healthy)
    {
        try { AtomicFile.WriteText(File_, new JsonObject { ["version"] = version, ["attempts"] = attempts, ["healthy"] = healthy }.ToJsonString()); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
}
