namespace LaptopCheck.Core;

/// <summary>What the dashboard's "update now and restart" button asks for.</summary>
public interface IUpdateActions
{
    /// <summary>
    /// Installs a downloaded (or, if need be, freshly found) update and restarts the app. JSON: dryRun, and noUpdate when there is nothing to install.
    /// </summary>
    /// <exception cref="NotSupportedException">This run is not an installed copy of the app.</exception>
    Task<string> RestartToUpdateAsync(CancellationToken cancellationToken = default);
}

/// <summary>A server without update support (a plain run of the program files).</summary>
public sealed class NoUpdateActions : IUpdateActions
{
    public Task<string> RestartToUpdateAsync(CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("Updates gibt es nur in der installierten App.");
}
