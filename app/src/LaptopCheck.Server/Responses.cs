using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;

namespace LaptopCheck.Server;

internal static class Responses
{
    public const string JsonType = "application/json; charset=utf-8";
    const string TextType = "text/plain; charset=utf-8";

    public static Task Text(HttpResponse res, int status, string text, string type = TextType) =>
        Bytes(res, status, type, Encoding.UTF8.GetBytes(text));

    public static Task Json(HttpResponse res, int status, string json) => Text(res, status, json, JsonType);

    public static Task Error(HttpResponse res, int status, string message) =>
        Json(res, status, JsonSerializer.Serialize(new { error = message }));

    public static async Task Bytes(HttpResponse res, int status, string type, byte[] bytes)
    {
        res.StatusCode = status;
        res.ContentType = type;
        res.ContentLength = bytes.Length;
        await res.Body.WriteAsync(bytes);
    }

    public static bool TokenMatches(string given, string expected) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(given), Encoding.UTF8.GetBytes(expected));

    /// <exception cref="ArgumentException">The body is larger than <paramref name="maxBytes"/>.</exception>
    public static async Task<string> ReadBody(HttpRequest req, int maxBytes)
    {
        using var ms = new MemoryStream();
        var buffer = new byte[81920];
        int n;
        while ((n = await req.Body.ReadAsync(buffer)) > 0)
        {
            ms.Write(buffer, 0, n);
            if (ms.Length > maxBytes) throw new BodyTooLargeException();
        }
        return Encoding.UTF8.GetString(ms.ToArray());
    }
}

internal sealed class BodyTooLargeException : Exception;
