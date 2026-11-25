using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using LaptopCheck.Core;
using Microsoft.AspNetCore.Http;

namespace LaptopCheck.Server;

/// <summary>The /api/* endpoints. Same routes and answers as the PowerShell server this app replaces.</summary>
internal sealed partial class ApiRouter(LcServerOptions options, JsonStores stores, StateBuilder state)
{
    const string NotYet = "Diese Funktion gibt es in der neuen App noch nicht.";

    /// <summary>Endpoints of the old server that are not ported yet: they answer 501 with a readable message.</summary>
    internal static readonly IReadOnlySet<string> NotPorted = new HashSet<string>(StringComparer.Ordinal);

    [GeneratedRegex("^/api/store/(?<name>notes|history|config|projects|repos|cleanup)$")]
    private static partial Regex StoreRoute();

    public async Task HandleAsync(HttpContext ctx, string path)
    {
        var res = ctx.Response;
        try
        {
            await RouteAsync(ctx, path);
        }
        catch (BodyTooLargeException)
        {
            await Responses.Error(res, 413, "too large");
        }
        catch (ArgumentException ex)
        {
            await Responses.Error(res, 400, ex.Message);
        }
        catch (NotSupportedException ex)
        {
            await Responses.Error(res, 501, ex.Message);
        }
        catch (Exception ex) when (!res.HasStarted)
        {
            await Responses.Error(res, 500, ex.Message);
        }
    }

