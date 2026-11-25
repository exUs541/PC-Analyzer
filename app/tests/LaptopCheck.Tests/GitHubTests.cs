using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LaptopCheck.Core;
using LaptopCheck.GitHub;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LaptopCheck.Tests;

internal sealed class FakeCredentials : ICredentialStore
{
    public Dictionary<string, List<StoredCredential>> ByFilter { get; } = [];

    public FakeCredentials Add(string filter, string secret, string target = "t")
    {
        if (!ByFilter.TryGetValue(filter, out var l)) ByFilter[filter] = l = [];
        l.Add(new StoredCredential(target, "user", secret));
        return this;
    }

    public IReadOnlyList<StoredCredential> Find(string filter) => ByFilter.TryGetValue(filter, out var l) ? l : [];
}

internal sealed class ScriptedProcesses : IProcessRunner
{
    public Dictionary<string, string> OnPath { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Func<string, IReadOnlyList<string>, string?, ProcessResult> Handler { get; set; } = (_, _, _) => new ProcessResult(1, "", false);
    public List<string> Calls { get; } = [];

    public ProcessResult Run(string file, IReadOnlyList<string> args, TimeSpan timeout, Encoding? encoding = null)
    {
        Calls.Add(Path.GetFileName(file) + " " + string.Join(' ', args));
        return Handler(file, args, null);
    }

    public ProcessResult RunWithInput(string file, IReadOnlyList<string> args, string input, TimeSpan timeout, IReadOnlyDictionary<string, string>? environment = null)
    {
        Calls.Add(Path.GetFileName(file) + " " + string.Join(' ', args) + " <input>");
        return Handler(file, args, input);
    }

    public string? FindOnPath(string exeName) => OnPath.TryGetValue(exeName, out var p) ? p : null;
}

/// <summary>A pretend GitHub: 130 public repos for demo-bulk, one for demo-user, two private ones behind the token "secret-token".</summary>
internal sealed class MockGitHub : IAsyncDisposable
{
    public record Hit(string Path, string? Page, string? Auth);

    readonly WebApplication _app;
    public List<Hit> Hits { get; } = [];
    public string Url { get; }

    MockGitHub(WebApplication app, string url)
    {
        _app = app;
        Url = url;
    }

    static object Repo(string owner, string name, bool priv) => new
    {
        full_name = owner + "/" + name, name, owner = new { login = owner }, @private = priv, description = name + " desc", language = "JavaScript",
        topics = new[] { "x" }, html_url = "https://github.com/" + owner + "/" + name, pushed_at = "2026-06-20T14:43:43Z", created_at = "2025-01-01T00:00:00Z",
        size = 12, fork = false, archived = false, stargazers_count = 1,
    };

    public static async Task<MockGitHub> StartAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        var app = builder.Build();
        MockGitHub self = null!;
        app.Run(async ctx =>
        {
            var path = ctx.Request.Path.Value ?? "";
            var page = int.TryParse(ctx.Request.Query["page"], out var p) ? p : 1;
            var auth = ctx.Request.Headers.Authorization.ToString();
            lock (self.Hits) self.Hits.Add(new Hit(path, ctx.Request.Query["page"], auth.Length == 0 ? null : auth));

            async Task Send(int code, object body)
            {
                ctx.Response.StatusCode = code;
                ctx.Response.ContentType = "application/json";
                await ctx.Response.WriteAsync(JsonSerializer.Serialize(body));
            }

            if (path == "/users/demo-bulk/repos")
            {
                var all = Enumerable.Range(0, 130).Select(i => Repo("demo-bulk", "bulk" + i, false)).ToList();
                await Send(200, all.Skip((page - 1) * 100).Take(100).ToList());
            }
            else if (path == "/users/demo-user/repos")
                await Send(200, page == 1 ? new[] { Repo("demo-user", "pub-one", false) } : []);
            else if (path == "/user/repos")
            {
                if (auth != "Bearer secret-token") await Send(401, new { message = "Bad credentials" });
                else await Send(200, page == 1 ? new[] { Repo("demo-user", "ComputerManager", true), Repo("demo-user", "private-two", true) } : []);
            }
            else if (path == "/user")
            {
                if (auth != "Bearer secret-token") await Send(401, new { message = "Bad credentials" });
                else await Send(200, new { login = "demo-user" });
            }
            else await Send(404, new { message = "Not Found" });
        });
        await app.StartAsync();
        var url = app.Urls.First();
        self = new MockGitHub(app, url);
        return self;
    }

