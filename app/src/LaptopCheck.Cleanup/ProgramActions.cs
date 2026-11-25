using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LaptopCheck.Core;
using LaptopCheck.Scan;
using LaptopCheck.Scan.Files;
using LaptopCheck.Scan.Sections;

namespace LaptopCheck.Cleanup;

/// <summary>Splits the UninstallString of the registry (what Windows runs for "Uninstall" in Settings) into program and arguments.</summary>
internal static partial class UninstallCommand
{
    // MSI: "MsiExec.exe /I{GUID}" is the "modify" entry - the uninstall switch is /X
    [GeneratedRegex(@"^""?(?:[A-Za-z]:\\[^""]*\\)?msiexec(?:\.exe)?""?\s+/[IiXx]\s*(\{[0-9A-Fa-f-]{36}\})\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex Msi();

    [GeneratedRegex(@"^""([^""]+)""\s*(.*)$")]
    private static partial Regex Quoted();

    [GeneratedRegex(@"^((?:[A-Za-z]:|%[A-Za-z0-9_()]+%)[^""]*?\.exe)(?:\s+(.*))?$", RegexOptions.IgnoreCase)]
    private static partial Regex Unquoted();

    /// <summary>Command shells and script hosts are never accepted as an "uninstaller".</summary>
    static readonly HashSet<string> Interpreters = new(StringComparer.OrdinalIgnoreCase)
    {
        "cmd.exe", "powershell.exe", "pwsh.exe", "wscript.exe", "cscript.exe", "mshta.exe", "regsvr32.exe", "bash.exe", "wsl.exe",
    };

    public static (string File, string Args)? Parse(string? command)
    {
        var s = (command ?? "").Trim();
        if (s.Length == 0) return null;
        var msi = Msi().Match(s);
        if (msi.Success) return ("msiexec.exe", "/x " + msi.Groups[1].Value);

        string file, argsText;
        var q = Quoted().Match(s);
        if (q.Success) { file = q.Groups[1].Value; argsText = q.Groups[2].Value; }
        else
        {
            var u = Unquoted().Match(s);
            if (!u.Success) return null;
            file = u.Groups[1].Value;
            argsText = u.Groups[2].Value;
        }
        file = Environment.ExpandEnvironmentVariables(file);
        var leaf = Path.GetFileName(file.Replace('\\', '/'));
        if (Interpreters.Contains(leaf)) return null;
        return (file, argsText.Trim());
    }
}

internal static partial class ProgramActions
{
    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._+-]{1,100}$")]
    private static partial Regex PackageId();

    [GeneratedRegex(@"^reg:(HKLM|HKCU):(x64|x86):(.+)$")]
    private static partial Regex RegId();

    static bool Dry => Environment.GetEnvironmentVariable("LC_OPEN_DRYRUN") == "1";

    // ------------------------------------------------------------------ the saved confirmations (data\cleanup.json)

    /// <summary>The page only records WHAT the user confirmed; nothing is executed from what the page sends. The item is looked up here.</summary>
    public static JsonObject? CleanupItem(CleanupContext c, string id)
    {
        var doc = JsonNode.Parse(c.Stores.Read("cleanup")) as JsonObject;
        return (doc?["items"] as JsonObject)?[id] as JsonObject;
    }

    // ------------------------------------------------------------------ uninstall

    public static string Uninstall(CleanupContext c, string requestJson)
    {
        var id = Jobs.Str(Jobs.ParseObject(requestJson)["id"]);
        var it = CleanupItem(c, id) ?? throw new ArgumentException("Unknown item.");
        if (Jobs.Str(it["type"]) != "app") throw new ArgumentException("Not a program item.");
        if (Jobs.Str(it["state"]) != "confirmed") throw new ArgumentException("Not confirmed yet.");
        var rawId = Jobs.Str(it["rawId"]);
        if (!rawId.StartsWith("reg:", StringComparison.Ordinal))
            throw new ArgumentException("This program has no classic uninstaller (Store app): remove it in Windows Settings > Apps.");

        var indexText = AtomicFile.ReadText(c.Data.UninstallIndex) ?? throw new ArgumentException("No scan data - run a scan first.");
        var entry = (JsonNode.Parse(indexText) as JsonArray ?? []).OfType<JsonObject>().FirstOrDefault(e => Jobs.Str(e["id"]) == rawId)
                    ?? throw new ArgumentException("Program not found in the last scan - scan again.");
        var cmd = UninstallCommand.Parse(Jobs.Str(entry["uninstallString"]))
                  ?? throw new ArgumentException("The uninstall command of this program is empty or not supported. Use Windows Settings > Apps.");
        if (!Dry && cmd.File != "msiexec.exe" && !File.Exists(cmd.File)) throw new ArgumentException("Uninstaller not found: " + cmd.File);

        var name = Jobs.Str(entry["name"]);
        Jobs.Log(c, new JsonObject { ["action"] = "uninstall", ["id"] = id, ["rawId"] = rawId, ["name"] = name, ["file"] = cmd.File, ["args"] = cmd.Args });
        if (Dry) return new JsonObject { ["dryRun"] = true, ["file"] = cmd.File, ["args"] = cmd.Args, ["name"] = name }.ToJsonString(Jobs.Compact);
        // the interactive uninstaller (never the "quiet" variant): the program's own dialog still asks once more
        c.Launcher.Start(cmd.File, cmd.Args);
        return new JsonObject { ["dryRun"] = false, ["name"] = name }.ToJsonString(Jobs.Compact);
    }

    // ------------------------------------------------------------------ winget updates

    /// <summary>
    /// "Update now" runs winget in its own visible window. Only package ids that the last scan reported are accepted
    /// (data\winget-index.json) and the command line is built from a strict pattern, never from free text.
    /// </summary>
    public static string WingetUpgrade(CleanupContext c, string requestJson)
    {
        var req = Jobs.ParseObject(requestJson);
        var known = new List<string>();
        var indexText = AtomicFile.ReadText(c.Data.WingetIndex);
        if (!string.IsNullOrEmpty(indexText))
        {
            try { known = (JsonNode.Parse(indexText) as JsonArray ?? []).OfType<JsonObject>().Select(e => Jobs.Str(e["id"])).ToList(); }
            catch (System.Text.Json.JsonException) { }
        }
        var all = req["all"] is JsonValue av && av.TryGetValue<bool>(out var b) && b;
        var ids = (req["ids"] as JsonArray ?? []).Select(Jobs.Str).Where(s => s.Length > 0).ToList();
        if (!all && ids.Count == 0) throw new ArgumentException("Nothing selected.");
        if (known.Count == 0) throw new ArgumentException("No updates known from the last scan - scan again first.");

        const string agree = " --accept-source-agreements --accept-package-agreements";
        var commands = new List<string>();
        if (all) commands.Add("winget upgrade --all" + agree);
        else
        {
            if (ids.Count > 60) throw new ArgumentException("Too many programs at once (max 60).");
            foreach (var id in ids)
            {
                if (!PackageId().IsMatch(id)) throw new ArgumentException("Invalid package id: " + id);
                if (!known.Contains(id, StringComparer.Ordinal)) throw new ArgumentException("Not an update reported by the last scan: " + id);
                commands.Add($"winget upgrade --id {id} -e" + agree);
            }
        }
        // a window of its own that stays open when winget is done (cmd /k); the ids passed the strict pattern above (no shell characters)
        var args = "/k \"" + string.Join(" & ", commands) + "\"";
        Jobs.Log(c, new JsonObject { ["action"] = "winget-upgrade", ["all"] = all, ["ids"] = new JsonArray(ids.Select(i => (JsonNode?)JsonValue.Create(i)).ToArray()) });
        if (Dry) return new JsonObject { ["dryRun"] = true, ["file"] = "cmd.exe", ["args"] = args }.ToJsonString(Jobs.Compact);
        c.Launcher.Start("cmd.exe", args);
        return "{\"dryRun\":false}";
    }

    // ------------------------------------------------------------------ re-check a program (the "Prüfen" page)

    /// <summary>
    /// Reads the program's entry in the Windows program list again and measures its install folder, so a suspicious number (a driver
    /// that claims 62 GB) can be checked on the spot. Read-only.
    /// </summary>
    public static string CheckApp(CleanupContext c, string requestJson)
    {
        var id = Jobs.Str(Jobs.ParseObject(requestJson)["id"]);
        var m = RegId().Match(id);
        if (!m.Success) throw new ArgumentException("Only programs from the Windows program list can be re-measured.");
        var hive = m.Groups[1].Value == "HKLM" ? RegHive.LocalMachine : RegHive.CurrentUser;
        var arch = m.Groups[2].Value;
        var name = m.Groups[3].Value;
        var sub = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
        var view = RegView.Registry64;
        if (arch == "x86")
        {
            if (hive == RegHive.LocalMachine) view = RegView.Registry32;
            else sub = @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";
        }
        using var rk = c.Registry.Open(hive, sub, view) ?? throw new ArgumentException("The program list could not be read.");
        using var k = rk.OpenSubKey(name) ?? throw new ArgumentException("This program is no longer in the Windows program list.");

        var loc = Val.Clean(k.GetValue("InstallLocation"));
        var result = new JsonObject
        {
            ["checkedAt"] = c.Stamp(),
            ["registryEstimatedSizeKB"] = Val.LongOrNull(k.GetValue("EstimatedSize")),
            ["displayVersion"] = Val.Clean(k.GetValue("DisplayVersion")),
            ["installLocation"] = loc,
            ["measurable"] = false, ["folderBytes"] = null, ["folderPartial"] = false,
        };
        if (loc is not null && SoftwareSections.IsMeasurableInstallFolder(loc))
        {
            var (bytes, partial) = FileScanner.DirSize(loc.Trim('"').TrimEnd('\\'), 15);
            result["measurable"] = true;
            result["folderBytes"] = bytes;
            result["folderPartial"] = partial;
        }
        return result.ToJsonString(Jobs.Compact);
    }

    // ------------------------------------------------------------------ show in Explorer

    /// <summary>Highlights a file or folder in Explorer. Uses /select, so nothing is ever executed, even if the path is a program.</summary>
    public static string Reveal(CleanupContext c, string requestJson)
    {
        var path = Jobs.Str(Jobs.ParseObject(requestJson)["path"]);
        if (path.Length == 0 || Jobs.ParentSegment().IsMatch(path)) throw new ArgumentException("Invalid path.");
        string full;
        try { full = Jobs.Full(path); }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { throw new ArgumentException("Invalid path."); }

        var roots = RemovableRoots(c).Concat([c.Env.ProgramFiles, c.Env.ProgramFilesX86]).Concat(CloudRoots(c)).Where(r => !string.IsNullOrEmpty(r));
        if (!roots.Any(r => PathUtil.IsUnder(full, r))) throw new ArgumentException("This place cannot be shown from here.");
        if (!Directory.Exists(full) && !File.Exists(full)) throw new ArgumentException("The path does not exist (any more).");
        var args = $"/select,\"{full}\"";
        if (Dry) return new JsonObject { ["dryRun"] = true, ["file"] = "explorer.exe", ["args"] = args }.ToJsonString(Jobs.Compact);
        c.Launcher.Start("explorer.exe", args);
        return "{\"dryRun\":false}";
    }

    // ------------------------------------------------------------------ roots

    /// <summary>Where removals are allowed at all: the user's profile, ProgramData and the folders the user configured.</summary>
    public static List<string> RemovableRoots(CleanupContext c)
    {
        var roots = new List<string>();
        if (!string.IsNullOrEmpty(c.Env.UserProfile)) roots.Add(c.Env.UserProfile);
        if (!string.IsNullOrEmpty(c.Env.ProgramData)) roots.Add(c.Env.ProgramData);
        roots.AddRange(c.Config.ExtraRoots);
        return roots.Where(r => r.Length > 0).ToList();
    }

    /// <summary>Sources of a move: the user's profile and the configured folders (not ProgramData).</summary>
    public static List<string> MoveSourceRoots(CleanupContext c)
    {
        var roots = new List<string>();
        if (!string.IsNullOrEmpty(c.Env.UserProfile)) roots.Add(c.Env.UserProfile);
        roots.AddRange(c.Config.ExtraRoots);
        return roots.Where(r => r.Length > 0).ToList();
    }

    public static List<CloudProviders.Provider> Providers(CleanupContext c) =>
        CloudProviders.Detect(c.Env, c.Probe, c.Config.ExtraCloudRoots);

    public static List<string> CloudRoots(CleanupContext c) => Providers(c).Select(p => p.Root).ToList();
}
