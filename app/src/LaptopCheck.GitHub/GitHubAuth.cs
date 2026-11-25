using System.Text.RegularExpressions;
using LaptopCheck.Core;

namespace LaptopCheck.GitHub;

/// <param name="Token">Never logged, never written, only ever sent to the GitHub API.</param>
/// <param name="Source">token-file, git-credential-manager, github-desktop, gh or git.</param>
public sealed record AuthCandidate(string Token, string Source);

/// <summary>
/// Finds a GitHub login that already exists on this PC, so no extra setup is needed (private repositories, updates).
/// Order: data\github-token.txt (set by hand) > Windows Credential Manager (Git Credential Manager, GitHub Desktop)
/// > GitHub CLI (gh auth token) > git credential fill (any other Git credential helper, never interactive).
/// </summary>
public sealed partial class GitHubAuth(DataPaths data, ICredentialStore credentials, IProcessRunner processes)
{
    [GeneratedRegex(@"^[A-Za-z0-9_]{20,255}$")]
    internal static partial Regex TokenShape();

    [GeneratedRegex(@"^password=(.+)$", RegexOptions.Multiline)]
    private static partial Regex PasswordLine();

    /// <param name="includeProcesses">False: only the token file and the Credential Manager (instant). True: also ask the GitHub CLI and Git, which can take seconds.</param>
    public IReadOnlyList<AuthCandidate> Candidates(bool includeProcesses = true)
    {
        var list = new List<AuthCandidate>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        void Add(string? token, string source)
        {
            if (!string.IsNullOrEmpty(token) && seen.Add(token)) list.Add(new AuthCandidate(token, source));
        }

        if (File.Exists(data.GitHubToken))
        {
            try { Add(File.ReadAllText(data.GitHubToken).Trim(), "token-file"); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }

        if (!NoSystemCredentials)
        {
            try
            {
                foreach (var c in credentials.Find("git:https://github.com*")) Add(c.Secret, "git-credential-manager");
                foreach (var c in credentials.Find("GitHub - https://api.github.com*")) Add(c.Secret, "github-desktop");
            }
            catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException or System.Runtime.InteropServices.COMException) { }
        }

        if (!includeProcesses) return list;

        var gh = NoGitHubCli ? null : processes.FindOnPath("gh.exe");
        if (gh is not null)
        {
            try
            {
                var r = processes.Run(gh, ["auth", "token"], TimeSpan.FromSeconds(8));
                if (!r.TimedOut && r.ExitCode == 0) Add(r.Output.Trim(), "gh");
            }
            catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException) { }
        }

        if (!NoSystemCredentials) Add(GitCredentialToken(), "git");
        return list;
    }

    /// <summary>LC_NO_SYSCRED=1 switches the Credential Manager and Git's credential helper off (tests, or for people who do not want them read).</summary>
    public static bool NoSystemCredentials => Environment.GetEnvironmentVariable("LC_NO_SYSCRED") == "1";

    /// <summary>LC_NO_GH=1 switches the GitHub CLI off.</summary>
    public static bool NoGitHubCli => Environment.GetEnvironmentVariable("LC_NO_GH") == "1";

    /// <summary>Asks Git's configured credential helper for github.com, without any prompt or window.</summary>
    string? GitCredentialToken()
    {
        var git = processes.FindOnPath("git.exe");
        if (git is null) return null;
        try
        {
            var env = new Dictionary<string, string>
            {
                ["GIT_TERMINAL_PROMPT"] = "0", ["GCM_INTERACTIVE"] = "never", ["GIT_ASKPASS"] = "", ["SSH_ASKPASS"] = "",
            };
            var r = processes.RunWithInput(git, ["credential", "fill"], "protocol=https\nhost=github.com\n\n", TimeSpan.FromSeconds(8), env);
            if (r.TimedOut) return null;
            var m = PasswordLine().Match(r.Output.Replace("\r", ""));
            return m.Success && TokenShape().IsMatch(m.Groups[1].Value.Trim()) ? m.Groups[1].Value.Trim() : null;
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return null;
        }
    }
}
