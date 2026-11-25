using System.Net;
using System.Text.Json;
using LaptopCheck.Core;
using LaptopCheck.Update;

namespace LaptopCheck.Tests;

public class UpdateTests : IDisposable
{
    readonly string _root = Path.Combine(Path.GetTempPath(), "lc-update-" + Guid.NewGuid().ToString("N"));
    readonly DataPaths _data;
    readonly FakeEngine _engine = new();
    readonly List<string> _log = [];
    int _exitRequests;
    DateTime _clock = new(2026, 10, 22, 9, 0, 0);

    public UpdateTests() => _data = new DataPaths(Path.Combine(_root, "data"));

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("LC_OPEN_DRYRUN", null);
        try { Directory.Delete(_root, true); } catch (IOException) { }
    }

    UpdateService Service() => new(_data, _engine, () => _exitRequests++, () => _clock, _log.Add);

    JsonElement State() => JsonDocument.Parse(File.ReadAllText(_data.UpdateState)).RootElement.Clone();

    static string Str(JsonElement e, string name) => e.GetProperty(name).GetString()!;

    sealed class FakeEngine : IUpdateEngine
    {
        public bool IsInstalled { get; set; } = true;
        public string CurrentVersion { get; set; } = "3.0.1";
        public UpdateOffer? Offer;
        public UpdateException? CheckFails;
        public UpdateException? DownloadFails;
        public int Checks, Downloads;
        public List<(string Version, bool Restart)> Applied { get; } = [];
        public Exception? ApplyFails;

        public Task<UpdateOffer?> CheckAsync(CancellationToken cancellationToken)
        {
            Checks++;
            if (CheckFails is not null) throw CheckFails;
            return Task.FromResult(Offer);
        }

        public Task DownloadAsync(UpdateOffer offer, Action<int>? progress, CancellationToken cancellationToken)
        {
            Downloads++;
            if (DownloadFails is not null) throw DownloadFails;
            return Task.CompletedTask;
        }

        public void ApplyOnExit(UpdateOffer offer, bool restart)
        {
            if (ApplyFails is not null) throw ApplyFails;
            Applied.Add((offer.Version, restart));
        }
    }

    static UpdateOffer Offer(string version) => new(version, null, new object());

    // ---- the state file the dashboard shows

    [Fact]
    public void First_start_writes_a_state_file_so_the_dashboard_has_something_to_show()
    {
        Service().NoteStart();
        var s = State();
        Assert.Equal("current", Str(s, "result"));
        Assert.Equal("velopack", Str(s, "method"));
        Assert.Equal("3.0.1", Str(s, "version"));
    }

    [Fact]
    public void A_start_with_a_new_version_reports_that_the_update_happened()
    {
        Service().NoteStart();
        _engine.CurrentVersion = "3.0.2";
        _clock = _clock.AddHours(1);
        Service().NoteStart();
        var s = State();
        Assert.Equal("updated", Str(s, "result"));
        Assert.Equal("3.0.2", Str(s, "version"));
        Assert.Equal("2026-10-22T10:00:00", Str(s, "updatedAt"));
        Assert.Contains(_log, l => l.Contains("3.0.1") && l.Contains("3.0.2"));
    }

    [Fact]
    public void A_start_with_the_same_version_leaves_the_state_alone()
    {
        var svc = Service();
        svc.NoteStart();
        var before = File.ReadAllText(_data.UpdateState);
        _clock = _clock.AddHours(1);
        svc.NoteStart();
        Assert.Equal(before, File.ReadAllText(_data.UpdateState));
    }

    [Fact]
    public void A_damaged_state_file_is_replaced_not_fatal()
    {
        File.WriteAllText(_data.UpdateState, "{ not json");
        Service().NoteStart();
        Assert.Equal("current", Str(State(), "result"));
    }

    // ---- checking

    [Fact]
    public async Task Without_an_installation_nothing_is_checked()
    {
        _engine.IsInstalled = false;
        Assert.Null(await Service().CheckAndDownloadAsync(force: false));
        Assert.Equal(0, _engine.Checks);
        Assert.Equal("disabled", Str(State(), "result"));
    }

    [Fact]
    public async Task Auto_update_off_skips_the_background_check_but_not_the_users_request()
    {
        File.WriteAllText(_data.Of("config.json"), "{\"autoUpdate\":false}");
        _engine.Offer = Offer("3.0.2");
        var svc = Service();

        Assert.Null(await svc.CheckAndDownloadAsync(force: false));
        Assert.Equal(0, _engine.Checks);
        Assert.Equal("disabled", Str(State(), "result"));

        Assert.Equal("3.0.2", (await svc.CheckAndDownloadAsync(force: true))?.Version);
        Assert.Equal(1, _engine.Checks);
    }

    [Fact]
    public async Task Newest_version_says_so()
    {
        Assert.Null(await Service().CheckAndDownloadAsync(force: false));
        Assert.Equal(1, _engine.Checks);
        Assert.Equal(0, _engine.Downloads);
        Assert.Equal("current", Str(State(), "result"));
    }

    [Fact]
    public async Task A_newer_version_is_loaded_and_waits_for_the_end_of_the_app()
    {
        _engine.Offer = Offer("3.0.2");
        var svc = Service();
        var offer = await svc.CheckAndDownloadAsync(force: false);

        Assert.Equal("3.0.2", offer?.Version);
        Assert.Same(offer, svc.Ready);
        Assert.Equal(1, _engine.Downloads);
        var s = State();
        Assert.Equal("ready", Str(s, "result"));
        Assert.Equal("3.0.2", Str(s, "available"));
        Assert.Empty(_engine.Applied);   // nothing is installed while the app is running

        // a second look does not load it again
        Assert.Same(offer, await svc.CheckAndDownloadAsync(force: false));
        Assert.Equal(1, _engine.Checks);
    }

    [Theory]
    [InlineData(UpdateFailure.Offline, "offline")]
    [InlineData(UpdateFailure.NoAccess, "no-access")]
    [InlineData(UpdateFailure.Other, "error")]
    public async Task A_failed_check_becomes_a_state_the_dashboard_understands(UpdateFailure kind, string result)
    {
        _engine.CheckFails = new UpdateException(kind, "boom");
        Assert.Null(await Service().CheckAndDownloadAsync(force: false));
        Assert.Equal(result, Str(State(), "result"));
        Assert.Contains(_log, l => l.Contains(result));
    }

    [Fact]
    public async Task A_failed_download_is_reported_and_nothing_is_marked_ready()
    {
        _engine.Offer = Offer("3.0.2");
        _engine.DownloadFails = new UpdateException(UpdateFailure.Offline, "cut");
        var svc = Service();
        Assert.Null(await svc.CheckAndDownloadAsync(force: false));
        Assert.Null(svc.Ready);
        Assert.Equal("offline", Str(State(), "result"));
    }

    [Fact]
    public async Task The_state_keeps_the_time_of_the_last_update()
    {
        Service().NoteStart();
        _engine.CurrentVersion = "3.0.2";
        _clock = _clock.AddHours(1);
        var svc = Service();
        svc.NoteStart();
        _clock = _clock.AddHours(5);
        await svc.CheckAndDownloadAsync(force: false);
        var s = State();
        Assert.Equal("current", Str(s, "result"));
        Assert.Equal("2026-10-22T10:00:00", Str(s, "updatedAt"));
        Assert.Equal("2026-10-22T15:00:00", Str(s, "checkedAt"));
    }

    // ---- applying

    [Fact]
    public async Task A_loaded_update_is_handed_over_when_the_app_ends()
    {
        _engine.Offer = Offer("3.0.2");
        var svc = Service();
        await svc.CheckAndDownloadAsync(force: false);
        svc.ApplyPendingOnExit();
        Assert.Equal([("3.0.2", false)], _engine.Applied);
    }

    [Fact]
    public void Nothing_loaded_means_nothing_is_handed_over()
    {
        Service().ApplyPendingOnExit();
        Assert.Empty(_engine.Applied);
    }

    [Fact]
    public async Task A_handover_that_fails_is_logged_and_does_not_crash_the_exit()
    {
        _engine.Offer = Offer("3.0.2");
        _engine.ApplyFails = new InvalidOperationException("no updater");
        var svc = Service();
        await svc.CheckAndDownloadAsync(force: false);
        svc.ApplyPendingOnExit();
        Assert.Contains(_log, l => l.Contains("no updater"));
    }

    [Fact]
    public async Task Update_now_loads_if_needed_ends_the_app_and_asks_for_a_restart()
    {
        _engine.Offer = Offer("3.0.2");
        var svc = Service();
        var json = JsonDocument.Parse(await svc.RestartToUpdateAsync()).RootElement;
        Assert.False(json.GetProperty("dryRun").GetBoolean());
        Assert.True(json.GetProperty("updating").GetBoolean());
        Assert.Equal("3.0.2", json.GetProperty("version").GetString());
        Assert.Equal(1, _exitRequests);

        svc.ApplyPendingOnExit();
        Assert.Equal([("3.0.2", true)], _engine.Applied);
    }

    [Fact]
    public async Task Update_now_without_a_newer_version_says_so_and_keeps_running()
    {
        var json = JsonDocument.Parse(await Service().RestartToUpdateAsync()).RootElement;
        Assert.True(json.GetProperty("noUpdate").GetBoolean());
        Assert.Equal(0, _exitRequests);
    }

    [Fact]
    public async Task Update_now_in_the_test_mode_only_reports()
    {
        Environment.SetEnvironmentVariable("LC_OPEN_DRYRUN", "1");
        _engine.Offer = Offer("3.0.2");
        var json = JsonDocument.Parse(await Service().RestartToUpdateAsync()).RootElement;
        Assert.True(json.GetProperty("dryRun").GetBoolean());
        Assert.Equal(0, _engine.Checks);
        Assert.Equal(0, _exitRequests);
    }

    [Fact]
    public async Task Update_now_without_an_installation_is_refused()
    {
        _engine.IsInstalled = false;
        await Assert.ThrowsAsync<NotSupportedException>(() => Service().RestartToUpdateAsync());
    }

    [Fact]
    public async Task The_background_loop_stops_at_once_when_cancelled()
    {
        using var cts = new CancellationTokenSource();
        var task = Service().RunAsync(cts.Token);
        cts.Cancel();
        await task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(0, _engine.Checks);   // cancelled during the start-up delay
    }

    // ---- through the server

    [Fact]
    public async Task The_server_shows_the_update_state_and_runs_update_now_through_the_service()
    {
        _engine.Offer = Offer("3.0.2");
        UpdateService? svc = null;
        await using var env = await TestEnv.StartAsync(updateFactory: d => svc = new UpdateService(d, _engine, () => _exitRequests++, () => _clock, _log.Add));
        Environment.SetEnvironmentVariable("LC_OPEN_DRYRUN", null);

        await svc!.CheckAndDownloadAsync(force: false);
        var state = JsonDocument.Parse(await (await env.Http.SendAsync(env.Request(HttpMethod.Get, "/api/state"))).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("ready", state.GetProperty("update").GetProperty("result").GetString());

        var res = await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/update/restart"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("\"updating\":true", await res.Content.ReadAsStringAsync());
        Assert.Equal(1, _exitRequests);
    }

    [Fact]
    public async Task Without_an_update_module_the_restart_endpoint_answers_501_with_a_reason()
    {
        await using var env = await TestEnv.StartAsync();
        var res = await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/update/restart"));
        Assert.Equal(HttpStatusCode.NotImplemented, res.StatusCode);
        Assert.Contains("installierten App", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_restart_endpoint_still_needs_the_token()
    {
        await using var env = await TestEnv.StartAsync(updateFactory: d => new UpdateService(d, _engine, () => _exitRequests++));
        var res = await env.Http.SendAsync(env.Request(HttpMethod.Post, "/api/update/restart", withToken: false));
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.Equal(0, _exitRequests);
    }

    // ---- settings

    [Theory]
    [InlineData("{}", true)]
    [InlineData("{\"autoUpdate\":true}", true)]
    [InlineData("{\"autoUpdate\":false}", false)]
    [InlineData("{\"autoUpdate\":\"no\"}", true)]
    [InlineData("not json", true)]
    public void Auto_update_is_on_unless_explicitly_switched_off(string json, bool expected) =>
        Assert.Equal(expected, AppConfig.Parse(json).AutoUpdate);

    // ---- the real engine, outside of an installation

    [Fact]
    public void The_real_engine_knows_it_is_not_installed_when_run_from_the_program_files()
    {
        var engine = new VelopackUpdateEngine(AppInfo.RepositoryUrl, () => []);
        Assert.False(engine.IsInstalled);
        Assert.Equal(AppInfo.Version, engine.CurrentVersion);
    }
}

public class StartupGuardTests : IDisposable
{
    readonly string _root = Path.Combine(Path.GetTempPath(), "lc-guard-" + Guid.NewGuid().ToString("N"));
    readonly DataPaths _data;

    public StartupGuardTests() => _data = new DataPaths(Path.Combine(_root, "data"));

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch (IOException) { }
    }

    [Fact]
    public void Starts_that_never_become_healthy_add_up()
    {
        var guard = new StartupGuard(_data, "3.0.1");
        Assert.Equal(1, guard.RegisterStart());
        Assert.Equal(2, guard.RegisterStart());
        Assert.False(guard.ShouldRepair(2));
        Assert.Equal(3, guard.RegisterStart());
        Assert.True(guard.ShouldRepair(3));
    }

    [Fact]
    public void A_healthy_start_resets_the_count()
    {
        var guard = new StartupGuard(_data, "3.0.1");
        guard.RegisterStart();
        guard.RegisterStart();
        guard.MarkHealthy();
        Assert.Equal(1, guard.RegisterStart());
    }

    [Fact]
    public void A_new_version_starts_counting_again()
    {
        var old = new StartupGuard(_data, "3.0.1");
        old.RegisterStart();
        old.RegisterStart();
        Assert.Equal(1, new StartupGuard(_data, "3.0.2").RegisterStart());
    }

    [Fact]
    public void A_damaged_file_counts_as_a_first_start()
    {
        File.WriteAllText(_data.Of("startup.json"), "{ nope");
        Assert.Equal(1, new StartupGuard(_data, "3.0.1").RegisterStart());
    }

    [Fact]
    public void An_unwritable_data_folder_does_not_stop_the_app()
    {
        var guard = new StartupGuard(_data, "3.0.1");
        Directory.CreateDirectory(_data.Of("startup.json"));   // a folder where the file should be
        Assert.Equal(1, guard.RegisterStart());
        guard.MarkHealthy();
    }
}
