using System.Text;
using System.Text.Json;

namespace LaptopCheck.Core;

public static class AtomicFile
{
    static readonly UTF8Encoding Utf8 = new(false);

    public static string? ReadText(string path) => File.Exists(path) ? File.ReadAllText(path, Utf8) : null;

    /// <summary>Writes to a temp file first, optionally keeps one .bak of the previous version, then swaps.</summary>
    public static void WriteText(string path, string text, bool keepBackup = false)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, text, Utf8);
        if (File.Exists(path))
        {
            if (keepBackup) File.Copy(path, path + ".bak", true);
            File.Move(tmp, path, true);
        }
        else
        {
            File.Move(tmp, path);
        }
    }

    public static bool IsValidJson(string text)
    {
        try
        {
            var reader = new Utf8JsonReader(Utf8.GetBytes(text));
            while (reader.Read()) { }
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
