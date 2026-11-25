using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace LaptopCheck.Scan.Files;

/// <summary>
/// Finds the sync folders of Google Drive (virtual drive or mirrored folder), OneDrive, Dropbox, Proton Drive, iCloud and MEGA.
/// Heuristics only: the result is shown to the user, who can see what was detected and why.
/// </summary>
public static partial class CloudProviders
{
    static readonly string[] GoogleDriveNames = ["My Drive", "Mein Drive", "Meine Ablage", "Mon Drive", "Mi unidad", "Il mio Drive", "Mijn Drive"];

    [GeneratedRegex(@"^(Google Drive|My Drive|Meine Ablage|Mein Drive)", RegexOptions.IgnoreCase)]
    private static partial Regex GoogleMirror();

    [GeneratedRegex(@"^Proton Drive", RegexOptions.IgnoreCase)]
    private static partial Regex Proton();

    [GeneratedRegex(@"^(iCloudDrive|iCloud Drive)$", RegexOptions.IgnoreCase)]
    private static partial Regex ICloud();

    [GeneratedRegex(@"^Dropbox", RegexOptions.IgnoreCase)]
    private static partial Regex Dropbox();

    [GeneratedRegex(@"^(MEGA|MEGAsync)$", RegexOptions.IgnoreCase)]
    private static partial Regex Mega();

    [GeneratedRegex(@"^OneDrive", RegexOptions.IgnoreCase)]
    private static partial Regex OneDrive();

    [GeneratedRegex(@"^\d{10,}$")]
    private static partial Regex DriveAccountFolder();

    /// <summary>
    /// A folder that looks like a mirrored Google Drive but is not synced any more: Drive already streams "My Drive" to a virtual
    /// drive and only one account is signed in, so the folder in the profile is what an older mirror setup left behind.
    /// Its files are NOT in the cloud (new changes only happen there), so it is never used as a cloud root.
    /// </summary>
    public const string LeftoverMode = "leftover";

    /// <summary>One numeric folder per signed-in account below %LOCALAPPDATA%\Google\DriveFS. 0 = Drive for desktop not found.</summary>
    internal static int DriveAccountCount(string localAppData)
    {
        if (string.IsNullOrEmpty(localAppData)) return 0;
        try
        {
            var dir = Path.Combine(localAppData, @"Google\DriveFS");
            return Directory.Exists(dir) ? Directory.EnumerateDirectories(dir).Count(d => DriveAccountFolder().IsMatch(Path.GetFileName(d))) : 0;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return 0; }
    }

    public sealed record Provider(string Id, string Name, string Mode, string Root, string DetectedBy)
    {
        public JsonObject ToJson() => J.O(("id", Id), ("name", Name), ("mode", Mode), ("root", Root), ("detectedBy", DetectedBy));
    }

    public static List<Provider> Detect(ScanEnvironment env, ISystemProbe probe, IEnumerable<string> extraCloudRoots)
    {
        var found = new List<Provider>();
        void Add(string id, string name, string mode, string? root, string by)
        {
            if (string.IsNullOrEmpty(root)) return;
            string full;
            try { full = Path.GetFullPath(root).TrimEnd('\\', '/'); }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { return; }
            if (found.Any(e => e.Root.Equals(full, StringComparison.OrdinalIgnoreCase))) return;
            found.Add(new Provider(id, name, mode, full, by));
        }

        // Google Drive for desktop in "stream" mode: a virtual drive letter that contains "My Drive" / "Meine Ablage" / ...
        foreach (var d in probe.Drives())
        {
            foreach (var n in GoogleDriveNames)
            {
                var p = Path.Combine(d.Name, n);
                if (!Directory.Exists(p)) continue;
                var by = $"folder \"{n}\" on drive {d.Name}";
                if (d.Label.Contains("Google Drive", StringComparison.OrdinalIgnoreCase)) by += $", volume label \"{d.Label}\"";
                Add("gdrive", "Google Drive", "stream", p, by);
            }
        }

        // mirrored into the profile (older "Backup and Sync" style or mirror mode) and other sync folders
        if (!string.IsNullOrEmpty(env.UserProfile) && Directory.Exists(env.UserProfile))
        {
            foreach (var dir in SafeDirectories(env.UserProfile))
            {
                var nm = Path.GetFileName(dir);
                var by = "folder in profile: " + nm;
                if (GoogleMirror().IsMatch(nm)) Add("gdrive", "Google Drive", "mirror", dir, by);
                else if (Proton().IsMatch(nm)) Add("proton", "Proton Drive", "sync", dir, by);
                else if (ICloud().IsMatch(nm)) Add("icloud", "iCloud Drive", "sync", dir, by);
                else if (Dropbox().IsMatch(nm)) Add("dropbox", "Dropbox", "sync", dir, by);
                else if (Mega().IsMatch(nm)) Add("mega", "MEGA", "sync", dir, by);
                else if (OneDrive().IsMatch(nm)) Add("onedrive", "OneDrive" + (nm != "OneDrive" ? $" ({nm})" : ""), "sync", dir, by);
            }
        }

        foreach (var (name, value) in env.CloudEnvVars)
        {
            if (Directory.Exists(value) || File.Exists(value)) Add("onedrive", "OneDrive", "sync", value, "environment variable " + name);
        }

        foreach (var infoFile in new[] { Path.Combine(env.AppData, @"Dropbox\info.json"), Path.Combine(env.LocalAppData, @"Dropbox\info.json") })
        {
            try
            {
                if (!File.Exists(infoFile)) continue;
                using var doc = JsonDocument.Parse(File.ReadAllText(infoFile));
                foreach (var account in new[] { "personal", "business" })
                {
                    if (doc.RootElement.ValueKind == JsonValueKind.Object
                        && doc.RootElement.TryGetProperty(account, out var acc) && acc.ValueKind == JsonValueKind.Object
                        && acc.TryGetProperty("path", out var path) && path.ValueKind == JsonValueKind.String
                        && path.GetString() is { Length: > 0 } p && (Directory.Exists(p) || File.Exists(p)))
                    {
                        Add("dropbox", "Dropbox", "sync", p, "Dropbox info.json");
                    }
                }
            }
            catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException) { }
        }

        foreach (var x in extraCloudRoots)
        {
            if (!string.IsNullOrEmpty(x) && (Directory.Exists(x) || File.Exists(x))) Add("custom", "Eigener Cloud-Ordner", "sync", x, "configured by you");
        }

        // Drive streams "My Drive" to a virtual drive AND a profile folder of the same name exists: with one account Drive cannot do both,
        // so that folder is a leftover of an older mirror setup. (Two accounts could legitimately mirror one and stream the other: then it stays "mirror".)
        var streamed = found.FirstOrDefault(p => p.Id == "gdrive" && p.Mode == "stream");
        if (streamed is not null && DriveAccountCount(env.LocalAppData) <= 1)
        {
            for (var i = 0; i < found.Count; i++)
            {
                if (found[i].Id == "gdrive" && found[i].Mode == "mirror")
                    found[i] = found[i] with { Mode = LeftoverMode, DetectedBy = found[i].DetectedBy + $"; Drive already streams to {streamed.Root} and only one account is signed in: left over from an older mirror setup, no longer synced" };
            }
        }
        return found;
    }

    static IEnumerable<string> SafeDirectories(string path)
    {
        try
        {
            return Directory.EnumerateDirectories(path, "*", new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = 0 }).ToList();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return []; }
    }

    public static string ToJson(IEnumerable<Provider> providers) =>
        J.A(providers.Select(p => (JsonNode?)p.ToJson())).ToJsonString();
}
