using System.Globalization;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace LaptopCheck.Core;

/// <summary>
/// Builds the /api/state document: every stored file is passed through as opaque text (no parse / re-serialize
/// round trip), a file that is missing or damaged becomes its fallback instead of breaking the whole answer.
/// </summary>
public sealed class StateBuilder(DataPaths paths, JsonStores stores, IGitHubStatusProvider github, string programDir)
{
    public int Port { get; set; }

    public string Build()
    {
        var sb = new StringBuilder(1 << 16);
        sb.Append("{\"snapshot\":").Append(Raw(paths.Snapshot, "null"));
        sb.Append(",\"prev\":").Append(Raw(paths.SnapshotPrev, "null"));
        sb.Append(",\"notes\":").Append(Raw(stores.PathOf("notes"), "null"));
        sb.Append(",\"history\":").Append(Raw(stores.PathOf("history"), "[]"));
        sb.Append(",\"config\":").Append(Raw(stores.PathOf("config"), "null"));
        sb.Append(",\"projects\":").Append(Raw(stores.PathOf("projects"), "null"));
        sb.Append(",\"repos\":").Append(Raw(stores.PathOf("repos"), "null"));
        sb.Append(",\"cleanup\":").Append(Raw(stores.PathOf("cleanup"), "null"));
        sb.Append(",\"files\":").Append(FilesInfo());
        sb.Append(",\"update\":").Append(Raw(paths.UpdateState, "null"));
        sb.Append(",\"meta\":").Append(Meta());
        return sb.Append('}').ToString();
    }

    static string Raw(string path, string fallback)
    {
        var text = AtomicFile.ReadText(path);
        return text is not null && AtomicFile.IsValidJson(text) ? text : fallback;
    }

    string FilesInfo()
    {
        var fi = new FileInfo(paths.Files);
        if (!fi.Exists) return "null";
        return "{\"exists\":true,\"bytes\":" + fi.Length.ToString(CultureInfo.InvariantCulture) +
               ",\"modified\":\"" + fi.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture) + "\"}";
    }

    string Meta()
    {
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms))
        {
            w.WriteStartObject();
            w.WriteString("version", AppInfo.Version);
            w.WriteBoolean("isAdmin", IsAdmin());
            w.WriteString("dataDir", paths.Dir);
            w.WriteNumber("port", Port);
            w.WriteString("programDir", programDir);
            w.WriteBoolean("isGitCopy", false);
            w.WriteBoolean("hasGithubToken", File.Exists(paths.GitHubToken));
            w.WriteString("engine", "native");
            w.WritePropertyName("github");
            w.WriteRawValue(github.GetStatusJson());
            w.WriteString("serverTime", DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture));
            w.WriteEndObject();
        }
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    public static bool IsAdmin()
    {
        try
        {
            using var id = WindowsIdentity.GetCurrent();
            return new WindowsPrincipal(id).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }
}
