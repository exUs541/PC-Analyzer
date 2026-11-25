using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LaptopCheck.Core;

namespace LaptopCheck.Scan.Sections;

/// <summary>Program updates reported by winget (optional, needs the network).</summary>
internal static partial class WingetSections
{
    [GeneratedRegex(@"^-{5,}\s*$")]
    private static partial Regex Separator();

    [GeneratedRegex(@"(?<=^|\s{2})\S")]
    private static partial Regex ColumnStart();

    /// <summary>Rows of the "winget upgrade" table, found by the column positions of its header line.</summary>
    public static List<JsonObject> ParseUpgradeTable(string text)
    {
        var lines = text.Split('\n')
            .Select(raw => raw.TrimEnd('\r'))
            .Select(l => l.Split('\r')[^1])   // drop spinner artefacts before the real line
            .ToList();

        var sep = -1;
        for (var i = 1; i < lines.Count; i++)
        {
            if (Separator().IsMatch(lines[i])) { sep = i; break; }
        }
        if (sep < 1) return [];

        var starts = ColumnStart().Matches(lines[sep - 1]).Select(m => m.Index).ToList();
        if (starts.Count < 4) return [];

        var rows = new List<JsonObject>();
        for (var i = sep + 1; i < lines.Count; i++)
        {
            var l = lines[i];
            if (l.Trim().Length == 0) break;
            if (l.Length <= starts[2]) continue;

            string Cut(int idx)
            {
                var from = starts[idx];
                if (from >= l.Length) return "";
                var to = idx + 1 < starts.Count ? Math.Min(starts[idx + 1], l.Length) : l.Length;
                return l.Substring(from, to - from).Trim();
            }

            var id = Cut(1);
            if (id.Length == 0 || id.Any(char.IsWhiteSpace)) continue;
            rows.Add(J.O(("name", Cut(0)), ("id", id), ("version", Cut(2)), ("available", Cut(3)), ("source", starts.Count > 4 ? Cut(4) : "")));
        }
        return rows;
    }

    /// <summary>Null when winget is unavailable or failed (so "0 updates" differs from "not checked").</summary>
    public static JsonArray? Updates(ScanContext c)
    {
        var winget = c.Processes.FindOnPath("winget.exe");
        if (winget is null) return null;
        var result = c.Processes.Run(winget, ["upgrade", "--accept-source-agreements", "--disable-interactivity"], TimeSpan.FromSeconds(90), Encoding.UTF8);
        if (result.TimedOut)
        {
            c.Warn("updates", "winget upgrade: timeout after 90 s");
            return null;
        }
        return J.A(ParseUpgradeTable(result.Output));
    }
}
