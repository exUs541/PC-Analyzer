namespace LaptopCheck.Core;

/// <summary>
/// The storage analysis: where the space of the system drive went (folder sizes several levels deep, read-only).
/// It is separate from the normal scan because it takes a minute or two; the server only knows this interface.
/// </summary>
public interface ISpaceScanRunner
{
    /// <summary>Measures the system drive and stores space.json.</summary>
    Task RunAsync(CancellationToken cancellationToken = default);
}