    public async ValueTask DisposeAsync()
    {
        await _app.StopAsync();
        await _app.DisposeAsync();
    }
}

public sealed class GitHubRig : IAsyncLifetime
{
    internal MockGitHub Mock = null!;
    internal DataPaths Data = null!;
    internal FakeCredentials Credentials = new();
    internal ScriptedProcesses Processes = new();
    internal GitHubService Service = null!;
    readonly string _dir = Path.Combine(Path.GetTempPath(), "lc-gh-" + Guid.NewGuid().ToString("N"));
    readonly HttpClient _http = new() { Timeout = Timeout.InfiniteTimeSpan };

    public async Task InitializeAsync()
    {
        Mock = await MockGitHub.StartAsync();
        Data = new DataPaths(_dir);
        WriteConfig(new { githubUsers = new[] { "demo-bulk", "demo-user" }, githubApiBase = Mock.Url });
        Service = new GitHubService(Data, new GitHubAuth(Data, Credentials, Processes), Processes, _http, () => new DateTime(2026, 10, 22, 12, 0, 0), standardGit: null);
    }

    internal void WriteConfig(object config) => AtomicFile.WriteText(Data.Of("config.json"), JsonSerializer.Serialize(config));

    public async Task DisposeAsync()
    {
        _http.Dispose();
        await Mock.DisposeAsync();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }
}

public class GitHubSyncTests : IAsyncLifetime
{
    readonly GitHubRig _rig = new();

    public Task InitializeAsync() => _rig.InitializeAsync();
    public Task DisposeAsync() => _rig.DisposeAsync();

    static JsonObject Parse(string json) => JsonNode.Parse(json)!.AsObject();

    [Fact]
    public async Task Public_sync_pages_through_130_repos_and_two_accounts_without_credentials()
    {
        var doc = Parse(await _rig.Service.SyncAsync());
        Assert.Equal("public", (string)doc["source"]!);
        Assert.Equal(131, (int)doc["fetched"]!);
        Assert.Equal(131, doc["repos"]!.AsArray().Count);
        Assert.Empty(doc["errors"]!.AsArray());
        Assert.Contains(_rig.Mock.Hits, h => h.Path == "/users/demo-bulk/repos" && h.Page == "2");
        Assert.All(_rig.Mock.Hits, h => Assert.Null(h.Auth));
        var one = doc["repos"]!.AsArray().Single(r => (string)r!["fullName"]! == "demo-user/pub-one")!;
        Assert.Equal("JavaScript", (string)one["language"]!);
        Assert.False((bool)one["private"]!);
        Assert.Equal("api", (string)one["source"]!);
        Assert.Equal("x", (string)one["topics"]![0]!);
        Assert.Equal(12, (int)one["sizeKB"]!);
        Assert.Equal("2026-10-22T12:00:00", (string)doc["syncedAt"]!);
        Assert.Equal(["demo-bulk", "demo-user"], doc["users"]!.AsArray().Select(u => (string)u!).ToArray());
    }

    [Fact]
    public async Task Sync_stores_the_document_and_keeps_a_backup_of_the_previous_one()
    {
        await _rig.Service.SyncAsync();
        var stores = new JsonStores(_rig.Data);
        Assert.Equal(131, JsonNode.Parse(stores.Read("repos"))!["repos"]!.AsArray().Count);
        await _rig.Service.SyncAsync();
        Assert.True(File.Exists(_rig.Data.Of("repos.json.bak")));
    }

    [Fact]
    public async Task Previously_imported_private_repos_survive_a_public_sync()
    {
        var stores = new JsonStores(_rig.Data);
        stores.Write("repos", """{"source":"seed","repos":[{"fullName":"demo-user/seed-private","name":"seed-private","owner":"demo-user","private":true,"source":"seed"}]}""");
        var doc = Parse(await _rig.Service.SyncAsync());
        Assert.Contains(doc["repos"]!.AsArray(), r => (string)r!["fullName"]! == "demo-user/seed-private" && (bool)r["private"]!);
    }

    [Fact]
    public async Task Token_file_gives_private_repos_through_the_user_endpoint()
    {
        File.WriteAllText(_rig.Data.GitHubToken, "secret-token\n");
        var doc = Parse(await _rig.Service.SyncAsync());
        Assert.Equal("token", (string)doc["source"]!);
        Assert.Contains(doc["repos"]!.AsArray(), r => (string)r!["fullName"]! == "demo-user/ComputerManager" && (bool)r["private"]!);
        Assert.Contains(_rig.Mock.Hits, h => h.Path == "/user/repos" && h.Auth == "Bearer secret-token");
        Assert.DoesNotContain(_rig.Mock.Hits, h => h.Path.StartsWith("/users/"));   // no public calls when the login works
    }

