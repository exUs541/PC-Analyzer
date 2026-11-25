namespace LaptopCheck.Core;

/// <summary>
/// The dashboard's own documents (notes, history, config, projects, repos, cleanup). They are opaque JSON to the
/// server: stored and returned as text, only checked for being valid JSON.
/// </summary>
public sealed class JsonStores(DataPaths paths)
{
    public const int MaxBytes = 8 * 1024 * 1024;

    public static readonly IReadOnlyList<string> Names = ["notes", "history", "config", "projects", "repos", "cleanup"];

    public static bool IsStore(string name) => Names.Contains(name);

    public string PathOf(string name)
    {
        if (!IsStore(name)) throw new ArgumentException("unknown store");
        return paths.Of(name + ".json");
    }

    /// <summary>The stored text, or "null" when nothing was saved yet.</summary>
    public string Read(string name) => AtomicFile.ReadText(PathOf(name)) ?? "null";

    /// <exception cref="ArgumentException">The body is not valid JSON.</exception>
    public void Write(string name, string body)
    {
        if (!AtomicFile.IsValidJson(body)) throw new ArgumentException("invalid json");
        AtomicFile.WriteText(PathOf(name), body, keepBackup: true);
    }
}
