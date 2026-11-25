using System.Globalization;

namespace LaptopCheck.Core;

/// <summary>Which GitHub login is in use (shown on the Projekte and Daten pages).</summary>
public interface IGitHubStatusProvider
{
    /// <summary>JSON object: connected, source, login, checkedAt. No network: the answer of the last check, or a guess from what is on this PC.</summary>
    string GetStatusJson();
}

/// <summary>Everything the dashboard asks of GitHub: status, repository list, one-click sign-in, hand-made access token.</summary>
public interface IGitHubService : IGitHubStatusProvider
{
    /// <summary>Live check (one call to GitHub): who is signed in on this PC. JSON like <see cref="IGitHubStatusProvider.GetStatusJson"/>.</summary>
    Task<string> StatusAsync(CancellationToken cancellationToken = default);

    /// <summary>Reads the repository list from GitHub, merges it into repos.json and returns the stored document (JSON).</summary>
    Task<string> SyncAsync(CancellationToken cancellationToken = default);

    /// <summary>Starts the sign-in (browser). Returns JSON: dryRun, and in a test run what would be started.</summary>
    string StartConnect();

    /// <summary>Stores (or, with an empty text, removes) a hand-made access token.</summary>
    /// <exception cref="ArgumentException">The text does not look like a GitHub token.</exception>
    void SetToken(string token);
}

/// <summary>Placeholder for a server without GitHub support: reports "not connected" and refuses the actions.</summary>
public sealed class NotConnectedGitHub : IGitHubService
{
    const string NotYet = "Diese Funktion gibt es in der neuen App noch nicht.";

    public string GetStatusJson() =>
        "{\"connected\":false,\"source\":null,\"login\":null,\"checkedAt\":\"" +
        DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture) + "\"}";

    public Task<string> StatusAsync(CancellationToken cancellationToken = default) => Task.FromResult(GetStatusJson());
    public Task<string> SyncAsync(CancellationToken cancellationToken = default) => throw new NotSupportedException(NotYet);
    public string StartConnect() => throw new NotSupportedException(NotYet);
    public void SetToken(string token) => throw new NotSupportedException(NotYet);
}
