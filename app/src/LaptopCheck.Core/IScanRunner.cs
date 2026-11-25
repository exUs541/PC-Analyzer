namespace LaptopCheck.Core;

/// <summary>Runs a system scan and stores the result (snapshot.json). The server only knows this interface.</summary>
public interface IScanRunner
{
    /// <param name="quick">Skip the slow parts (folder sizes, program sizes, update check).</param>
    Task RunAsync(bool quick, CancellationToken cancellationToken = default);
}
