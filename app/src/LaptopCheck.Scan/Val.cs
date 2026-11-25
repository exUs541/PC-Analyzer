using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace LaptopCheck.Scan;

/// <summary>Small value helpers with the exact semantics the old collector had (null stays null, junk text is dropped).</summary>
internal static partial class Val
{
    [GeneratedRegex(@"^(To Be Filled By O\.E\.M\.|Default string|None|Not Specified|System Product Name|System manufacturer|Unknown)$", RegexOptions.IgnoreCase)]
    private static partial Regex Placeholder();

    /// <summary>Trimmed text, or null for empty text and the placeholders firmware vendors leave behind.</summary>
    public static string? Clean(object? v)
    {
        if (v is null) return null;
        var s = Convert.ToString(v, CultureInfo.InvariantCulture)!.Trim();
        if (s.Length == 0) return null;
        return Placeholder().IsMatch(s) ? null : s;
    }

    public static long? LongOrNull(object? v)
    {
        switch (v)
        {
            case null: return null;
            case long l: return l;
            case int i: return i;
            case uint ui: return ui;
            case ushort us: return us;
            case short sh: return sh;
            case byte b: return b;
            case char ch: return ch;   // WMI char16 properties such as MSFT_Partition.DriveLetter
            case sbyte sb: return sb;
            case ulong ul: return ul <= long.MaxValue ? (long)ul : null;
            case bool: return null;
            case double d: return double.IsFinite(d) ? (long)Math.Round(d) : null;
            case float f: return float.IsFinite(f) ? (long)Math.Round(f) : null;
            case decimal m: return (long)Math.Round(m);
            case string s:
                return long.TryParse(s.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
            default: return null;
        }
    }

    /// <summary>Like PowerShell's [int]$x: null and unreadable values become 0.</summary>
    public static int Int0(object? v) => (int)(LongOrNull(v) ?? 0);

    /// <summary>yyyy-MM-ddTHH:mm:ss, or null for missing dates and the 1601/1980 placeholders firmware writes.</summary>
    public static string? Iso(DateTime? d, DateTime? now = null)
    {
        if (d is null) return null;
        var limit = (now ?? DateTime.Now).Year + 1;
        if (d.Value.Year < 1990 || d.Value.Year > limit) return null;
        return d.Value.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);
    }

    public static string? FileTimeIso(long fileTime, DateTime? now = null)
    {
        if (fileTime <= 0) return null;
        try { return Iso(DateTime.FromFileTimeUtc(fileTime).ToLocalTime(), now); }
        catch (ArgumentOutOfRangeException) { return null; }
    }

    public static string Rot13(string text)
    {
        var chars = text.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            var c = chars[i];
            if (c is >= 'a' and <= 'z') chars[i] = (char)((c - 'a' + 13) % 26 + 'a');
            else if (c is >= 'A' and <= 'Z') chars[i] = (char)((c - 'A' + 13) % 26 + 'A');
        }
        return new string(chars);
    }
}

/// <summary>Building JSON documents in the order the old collector wrote them.</summary>
internal static class J
{
    public static JsonNode? N(object? v) => v switch
    {
        null => null,
        JsonNode n => n,
        string s => JsonValue.Create(s),
        bool b => JsonValue.Create(b),
        int i => JsonValue.Create(i),
        long l => JsonValue.Create(l),
        double d => JsonValue.Create(d),
        uint ui => JsonValue.Create((long)ui),
        ushort us => JsonValue.Create((int)us),
        ulong ul => JsonValue.Create(ul),
        byte b => JsonValue.Create((int)b),
        IEnumerable<object?> list => new JsonArray(list.Select(N).ToArray()),
        _ => JsonValue.Create(Convert.ToString(v, CultureInfo.InvariantCulture)),
    };

    public static JsonObject O(params (string Key, object? Value)[] props)
    {
        var o = new JsonObject();
        foreach (var (k, v) in props) o[k] = N(v);
        return o;
    }

    public static JsonArray A(IEnumerable<JsonNode?> items) => new(items.ToArray());
}
