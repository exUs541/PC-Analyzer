namespace LaptopCheck.Core;

/// <summary>
/// The actions behind the dashboard's clean-up pages: copy folders to a cloud folder and remove the verified originals,
/// send confirmed files and folders to the Recycle Bin, start a program's own uninstaller, update programs with winget,
/// re-measure a program, show a place in Explorer. Requests and answers are JSON text, the server only routes them.
/// A request that is wrong throws <see cref="ArgumentException"/> (HTTP 400), one that cannot be done here
/// <see cref="NotSupportedException"/> (HTTP 501).
/// </summary>
public interface ICleanupActions
{
    /// <summary>Checks a move request, writes its job and starts the copy-and-verify phase in the background. Answer: id, items, started.</summary>
    Task<string> StartMoveAsync(string requestJson);

    /// <summary>Starts the removal of the verified originals of a finished copy (asks for confirmation in its own window first).</summary>
    Task<string> StartMoveCleanupAsync(string jobId);

    string MoveStatus(string jobId);

    string MoveList();

    /// <summary>Copies the files that only the old local Drive folder has into the live drive (same relative path, nothing overwritten, every copy verified). The page sends no path. Answer: id.</summary>
    Task<string> StartRestoreAsync(string requestJson);

    string RestoreStatus(string jobId);

    /// <summary>Checks the confirmed items against the saved confirmation, writes a job and starts the removal to the Recycle Bin.</summary>
    Task<string> StartDeleteAsync(string requestJson);

    string DeleteStatus(string jobId);

    /// <summary>Starts the uninstaller that the last scan recorded for a confirmed program.</summary>
    string Uninstall(string requestJson);

    /// <summary>Updates programs through winget (only ids the last scan reported).</summary>
    string WingetUpgrade(string requestJson);

    /// <summary>Reads a program's entry in the Windows program list again and measures its folder. Read-only.</summary>
    string CheckApp(string requestJson);

    /// <summary>Highlights a place in Explorer (never starts anything).</summary>
    string Reveal(string requestJson);
}

/// <summary>A server without clean-up support: every action says so.</summary>
public sealed class NoCleanupActions : ICleanupActions
{
    const string NotYet = "Diese Funktion gibt es in der neuen App noch nicht.";

    public Task<string> StartMoveAsync(string requestJson) => throw new NotSupportedException(NotYet);
    public Task<string> StartMoveCleanupAsync(string jobId) => throw new NotSupportedException(NotYet);
    public string MoveStatus(string jobId) => throw new NotSupportedException(NotYet);
    public string MoveList() => throw new NotSupportedException(NotYet);
    public Task<string> StartRestoreAsync(string requestJson) => throw new NotSupportedException(NotYet);
    public string RestoreStatus(string jobId) => throw new NotSupportedException(NotYet);
    public Task<string> StartDeleteAsync(string requestJson) => throw new NotSupportedException(NotYet);
    public string DeleteStatus(string jobId) => throw new NotSupportedException(NotYet);
    public string Uninstall(string requestJson) => throw new NotSupportedException(NotYet);
    public string WingetUpgrade(string requestJson) => throw new NotSupportedException(NotYet);
    public string CheckApp(string requestJson) => throw new NotSupportedException(NotYet);
    public string Reveal(string requestJson) => throw new NotSupportedException(NotYet);
}

/// <summary>What the user is asked before anything is removed.</summary>
/// <param name="Lines">What would happen, one entry per line (items, sizes).</param>
/// <param name="CheckboxText">A statement the user has to tick (e.g. "the cloud client shows synced"), or null.</param>
/// <param name="RequiredWord">The word that must be typed exactly (upper case, no variations).</param>
public sealed record ConfirmationRequest(string Title, string Heading, IReadOnlyList<string> Lines, string? CheckboxText, string RequiredWord)
{
    public const string RemoveWord = "ENTFERNEN";

    /// <summary>True only when every condition is met: the box is ticked (if there is one) and the word is typed exactly.</summary>
    public bool IsSatisfiedBy(bool boxTicked, string? typed) =>
        (CheckboxText is null || boxTicked) && string.Equals(typed, RequiredWord, StringComparison.Ordinal);
}

/// <summary>Asks the user in a window of their own. There is deliberately no way to answer "yes" from outside.</summary>
public interface IConfirmation
{
    Task<bool> ConfirmAsync(ConfirmationRequest request, CancellationToken cancellationToken = default);
}

/// <summary>Used where no window exists (server-only runs, tests): nothing is ever confirmed.</summary>
public sealed class DenyAllConfirmation : IConfirmation
{
    public Task<bool> ConfirmAsync(ConfirmationRequest request, CancellationToken cancellationToken = default) => Task.FromResult(false);
}

/// <summary>Moves a file or folder to the Recycle Bin (not deleted for good).</summary>
public interface IRecycleBin
{
    void Recycle(string path, bool isDirectory);
}

/// <summary>Starts a program the way Windows does (own window, administrator prompt where the program needs it).</summary>
public interface ILauncher
{
    void Start(string file, string arguments);
}

public sealed class RealRecycleBin : IRecycleBin
{
    /// <summary>AllDialogs: if an item is too big for the Recycle Bin, Windows asks before it would be deleted for good.</summary>
    public void Recycle(string path, bool isDirectory)
    {
        if (isDirectory)
            Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(path, Microsoft.VisualBasic.FileIO.UIOption.AllDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
        else
            Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(path, Microsoft.VisualBasic.FileIO.UIOption.AllDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
    }
}

public sealed class RealLauncher : ILauncher
{
    public void Start(string file, string arguments) =>
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(file) { Arguments = arguments, UseShellExecute = true });
}
