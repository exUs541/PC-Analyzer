using System.Reflection;

namespace LaptopCheck.Core;

public static class AppInfo
{
    /// <summary>Where the releases (installer and updates) are published.</summary>
    public const string RepositoryUrl = "https://github.com/exUs541/PC-Analyzer";

    /// <summary>Product version without the "+commit" suffix the SDK appends.</summary>
    public static string Version { get; } = ReadVersion();

    static string ReadVersion()
    {
        var attr = typeof(AppInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>();
        var v = attr?.InformationalVersion ?? "0.0.0";
        var plus = v.IndexOf('+');
        return plus >= 0 ? v[..plus] : v;
    }
}
