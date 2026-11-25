using System.Text.Json;
using System.Text.Json.Nodes;
using LaptopCheck.Core;

namespace LaptopCheck.Scan.Files;

/// <summary>
/// The "compare two folders" action behind the dashboard. Checks the two folders (they exist, they are different, neither lies inside the other),
/// runs <see cref="FolderCompare"/> and keeps the last result in data\compare.json so the page can show it again. Read-only.
/// </summary>
public sealed class CompareService(DataPaths data, int seconds = 240) : ICompareActions
{
    readonly SemaphoreSlim _gate = new(1, 1);

    static string Full(string path, string what)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException(what + ": Es wurde kein Ordner angegeben.");
        var p = path.Trim().Trim('"');
        if (p.Split('\\', '/').Any(s => s == "..")) throw new ArgumentException(what + ": Der Pfad darf kein „..“ enthalten.");
        if (!Path.IsPathFullyQualified(p)) throw new ArgumentException(what + ": Bitte einen vollständigen Pfad angeben, z. B. C:\\Users\\…\\Dokumente.");
        string full;
        try { full = Path.GetFullPath(p).TrimEnd('\\', '/'); }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { throw new ArgumentException(what + ": Der Pfad ist ungültig."); }
        if (full.Length <= 3) full = Path.GetPathRoot(full) ?? full;
        if (!Directory.Exists(full)) throw new ArgumentException(what + ": Diesen Ordner gibt es nicht: " + full);
        return full;
    }

    public async Task<string> RunAsync(string requestJson, CancellationToken cancellationToken = default)
    {
        JsonObject req;
        try { req = JsonNode.Parse(requestJson) as JsonObject ?? throw new ArgumentException("Ungültige Anfrage."); }
        catch (JsonException) { throw new ArgumentException("Ungültige Anfrage."); }
        var a = Full(req["a"] is JsonValue va && va.TryGetValue<string>(out var sa) ? sa : "", "Ordner A");
        var b = Full(req["b"] is JsonValue vb && vb.TryGetValue<string>(out var sb) ? sb : "", "Ordner B");
        if (PathUtil.IsUnder(a, b) || PathUtil.IsUnder(b, a))
            throw new ArgumentException(a.Equals(b, StringComparison.OrdinalIgnoreCase) ? "Ordner A und B sind derselbe Ordner." : "Ein Ordner liegt im anderen: Das lässt sich nicht sinnvoll vergleichen.");
        var deep = req["deep"] is JsonValue vd && vd.TryGetValue<bool>(out var d) && d;
        var ignoreJunk = !(req["ignoreJunk"] is JsonValue vj && vj.TryGetValue<bool>(out var j) && !j);

        if (!await _gate.WaitAsync(0, cancellationToken)) throw new ArgumentException("Es läuft schon ein Vergleich.");
        try
        {
            var result = await Task.Run(() => FolderCompare.Run(a, b, deep, ignoreJunk, seconds), cancellationToken);
            var text = result.ToJsonString(new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
            try { AtomicFile.WriteText(data.Compare, text); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* the answer still goes out; only "show last result" is missing */ }
            return text;
        }
        finally
        {
            _gate.Release();
        }
    }

    public string Last()
    {
        var t = AtomicFile.ReadText(data.Compare);
        return t is not null && AtomicFile.IsValidJson(t) ? t : "null";
    }
}
