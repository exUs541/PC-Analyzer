using LaptopCheck.Core;
using LaptopCheck.Server;

namespace LaptopCheck.Tests;

/// <summary>A server on a free port with its own data folder and a tiny dashboard folder.</summary>
internal sealed class TestEnv : IAsyncDisposable
{
    public required string Root { get; init; }
    public required DataPaths Data { get; init; }
    public required string Web { get; init; }
    public required LcServer Server { get; init; }
    public required HttpClient Http { get; init; }
    public int ShutdownCalls;

    public static async Task<TestEnv> StartAsync(Func<DataPaths, IScanRunner>? scannerFactory = null, Func<DataPaths, IFilesScanRunner>? filesFactory = null, IGitHubService? gitHub = null,
        ICleanupActions? cleanup = null, Func<DataPaths, IUpdateActions>? updateFactory = null, Func<DataPaths, ISpaceScanRunner>? spaceFactory = null, Func<DataPaths, ICompareActions>? compareFactory = null, IFolderPicker? folderPicker = null)
    {
        Environment.SetEnvironmentVariable("LC_OPEN_DRYRUN", "1");
        var root = Path.Combine(Path.GetTempPath(), "lc-test-" + Guid.NewGuid().ToString("N"));
        var web = Path.Combine(root, "web");
        Directory.CreateDirectory(web);
        File.WriteAllText(Path.Combine(web, "index.html"), "<meta name=\"lc-token\" content=\"__LC_TOKEN__\">");
        File.WriteAllText(Path.Combine(web, "app.js"), "console.log(1)");
        File.WriteAllText(Path.Combine(web, "notes.txt"), "not served");
        File.WriteAllText(Path.Combine(root, "secret.txt"), "secret");

        var data = new DataPaths(Path.Combine(root, "data"));
        TestEnv? env = null;
        var server = await LcServer.StartAsync(new LcServerOptions
        {
            Data = data,
            WebRoot = web,
            PreferredPort = 0,
            Scanner = scannerFactory?.Invoke(data),
            Files = filesFactory?.Invoke(data),
            Space = spaceFactory?.Invoke(data),
            GitHub = gitHub ?? new NotConnectedGitHub(),
            Cleanup = cleanup ?? new NoCleanupActions(),
            Update = updateFactory?.Invoke(data) ?? new NoUpdateActions(),
            Compare = compareFactory?.Invoke(data) ?? new NoCompareActions(),
            FolderPicker = folderPicker ?? new NoFolderPicker(),
            OnShutdownRequested = () => { if (env != null) Interlocked.Increment(ref env.ShutdownCalls); },
        });
        env = new TestEnv { Root = root, Data = data, Web = web, Server = server, Http = new HttpClient { BaseAddress = new Uri(server.Url) } };
        return env;
    }

    public HttpRequestMessage Request(HttpMethod method, string path, bool withToken = true, string? host = null, string? body = null)
    {
        var req = new HttpRequestMessage(method, path);
        if (withToken) req.Headers.Add("X-LC-Token", Server.Token);
        if (host != null) req.Headers.Host = host;
        if (body != null) req.Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
        return req;
    }

    public async ValueTask DisposeAsync()
    {
        Environment.SetEnvironmentVariable("LC_OPEN_DRYRUN", null);   // set for the "open" tests; other tests must not inherit it
        Http.Dispose();
        await Server.DisposeAsync();
        try { Directory.Delete(Root, true); } catch (IOException) { }
    }
}
