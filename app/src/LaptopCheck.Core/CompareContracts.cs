namespace LaptopCheck.Core;

/// <summary>Comparing two folders of the user's choice: what only one side has, what differs, what moved. Read-only.</summary>
public interface ICompareActions
{
    /// <summary>Request {a, b, deep, ignoreJunk} -> the result (also stored as data\compare.json). Throws ArgumentException for folders that cannot be compared.</summary>
    Task<string> RunAsync(string requestJson, CancellationToken cancellationToken = default);

    /// <summary>The last stored result, or "null".</summary>
    string Last();
}

public sealed class NoCompareActions : ICompareActions
{
    static NotSupportedException No() => new("Das Vergleichen von Ordnern gibt es hier nicht.");
    public Task<string> RunAsync(string requestJson, CancellationToken cancellationToken = default) => throw No();
    public string Last() => throw No();
}

/// <summary>A window in which the user picks a folder. Without a window (tests, server-only runs) nothing is picked.</summary>
public interface IFolderPicker
{
    /// <returns>The chosen folder, or null when the window was cancelled or there is none.</returns>
    string? Pick(string title, string? startPath);
}

public sealed class NoFolderPicker : IFolderPicker
{
    public string? Pick(string title, string? startPath) => null;
}