    [Fact]
    public async Task A_bad_token_is_reported_and_nothing_is_lost()
    {
        await _rig.Service.SyncAsync();                                             // 131 public repos stored
        File.WriteAllText(_rig.Data.GitHubToken, "wrong");
        var doc = Parse(await _rig.Service.SyncAsync());
        var errors = doc["errors"]!.AsArray();
        Assert.Single(errors);
        Assert.Matches("401|Unauthorized", (string)errors[0]!);
        Assert.Contains("token-file", (string)errors[0]!);
        Assert.True(doc["repos"]!.AsArray().Count > 100);
    }

    [Fact]
    public async Task Without_any_login_and_no_users_the_error_says_so()
    {
        _rig.WriteConfig(new { githubApiBase = _rig.Mock.Url });
        var doc = Parse(await _rig.Service.SyncAsync());
        Assert.Equal(["Nicht mit GitHub verbunden."], doc["errors"]!.AsArray().Select(e => (string)e!).ToArray());
        Assert.Equal(0, (int)doc["fetched"]!);
    }

    [Fact]
    public async Task Failed_public_account_is_an_error_entry_not_an_exception()
    {
        _rig.WriteConfig(new { githubUsers = new[] { "nobody-here", "demo-user" }, githubApiBase = _rig.Mock.Url });
        var doc = Parse(await _rig.Service.SyncAsync());
        Assert.Single(doc["errors"]!.AsArray());
        Assert.StartsWith("nobody-here: 404", (string)doc["errors"]![0]!);
        Assert.Equal(1, (int)doc["fetched"]!);
    }

    [Fact]
    public async Task GitHub_CLI_is_used_when_no_token_is_available()
    {
        _rig.Processes.OnPath["gh.exe"] = @"C:\gh\gh.exe";
        _rig.Processes.Handler = (file, args, _) =>
        {
            if (args[0] == "auth" && args[1] == "token") return new ProcessResult(1, "", false);   // keyring-only login: no token to read
            if (args[0] == "auth" && args[1] == "status") return new ProcessResult(0, "", false);
            if (args[0] == "repo" && args[1] == "list")
                return new ProcessResult(0, """[{"name":"LocalNet","owner":{"login":"demo-user"},"isPrivate":true,"description":"Local network tool","primaryLanguage":{"name":"Python"},"pushedAt":"2026-06-30T17:47:11Z","createdAt":"2026-01-01T00:00:00Z","url":"https://github.com/demo-user/LocalNet","diskUsage":42,"isFork":false,"isArchived":false,"repositoryTopics":[{"name":"ai"}]}]""", false);
            return new ProcessResult(1, "", false);
        };
        _rig.WriteConfig(new { githubUsers = new[] { "demo-user" }, githubApiBase = _rig.Mock.Url });
        var doc = Parse(await _rig.Service.SyncAsync());
        Assert.Equal("gh", (string)doc["source"]!);
        var repo = Assert.Single(doc["repos"]!.AsArray())!;
        Assert.Equal("demo-user/LocalNet", (string)repo["fullName"]!);
        Assert.True((bool)repo["private"]!);
        Assert.Equal("Python", (string)repo["language"]!);
        Assert.Equal("ai", (string)repo["topics"]![0]!);
        Assert.Equal(42, (int)repo["sizeKB"]!);
        Assert.Equal("gh", (string)repo["source"]!);
        Assert.Empty(_rig.Mock.Hits);                                               // GitHub's API was not called
    }

    [Fact]
    public async Task Concurrent_syncs_do_not_corrupt_the_stored_document()
    {
        await Task.WhenAll(_rig.Service.SyncAsync(), _rig.Service.SyncAsync(), _rig.Service.SyncAsync());
        var stored = JsonNode.Parse(File.ReadAllText(_rig.Data.Of("repos.json")))!;
        Assert.Equal(131, stored["repos"]!.AsArray().Count);
    }

