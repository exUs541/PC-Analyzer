using LaptopCheck.Core;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LaptopCheck.Server;

public sealed class LcServerOptions
{
    public required DataPaths Data { get; init; }
    public required string WebRoot { get; init; }
    public string ProgramDir { get; init; } = AppContext.BaseDirectory;
    /// <summary>0 = any free port. Otherwise the first free port from here upwards is used.</summary>
    public int PreferredPort { get; init; } = 48765;
    public int PortTries { get; init; } = 10;
    /// <summary>Called after the answer to POST /api/shutdown was sent.</summary>
    public Action? OnShutdownRequested { get; init; }
    public IGitHubService GitHub { get; init; } = new NotConnectedGitHub();
    /// <summary>Runs POST /api/scan. Without one the endpoint answers 501.</summary>
    public IScanRunner? Scanner { get; init; }
    /// <summary>Runs POST /api/scan-files and answers GET /api/providers. Without one they answer 501.</summary>
    public IFilesScanRunner? Files { get; init; }
    /// <summary>Runs POST /api/scan-space (the storage analysis of the system drive). Without one it answers 501.</summary>
    public ISpaceScanRunner? Space { get; init; }
    /// <summary>Move to the cloud, remove, uninstall, update, re-measure, reveal. Without one they answer 501.</summary>
    public ICleanupActions Cleanup { get; init; } = new NoCleanupActions();
    /// <summary>POST /api/update/restart. Without one it answers 501.</summary>
    public IUpdateActions Update { get; init; } = new NoUpdateActions();
    public IOrganizeActions Organize { get; init; } = new NoOrganizeActions();
    /// <summary>POST /api/compare (two folders), GET /api/compare/last. Without one they answer 501.</summary>
    public ICompareActions Compare { get; init; } = new NoCompareActions();
    /// <summary>POST /api/pick-folder: a window in which the user picks a folder. Without one nothing is picked.</summary>
    public IFolderPicker FolderPicker { get; init; } = new NoFolderPicker();
}

/// <summary>
/// The dashboard's local web server: serves web/ and the /api/* endpoints. Loopback only; every API call needs the
/// per-start token and a Host header of this server (protects against other web pages talking to it).
/// </summary>
public sealed class LcServer : IAsyncDisposable
{
    readonly WebApplication _app;

    LcServer(WebApplication app, int port, string token)
    {
        _app = app;
        Port = port;
        Token = token;
    }

    public int Port { get; }
    public string Token { get; }
    public string Url => $"http://127.0.0.1:{Port}/";

    public static async Task<LcServer> StartAsync(LcServerOptions options)
    {
        var token = Guid.NewGuid().ToString("N");
        Exception? last = null;
        for (var i = 0; i < Math.Max(1, options.PortTries); i++)
        {
            var wanted = options.PreferredPort == 0 ? 0 : options.PreferredPort + i;
            var port = new PortHolder();
            var app = Build(options, token, wanted, port);
            try
            {
                await app.StartAsync();
                port.Value = new Uri(app.Urls.First()).Port;
                return new LcServer(app, port.Value, token);
            }
            catch (IOException ex)
            {
                last = ex;
                await app.DisposeAsync();
            }
        }
        throw new IOException($"No free port found from {options.PreferredPort} on.", last);
    }

    static WebApplication Build(LcServerOptions options, string token, int wantedPort, PortHolder port)
    {
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { ContentRootPath = AppContext.BaseDirectory });
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls($"http://127.0.0.1:{wantedPort}");
        builder.WebHost.ConfigureKestrel(k =>
        {
            k.AddServerHeader = false;
            k.Limits.MaxRequestBodySize = JsonStores.MaxBytes + 1024;
        });
        var app = builder.Build();

        var stores = new JsonStores(options.Data);
        var state = new StateBuilder(options.Data, stores, options.GitHub, options.ProgramDir);
        var api = new ApiRouter(options, stores, state);
        var files = new StaticFiles(options.WebRoot, token);

        app.Run(async ctx =>
        {
            var res = ctx.Response;
            res.Headers.CacheControl = "no-store";
            res.Headers["X-Content-Type-Options"] = "nosniff";
            state.Port = port.Value;

            var host = ctx.Request.Headers.Host.ToString();
            if (host != $"localhost:{port.Value}" && host != $"127.0.0.1:{port.Value}")
            {
                await Responses.Text(res, 400, "Bad host header");
                return;
            }

            var path = ctx.Request.Path.Value ?? "/";
            if (path.StartsWith("/api/", StringComparison.Ordinal))
            {
                if (!Responses.TokenMatches(ctx.Request.Headers["X-LC-Token"].ToString(), token))
                {
                    await Responses.Text(res, 403, "Forbidden");
                    return;
                }
                await api.HandleAsync(ctx, path);
            }
            else
            {
                await files.HandleAsync(ctx, path);
            }
        });
        return app;
    }

    public async ValueTask DisposeAsync()
    {
        await _app.StopAsync();
        await _app.DisposeAsync();
    }

    internal sealed class PortHolder
    {
        public int Value;
    }
}
