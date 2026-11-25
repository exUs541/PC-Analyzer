using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LaptopCheck.Core;

namespace LaptopCheck.Scan.Files;

/// <summary>What the files scan reports about a git working copy: remote, branch, uncommitted work, size, project type.</summary>
internal static partial class GitRepos
{
    [GeneratedRegex(@"github\.com[:/]+([^/\s]+)/([^/\s]+?)(?:\.git)?/?$")]
    private static partial Regex GitHubRemote();

    [GeneratedRegex(@"(?s)\[remote ""origin""\][^\[]*?url\s*=\s*([^\r\n]+)")]
    private static partial Regex OriginUrl();

    [GeneratedRegex(@"^ref:\s*refs/heads/(.+)$")]
    private static partial Regex HeadRef();

    [GeneratedRegex(@"\[ahead (\d+)")]
    private static partial Regex Ahead();

    static readonly string[] MarkerNames =
        ["package.json", "requirements.txt", "pyproject.toml", "Pipfile", "manifest.json", "project.godot", "ProjectSettings", "Dockerfile", "docker-compose.yml", "build.gradle", "build.gradle.kts", "AndroidManifest.xml"];

    static readonly string[] MarkerPatterns = ["*.sln", "*.csproj", "*.uproject"];

    /// <summary>https://github.com/owner/repo(.git) or git@github.com:owner/repo(.git) become "owner/repo"; other hosts give null.</summary>
    public static string? FullNameOf(string? url)
    {
        if (string.IsNullOrEmpty(url)) return null;
        var m = GitHubRemote().Match(url);
        return m.Success ? m.Groups[1].Value + "/" + m.Groups[2].Value : null;
    }

    static string? ReadText(string path)
    {
        try { return File.ReadAllText(path); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return null; }
    }

    static string? GitText(FilesContext c, string gitExe, IReadOnlyList<string> args)
    {
        try
        {
            var r = c.Processes.Run(gitExe, args, TimeSpan.FromMilliseconds(8000));
            return r.TimedOut || r.ExitCode != 0 ? null : r.Output;
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException) { return null; }
    }

    public static JsonObject Info(FilesContext c, string path, string? gitExe, IReadOnlyList<string> cloudRoots, int sizeSeconds = 3)
    {
        var gitDir = Path.Combine(path, ".git");
        var isDir = Directory.Exists(gitDir);
        var cfgText = isDir ? ReadText(Path.Combine(gitDir, "config")) ?? "" : "";
        var headText = isDir ? (ReadText(Path.Combine(gitDir, "HEAD")) ?? "").Trim() : "";

        string? remote = null;
        var rm = OriginUrl().Match(cfgText);
        if (rm.Success) remote = rm.Groups[1].Value.Trim();
        string? branch = null;
        var bm = HeadRef().Match(headText);
        if (bm.Success) branch = bm.Groups[1].Value;

        string? last = null;
        foreach (var cand in new[] { Path.Combine(gitDir, "logs", "HEAD"), Path.Combine(gitDir, "HEAD") })
        {
            if (!File.Exists(cand)) continue;
            last = Val.Iso(File.GetLastWriteTime(cand), c.Now());
            break;
        }

        bool? dirty = null, noUpstream = null;
        int? ahead = null, changed = null, untracked = null;
        if (gitExe is not null)
        {
            var st = GitText(c, gitExe, ["--no-optional-locks", "-C", path, "status", "--porcelain=v1", "--branch"]);
            if (st is not null)
            {
                changed = 0; untracked = 0;
                foreach (var raw in st.Split('\n'))
                {
                    var l = raw.TrimEnd('\r');
                    if (l.Trim().Length == 0) continue;
                    if (l.StartsWith("## ", StringComparison.Ordinal))
                    {
                        noUpstream = !l.Contains("...", StringComparison.Ordinal);
                        var am = Ahead().Match(l);
                        ahead = am.Success ? int.Parse(am.Groups[1].Value) : 0;
                    }
                    else if (l.StartsWith("??", StringComparison.Ordinal)) untracked++;
                    else changed++;
                }
                dirty = changed > 0 || untracked > 0;
            }
        }

        long? size = null, nodeModules = null;
        var sizePartial = false;
        try
        {
            var s = FileScanner.DirSize(path, sizeSeconds);
            size = s.Bytes;
            sizePartial = s.Partial;
            var nmPath = Path.Combine(path, "node_modules");
            if (Directory.Exists(nmPath)) nodeModules = FileScanner.DirSize(nmPath, sizeSeconds).Bytes;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }

        string? inCloud = cloudRoots.FirstOrDefault(cr => PathUtil.IsUnder(path, cr));

        // files in the repository root that tell which tools the project needs (Node, Python, Unity, Godot, extension manifest ...)
        var markers = new List<string>();
        foreach (var mk in MarkerNames)
        {
            var p = Path.Combine(path, mk);
            if (File.Exists(p) || Directory.Exists(p)) markers.Add(mk);
        }
        foreach (var pat in MarkerPatterns)
        {
            try
            {
                if (Directory.EnumerateFiles(path, pat).Any()) markers.Add(pat);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }

        return J.O(
            ("markers", markers.Select(m => (object?)m).ToList()),
            ("path", path), ("remote", remote), ("fullName", FullNameOf(remote)), ("branch", branch), ("lastCommit", last),
            ("dirty", dirty), ("changedFiles", changed), ("untrackedFiles", untracked), ("ahead", ahead), ("noUpstream", noUpstream),
            ("sizeBytes", size), ("sizePartial", sizePartial), ("nodeModulesBytes", nodeModules), ("inCloudRoot", inCloud));
    }
}
