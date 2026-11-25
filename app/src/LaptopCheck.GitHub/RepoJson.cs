using System.Text.Json.Nodes;

namespace LaptopCheck.GitHub;

/// <summary>Turns GitHub answers (REST API or "gh repo list --json") into the repository entries the dashboard stores in repos.json.</summary>
internal static class RepoJson
{
    static string Text(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";

    static bool Flag(JsonNode? n) => n is JsonValue v && v.TryGetValue<bool>(out var b) && b;

    static JsonNode? Copy(JsonNode? n) => n?.DeepClone();

    static JsonArray Topics(JsonNode? n) => new(((n as JsonArray) ?? []).Select(t => (JsonNode?)JsonValue.Create(Text(t))).ToArray());

    /// <summary>One element of the REST API list (/user/repos, /users/{name}/repos).</summary>
    public static JsonObject FromRest(JsonObject r, string source) => new()
    {
        ["fullName"] = Text(r["full_name"]), ["name"] = Text(r["name"]), ["owner"] = Text(r["owner"]?["login"]), ["private"] = Flag(r["private"]),
        ["description"] = Copy(r["description"]), ["language"] = Copy(r["language"]), ["topics"] = Topics(r["topics"]), ["url"] = Text(r["html_url"]),
        ["pushedAt"] = Copy(r["pushed_at"]), ["createdAt"] = Copy(r["created_at"]), ["sizeKB"] = Copy(r["size"]), ["fork"] = Flag(r["fork"]), ["archived"] = Flag(r["archived"]),
        ["stars"] = Copy(r["stargazers_count"]), ["homepage"] = Copy(r["homepage"]), ["defaultBranch"] = Copy(r["default_branch"]),
        ["openIssues"] = Copy(r["open_issues_count"]), ["source"] = source,
    };

    /// <summary>One element of "gh repo list --json name,owner,isPrivate,...".</summary>
    public static JsonObject FromGh(JsonObject r)
    {
        var lang = Text(r["primaryLanguage"]?["name"]);
        var topics = new JsonArray();
        if (r["repositoryTopics"] is JsonArray list)
        {
            foreach (var t in list)
            {
                var name = Text(t?["name"]);
                if (name.Length == 0) name = Text(t?["topic"]?["name"]);
                if (name.Length > 0) topics.Add(name);
            }
        }
        var owner = Text(r["owner"]?["login"]);
        return new JsonObject
        {
            ["fullName"] = owner + "/" + Text(r["name"]), ["name"] = Text(r["name"]), ["owner"] = owner, ["private"] = Flag(r["isPrivate"]),
            ["description"] = Copy(r["description"]), ["language"] = lang.Length > 0 ? lang : null, ["topics"] = topics, ["url"] = Text(r["url"]),
            ["pushedAt"] = Copy(r["pushedAt"]), ["createdAt"] = Copy(r["createdAt"]), ["sizeKB"] = Copy(r["diskUsage"]), ["fork"] = Flag(r["isFork"]), ["archived"] = Flag(r["isArchived"]),
            ["stars"] = null, ["homepage"] = null, ["defaultBranch"] = null, ["openIssues"] = null, ["source"] = "gh",
        };
    }

    public static string FullName(JsonNode? repo) => Text(repo?["fullName"]);
}
