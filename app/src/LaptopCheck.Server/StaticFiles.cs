using System.Text;
using Microsoft.AspNetCore.Http;

namespace LaptopCheck.Server;

/// <summary>Serves the dashboard (web/). Only known file types, nothing outside the web folder.</summary>
internal sealed class StaticFiles(string webRoot, string token)
{
    const string Csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; " +
                       "frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

    readonly string _root = Path.GetFullPath(webRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;

    static string? MimeOf(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".ico" => "image/x-icon",
        _ => null,
    };

    public async Task HandleAsync(HttpContext ctx, string path)
    {
        var res = ctx.Response;
        if (ctx.Request.Method != "GET")
        {
            await Responses.Text(res, 405, "Method not allowed");
            return;
        }

        var rel = Uri.UnescapeDataString(path).TrimStart('/');
        if (rel.Length == 0) rel = "index.html";
        var full = Path.GetFullPath(Path.Combine(_root, rel));
        var mime = MimeOf(full);
        if (!full.StartsWith(_root, StringComparison.OrdinalIgnoreCase) || mime is null || !File.Exists(full))
        {
            await Responses.Text(res, 404, "Not found");
            return;
        }

        res.Headers.ContentSecurityPolicy = Csp;
        if (string.Equals(Path.GetFileName(full), "index.html", StringComparison.OrdinalIgnoreCase))
        {
            var html = (await File.ReadAllTextAsync(full, Encoding.UTF8)).Replace("__LC_TOKEN__", token);
            await Responses.Text(res, 200, html, mime);
            return;
        }
        await Responses.Bytes(res, 200, mime, await File.ReadAllBytesAsync(full));
    }
}
