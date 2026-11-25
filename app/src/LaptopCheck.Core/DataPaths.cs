namespace LaptopCheck.Core;

/// <summary>
/// Where the user's own data lives. It is never inside the program folder, so updates (which replace the
/// program folder) cannot touch it.
/// </summary>
public sealed class DataPaths
{
    public string Dir { get; }

    public DataPaths(string dir)
    {
        Dir = Path.GetFullPath(dir);
        Directory.CreateDirectory(Dir);
    }

    /// <summary>
    /// Explicit folder (tests, --data-dir) > LC_DATA_DIR > %LOCALAPPDATA%\LaptopCheckData\data. Deliberately not inside
    /// %LOCALAPPDATA%\LaptopCheck: that is the install folder, which updates replace and an uninstall removes.
    /// </summary>
    public static DataPaths Resolve(string? explicitDir)
    {
        var dir = explicitDir ?? Environment.GetEnvironmentVariable("LC_DATA_DIR");
        if (string.IsNullOrWhiteSpace(dir))
            dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LaptopCheckData", "data");
        return new DataPaths(dir);
    }

    public string Of(string fileName) => Path.Combine(Dir, fileName);

    public string Snapshot => Of("snapshot.json");
    public string SnapshotPrev => Of("snapshot.prev.json");
    public string Files => Of("files.json");
    public string Space => Of("space.json");
    public string Compare => Of("compare.json");
    public string UpdateState => Of("update-state.json");
    public string GitHubToken => Of("github-token.txt");
    public string UninstallIndex => Of("uninstall-index.json");
    public string WingetIndex => Of("winget-index.json");
}
