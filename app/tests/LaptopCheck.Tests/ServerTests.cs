using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LaptopCheck.Core;
using LaptopCheck.Server;

namespace LaptopCheck.Tests;

public class ServerTests : IAsyncLifetime
{
    TestEnv _env = null!;

    public async Task InitializeAsync() => _env = await TestEnv.StartAsync();
    public async Task DisposeAsync() => await _env.DisposeAsync();

    static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;

    [Fact]
    public async Task Foreign_host_header_is_rejected()
    {
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Get, "/", host: "evil.example"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Api_without_token_is_forbidden()
    {
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Get, "/api/state", withToken: false));
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task The_update_state_is_served_cheaply_and_needs_the_token()
    {
        async Task<string> Get(bool token) => await (await _env.Http.SendAsync(_env.Request(HttpMethod.Get, "/api/update/state", withToken: token))).Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.Forbidden, (await _env.Http.SendAsync(_env.Request(HttpMethod.Get, "/api/update/state", withToken: false))).StatusCode);
        File.Delete(_env.Data.UpdateState);
        Assert.Equal("null", await Get(true));                                   // nothing checked yet
        File.WriteAllText(_env.Data.UpdateState, "{\"result\":\"ready\",\"available\":\"3.0.99\",\"version\":\"3.0.17\"}");
        var st = JsonNode.Parse(await Get(true))!;
        Assert.Equal("ready", (string)st["result"]!);
        Assert.Equal("3.0.99", (string)st["available"]!);
        File.WriteAllText(_env.Data.UpdateState, "{ not json");
        Assert.Equal("null", await Get(true));                                   // a half-written file never breaks the page
    }

    [Fact]
    public async Task Api_with_wrong_token_is_forbidden()
    {
        var req = _env.Request(HttpMethod.Get, "/api/ping", withToken: false);
        req.Headers.Add("X-LC-Token", "nope");
        Assert.Equal(HttpStatusCode.Forbidden, (await _env.Http.SendAsync(req)).StatusCode);
    }

    [Fact]
    public async Task Index_gets_the_token_and_security_headers()
    {
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Get, "/", withToken: false));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains(_env.Server.Token, await res.Content.ReadAsStringAsync());
        Assert.DoesNotContain("__LC_TOKEN__", await res.Content.ReadAsStringAsync());
        Assert.Contains("default-src 'self'", res.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Equal("no-store", res.Headers.CacheControl?.ToString());
    }

    [Theory]
    [InlineData("/notes.txt")]
    [InlineData("/missing.js")]
    [InlineData("/..%2fsecret.txt")]
    [InlineData("/..%5csecret.txt")]
    [InlineData("/%2e%2e/secret.txt")]
    public async Task Unknown_types_and_paths_outside_web_are_not_served(string path)
    {
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Get, path, withToken: false));
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task Static_file_is_served_with_its_type()
    {
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Get, "/app.js", withToken: false));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.StartsWith("text/javascript", res.Content.Headers.ContentType?.ToString());
    }

    [Fact]
    public async Task Static_files_only_answer_get()
    {
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Post, "/app.js", withToken: false));
        Assert.Equal(HttpStatusCode.MethodNotAllowed, res.StatusCode);
    }

    [Fact]
    public async Task State_has_all_parts_even_without_any_data()
    {
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Get, "/api/state"));
        var root = Parse(await res.Content.ReadAsStringAsync());
        foreach (var key in new[] { "snapshot", "prev", "notes", "history", "config", "projects", "repos", "cleanup", "files", "update", "meta" })
            Assert.True(root.TryGetProperty(key, out _), key);
        Assert.Equal(JsonValueKind.Null, root.GetProperty("snapshot").ValueKind);
        Assert.Equal(JsonValueKind.Array, root.GetProperty("history").ValueKind);
        var meta = root.GetProperty("meta");
        Assert.Equal(_env.Server.Port, meta.GetProperty("port").GetInt32());
        Assert.Equal(_env.Data.Dir, meta.GetProperty("dataDir").GetString());
        Assert.False(meta.GetProperty("github").GetProperty("connected").GetBoolean());
    }

    [Fact]
    public async Task State_passes_stored_files_through_and_survives_a_damaged_one()
    {
        File.WriteAllText(_env.Data.Snapshot, "{\"collectedAt\":\"2026-01-01T00:00:00\"}");
        File.WriteAllText(_env.Data.Of("notes.json"), "{ this is not json");
        File.WriteAllText(_env.Data.Files, "{\"x\":1}");
        var root = Parse(await (await _env.Http.SendAsync(_env.Request(HttpMethod.Get, "/api/state"))).Content.ReadAsStringAsync());
        Assert.Equal("2026-01-01T00:00:00", root.GetProperty("snapshot").GetProperty("collectedAt").GetString());
        Assert.Equal(JsonValueKind.Null, root.GetProperty("notes").ValueKind);
        Assert.True(root.GetProperty("files").GetProperty("exists").GetBoolean());
    }

    [Fact]
    public async Task Store_roundtrip_keeps_one_backup()
    {
        var put1 = await _env.Http.SendAsync(_env.Request(HttpMethod.Put, "/api/store/notes", body: "{\"a\":1}"));
        Assert.Equal(HttpStatusCode.OK, put1.StatusCode);
        var put2 = await _env.Http.SendAsync(_env.Request(HttpMethod.Put, "/api/store/notes", body: "{\"a\":2}"));
        Assert.Equal(HttpStatusCode.OK, put2.StatusCode);

        var get = await _env.Http.SendAsync(_env.Request(HttpMethod.Get, "/api/store/notes"));
        Assert.Equal("{\"a\":2}", await get.Content.ReadAsStringAsync());
        Assert.Equal("{\"a\":1}", File.ReadAllText(_env.Data.Of("notes.json.bak")));
    }

    [Fact]
    public async Task Empty_store_reads_as_null()
    {
        var get = await _env.Http.SendAsync(_env.Request(HttpMethod.Get, "/api/store/projects"));
        Assert.Equal("null", await get.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Store_rejects_invalid_json_and_unknown_names()
    {
        var bad = await _env.Http.SendAsync(_env.Request(HttpMethod.Put, "/api/store/notes", body: "{nope"));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Contains("invalid json", await bad.Content.ReadAsStringAsync());
        Assert.False(File.Exists(_env.Data.Of("notes.json")));

        var unknown = await _env.Http.SendAsync(_env.Request(HttpMethod.Put, "/api/store/passwords", body: "{}"));
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
    }

    [Fact]
    public async Task Store_rejects_bodies_over_8_MB()
    {
        var big = "[\"" + new string('x', JsonStores.MaxBytes) + "\"]";
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Put, "/api/store/notes", body: big));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, res.StatusCode);
    }

    [Fact]
    public async Task Open_reports_a_known_target_without_starting_it()
    {
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Post, "/api/open?target=firewall"));
        var json = Parse(await res.Content.ReadAsStringAsync());
        Assert.True(json.GetProperty("dryRun").GetBoolean());
        Assert.Equal("control.exe", json.GetProperty("file").GetString());
        Assert.Equal("firewall.cpl", json.GetProperty("args").GetString());
    }

    [Fact]
    public async Task Open_rejects_unknown_targets()
    {
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Post, "/api/open?target=cmd.exe"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public void Open_targets_match_the_ids_the_dashboard_offers()
    {
        var js = File.ReadAllText(Path.Combine(RepoRoot(), "web", "knowledge.js"));
        var block = Regex.Match(js, @"LC\.OPEN_TARGETS = \{(?<body>.*?)\n  \};", RegexOptions.Singleline).Groups["body"].Value;
        var uiIds = Regex.Matches(block, @"^\s{4}(?:'(?<q>[^']+)'|(?<b>[A-Za-z_]\w*)):", RegexOptions.Multiline)
            .Select(m => m.Groups["q"].Success ? m.Groups["q"].Value : m.Groups["b"].Value)
            .Order().ToArray();
        Assert.NotEmpty(uiIds);
        Assert.Equal(uiIds, OpenTargets.Ids.Order().ToArray());
    }

    [Fact]
    public async Task Scan_endpoint_runs_the_scanner_and_answers_with_the_state()
    {
        CountingScanner scanner = null!;
        await using var env = await TestEnv.StartAsync(d => scanner = new CountingScanner(d));
        var res = await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/scan?quick=1"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(1, scanner.Runs);
        Assert.True(scanner.LastQuick);
        var state = Parse(await res.Content.ReadAsStringAsync());
        Assert.Equal("2026-01-01T00:00:00", state.GetProperty("snapshot").GetProperty("collectedAt").GetString());   // the answer already contains the new snapshot
    }

    [Fact]
    public async Task Scan_endpoint_without_quick_runs_the_full_scan()
    {
        CountingScanner scanner = null!;
        await using var env = await TestEnv.StartAsync(d => scanner = new CountingScanner(d));
        await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/scan"));
        Assert.False(scanner.LastQuick);
    }

    [Fact]
    public async Task Files_scan_and_providers_endpoints_use_the_files_runner()
    {
        FakeFiles files = null!;
        await using var env = await TestEnv.StartAsync(filesFactory: d => files = new FakeFiles(d));
        var res = await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/scan-files"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(1, files.Runs);
        Assert.Equal("2026-02-02T00:00:00", Parse(await res.Content.ReadAsStringAsync()).GetProperty("scannedAt").GetString());

        var providers = await env.Http.SendAsync(env.Request(HttpMethod.Get, "/api/providers"));
        Assert.Equal("[{\"id\":\"custom\"}]", await providers.Content.ReadAsStringAsync());

        var stored = await env.Http.SendAsync(env.Request(HttpMethod.Get, "/api/files"));
        Assert.Contains("2026-02-02", await stored.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("/api/scan-files", "POST")]
    [InlineData("/api/providers", "GET")]
    public async Task Files_endpoints_without_a_runner_answer_501(string path, string method)
    {
        var res = await _env.Http.SendAsync(_env.Request(new HttpMethod(method), path));
        Assert.Equal(HttpStatusCode.NotImplemented, res.StatusCode);
    }

    [Fact]
    public async Task Space_scan_endpoint_runs_the_runner_and_the_stored_result_can_be_read_again()
    {
        FakeSpace space = null!;
        await using var env = await TestEnv.StartAsync(spaceFactory: d => space = new FakeSpace(d));

        var before = await env.Http.SendAsync(env.Request(HttpMethod.Get, "/api/space"));
        Assert.Equal("null", await before.Content.ReadAsStringAsync());   // nothing analysed yet

        var res = await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/scan-space"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(1, space.Runs);
        Assert.Equal("2026-03-03T00:00:00", Parse(await res.Content.ReadAsStringAsync()).GetProperty("scannedAt").GetString());

        var stored = await env.Http.SendAsync(env.Request(HttpMethod.Get, "/api/space"));
        Assert.Contains("2026-03-03", await stored.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Space_scan_without_a_runner_answers_501_and_needs_the_token()
    {
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Post, "/api/scan-space"));
        Assert.Equal(HttpStatusCode.NotImplemented, res.StatusCode);

        var noToken = await _env.Http.SendAsync(_env.Request(HttpMethod.Get, "/api/space", withToken: false));
        Assert.Equal(HttpStatusCode.Forbidden, noToken.StatusCode);
    }

    [Fact]
    public async Task GitHub_endpoints_use_the_github_service()
    {
        var gh = new FakeGitHub();
        await using var env = await TestEnv.StartAsync(gitHub: gh);

        var status = await env.Http.SendAsync(env.Request(HttpMethod.Get, "/api/github/status"));
        Assert.Equal("{\"connected\":true,\"login\":\"live\"}", await status.Content.ReadAsStringAsync());

        var sync = await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/github/sync"));
        Assert.Equal("{\"fetched\":3}", await sync.Content.ReadAsStringAsync());

        var connect = await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/github/connect"));
        Assert.Equal("{\"dryRun\":false}", await connect.Content.ReadAsStringAsync());
        Assert.Equal(1, gh.Connects);

        var token = await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/github/token", body: "{\"token\":\"ghp_abc\"}"));
        Assert.Equal(HttpStatusCode.OK, token.StatusCode);
        Assert.Equal("ghp_abc", gh.LastToken);

        var state = Parse(await (await env.Http.SendAsync(env.Request(HttpMethod.Get, "/api/state"))).Content.ReadAsStringAsync());
        Assert.Equal("cached", state.GetProperty("meta").GetProperty("github").GetProperty("login").GetString());
    }

    [Fact]
    public async Task GitHub_token_endpoint_turns_a_refused_token_into_400_and_accepts_an_empty_one()
    {
        var gh = new FakeGitHub { RefuseTokens = true };
        await using var env = await TestEnv.StartAsync(gitHub: gh);
        var bad = await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/github/token", body: "{\"token\":\"nope\"}"));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Contains("kein Token", await bad.Content.ReadAsStringAsync());

        var none = await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/github/token", body: "{}"));
        Assert.Equal(HttpStatusCode.BadRequest, none.StatusCode);                  // an empty token goes to the service, which refused everything here
        Assert.Equal("", gh.LastToken);
    }

    [Theory]
    [InlineData("/api/github/sync", "POST")]
    [InlineData("/api/github/connect", "POST")]
    public async Task GitHub_actions_without_a_service_answer_501(string path, string method)
    {
        var res = await _env.Http.SendAsync(_env.Request(new HttpMethod(method), path));
        Assert.Equal(HttpStatusCode.NotImplemented, res.StatusCode);
    }

    [Fact]
    public async Task GitHub_status_without_a_service_says_not_connected()
    {
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Get, "/api/github/status"));
        Assert.False(Parse(await res.Content.ReadAsStringAsync()).GetProperty("connected").GetBoolean());
    }

    [Fact]
    public async Task Cleanup_endpoints_hand_the_request_to_the_cleanup_actions_and_answer_with_their_json()
    {
        var actions = new FakeCleanup();
        await using var env = await TestEnv.StartAsync(cleanup: actions);

        async Task<string> Call(HttpMethod m, string path, string? body = null) =>
            await (await env.Http.SendAsync(env.Request(m, path, body: body))).Content.ReadAsStringAsync();

        Assert.Equal("{\"id\":\"move\"}", await Call(HttpMethod.Post, "/api/move/start", "{\"cloudRoot\":\"X\"}"));
        Assert.Equal("{\"cloudRoot\":\"X\"}", actions.Last["move/start"]);
        Assert.Equal("{\"id\":\"cleanup\"}", await Call(HttpMethod.Post, "/api/move/cleanup?id=20260101-000000-abcd"));
        Assert.Equal("20260101-000000-abcd", actions.Last["move/cleanup"]);
        Assert.Equal("{\"status\":\"s\"}", await Call(HttpMethod.Get, "/api/move/status?id=abc"));
        Assert.Equal("[]", await Call(HttpMethod.Get, "/api/move/list"));
        Assert.Equal("{\"id\":\"restore\"}", await Call(HttpMethod.Post, "/api/restore/start", "{}"));
        Assert.Equal("{\"status\":\"r\"}", await Call(HttpMethod.Get, "/api/restore/status?id=abc"));
        Assert.Equal("{\"id\":\"delete\"}", await Call(HttpMethod.Post, "/api/delete/start", "{\"ids\":[\"a\"]}"));
        Assert.Equal("{\"status\":\"d\"}", await Call(HttpMethod.Get, "/api/delete/status?id=abc"));
        Assert.Equal("{\"name\":\"u\"}", await Call(HttpMethod.Post, "/api/uninstall", "{\"id\":\"app:x\"}"));
        Assert.Equal("{\"ok\":\"w\"}", await Call(HttpMethod.Post, "/api/winget/upgrade", "{\"all\":true}"));
        Assert.Equal("{\"ok\":\"c\"}", await Call(HttpMethod.Post, "/api/check/app", "{\"id\":\"reg:x\"}"));
        Assert.Equal("{\"ok\":\"r\"}", await Call(HttpMethod.Post, "/api/reveal", "{\"path\":\"C:\\\\x\"}"));
    }

    [Fact]
    public async Task Cleanup_refusals_become_400_and_a_missing_module_is_501()
    {
        await using var env = await TestEnv.StartAsync(cleanup: new FakeCleanup { Refuse = true });
        var res = await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/delete/start", body: "{}"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("nicht erlaubt", await res.Content.ReadAsStringAsync());

        foreach (var (method, path) in new[] { ("POST", "/api/move/start"), ("POST", "/api/restore/start"), ("POST", "/api/delete/start"), ("POST", "/api/uninstall"), ("GET", "/api/move/list"), ("POST", "/api/reveal") })
        {
            var r = await _env.Http.SendAsync(_env.Request(new HttpMethod(method), path, body: method == "POST" ? "{}" : null));
            Assert.Equal(HttpStatusCode.NotImplemented, r.StatusCode);
        }
    }

    [Fact]
    public async Task Cleanup_endpoints_still_need_the_token()
    {
        await using var env = await TestEnv.StartAsync(cleanup: new FakeCleanup());
        var res = await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/delete/start", withToken: false, body: "{\"ids\":[\"a\"]}"));
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    sealed class FakeCleanup : ICleanupActions
    {
        public Dictionary<string, string> Last { get; } = [];
        public bool Refuse;

        string Take(string key, string value)
        {
            Last[key] = value;
            return value;
        }

        public Task<string> StartMoveAsync(string requestJson) { Take("move/start", requestJson); return Task.FromResult("{\"id\":\"move\"}"); }
        public Task<string> StartMoveCleanupAsync(string jobId) { Take("move/cleanup", jobId); return Task.FromResult("{\"id\":\"cleanup\"}"); }
        public string MoveStatus(string jobId) => "{\"status\":\"s\"}";
        public string MoveList() => "[]";
        public Task<string> StartRestoreAsync(string requestJson) { Take("restore/start", requestJson); return Task.FromResult("{\"id\":\"restore\"}"); }
        public string RestoreStatus(string jobId) => "{\"status\":\"r\"}";
        public Task<string> StartDeleteAsync(string requestJson) => Refuse ? throw new ArgumentException("nicht erlaubt") : Task.FromResult("{\"id\":\"delete\"}");
        public string DeleteStatus(string jobId) => "{\"status\":\"d\"}";
        public string Uninstall(string requestJson) => "{\"name\":\"u\"}";
        public string WingetUpgrade(string requestJson) => "{\"ok\":\"w\"}";
        public string CheckApp(string requestJson) => "{\"ok\":\"c\"}";
        public string Reveal(string requestJson) => "{\"ok\":\"r\"}";
    }

    sealed class FakeGitHub : IGitHubService
    {
        public int Connects;
        public string? LastToken;
        public bool RefuseTokens;

        public string GetStatusJson() => "{\"connected\":true,\"login\":\"cached\"}";
        public Task<string> StatusAsync(CancellationToken cancellationToken = default) => Task.FromResult("{\"connected\":true,\"login\":\"live\"}");
        public Task<string> SyncAsync(CancellationToken cancellationToken = default) => Task.FromResult("{\"fetched\":3}");

        public string StartConnect()
        {
            Connects++;
            return "{\"dryRun\":false}";
        }

        public void SetToken(string token)
        {
            LastToken = token;
            if (RefuseTokens) throw new ArgumentException("kein Token");
        }
    }

    sealed class FakeFiles(DataPaths data) : IFilesScanRunner
    {
        public int Runs;

        public Task RunAsync(CancellationToken cancellationToken = default)
        {
            Runs++;
            AtomicFile.WriteText(data.Files, "{\"scannedAt\":\"2026-02-02T00:00:00\"}");
            return Task.CompletedTask;
        }

        public string ProvidersJson() => "[{\"id\":\"custom\"}]";
    }

    sealed class FakeSpace(DataPaths data) : ISpaceScanRunner
    {
        public int Runs;

        public Task RunAsync(CancellationToken cancellationToken = default)
        {
            Runs++;
            AtomicFile.WriteText(data.Space, "{\"scannedAt\":\"2026-03-03T00:00:00\",\"entries\":[]}");
            return Task.CompletedTask;
        }
    }

    sealed class CountingScanner(DataPaths data) : IScanRunner
    {
        public int Runs;
        public bool LastQuick;

        public Task RunAsync(bool quick, CancellationToken cancellationToken = default)
        {
            Runs++;
            LastQuick = quick;
            AtomicFile.WriteText(data.Snapshot, "{\"collectedAt\":\"2026-01-01T00:00:00\"}");
            return Task.CompletedTask;
        }
    }

    [Theory]
    [InlineData("/api/scan", "POST")]
    [InlineData("/api/move/list", "GET")]
    public async Task Not_ported_endpoints_answer_501_with_a_message(string path, string method)
    {
        var res = await _env.Http.SendAsync(_env.Request(new HttpMethod(method), path));
        Assert.Equal(HttpStatusCode.NotImplemented, res.StatusCode);
        Assert.Contains("noch nicht", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Unknown_api_route_is_404()
    {
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Get, "/api/nothing"));
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task Shutdown_answers_first_then_notifies()
    {
        var res = await _env.Http.SendAsync(_env.Request(HttpMethod.Post, "/api/shutdown"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        for (var i = 0; i < 50 && _env.ShutdownCalls == 0; i++) await Task.Delay(20);
        Assert.Equal(1, _env.ShutdownCalls);
    }

    [Fact]
    public async Task Second_server_moves_to_the_next_port_when_the_first_is_taken()
    {
        var other = await LcServer.StartAsync(new LcServerOptions { Data = _env.Data, WebRoot = _env.Web, PreferredPort = _env.Server.Port, PortTries = 5 });
        try { Assert.NotEqual(_env.Server.Port, other.Port); }
        finally { await other.DisposeAsync(); }
    }

    static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "web", "index.html"))) dir = dir.Parent;
        return dir?.FullName ?? throw new DirectoryNotFoundException("repository root with web/ not found");
    }
}
