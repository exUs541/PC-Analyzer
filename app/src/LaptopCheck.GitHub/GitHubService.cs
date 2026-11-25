using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using LaptopCheck.Core;

namespace LaptopCheck.GitHub;

/// <summary>
/// The dashboard's GitHub side: who is signed in, the list of your repositories (private ones too when a login exists),
/// one-click sign-in through the browser, and a hand-made access token as the fallback. LaptopCheck never sees a password:
/// the login is kept by Git, GitHub Desktop or the GitHub CLI like for any other tool.
/// </summary>
public sealed class GitHubService : IGitHubService
{
    const string DefaultApi = "https://api.github.com";
    static readonly JsonSerializerOptions Compact = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    readonly DataPaths _data;
    readonly JsonStores _stores;
    readonly GitHubAuth _auth;
    readonly IProcessRunner _processes;
    readonly HttpClient _http;
    readonly Func<DateTime> _now;
    readonly Action<string>? _log;
    readonly object _lock = new();
    readonly SemaphoreSlim _syncGate = new(1, 1);
    string? _status;

    readonly string? _standardGit;

    /// <param name="standardGit">Where Git is installed by default, used when it is not on PATH (null: nowhere). Defaults to "C:\Program Files\Git\cmd\git.exe".</param>
    public GitHubService(DataPaths data, GitHubAuth auth, IProcessRunner processes, HttpClient http, Func<DateTime>? now = null, Action<string>? log = null,
        string? standardGit = "")
    {
        _standardGit = standardGit == "" ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Git\cmd\git.exe") : standardGit;
        _data = data;
        _stores = new JsonStores(data);
        _auth = auth;
        _processes = processes;
        _http = http;
        _now = now ?? (() => DateTime.Now);
        _log = log;
    }