    [Fact]
    public async Task Live_status_names_the_signed_in_account()
    {
        _rig.Credentials.Add("git:https://github.com*", "bad-first-token-123456789");
        _rig.Credentials.Add("GitHub - https://api.github.com*", "secret-token");
        var st = Parse(await _rig.Service.StatusAsync());
        Assert.True((bool)st["connected"]!);
        Assert.Equal("github-desktop", (string)st["source"]!);                      // the first login was refused, the second accepted
        Assert.Equal("demo-user", (string)st["login"]!);
        Assert.Equal(["Bearer bad-first-token-123456789", "Bearer secret-token"], _rig.Mock.Hits.Select(h => h.Auth ?? "").ToArray());
    }

    [Fact]
    public async Task Live_status_without_a_working_login_is_not_connected()
    {
        _rig.Credentials.Add("git:https://github.com*", "bad-first-token-123456789");
        var st = Parse(await _rig.Service.StatusAsync());
        Assert.False((bool)st["connected"]!);
        Assert.Null(st["login"]);
        Assert.Null(st["source"]);
    }

    [Fact]
    public void Cached_status_needs_no_network_and_no_other_program()
    {
        _rig.Credentials.Add("git:https://github.com*", "any-token-1234567890abcd");
        _rig.Processes.OnPath["gh.exe"] = @"C:\gh\gh.exe";
        _rig.Processes.OnPath["git.exe"] = @"C:\git\git.exe";
        var st = Parse(_rig.Service.GetStatusJson());
        Assert.True((bool)st["connected"]!);
        Assert.Equal("git-credential-manager", (string)st["source"]!);
        Assert.Empty(_rig.Mock.Hits);
        Assert.Empty(_rig.Processes.Calls);                                         // gh and git are only asked for the live status
    }

    [Fact]
    public void Cached_status_without_any_login_is_not_connected()
    {
        Assert.False((bool)Parse(_rig.Service.GetStatusJson())["connected"]!);
    }

    [Fact]
    public void Setting_the_token_resets_the_remembered_status()
    {
        Assert.False((bool)Parse(_rig.Service.GetStatusJson())["connected"]!);
        _rig.Service.SetToken("ghp_" + new string('a', 30));
        Assert.True((bool)Parse(_rig.Service.GetStatusJson())["connected"]!);
        Assert.Equal("token-file", (string)Parse(_rig.Service.GetStatusJson())["source"]!);
    }

    [Fact]
    public void Token_by_hand_is_checked_stored_and_removable()
    {
        var good = "github_pat_" + new string('x', 40);
        _rig.Service.SetToken("  " + good + "\n");
        Assert.Equal(good, File.ReadAllText(_rig.Data.GitHubToken));
        _rig.Service.SetToken("");
        Assert.False(File.Exists(_rig.Data.GitHubToken));
        _rig.Service.SetToken("");                                                  // removing nothing is fine
    }

    [Theory]
    [InlineData("short")]
    [InlineData("has spaces in it but is long enough 123")]
    [InlineData("ghp_with-dash-isnotvalid-1234567890")]
    public void Token_by_hand_that_does_not_look_like_a_token_is_refused(string token)
    {
        var ex = Assert.Throws<ArgumentException>(() => _rig.Service.SetToken(token));
        Assert.Contains("GitHub-Zugangsschlüssel", ex.Message);
        Assert.False(File.Exists(_rig.Data.GitHubToken));
    }

    [Fact]
    public void Connect_in_a_test_run_only_reports_what_it_would_start()
    {
        Environment.SetEnvironmentVariable("LC_OPEN_DRYRUN", "1");
        try
        {
            _rig.Processes.OnPath["gh.exe"] = @"C:\gh\gh.exe";
            var withGh = Parse(_rig.Service.StartConnect());
            Assert.True((bool)withGh["dryRun"]!);
            Assert.Equal(@"C:\gh\gh.exe", (string)withGh["file"]!);
            Assert.Contains("auth login", (string)withGh["args"]!);

            _rig.Processes.OnPath.Clear();
            var none = Parse(_rig.Service.StartConnect());
            Assert.Equal("winget", (string)none["file"]!);
            Assert.Empty(_rig.Processes.Calls);                                     // nothing was started
        }
        finally
        {
            Environment.SetEnvironmentVariable("LC_OPEN_DRYRUN", null);
        }
    }
}

