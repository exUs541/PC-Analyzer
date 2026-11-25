using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace LaptopCheck.Scan.Sections;

/// <summary>Installed programs (classic installers and Store apps), their sizes, and Start Menu shortcuts.</summary>
internal static partial class SoftwareSections
{
    [GeneratedRegex(@"^(Update|Hotfix|Security Update|Update Rollup|ServicePack)$", RegexOptions.IgnoreCase)]
    private static partial Regex UpdateRelease();

    [GeneratedRegex(@"^(Update for|Security Update for|Hotfix for)\b|\(KB\d{6,}\)", RegexOptions.IgnoreCase)]
    private static partial Regex UpdateName();

    [GeneratedRegex(@"CN=(?:""([^""]+)""|([^,]+))")]
    private static partial Regex PublisherCn();

    [GeneratedRegex(@"^[0-9A-Fa-f-]{20,}$")]
    private static partial Regex GuidLike();

    [GeneratedRegex(@"(?i)^[a-z]:\\(windows|program files|program files \(x86\)|programdata)$")]
    private static partial Regex SystemFolder();

    [GeneratedRegex(@"(?i)^[a-z]:\\users\\[^\\]+(\\(documents|downloads|desktop|pictures|videos|music|appdata(\\(local|roaming|locallow))?))?$")]
    private static partial Regex ProfileFolder();

    public sealed record RegistryResult(List<JsonObject> Items, int IgnoredUpdates);