    async Task RouteAsync(HttpContext ctx, string path)
    {
        var req = ctx.Request;
        var res = ctx.Response;
        var method = req.Method;

        if (path == "/api/ping")
        {
            await Responses.Json(res, 200, "{\"ok\":true}");
            return;
        }
        if (path == "/api/state" && method == "GET")
        {
            await Responses.Json(res, 200, state.Build());
            return;
        }
        if (path == "/api/scan" && method == "POST")
        {
            if (options.Scanner is null) throw new NotSupportedException(NotYet);
            await options.Scanner.RunAsync(req.Query["quick"] == "1", ctx.RequestAborted);
            await Responses.Json(res, 200, state.Build());
            return;
        }
        if (path == "/api/scan-files" && method == "POST")
        {
            if (options.Files is null) throw new NotSupportedException(NotYet);
            await options.Files.RunAsync(ctx.RequestAborted);
            await Responses.Json(res, 200, AtomicFile.ReadText(options.Data.Files) ?? "null");
            return;
        }
        if (path == "/api/scan-space" && method == "POST")
        {
            if (options.Space is null) throw new NotSupportedException(NotYet);
            await options.Space.RunAsync(ctx.RequestAborted);
            await Responses.Json(res, 200, AtomicFile.ReadText(options.Data.Space) ?? "null");
            return;
        }
        if (path == "/api/space" && method == "GET")
        {
            await Responses.Json(res, 200, AtomicFile.ReadText(options.Data.Space) ?? "null");
            return;
        }
        if (path == "/api/providers" && method == "GET")
        {
            if (options.Files is null) throw new NotSupportedException(NotYet);
            await Responses.Json(res, 200, options.Files.ProvidersJson());
            return;
        }
        if (path == "/api/files" && method == "GET")
        {
            await Responses.Json(res, 200, AtomicFile.ReadText(options.Data.Files) ?? "null");
            return;
        }
        if (path == "/api/github/status" && method == "GET")
        {
            await Responses.Json(res, 200, await options.GitHub.StatusAsync(ctx.RequestAborted));
            return;
        }
        if (path == "/api/github/sync" && method == "POST")
        {
            await Responses.Json(res, 200, await options.GitHub.SyncAsync(ctx.RequestAborted));
            return;
        }
        if (path == "/api/github/connect" && method == "POST")
        {
            await Responses.Json(res, 200, options.GitHub.StartConnect());
            return;
        }
        if (path == "/api/github/token" && method == "POST")
        {
            using var body = JsonDocument.Parse(await Responses.ReadBody(req, 64 * 1024));
            var token = body.RootElement.ValueKind == JsonValueKind.Object && body.RootElement.TryGetProperty("token", out var t) && t.ValueKind == JsonValueKind.String
                ? t.GetString() ?? "" : "";
            options.GitHub.SetToken(token);
            await Responses.Json(res, 200, "{\"ok\":true}");
            return;
        }

        var store = StoreRoute().Match(path);
        if (store.Success && (method == "GET" || method == "PUT"))
        {
            var name = store.Groups["name"].Value;
            if (method == "GET")
            {
                await Responses.Json(res, 200, stores.Read(name));
                return;
            }
            if (req.ContentLength > JsonStores.MaxBytes) throw new BodyTooLargeException();
            stores.Write(name, await Responses.ReadBody(req, JsonStores.MaxBytes));
            await Responses.Json(res, 200, "{\"ok\":true}");
            return;
        }

        // ---- clean-up: the server re-validates everything; nothing the page sends is executed
        if (path == "/api/move/start" && method == "POST")
        {
            await Responses.Json(res, 200, await options.Cleanup.StartMoveAsync(await Responses.ReadBody(req, 1024 * 1024)));
            return;
        }
        if (path == "/api/move/cleanup" && method == "POST")
        {
            await Responses.Json(res, 200, await options.Cleanup.StartMoveCleanupAsync(req.Query["id"].ToString()));
            return;
        }
        if (path == "/api/move/status" && method == "GET")
        {
            await Responses.Json(res, 200, options.Cleanup.MoveStatus(req.Query["id"].ToString()));
            return;
        }
        if (path == "/api/move/list" && method == "GET")
        {
            await Responses.Json(res, 200, options.Cleanup.MoveList());
            return;
        }
        if (path == "/api/restore/start" && method == "POST")
        {
            await Responses.Json(res, 200, await options.Cleanup.StartRestoreAsync(await Responses.ReadBody(req, 64 * 1024)));
            return;
        }
        if (path == "/api/restore/status" && method == "GET")
        {
            await Responses.Json(res, 200, options.Cleanup.RestoreStatus(req.Query["id"].ToString()));
            return;
        }
        if (path == "/api/delete/start" && method == "POST")
        {
            await Responses.Json(res, 200, await options.Cleanup.StartDeleteAsync(await Responses.ReadBody(req, 1024 * 1024)));
            return;
        }
        if (path == "/api/delete/status" && method == "GET")
        {
            await Responses.Json(res, 200, options.Cleanup.DeleteStatus(req.Query["id"].ToString()));
            return;
        }
        if (path == "/api/uninstall" && method == "POST")
        {
            await Responses.Json(res, 200, options.Cleanup.Uninstall(await Responses.ReadBody(req, 64 * 1024)));
            return;
        }
        if (path == "/api/winget/upgrade" && method == "POST")
        {
            await Responses.Json(res, 200, options.Cleanup.WingetUpgrade(await Responses.ReadBody(req, 64 * 1024)));
            return;
        }
        if (path == "/api/check/app" && method == "POST")
        {
            await Responses.Json(res, 200, options.Cleanup.CheckApp(await Responses.ReadBody(req, 64 * 1024)));
            return;
        }
        if (path == "/api/reveal" && method == "POST")
        {
            await Responses.Json(res, 200, options.Cleanup.Reveal(await Responses.ReadBody(req, 64 * 1024)));
            return;
        }

        if (path == "/api/compare" && method == "POST") { await Responses.Json(res, 200, await options.Compare.RunAsync(await Responses.ReadBody(req, 64 * 1024), ctx.RequestAborted)); return; }
        if (path == "/api/compare/last" && method == "GET") { await Responses.Json(res, 200, options.Compare.Last()); return; }
        if (path == "/api/pick-folder" && method == "POST")
        {
            var pick = System.Text.Json.Nodes.JsonNode.Parse(await Responses.ReadBody(req, 16 * 1024)) as System.Text.Json.Nodes.JsonObject;
            string? Field(string n) => pick?[n] is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
            var chosen = await Task.Run(() => options.FolderPicker.Pick(Field("title") ?? "Ordner wählen", Field("start")), ctx.RequestAborted);
            await Responses.Json(res, 200, new System.Text.Json.Nodes.JsonObject { ["path"] = chosen }.ToJsonString());
            return;
        }
        if (path == "/api/organize/folders" && method == "GET") { await Responses.Json(res, 200, options.Organize.Folders()); return; }
        if (path == "/api/organize/analyze" && method == "POST") { await Responses.Json(res, 200, await options.Organize.AnalyzeAsync(await Responses.ReadBody(req, 64 * 1024), ctx.RequestAborted)); return; }
        if (path == "/api/organize/apply" && method == "POST") { await Responses.Json(res, 200, await options.Organize.ApplyAsync(await Responses.ReadBody(req, 4 * 1024 * 1024), ctx.RequestAborted)); return; }
        if (path == "/api/organize/runs" && method == "GET") { await Responses.Json(res, 200, options.Organize.Runs()); return; }
        if (path == "/api/organize/undo" && method == "POST") { await Responses.Json(res, 200, options.Organize.Undo(await Responses.ReadBody(req, 64 * 1024))); return; }

        if (path == "/api/update/state" && method == "GET")
        {
            var text = AtomicFile.ReadText(options.Data.UpdateState);
            await Responses.Json(res, 200, text is not null && AtomicFile.IsValidJson(text) ? text : "null");
            return;
        }
        if (path == "/api/update/restart" && method == "POST")
        {
            await Responses.Json(res, 200, await options.Update.RestartToUpdateAsync(ctx.RequestAborted));
            return;
        }

        if (path == "/api/open" && method == "POST")
        {
            await OpenAsync(req, res);
            return;
        }
        if (path == "/api/shutdown" && method == "POST")
        {
            await Responses.Json(res, 200, "{\"ok\":true}");
            await res.CompleteAsync();
            options.OnShutdownRequested?.Invoke();
            return;
        }

        if (NotPorted.Contains(path))
            throw new NotSupportedException(NotYet);

        await Responses.Error(res, 404, "not found");
    }

    static async Task OpenAsync(HttpRequest req, HttpResponse res)
    {
        var id = req.Query["target"].ToString();
        if (!OpenTargets.TryGet(id, out var target))
        {
            await Responses.Error(res, 400, "unknown target");
            return;
        }
        if (Environment.GetEnvironmentVariable("LC_OPEN_DRYRUN") == "1")
        {
            // used by the automated tests: report instead of starting anything
            await Responses.Json(res, 200, JsonSerializer.Serialize(new { ok = true, dryRun = true, file = target.File, args = target.Args ?? "" }));
            return;
        }
        Process.Start(new ProcessStartInfo(target.File) { Arguments = target.Args ?? "", UseShellExecute = true });
        await Responses.Json(res, 200, "{\"ok\":true}");
    }
}
