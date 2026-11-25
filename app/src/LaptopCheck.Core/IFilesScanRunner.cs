namespace LaptopCheck.Core;

/// <summary>The files scan: your folders, cloud folders and git repositories. The server only knows this interface.</summary>
public interface IFilesScanRunner
{
    /// <summary>Scans and stores files.json. Takes up to a few minutes.</summary>
    Task RunAsync(CancellationToken cancellationToken = default);

    /// <summary>JSON array of the detected cloud sync folders (Google Drive, OneDrive, ...).</summary>
    string ProvidersJson();
}