    public static RegistryResult FromRegistry(ScanContext c)
    {
        var items = new List<JsonObject>();
        var ignored = 0;
        var seen = new HashSet<string>();
        const string uninst = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
        (RegHive Hive, RegView View, string Sub, string Scope, string Arch)[] roots =
        [
            (RegHive.LocalMachine, RegView.Registry64, uninst, "machine", "x64"),
            (RegHive.LocalMachine, RegView.Registry32, uninst, "machine", "x86"),
            (RegHive.CurrentUser, RegView.Registry64, uninst, "user", "x64"),
            (RegHive.CurrentUser, RegView.Registry64, @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall", "user", "x86"),
        ];

        foreach (var root in roots)
        {
            using var rk = c.Registry.Open(root.Hive, root.Sub, root.View);
            if (rk is null) continue;
            foreach (var name in rk.GetSubKeyNames())
            {
                using var k = rk.OpenSubKey(name);
                if (k is null) continue;
                try
                {
                    var dn = Val.Clean(k.GetValue("DisplayName"));
                    if (dn is null) continue;
                    var rel = Convert.ToString(k.GetValue("ReleaseType"), CultureInfo.InvariantCulture) ?? "";
                    if (!string.IsNullOrEmpty(Convert.ToString(k.GetValue("ParentKeyName"), CultureInfo.InvariantCulture))
                        || UpdateRelease().IsMatch(rel) || UpdateName().IsMatch(dn))
                    {
                        ignored++;
                        continue;
                    }
                    var ver = Val.Clean(k.GetValue("DisplayVersion"));
                    var pub = Val.Clean(k.GetValue("Publisher"));
                    if (!seen.Add((dn + "|" + ver + "|" + pub + "|" + root.Arch).ToLowerInvariant())) continue;

                    var loc = Val.Clean(k.GetValue("InstallLocation"));
                    var icon = Val.Clean(k.GetValue("DisplayIcon"));
                    var (date, dateSrc) = InstallDate(c, k, loc);
                    var sizeKb = Val.LongOrNull(k.GetValue("EstimatedSize"));
                    items.Add(J.O(
                        ("id", $"reg:{(root.Hive == RegHive.LocalMachine ? "HKLM" : "HKCU")}:{root.Arch}:{name}"),
                        ("source", "registry"),
                        ("name", dn),
                        ("version", ver),
                        ("publisher", pub),
                        ("installDate", date),
                        ("installDateSource", dateSrc),
                        ("installLocation", loc),
                        ("displayIcon", icon),
                        ("uninstallString", Val.Clean(k.GetValue("UninstallString"))),
                        ("quietUninstall", Val.Clean(k.GetValue("QuietUninstallString"))),
                        ("sizeKB", sizeKb),
                        ("sizeSource", sizeKb is > 0 ? "registry" : null),
                        ("scope", root.Scope),
                        ("arch", root.Arch),
                        ("isSystemComponent", Val.LongOrNull(k.GetValue("SystemComponent")) == 1),
                        ("aboutUrl", Val.Clean(k.GetValue("URLInfoAbout"))),
                        ("regKey", name)));
                }
                catch (Exception ex) when (ex is InvalidCastException or FormatException or IOException) { }
            }
        }
        return new RegistryResult(items, ignored);
    }

    static (string? Date, string? Source) InstallDate(ScanContext c, IRegKey k, string? loc)
    {
        var raw = Convert.ToString(k.GetValue("InstallDate"), CultureInfo.InvariantCulture) ?? "";
        if (raw.Length == 8 && raw.All(char.IsAsciiDigit)
            && DateTime.TryParseExact(raw, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            && Val.Iso(parsed, c.Now()) is { } fromRegistry)
        {
            return (fromRegistry, "registry");
        }
        if (loc is not null)
        {
            var clean = loc.Trim('"').TrimEnd('\\');
            if (clean.Split('\\').Length >= 3)
            {
                try
                {
                    DateTime? created = Directory.Exists(clean) ? Directory.GetCreationTime(clean) : File.Exists(clean) ? File.GetCreationTime(clean) : null;
                    if (Val.Iso(created, c.Now()) is { } fromFolder) return (fromFolder, "folder");
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException) { }
            }
        }
        if (Val.Iso(k.LastWriteTime, c.Now()) is { } fromKey) return (fromKey, "keytime");
        return (null, null);
    }

    public static List<JsonObject> FromStore(ScanContext c)
    {
        var list = new List<JsonObject>();
        foreach (var pkg in c.Appx.GetPackages().Where(p => !p.IsFramework && !p.IsResource))
        {
            if (pkg.NonRemovable || pkg.IsSystem) continue;
            var start = pkg.StartApps.FirstOrDefault();
            var display = start is not null ? start.Name : pkg.Name;

            string? publisher = null;
            var m = PublisherCn().Match(pkg.Publisher ?? "");
            if (m.Success) publisher = m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value.Trim();
            if (string.IsNullOrEmpty(publisher) || GuidLike().IsMatch(publisher))
            {
                var pd = pkg.PublisherDisplayName;
                if (!string.IsNullOrEmpty(pd) && !pd.StartsWith("ms-resource:", StringComparison.Ordinal)) publisher = pd;
            }

            string? date = null;
            if (!string.IsNullOrEmpty(pkg.InstalledPath))
            {
                try { date = Val.Iso(Directory.GetCreationTime(pkg.InstalledPath), c.Now()); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { }
            }

            list.Add(J.O(
                ("id", "store:" + pkg.FullName), ("source", "store"), ("name", display), ("version", pkg.Version),
                ("publisher", publisher), ("installDate", date), ("installDateSource", date is null ? null : "folder"),
                ("installLocation", pkg.InstalledPath), ("displayIcon", null), ("uninstallString", null), ("quietUninstall", null),
                ("sizeKB", null), ("sizeSource", null), ("scope", "user"), ("arch", pkg.Architecture), ("isSystemComponent", false),
                ("aboutUrl", null), ("regKey", null), ("packageName", pkg.Name), ("packageFamily", pkg.FamilyName),
                ("hasStartEntry", start is not null)));
        }
        return list;
    }

    /// <summary>Only real program folders are measured: never a drive root, a user profile, a standard folder or a system folder itself.</summary>
    internal static bool IsMeasurableInstallFolder(string? path)
    {
        if (string.IsNullOrEmpty(path)) return false;
        var p = path.Trim('"').TrimEnd('\\');
        if (p.Split('\\', '/').Length < 3) return false;
        if (SystemFolder().IsMatch(p) || ProfileFolder().IsMatch(p)) return false;
        return Directory.Exists(p) || File.Exists(p);
    }

    /// <summary>
    /// 1) Fills in missing program sizes by measuring the install folder (time-boxed).
    /// 2) Re-measures suspiciously large sizes the installer reported: some installers write BYTES where Windows expects
    ///    KILOBYTES, so a 62 MB driver shows up as 62 GB. If the folder is far smaller than the claim, the folder wins
    ///    (sizeSource = folder-corrected, the claimed value stays in sizeRegistryKB).
    /// </summary>
    public static void AddFolderSizes(IReadOnlyList<JsonObject> items, int budgetSeconds = 45, long checkAboveKb = 2_097_152)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        foreach (var it in items)
        {
            if (sw.Elapsed.TotalSeconds > budgetSeconds) break;
            var loc = it["installLocation"]?.GetValue<string>();
            if (SizeOf(it) is > 0 || string.IsNullOrEmpty(loc)) continue;
            var p = loc.Trim('"').TrimEnd('\\');
            if (!IsMeasurableInstallFolder(p)) continue;
            var s = SystemSections.FolderSizeCapped(p, 3);
            if (s.Bytes > 0)
            {
                it["sizeKB"] = (long)Math.Round(s.Bytes / 1024.0);
                it["sizeSource"] = s.Partial ? "folder-partial" : "folder";
            }
        }
        foreach (var it in items)
        {
            if (sw.Elapsed.TotalSeconds > budgetSeconds + 20) break;
            var kb = SizeOf(it);
            if (it["sizeSource"]?.GetValue<string>() != "registry" || kb is null or 0 || kb < checkAboveKb) continue;
            var loc = it["installLocation"]?.GetValue<string>();
            if (string.IsNullOrEmpty(loc)) continue;
            var p = loc.Trim('"').TrimEnd('\\');
            if (!IsMeasurableInstallFolder(p)) continue;
            var s = SystemSections.FolderSizeCapped(p, 6);
            if (s.Partial || s.Bytes <= 0) continue;   // cannot judge: keep the installer's claim (the dashboard still checks plausibility)
            var folderKb = (long)Math.Round(s.Bytes / 1024.0);
            if (kb > 8 * Math.Max(folderKb, 1024))
            {
                it["sizeRegistryKB"] = kb;
                it["sizeKB"] = folderKb;
                it["sizeSource"] = "folder-corrected";
            }
        }
    }

    static long? SizeOf(JsonObject it) => it["sizeKB"] is JsonValue v && v.TryGetValue<long>(out var l) ? l : null;

    /// <summary>Start Menu shortcuts link a program's display name to its executable.</summary>
    public static JsonArray Shortcuts(ScanContext c)
    {
        var list = new List<JsonNode?>();
        foreach (var root in new[] { Path.Combine(c.Env.ProgramData, @"Microsoft\Windows\Start Menu\Programs"), Path.Combine(c.Env.AppData, @"Microsoft\Windows\Start Menu\Programs") })
        {
            if (!Directory.Exists(root)) continue;
            foreach (var lnk in SystemSections.FilesIn(root, "*.lnk", recurse: true))
            {
                var t = c.Probe.ReadShortcut(lnk);
                if (t is not null) list.Add(J.O(("name", Path.GetFileNameWithoutExtension(lnk)), ("path", lnk), ("target", t.Target), ("args", t.Arguments)));
            }
        }
        return J.A(list);
    }
}
