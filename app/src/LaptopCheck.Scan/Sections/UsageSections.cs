using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace LaptopCheck.Scan.Sections;

/// <summary>Evidence of when programs were last used (the dashboard matches it to the installed programs).</summary>
internal static partial class UsageSections
{
    [GeneratedRegex(@"^(?<p>.+\.exe)\.FriendlyAppName$", RegexOptions.IgnoreCase)]
    private static partial Regex MuiName();

    [GeneratedRegex(@"^(?<exe>.+)-[0-9A-F]{8}\.pf$", RegexOptions.IgnoreCase)]
    private static partial Regex PrefetchName();

    public sealed record Evidence(List<JsonNode?> Entries, JsonObject Counts);

    public static Evidence Collect(ScanContext c)
    {
        var entries = new List<JsonNode?>();
        int userAssist = 0, appCompat = 0, muiCache = 0, prefetch = 0;

        // 1) UserAssist: programs started via Explorer or the Start menu. HKCU, no admin needed.
        using (var ua = c.Registry.Open(RegHive.CurrentUser, @"Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist"))
        {
            if (ua is not null)
            {
                foreach (var g in ua.GetSubKeyNames())
                {
                    using var ck = ua.OpenSubKey(g + @"\Count");
                    if (ck is null) continue;
                    foreach (var n in ck.GetValueNames())
                    {
                        var decoded = Val.Rot13(n);                           // the names are ROT13-encoded
                        if (decoded.StartsWith("UEME_", StringComparison.OrdinalIgnoreCase)) continue;   // session bookkeeping
                        if (ck.GetValue(n) is not byte[] { Length: >= 68 } b) continue;
                        var runCount = BitConverter.ToUInt32(b, 4);
                        var focusMs = BitConverter.ToUInt32(b, 12);
                        entries.Add(J.O(
                            ("source", "UserAssist"), ("path", decoded), ("lastRun", Val.FileTimeIso(BitConverter.ToInt64(b, 60), c.Now())),
                            ("runCount", (long)runCount), ("focusSec", (long)Math.Round(focusMs / 1000.0))));
                        userAssist++;
                    }
                }
            }
        }

        // 2) Compatibility Assistant store: executables started by Explorer, with a timestamp.
        using (var ac = c.Registry.Open(RegHive.CurrentUser, @"Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Compatibility Assistant\Store"))
        {
            if (ac is not null)
            {
                foreach (var n in ac.GetValueNames())
                {
                    string? last = null;
                    if (ac.GetValue(n) is byte[] { Length: >= 8 } b) last = Val.FileTimeIso(BitConverter.ToInt64(b, 0), c.Now());
                    if (n.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                    {
                        entries.Add(J.O(("source", "AppCompat"), ("path", n), ("lastRun", last), ("runCount", null), ("focusSec", null)));
                        appCompat++;
                    }
                }
            }
        }

        // 3) MuiCache: proves an executable was started at least once (no timestamp).
        using (var mc = c.Registry.Open(RegHive.CurrentUser, @"Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache"))
        {
            if (mc is not null)
            {
                foreach (var n in mc.GetValueNames())
                {
                    var m = MuiName().Match(n);
                    if (!m.Success) continue;
                    entries.Add(J.O(("source", "MuiCache"), ("path", m.Groups["p"].Value), ("lastRun", null), ("runCount", null), ("focusSec", null),
                        ("title", Convert.ToString(mc.GetValue(n), System.Globalization.CultureInfo.InvariantCulture))));
                    muiCache++;
                }
            }
        }

        // 4) Prefetch: only readable as administrator. File write time is about the last run.
        if (c.Env.IsAdmin)
        {
            var dir = Path.Combine(c.Env.SystemRoot, "Prefetch");
            if (Directory.Exists(dir))
            {
                var latest = new Dictionary<string, DateTime>();
                foreach (var f in SystemSections.FilesIn(dir, "*.pf", recurse: false))
                {
                    var m = PrefetchName().Match(Path.GetFileName(f));
                    if (!m.Success) continue;
                    var exe = m.Groups["exe"].Value.ToLowerInvariant();
                    var time = File.GetLastWriteTime(f);
                    if (!latest.TryGetValue(exe, out var old) || time > old) latest[exe] = time;
                }
                foreach (var (exe, time) in latest)
                {
                    entries.Add(J.O(("source", "Prefetch"), ("path", exe), ("lastRun", Val.Iso(time, c.Now())), ("runCount", null), ("focusSec", null)));
                    prefetch++;
                }
            }
        }

        return new Evidence(entries, J.O(("userAssist", userAssist), ("appCompat", appCompat), ("muiCache", muiCache), ("prefetch", prefetch)));
    }
}
