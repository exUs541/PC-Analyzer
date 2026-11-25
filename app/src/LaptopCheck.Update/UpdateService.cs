using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using LaptopCheck.Core;

namespace LaptopCheck.Update;

/// <summary>
/// The app's own updating, without anything for the user to do: it looks for a newer version in the background (shortly after
/// the start and then every hour), loads it quietly and installs it when the app is closed the next time. The dashboard's
/// "update now" button installs it right away and restarts. What happened is in data\update-state.json (the dashboard shows it).
/// </summary>
public sealed class UpdateService(DataPaths data, IUpdateEngine engine, Action requestExit, Func<DateTime>? now = null, Action<string>? log = null) : IUpdateActions
{
    static readonly JsonSerializerOptions Compact = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    public static readonly TimeSpan FirstCheckDelay = TimeSpan.FromSeconds(20);
    public static readonly TimeSpan CheckEvery = TimeSpan.FromHours(1);

    readonly Func<DateTime> _now = now ?? (() => DateTime.Now);
    readonly SemaphoreSlim _gate = new(1, 1);
    UpdateOffer? _ready;
    bool _restartRequested;

    /// <summary>The update that is loaded and waits for the next end of the app, or null.</summary>
    public UpdateOffer? Ready => _ready;

    string Stamp() => _now().ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);

    JsonObject? ReadState()
    {
        try { return JsonNode.Parse(AtomicFile.ReadText(data.UpdateState) ?? "null") as JsonObject; }
        catch (JsonException) { return null; }
    }

    void WriteState(string result, string message, string? available = null, bool updated = false)
    {
        var old = ReadState();
        var state = new JsonObject
        {
            ["checkedAt"] = Stamp(), ["result"] = result, ["message"] = message, ["method"] = "velopack", ["source"] = null, ["sha"] = null,
            ["updatedAt"] = updated ? Stamp() : old?["updatedAt"]?.DeepClone(),
            ["version"] = engine.CurrentVersion, ["changed"] = 0,
        };
        if (available is not null) state["available"] = available;
        try { AtomicFile.WriteText(data.UpdateState, state.ToJsonString(Compact)); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    /// <summary>Call once at the start: when the version differs from the one the last run saw, this run is the result of an update.</summary>
    public void NoteStart()
    {
        var old = ReadState();
        var before = old?["version"]?.GetValue<string>();
        if (before is not null && before != engine.CurrentVersion)
        {
            WriteState("updated", $"Auf die neueste Version aktualisiert (Version {engine.CurrentVersion}).", updated: true);
            log?.Invoke($"updated from {before} to {engine.CurrentVersion}");
        }
        else if (old is null)
        {
            WriteState("current", "Noch nicht geprüft.");
        }
    }

    bool AutoUpdateOn => AppConfig.Read(new JsonStores(data)).AutoUpdate;

    /// <summary>Looks for a newer version and loads it. Returns the version that is ready to be installed, or null.</summary>
    /// <param name="force">The user asked for it: ignore the "update automatically" setting.</param>
    public async Task<UpdateOffer?> CheckAndDownloadAsync(bool force, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (!force && !AutoUpdateOn)
            {
                WriteState("disabled", "Automatische Updates sind ausgeschaltet.");
                return null;
            }
            if (!engine.IsInstalled)
            {
                WriteState("disabled", "Updates gibt es nur in der installierten App (dies ist ein Start aus den Programmdateien).");
                return null;
            }
            if (_ready is not null) return _ready;

            try
            {
                var offer = await engine.CheckAsync(cancellationToken);
                if (offer is null)
                {
                    WriteState("current", "Du hast bereits die neueste Version.");
                    return null;
                }
                WriteState("downloading", $"Version {offer.Version} wird geladen …", offer.Version);
                await engine.DownloadAsync(offer, null, cancellationToken);
                _ready = offer;
                WriteState("ready", $"Version {offer.Version} ist geladen und wird beim nächsten Beenden installiert.", offer.Version);
                log?.Invoke("update ready: " + offer.Version);
                return offer;
            }
            catch (UpdateException ex)
            {
                var (result, message) = ex.Kind switch
                {
                    UpdateFailure.Offline => ("offline", "GitHub ist gerade nicht erreichbar. Beim nächsten Mal wird erneut geprüft."),
                    UpdateFailure.NoAccess => ("no-access", "Kein Zugriff auf die Updates. Verbinde dich mit GitHub (Konto mit Zugriff auf das Repository)."),
                    _ => ("error", "Die Update-Prüfung ist fehlgeschlagen: " + ex.Message),
                };
                WriteState(result, message);
                log?.Invoke($"update check: {result}: {ex.Message}");
                return null;
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>The background loop: first check after a short delay (so the start stays fast), then every hour.</summary>
    public async Task RunAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(FirstCheckDelay, cancellationToken);
            while (!cancellationToken.IsCancellationRequested)
            {
                await CheckAndDownloadAsync(force: false, cancellationToken);
                await Task.Delay(CheckEvery, cancellationToken);
            }
        }
        catch (OperationCanceledException) { }
    }

    /// <summary>"Update now": installs the loaded (or freshly found) version and restarts.</summary>
    public async Task<string> RestartToUpdateAsync(CancellationToken cancellationToken = default)
    {
        if (!engine.IsInstalled) throw new NotSupportedException("Neustart zum Aktualisieren gibt es nur in der installierten App.");
        if (Environment.GetEnvironmentVariable("LC_OPEN_DRYRUN") == "1") return "{\"dryRun\":true}";
        var offer = _ready ?? await CheckAndDownloadAsync(force: true, cancellationToken);
        if (offer is null) return "{\"dryRun\":false,\"noUpdate\":true}";
        _restartRequested = true;
        requestExit();
        return new JsonObject { ["dryRun"] = false, ["updating"] = true, ["version"] = offer.Version }.ToJsonString(Compact);
    }

    /// <summary>Call when the app has ended: installs a loaded update now (and starts the app again if the user asked for the restart).</summary>
    public void ApplyPendingOnExit(bool restart = false)
    {
        var offer = _ready;
        if (offer is null) return;
        restart |= _restartRequested;
        try
        {
            engine.ApplyOnExit(offer, restart);
            log?.Invoke($"update {offer.Version} will be installed (restart: {restart})");
        }
        catch (Exception ex) when (ex is InvalidOperationException or IOException or System.ComponentModel.Win32Exception)
        {
            log?.Invoke("could not hand the update over: " + ex.Message);   // the next start applies a loaded update by itself
        }
    }
}