    string Stamp() => _now().ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);

    string ApiBase()
    {
        var cfg = AppConfig.Read(_stores);
        return string.IsNullOrEmpty(cfg.GithubApiBase) ? DefaultApi : cfg.GithubApiBase.TrimEnd('/');
    }

    string StatusJson(bool connected, string? source, string? login) => new JsonObject
    {
        ["connected"] = connected, ["source"] = source, ["login"] = login, ["checkedAt"] = Stamp(),
    }.ToJsonString(Compact);

    // ------------------------------------------------------------ status

    /// <summary>
    /// No network and no waiting: the last result, or "connected" when the token file or the Credential Manager holds a login
    /// (looked up once, then remembered). The dashboard asks for the live status right after it has loaded.
    /// </summary>
    public string GetStatusJson()
    {
        lock (_lock)
        {
            if (_status is not null) return _status;
            var candidates = _auth.Candidates(includeProcesses: false);
            return _status = StatusJson(candidates.Count > 0, candidates.FirstOrDefault()?.Source, null);
        }
    }

    /// <summary>One call to GitHub per login found, until one of them is accepted.</summary>
    public async Task<string> StatusAsync(CancellationToken cancellationToken = default)
    {
        var api = ApiBase();
        var connected = false;
        string? source = null, login = null;
        foreach (var cand in _auth.Candidates())
        {
            try
            {
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                cts.CancelAfter(TimeSpan.FromSeconds(8));
                using var req = Request(api + "/user", cand.Token);
                using var res = await _http.SendAsync(req, cts.Token);
                if (!res.IsSuccessStatusCode) continue;
                var user = JsonNode.Parse(await res.Content.ReadAsStringAsync(cts.Token));
                connected = true;
                source = cand.Source;
                login = user?["login"]?.GetValue<string>();
                break;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException) { }
        }
        var json = StatusJson(connected, source, login);
        lock (_lock) _status = json;
        return json;
    }

    // ------------------------------------------------------------ token by hand

    public void SetToken(string token)
    {
        var t = (token ?? "").Trim();
        lock (_lock) _status = null;
        if (t.Length == 0)
        {
            if (File.Exists(_data.GitHubToken)) File.Delete(_data.GitHubToken);
            return;
        }
        if (!GitHubAuth.TokenShape().IsMatch(t))
            throw new ArgumentException("Das sieht nicht wie ein GitHub-Zugangsschlüssel aus (beginnt meist mit github_pat_ oder ghp_).");
        AtomicFile.WriteText(_data.GitHubToken, t);
    }

    // ------------------------------------------------------------ repository list

    HttpRequestMessage Request(string url, string? token)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.UserAgent.ParseAdd("LaptopCheck");
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        if (token is not null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return req;
    }

    async Task<List<JsonObject>> GetPagesAsync(string url, string? token, CancellationToken ct)
    {
        var all = new List<JsonObject>();
        for (var page = 1; page <= 10; page++)
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(30));
            using var req = Request(url + (url.Contains('?') ? "&" : "?") + $"per_page=100&page={page}", token);
            using var res = await _http.SendAsync(req, cts.Token);
            if (!res.IsSuccessStatusCode) throw new HttpRequestException($"{(int)res.StatusCode} {res.ReasonPhrase}");
            var chunk = JsonNode.Parse(await res.Content.ReadAsStringAsync(cts.Token)) as JsonArray ?? [];
            all.AddRange(chunk.OfType<JsonObject>());
            if (chunk.Count < 100) break;
        }
        return all;
    }

    /// <summary>
    /// Uses a GitHub login that already exists on this PC: then private repositories are included. Without one: the GitHub CLI's
    /// repo list, else the public API for each configured user. What is already stored (an imported list with private repos the
    /// public API cannot see) is kept, and nothing is lost when the sync fails.
    /// </summary>
    public async Task<string> SyncAsync(CancellationToken cancellationToken = default)
    {
        await _syncGate.WaitAsync(cancellationToken);
        try
        {
            var cfg = AppConfig.Read(_stores);
            var api = ApiBase();
            var found = new List<JsonObject>();
            var errors = new List<string>();
            var source = "public";
            var authOk = false;

            foreach (var cand in _auth.Candidates())
            {
                try
                {
                    var list = await GetPagesAsync(api + "/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed", cand.Token, cancellationToken);
                    found.AddRange(list.Select(r => RepoJson.FromRest(r, "api")));
                    source = cand.Source == "token-file" ? "token" : cand.Source;
                    authOk = true;
                    break;
                }
                catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
                {
                    errors.Add(cand.Source + ": " + ex.Message);
                }
            }

            if (authOk)
            {
                errors.Clear();
            }
            else
            {
                var gh = GitHubAuth.NoGitHubCli ? null : _processes.FindOnPath("gh.exe");
                var ghOk = gh is not null && TryRun(gh, ["auth", "status"]) is { ExitCode: 0, TimedOut: false };
                if (ghOk)
                {
                    source = "gh";
                    foreach (var user in cfg.GithubUsers)
                    {
                        try
                        {
                            var r = _processes.Run(gh!, ["repo", "list", user, "--limit", "200", "--json",
                                "name,owner,isPrivate,description,primaryLanguage,pushedAt,createdAt,url,diskUsage,isFork,isArchived,repositoryTopics"], TimeSpan.FromSeconds(60));
                            if (r.TimedOut || r.ExitCode != 0) throw new InvalidOperationException("gh repo list liefert keine Daten");
                            found.AddRange((JsonNode.Parse(r.Output) as JsonArray ?? []).OfType<JsonObject>().Select(RepoJson.FromGh));
                        }
                        catch (Exception ex) when (ex is InvalidOperationException or JsonException or System.ComponentModel.Win32Exception)
                        {
                            errors.Add("gh " + user + ": " + ex.Message);
                        }
                    }
                }
                else
                {
                    foreach (var user in cfg.GithubUsers)
                    {
                        try
                        {
                            var list = await GetPagesAsync(api + "/users/" + Uri.EscapeDataString(user) + "/repos?type=owner&sort=pushed", null, cancellationToken);
                            found.AddRange(list.Select(r => RepoJson.FromRest(r, "api")));
                        }
                        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
                        {
                            errors.Add(user + ": " + ex.Message);
                        }
                    }
                    if (cfg.GithubUsers.Count == 0 && errors.Count == 0) errors.Add("Nicht mit GitHub verbunden.");
                }
            }

            // merge with what is already known
            var merged = new Dictionary<string, JsonNode>(StringComparer.OrdinalIgnoreCase);
            var old = AtomicFile.ReadText(_stores.PathOf("repos"));
            if (!string.IsNullOrEmpty(old))
            {
                try
                {
                    foreach (var e in (JsonNode.Parse(old)?["repos"] as JsonArray ?? []).OfType<JsonObject>())
                    {
                        var name = RepoJson.FullName(e);
                        if (name.Length > 0) merged[name] = e.DeepClone();
                    }
                }
                catch (JsonException) { }
            }
            foreach (var n in found)
            {
                var name = RepoJson.FullName(n);
                if (name.Length > 0) merged[name] = n;
            }

            var doc = new JsonObject
            {
                ["syncedAt"] = Stamp(),
                ["source"] = source,
                ["users"] = new JsonArray(cfg.GithubUsers.Select(u => (JsonNode?)JsonValue.Create(u)).ToArray()),
                ["fetched"] = found.Count,
                ["errors"] = new JsonArray(errors.Select(e => (JsonNode?)JsonValue.Create(e)).ToArray()),
                ["repos"] = new JsonArray(merged.Values.Select(v => (JsonNode?)v.DeepClone()).ToArray()),
            };
            var json = doc.ToJsonString(Compact);
            if (found.Count > 0 || string.IsNullOrEmpty(old)) AtomicFile.WriteText(_stores.PathOf("repos"), json, keepBackup: true);
            return json;
        }
        finally
        {
            _syncGate.Release();
        }
    }

    ProcessResult? TryRun(string file, IReadOnlyList<string> args)
    {
        try { return _processes.Run(file, args, TimeSpan.FromSeconds(15)); }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException) { return null; }
    }

    // ------------------------------------------------------------ one-click sign-in

    /// <summary>
    /// Starts the sign-in the usual way (browser) in the background: GitHub CLI when installed (its own window shows the code),
    /// otherwise Git and its Git Credential Manager (installed through winget when missing). The dashboard notices the login by itself.
    /// </summary>
    public string StartConnect()
    {
        lock (_lock) _status = null;
        var gh = GitHubAuth.NoGitHubCli ? null : _processes.FindOnPath("gh.exe");
        var git = FindGit();
        if (Environment.GetEnvironmentVariable("LC_OPEN_DRYRUN") == "1")
        {
            var args = gh is not null ? "auth login --hostname github.com --git-protocol https --web" : git is not null ? "credential fill" : "install --id Git.Git -e";
            return new JsonObject { ["dryRun"] = true, ["file"] = gh ?? git ?? "winget", ["args"] = args }.ToJsonString(Compact);
        }
        _ = Task.Run(() => ConnectFlow(gh));
        return "{\"dryRun\":false}";
    }

    string? FindGit()
    {
        var git = _processes.FindOnPath("git.exe");
        if (git is not null) return git;
        return _standardGit is not null && File.Exists(_standardGit) ? _standardGit : null;
    }

    static bool RunInOwnWindow(string file, string arguments)
    {
        using var p = Process.Start(new ProcessStartInfo(file, arguments) { UseShellExecute = true });
        if (p is null) return false;
        return p.WaitForExit(TimeSpan.FromMinutes(10)) && p.ExitCode == 0;
    }

    void ConnectFlow(string? gh)
    {
        try
        {
            var ok = false;
            if (gh is not null)
            {
                if (TryRun(gh, ["auth", "status"]) is { ExitCode: 0 }) ok = true;
                else ok = RunInOwnWindow(gh, "auth login --hostname github.com --git-protocol https --web");
            }
            if (!ok && !GitHubAuth.NoSystemCredentials)
            {
                var git = FindGit();
                if (git is null)
                {
                    RunInOwnWindow("winget", "install --id Git.Git -e --accept-source-agreements --accept-package-agreements");
                    git = FindGit();
                }
                if (git is not null)
                {
                    var answer = _processes.RunWithInput(git, ["credential", "fill"], "protocol=https\nhost=github.com\n\n", TimeSpan.FromMinutes(10),
                        new Dictionary<string, string> { ["GCM_INTERACTIVE"] = "always" });
                    if (!answer.TimedOut && answer.ExitCode == 0 && answer.Output.Contains("password=", StringComparison.Ordinal))
                    {
                        _processes.RunWithInput(git, ["credential", "approve"], answer.Output.TrimEnd() + "\n\n", TimeSpan.FromSeconds(30));   // let Windows keep the login
                        ok = true;
                    }
                }
            }
            _log?.Invoke(ok ? "GitHub: connected" : "GitHub: sign-in not completed");
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            _log?.Invoke("GitHub: sign-in failed: " + ex.Message);
        }
        finally
        {
            lock (_lock) _status = null;
        }
    }
}
