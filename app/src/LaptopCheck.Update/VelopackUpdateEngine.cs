using System.Net;
using LaptopCheck.Core;
using Velopack;
using Velopack.Sources;

namespace LaptopCheck.Update;

/// <summary>
/// Updates through Velopack. The feed is the GitHub releases of the repository: first without a login, and when GitHub refuses
/// (a private repository) with each GitHub login found on this PC. For tests and for people who host the files themselves,
/// LC_UPDATE_SOURCE (a folder or a web address) replaces the feed.
/// </summary>
public sealed class VelopackUpdateEngine(string repoUrl, Func<IReadOnlyList<string>> logins, string? overrideSource = null, string[]? restartArgs = null) : IUpdateEngine
{
    UpdateManager? _active;
    UpdateInfo? _info;

    UpdateManager Make(string? token) =>
        overrideSource is { Length: > 0 } ? new UpdateManager(overrideSource) : new UpdateManager(new GithubSource(repoUrl, token, false));

    /// <summary>Without VelopackApp.Build().Run() (tests, tools) there is no installation to ask: then this is simply "not installed".</summary>
    UpdateManager? Probe()
    {
        try { return _active ?? Make(null); }
        catch (InvalidOperationException) { return null; }
    }

    public bool IsInstalled => Probe()?.IsInstalled ?? false;

    public string CurrentVersion => Probe()?.CurrentVersion?.ToString() ?? AppInfo.Version;

    static UpdateFailure Classify(Exception ex)
    {
        var text = ex.ToString();
        if (text.Contains("401") || text.Contains("403") || text.Contains("404") || text.Contains("Unauthorized", StringComparison.OrdinalIgnoreCase) || text.Contains("Not Found", StringComparison.OrdinalIgnoreCase))
            return UpdateFailure.NoAccess;
        for (Exception? e = ex; e is not null; e = e.InnerException)
        {
            if (e is HttpRequestException { StatusCode: null } or System.Net.Sockets.SocketException or TaskCanceledException or TimeoutException) return UpdateFailure.Offline;
            if (e is HttpRequestException { StatusCode: HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound }) return UpdateFailure.NoAccess;
        }
        return UpdateFailure.Other;
    }

    public async Task<UpdateOffer?> CheckAsync(CancellationToken cancellationToken)
    {
        UpdateException? last = null;
        IReadOnlyList<string?> attempts = [null];
        for (var i = 0; i < attempts.Count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var mgr = Make(attempts[i]);
                var info = await mgr.CheckForUpdatesAsync();
                _active = mgr;
                _info = info;
                if (info is null || info.IsDowngrade) return null;
                var target = info.TargetFullRelease;
                return new UpdateOffer(target.Version.ToString(), target.NotesMarkdown, info);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                var kind = Classify(ex);
                last = new UpdateException(kind, ex.Message, ex);
                // a private repository answers "not found" without a login: only now look for the logins on this PC
                if (kind == UpdateFailure.NoAccess && i == 0 && overrideSource is null) attempts = [null, .. logins()];
                else if (kind != UpdateFailure.NoAccess) throw last;
            }
        }
        throw last ?? new UpdateException(UpdateFailure.Other, "unknown");
    }

    public async Task DownloadAsync(UpdateOffer offer, Action<int>? progress, CancellationToken cancellationToken)
    {
        if (_active is null || offer.Handle is not UpdateInfo info) throw new InvalidOperationException("Check for updates first.");
        try
        {
            await _active.DownloadUpdatesAsync(info, progress, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new UpdateException(Classify(ex), ex.Message, ex);
        }
    }

    public void ApplyOnExit(UpdateOffer offer, bool restart)
    {
        if (_active is null || offer.Handle is not UpdateInfo info) throw new InvalidOperationException("Check for updates first.");
        _active.WaitExitThenApplyUpdates(info.TargetFullRelease, silent: true, restart: restart, restartArgs: restartArgs);
    }
}
