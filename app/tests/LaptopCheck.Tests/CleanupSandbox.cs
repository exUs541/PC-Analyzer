using System.Text.Json;
using System.Text.Json.Nodes;
using LaptopCheck.Cleanup;
using LaptopCheck.Core;
using LaptopCheck.Scan;

namespace LaptopCheck.Tests;

internal sealed class ScriptedConfirmation : IConfirmation
{
    public bool Answer { get; set; }
    public Action? DuringConfirm { get; set; }
    public List<ConfirmationRequest> Requests { get; } = [];

    public Task<bool> ConfirmAsync(ConfirmationRequest request, CancellationToken cancellationToken = default)
    {
        Requests.Add(request);
        DuringConfirm?.Invoke();
        return Task.FromResult(Answer);
    }
}

/// <summary>A Recycle Bin that is a folder inside the sandbox: nothing here ever reaches the real one.</summary>
internal sealed class FolderRecycle(string trash) : IRecycleBin
{
    public List<string> Recycled { get; } = [];
    public Func<string, bool>? Fail { get; set; }

    public void Recycle(string path, bool isDirectory)
    {
        if (Fail?.Invoke(path) == true) throw new IOException("Papierkorb nicht erreichbar");
        Directory.CreateDirectory(trash);
        var target = Path.Combine(trash, Guid.NewGuid().ToString("N") + "_" + Path.GetFileName(path));
        if (isDirectory) Directory.Move(path, target); else File.Move(path, target);
        Recycled.Add(path);
    }
}

internal sealed class RecordingLauncher : ILauncher
{
    public List<(string File, string Args)> Started { get; } = [];
    public void Start(string file, string arguments) => Started.Add((file, arguments));
}

/// <summary>A pretend PC in a temp folder: a user profile, a cloud folder, a data folder, protected places, and fakes for everything that acts.</summary>
internal sealed class CleanupSandbox : IDisposable
{
    public string Base { get; } = Path.Combine(Path.GetTempPath(), "lc-cleanup-" + Guid.NewGuid().ToString("N"));
    public string Home => Path.Combine(Base, "home");
    public string Cloud => Path.Combine(Base, "cloud", "Meine Ablage");
    public string Trash => Path.Combine(Base, "trash");
    public DataPaths Data { get; }
    public ScanEnvironment Env { get; }
    public ScriptedConfirmation Confirmation { get; } = new();
    public FolderRecycle Recycle { get; }
    public RecordingLauncher Launcher { get; } = new();
    public FakeRegistry Registry { get; } = new();
    public CleanupContext Context { get; }
    public CleanupService Service { get; }

    public CleanupSandbox()
    {
        Environment.SetEnvironmentVariable("LC_OPEN_DRYRUN", null);   // these tests exercise the real actions (with fakes), not the test-run mode
        Directory.CreateDirectory(Cloud);
        Directory.CreateDirectory(Home);
        Data = new DataPaths(Path.Combine(Base, "data"));
        Env = new ScanEnvironment
        {
            UserProfile = Home, AppData = Path.Combine(Home, "AppData", "Roaming"), LocalAppData = Path.Combine(Home, "AppData", "Local"),
            ProgramData = Path.Combine(Base, "ProgramData"), SystemRoot = Path.Combine(Base, "Windows"),
            ProgramFiles = Path.Combine(Base, "Program Files"), ProgramFilesX86 = Path.Combine(Base, "Program Files (x86)"), SystemDrive = Base,
        };
        Recycle = new FolderRecycle(Trash);
        WriteConfig(new { extraCloudRoots = new[] { Cloud } });
        Context = new CleanupContext
        {
            Data = Data, Env = Env, Probe = new FakeProbe(), Registry = Registry, Recycle = Recycle, Launcher = Launcher, Confirmation = Confirmation,
        };
        Service = new CleanupService(Context);
    }

    public void WriteConfig(object config) => AtomicFile.WriteText(Data.Of("config.json"), JsonSerializer.Serialize(config));

    public string Write(string path, string text = "x")
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
        return path;
    }

    /// <summary>What the dashboard saves in data\cleanup.json when the user confirms something.</summary>
    public void SaveCleanup(params (string Id, object Item)[] items)
    {
        var map = new JsonObject();
        foreach (var (id, item) in items) map[id] = JsonSerializer.SerializeToNode(item);
        new JsonStores(Data).Write("cleanup", new JsonObject { ["version"] = 1, ["items"] = map }.ToJsonString());
    }

    public static long ConfirmedIn(TimeSpan fromNow) => DateTimeOffset.UtcNow.Add(fromNow).ToUnixTimeMilliseconds();

    public object PathItem(string path, string kind, string state = "confirmed", long? confirmedMs = null) =>
        new { type = "path", kind, name = Path.GetFileName(path), path, state, confirmedMs = confirmedMs ?? ConfirmedIn(TimeSpan.FromMinutes(1)) };

    public JsonNode Json(string text) => JsonNode.Parse(text)!;

    public string MoveDir(string id) => Path.Combine(Data.Dir, "moves", id);

    public string MoveFile(string id, string name) => File.ReadAllText(Path.Combine(MoveDir(id), name));

    public void Dispose()
    {
        try
        {
            foreach (var f in Directory.EnumerateFiles(Base, "*", SearchOption.AllDirectories)) File.SetAttributes(f, FileAttributes.Normal);
            Directory.Delete(Base, true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
}
