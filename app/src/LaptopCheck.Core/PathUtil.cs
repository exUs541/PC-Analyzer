namespace LaptopCheck.Core;

public static class PathUtil
{
    /// <summary>True when <paramref name="path"/> is the folder <paramref name="root"/> itself or lies below it (case-insensitive, no prefix tricks).</summary>
    public static bool IsUnder(string? path, string? root)
    {
        if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(root)) return false;
        string p, r;
        try
        {
            p = Path.GetFullPath(path).TrimEnd('\\', '/');
            r = Path.GetFullPath(root).TrimEnd('\\', '/');
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return false;
        }
        if (p.Equals(r, StringComparison.OrdinalIgnoreCase)) return true;
        return p.StartsWith(r + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }
}
