namespace LaptopCheck.Core;

/// <summary>Analysing folders, proposing a new folder structure and applying it (nothing is deleted unless the user marks it).</summary>
public interface IOrganizeActions
{
    /// <summary>JSON: the user's usual folders (Downloads, Documents, ...) with their paths.</summary>
    string Folders();

    /// <summary>Request {roots:[...]} -> a plan (also stored on disk) with one item per loose file / sub folder and its proposed place.</summary>
    Task<string> AnalyzeAsync(string requestJson, CancellationToken cancellationToken = default);

    /// <summary>Request {planId, folderMap, skipIds, deleteIds} -> moves what the stored plan says. Marked items go to the Recycle Bin after a confirmation window.</summary>
    Task<string> ApplyAsync(string requestJson, CancellationToken cancellationToken = default);

    /// <summary>JSON: earlier runs (for "undo").</summary>
    string Runs();

    /// <summary>Request {runId} -> moves everything of that run back.</summary>
    string Undo(string requestJson);
}

public sealed class NoOrganizeActions : IOrganizeActions
{
    static NotSupportedException No() => new("Das Ordnen von Dateien gibt es hier nicht.");
    public string Folders() => throw No();
    public Task<string> AnalyzeAsync(string requestJson, CancellationToken cancellationToken = default) => throw No();
    public Task<string> ApplyAsync(string requestJson, CancellationToken cancellationToken = default) => throw No();
    public string Runs() => throw No();
    public string Undo(string requestJson) => throw No();
}