public class GitHubAuthTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "lc-ghauth-" + Guid.NewGuid().ToString("N"));
    readonly FakeCredentials _credentials = new();
    readonly ScriptedProcesses _processes = new();

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    GitHubAuth Auth() => new(new DataPaths(_dir), _credentials, _processes);

    [Fact]
    public void Logins_are_found_in_a_fixed_order_and_listed_once()
    {
        var data = new DataPaths(_dir);
        File.WriteAllText(data.GitHubToken, "file-token-1234567890abcd\n");
        _credentials.Add("git:https://github.com*", "gcm-token-1234567890abcdef");
        _credentials.Add("git:https://github.com*", "file-token-1234567890abcd");        // same token again: ignored
        _credentials.Add("GitHub - https://api.github.com*", "desktop-token-1234567890ab");
        _processes.OnPath["gh.exe"] = @"C:\gh\gh.exe";
        _processes.OnPath["git.exe"] = @"C:\git\git.exe";
        _processes.Handler = (file, args, input) => file.EndsWith("gh.exe")
            ? new ProcessResult(0, "gho_ghcli1234567890abcdef\r\n", false)
            : new ProcessResult(0, "protocol=https\nhost=github.com\nusername=x\npassword=ghp_gitfill1234567890abcd\n", false);

        var found = Auth().Candidates();
        Assert.Equal(["token-file", "git-credential-manager", "github-desktop", "gh", "git"], found.Select(c => c.Source).ToArray());
        Assert.Equal("gho_ghcli1234567890abcdef", found[3].Token);
        Assert.Equal("ghp_gitfill1234567890abcd", found[4].Token);
    }

    [Fact]
    public void Git_credential_fill_is_asked_without_any_prompt()
    {
        _processes.OnPath["git.exe"] = @"C:\git\git.exe";
        string? seen = null;
        _processes.Handler = (_, args, input) =>
        {
            seen = input;
            return new ProcessResult(0, "password=ghp_gitfill1234567890abcd\n", false);
        };
        Auth().Candidates();
        Assert.Equal("protocol=https\nhost=github.com\n\n", seen);
        Assert.Contains("git.exe credential fill <input>", _processes.Calls);
    }

    [Theory]
    [InlineData("password=short\n")]
    [InlineData("password=has a space inside and is long enough\n")]
    [InlineData("username=only\n")]
    public void Credentials_that_do_not_look_like_tokens_are_ignored(string output)
    {
        _processes.OnPath["git.exe"] = @"C:\git\git.exe";
        _processes.Handler = (_, _, _) => new ProcessResult(0, output, false);
        Assert.Empty(Auth().Candidates());
    }

    [Fact]
    public void Failing_or_slow_helpers_give_no_login_instead_of_an_error()
    {
        _processes.OnPath["gh.exe"] = @"C:\gh\gh.exe";
        _processes.OnPath["git.exe"] = @"C:\git\git.exe";
        _processes.Handler = (_, _, _) => new ProcessResult(-1, "", true);
        Assert.Empty(Auth().Candidates());
        _processes.Handler = (_, _, _) => throw new System.ComponentModel.Win32Exception("not found");
        Assert.Empty(Auth().Candidates());
    }

    [Fact]
    public void Cheap_lookup_skips_the_programs()
    {
        _processes.OnPath["gh.exe"] = @"C:\gh\gh.exe";
        _credentials.Add("git:https://github.com*", "gcm-token-1234567890abcdef");
        var found = Auth().Candidates(includeProcesses: false);
        Assert.Single(found);
        Assert.Empty(_processes.Calls);
    }

    [Fact]
    public void The_switches_turn_the_system_logins_and_the_cli_off()
    {
        _credentials.Add("git:https://github.com*", "gcm-token-1234567890abcdef");
        _processes.OnPath["gh.exe"] = @"C:\gh\gh.exe";
        _processes.OnPath["git.exe"] = @"C:\git\git.exe";
        _processes.Handler = (_, _, _) => new ProcessResult(0, "gho_ghcli1234567890abcdef\npassword=ghp_gitfill1234567890abcd\n", false);
        try
        {
            Environment.SetEnvironmentVariable("LC_NO_SYSCRED", "1");
            Assert.Equal(["gh"], Auth().Candidates().Select(c => c.Source).ToArray());   // only the CLI is left
            Environment.SetEnvironmentVariable("LC_NO_GH", "1");
            Assert.Empty(Auth().Candidates());
        }
        finally
        {
            Environment.SetEnvironmentVariable("LC_NO_SYSCRED", null);
            Environment.SetEnvironmentVariable("LC_NO_GH", null);
        }
    }

    [Fact]
    public void The_real_credential_store_answers_an_unknown_filter_with_nothing()
    {
        Assert.Empty(new Win32CredentialStore().Find("lc-test-no-such-credential-*"));
    }
}
