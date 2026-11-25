namespace LaptopCheck.Update;

/// <summary>A newer version that is available (not yet installed).</summary>
public sealed record UpdateOffer(string Version, string? Notes, object Handle);

public enum UpdateFailure { Offline, NoAccess, Other }

/// <summary>Checking for or loading an update failed; the kind tells the dashboard what to say.</summary>
public sealed class UpdateException(UpdateFailure kind, string message, Exception? inner = null) : Exception(message, inner)
{
    public UpdateFailure Kind { get; } = kind;
}

/// <summary>The part that talks to the release feed and installs packages. A seam: tests use a fake, the app uses Velopack.</summary>
public interface IUpdateEngine
{
    /// <summary>False for a plain run of the program files (development, or the portable copy): there is nothing to update.</summary>
    bool IsInstalled { get; }

    /// <summary>The version that is running.</summary>
    string CurrentVersion { get; }

    /// <summary>Null when this is the newest version.</summary>
    /// <exception cref="UpdateException">The feed could not be read.</exception>
    Task<UpdateOffer?> CheckAsync(CancellationToken cancellationToken);

    Task DownloadAsync(UpdateOffer offer, Action<int>? progress, CancellationToken cancellationToken);

    /// <summary>Installs the downloaded version as soon as this process has ended, and starts the app again when asked to.</summary>
    void ApplyOnExit(UpdateOffer offer, bool restart);
}
