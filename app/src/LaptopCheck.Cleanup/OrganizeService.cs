using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LaptopCheck.Core;

namespace LaptopCheck.Cleanup;

public sealed class PlanItem
{
    public string Id { get; set; } = "";
    public string Root { get; set; } = "";
    public string Rel { get; set; } = "";          // path below the root (loose files: just the name)
    public string Name { get; set; } = "";
    public bool IsDir { get; set; }
    public long Size { get; set; }
    public DateTime Modified { get; set; }         // UTC
    public int Files { get; set; }                 // for folders: number of files inside
    public string Category { get; set; } = "";
    public List<string> Tags { get; set; } = [];
    public string Zone { get; set; } = "";
    public string Target { get; set; } = "";       // proposed folder below the root; "" = stays where it is
    public string Action { get; set; } = "keep";   // move | duplicate | keep
    public string? DuplicateOf { get; set; }
}

public sealed class Plan
{
    public string Id { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public List<string> Roots { get; set; } = [];
    public List<PlanItem> Items { get; set; } = [];
    public int TotalFiles { get; set; }
    public long TotalBytes { get; set; }
    public int Duplicates { get; set; }
    public long DuplicateBytes { get; set; }
    public bool Truncated { get; set; }
}

/// <summary>
/// "Ordnen": looks at everything in the chosen folders (also deep inside sub folders, for duplicates), tags it and proposes a
/// structure: Wichtig / Aktuell / Archiv, below that the kind of file (and topic/year). Loose files are proposed to move,
/// sub folders stay together (only old ones go to Archiv\Ordner), duplicates go to _Duplikate. Nothing is overwritten and
/// nothing is deleted; only items the user marks go to the Recycle Bin (after a confirmation window). Every run can be undone.
/// </summary>
public sealed class OrganizeService(DataPaths data, IRecycleBin recycle, IConfirmation confirmation, string? userProfile = null, Func<DateTime>? now = null) : IOrganizeActions
{
    public const int MaxItems = 20000;
    public static readonly TimeSpan AnalyzeBudget = TimeSpan.FromSeconds(90);
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    static readonly string[] StructureNames = ["Aktuell", "Archiv", "Wichtig", "_Duplikate"];
    static readonly Regex Id32 = new("^[0-9a-f]{32}$", RegexOptions.Compiled);

    readonly Func<DateTime> _now = now ?? (() => DateTime.UtcNow);
    string Dir => Directory.CreateDirectory(data.Of("organize")).FullName;
    string Profile => userProfile ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    // ---------------------------------------------------------------- kinds and topics
    static readonly Dictionary<string, string> Kinds = BuildKinds(
        ("Dokumente", "pdf doc docx odt rtf txt md xls xlsx ods csv ppt pptx odp epub pages numbers key tex"),
        ("Bilder", "jpg jpeg png gif bmp webp heic heif svg tif tiff raw cr2 nef arw dng ico psd ai"),
        ("Videos", "mp4 mkv avi mov wmv webm flv m4v mpg mpeg 3gp"),
        ("Musik", "mp3 wav flac m4a ogg aac wma opus mid"),
        ("Archive", "zip rar 7z tar gz tgz bz2 xz iso img cab"),
        ("Installer", "exe msi msix appx appxbundle msixbundle apk"),
        ("Code & Daten", "json xml js ts py cs java cpp c h html css sql yml yaml ini log db sqlite ps1 sh bat cmd"));

    static Dictionary<string, string> BuildKinds(params (string Kind, string Exts)[] groups)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (kind, exts) in groups) foreach (var e in exts.Split(' ')) d[e] = kind;
        return d;
    }

    // topic, counts as important, keywords (lower case)
    static readonly (string Topic, bool Important, string[] Words)[] Topics =
    [
        ("Finanzen", true, ["rechnung", "invoice", "steuer", "tax", "bank", "kontoauszug", "quittung", "beleg", "gehalt", "lohn"]),
        ("Verträge", true, ["vertrag", "contract", "kündigung", "kuendigung", "versicherung", "police", "mietvertrag"]),
        ("Beruf", true, ["bewerbung", "lebenslauf", "zeugnis", "arbeitsvertrag"]),
        ("Persönliche Dokumente", true, ["ausweis", "geburtsurkunde", "urkunde", "führerschein", "fuehrerschein", "reisepass"]),
        ("Gesundheit", true, ["arzt", "befund", "rezept", "impf", "krankenkasse"]),
        ("Reisen", false, ["ticket", "buchung", "reise", "flug", "hotel", "boarding"]),
        ("Studium", false, ["vorlesung", "skript", "hausarbeit", "klausur", "thesis", "bachelor"]),
    ];

    public static string KindOf(string fileName) => Kinds.TryGetValue(Path.GetExtension(fileName).TrimStart('.'), out var k) ? k : "Sonstiges";

    // ---------------------------------------------------------------- folders
    public string Folders()
    {
        var p = Profile;
        (string Id, string Label, string Path)[] list =
        [
            ("downloads", "Downloads", Path.Combine(p, "Downloads")),
            ("documents", "Dokumente", userProfile is null ? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) : Path.Combine(p, "Documents")),
            ("desktop", "Desktop", userProfile is null ? Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory) : Path.Combine(p, "Desktop")),
            ("pictures", "Bilder", userProfile is null ? Environment.GetFolderPath(Environment.SpecialFolder.MyPictures) : Path.Combine(p, "Pictures")),
            ("videos", "Videos", userProfile is null ? Environment.GetFolderPath(Environment.SpecialFolder.MyVideos) : Path.Combine(p, "Videos")),
            ("music", "Musik", userProfile is null ? Environment.GetFolderPath(Environment.SpecialFolder.MyMusic) : Path.Combine(p, "Music")),
        ];
        return JsonSerializer.Serialize(list.Select(f => new { id = f.Id, label = f.Label, path = f.Path, exists = Directory.Exists(f.Path) }), Json);
    }

    /// <summary>A folder may be organised when it is a real folder of the user: not a drive root, not Windows/Program Files/ProgramData/AppData, not the whole profile, not this app's data.</summary>
    string ValidateRoot(string? root)
    {
        if (string.IsNullOrWhiteSpace(root)) throw new ArgumentException("Kein Ordner angegeben.");
        string full;
        try { full = Path.GetFullPath(root).TrimEnd('\\', '/'); }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { throw new ArgumentException("Das ist kein gültiger Ordnerpfad."); }
        if (!Directory.Exists(full)) throw new ArgumentException("Der Ordner existiert nicht: " + full);
        if (string.Equals(Path.GetPathRoot(full)?.TrimEnd('\\', '/'), full, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Ein ganzes Laufwerk wird nicht umgeordnet. Wähle einen Ordner darauf.");
        if (full.Equals(Profile.TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Der gesamte Benutzerordner wird nicht umgeordnet. Wähle einzelne Ordner (Downloads, Dokumente, ...).");
        string[] blocked =
        [
            Environment.GetFolderPath(Environment.SpecialFolder.Windows), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            Path.Combine(Profile, "AppData"), data.Dir, Path.GetDirectoryName(data.Dir) ?? data.Dir,
        ];
        if (blocked.Any(b => !string.IsNullOrEmpty(b) && PathUtil.IsUnder(full, b))) throw new ArgumentException("Dieser Ordner gehört zu Windows, zu Programmen oder zu LaptopCheck selbst und wird nicht umgeordnet.");
        return full;
    }

    // ---------------------------------------------------------------- analysis
    public Task<string> AnalyzeAsync(string requestJson, CancellationToken cancellationToken = default) => Task.Run(() =>
    {
        var req = JsonNode.Parse(requestJson) as JsonObject ?? throw new ArgumentException("Ungültige Anfrage.");
        var roots = (req["roots"] as JsonArray)?.Select(n => n?.GetValue<string>()).Where(s => !string.IsNullOrWhiteSpace(s)).Select(ValidateRoot).Distinct(StringComparer.OrdinalIgnoreCase).ToList()
            ?? throw new ArgumentException("Keine Ordner angegeben.");
        if (roots.Count == 0) throw new ArgumentException("Keine Ordner angegeben.");
        var plan = Analyze(roots, cancellationToken);
        var text = JsonSerializer.Serialize(plan, Json);
        AtomicFile.WriteText(Path.Combine(Dir, "plan-" + plan.Id + ".json"), text);
        foreach (var old in new DirectoryInfo(Dir).GetFiles("plan-*.json").OrderByDescending(f => f.LastWriteTimeUtc).Skip(5))
        {
            try { old.Delete(); } catch (IOException) { } catch (UnauthorizedAccessException) { }   // only this feature's own temporary plans
        }
        return text;
    }, cancellationToken);

    static bool Skippable(FileSystemInfo f) =>
        f.Name.StartsWith('.') || f.Name.Equals("desktop.ini", StringComparison.OrdinalIgnoreCase) || f.Name.Equals("thumbs.db", StringComparison.OrdinalIgnoreCase)
        || (f.Attributes & FileAttributes.ReparsePoint) != 0 || ((f.Attributes & FileAttributes.Hidden) != 0 && (f.Attributes & FileAttributes.System) != 0);

    sealed class Seen(string path, long size, DateTime modified, bool loose) { public string Path = path; public long Size = size; public DateTime Modified = modified; public bool Loose = loose; }

    public Plan Analyze(IReadOnlyList<string> roots, CancellationToken ct)
    {
        var now = _now();
        var watch = Stopwatch.StartNew();
        var plan = new Plan { Id = Guid.NewGuid().ToString("N"), CreatedAt = now, Roots = [.. roots] };
        var opts = new EnumerationOptions { IgnoreInaccessible = true, RecurseSubdirectories = false, AttributesToSkip = FileAttributes.ReparsePoint };
        var seen = new List<Seen>();
        var items = new List<PlanItem>();
        var n = 0;

        bool OverBudget() { if (watch.Elapsed > AnalyzeBudget || seen.Count > 300_000) { plan.Truncated = true; return true; } ct.ThrowIfCancellationRequested(); return false; }

        foreach (var root in roots)
        {
            foreach (var entry in new DirectoryInfo(root).EnumerateFileSystemInfos("*", opts))
            {
                if (OverBudget() || items.Count >= MaxItems) { plan.Truncated = true; break; }
                if (Skippable(entry)) continue;
                if (entry is FileInfo fi)
                {
                    seen.Add(new Seen(fi.FullName, fi.Length, fi.LastWriteTimeUtc, true));
                    var it = new PlanItem { Id = "i" + (++n), Root = root, Rel = fi.Name, Name = fi.Name, Size = fi.Length, Modified = fi.LastWriteTimeUtc, Category = KindOf(fi.Name) };
                    Classify(it, now);
                    items.Add(it);
                    continue;
                }
                var dir = (DirectoryInfo)entry;
                var stats = Walk(dir, seen, OverBudget, opts);
                if (StructureNames.Contains(dir.Name, StringComparer.OrdinalIgnoreCase)) continue;   // an earlier result of this feature: stays as it is
                var unit = new PlanItem { Id = "i" + (++n), Root = root, Rel = dir.Name, Name = dir.Name, IsDir = true, Size = stats.Bytes, Modified = stats.Newest, Files = stats.Files, Category = "Ordner" };
                unit.Tags.Add("Ordner");
                if (Directory.Exists(Path.Combine(dir.FullName, ".git"))) { unit.Tags.Add("Git-Projekt"); unit.Action = "keep"; unit.Zone = "Aktuell"; }
                else if (stats.Files > 0 && (now - stats.Newest).TotalDays > 365) { unit.Tags.Add("selten benutzt"); unit.Zone = "Archiv"; unit.Target = Path.Combine("Archiv", "Ordner"); unit.Action = "move"; }
                else unit.Zone = "Aktuell";
                items.Add(unit);
            }
        }

        // duplicates: same size, then same content; only loose files are ever moved
        var dupOf = FindDuplicates(seen, watch, ct);
        foreach (var it in items.Where(i => !i.IsDir))
        {
            var full = Path.Combine(it.Root, it.Rel);
            if (dupOf.TryGetValue(full, out var original))
            {
                it.Action = "duplicate"; it.Zone = "Duplikat"; it.DuplicateOf = original; it.Target = Path.Combine("_Duplikate", it.Category);
                it.Tags.Add("Duplikat");
                plan.Duplicates++; plan.DuplicateBytes += it.Size;
            }
        }
        plan.Items = items;
        plan.TotalFiles += seen.Count;
        plan.TotalBytes = seen.Sum(s => s.Size);
        return plan;
    }

    (int Files, long Bytes, DateTime Newest) Walk(DirectoryInfo dir, List<Seen> seen, Func<bool> over, EnumerationOptions opts)
    {
        var files = 0; long bytes = 0; var newest = DateTime.MinValue;
        var rec = new EnumerationOptions { IgnoreInaccessible = true, RecurseSubdirectories = true, AttributesToSkip = FileAttributes.ReparsePoint };
        foreach (var f in dir.EnumerateFiles("*", rec))
        {
            if (over()) break;
            files++; bytes += f.Length;
            if (f.LastWriteTimeUtc > newest) newest = f.LastWriteTimeUtc;
            seen.Add(new Seen(f.FullName, f.Length, f.LastWriteTimeUtc, false));
        }
        return (files, bytes, newest == DateTime.MinValue ? dir.LastWriteTimeUtc : newest);
    }

    /// <summary>loose file path -> path of the file it duplicates (the one that stays).</summary>
    static Dictionary<string, string> FindDuplicates(List<Seen> seen, Stopwatch watch, CancellationToken ct)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var hashBudgetEnds = watch.Elapsed + TimeSpan.FromSeconds(60);
        foreach (var group in seen.Where(s => s.Size > 0 && s.Size <= 2L * 1024 * 1024 * 1024).GroupBy(s => s.Size).Where(g => g.Count() > 1 && g.Any(s => s.Loose)))
        {
            if (watch.Elapsed > hashBudgetEnds) break;
            ct.ThrowIfCancellationRequested();
            var byHash = new Dictionary<string, List<Seen>>();
            foreach (var s in group)
            {
                var h = Hash(s.Path);
                if (h is null) continue;
                if (!byHash.TryGetValue(h, out var l)) byHash[h] = l = [];
                l.Add(s);
            }
            foreach (var same in byHash.Values.Where(l => l.Count > 1))
            {
                var original = same.FirstOrDefault(s => !s.Loose) ?? same.OrderBy(s => s.Modified).ThenBy(s => s.Path.Length).First();
                foreach (var dup in same.Where(s => s.Loose && s != original)) result[dup.Path] = original.Path;
            }
        }
        return result;
    }

    static string? Hash(string path)
    {
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            return Convert.ToHexString(SHA256.HashData(fs));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return null; }
    }

    /// <summary>Tags, zone and proposed folder of a loose file.</summary>
    static void Classify(PlanItem it, DateTime now)
    {
        var lower = it.Name.ToLowerInvariant();
        var age = (now - it.Modified).TotalDays;
        it.Tags.Add(it.Category);
        it.Tags.Add(it.Modified.Year.ToString());
        string? topic = null; var important = false;
        if (it.Category == "Dokumente")
        {
            foreach (var (t, imp, words) in Topics)
            {
                if (!words.Any(w => lower.Contains(w))) continue;
                topic = t; important = imp; it.Tags.Add(t); break;
            }
            if (important) it.Tags.Add("wichtig");
        }
        if (age > 365) it.Tags.Add("selten benutzt"); else if (age <= 90) it.Tags.Add("aktuell");
        if (it.Size >= 500L * 1024 * 1024) it.Tags.Add("groß");
        if (it.Size == 0) it.Tags.Add("leer");

        it.Zone = important ? "Wichtig" : age <= 90 ? "Aktuell" : "Archiv";
        var parts = new List<string> { it.Zone, it.Category };
        if (it.Category == "Dokumente") parts.Add(topic ?? "Allgemein");
        if ((it.Category is "Dokumente" or "Bilder" or "Videos") && it.Zone != "Aktuell") parts.Add(it.Modified.Year.ToString());
        it.Target = Path.Combine(parts.ToArray());
        it.Action = "move";
    }

    // ---------------------------------------------------------------- apply
    static readonly char[] Bad = Path.GetInvalidFileNameChars();

    /// <summary>Folder path below a root as the user (or the plan) wrote it: no ".." and no odd characters; null when unusable.</summary>
    internal static string? CleanTarget(string? rel)
    {
        if (string.IsNullOrWhiteSpace(rel)) return null;
        var parts = rel.Split(['\\', '/'], StringSplitOptions.RemoveEmptyEntries).Select(p => p.Trim().TrimEnd('.', ' ')).ToList();
        if (parts.Count == 0 || parts.Count > 8) return null;
        if (parts.Any(p => p.Length == 0 || p.Length > 80 || p is "." or ".." || p.IndexOfAny(Bad) >= 0)) return null;
        return Path.Combine(parts.ToArray());
    }

    static string Unique(string path, bool isDir)
    {
        bool Taken(string p) => File.Exists(p) || Directory.Exists(p);
        if (!Taken(path)) return path;
        var dir = Path.GetDirectoryName(path)!;
        var name = isDir ? Path.GetFileName(path) : Path.GetFileNameWithoutExtension(path);
        var ext = isDir ? "" : Path.GetExtension(path);
        for (var i = 2; ; i++)
        {
            var candidate = Path.Combine(dir, $"{name} ({i}){ext}");
            if (!Taken(candidate)) return candidate;
        }
    }

    Plan LoadPlan(string? id)
    {
        if (id is null || !Id32.IsMatch(id)) throw new ArgumentException("Unbekannter Plan.");
        var file = Path.Combine(Dir, "plan-" + id + ".json");
        if (!File.Exists(file)) throw new ArgumentException("Der Plan ist nicht mehr vorhanden. Bitte neu analysieren.");
        return JsonSerializer.Deserialize<Plan>(AtomicFile.ReadText(file)!, Json) ?? throw new ArgumentException("Der Plan ist beschädigt. Bitte neu analysieren.");
    }

    /// <summary>The item still is what the plan saw (same size and time); nothing is touched otherwise.</summary>
    static bool Unchanged(PlanItem it, string full)
    {
        if (it.IsDir) return Directory.Exists(full) && !Directory.Exists(Path.Combine(full, ".git"));
        var fi = new FileInfo(full);
        return fi.Exists && fi.Length == it.Size && Math.Abs((fi.LastWriteTimeUtc - it.Modified).TotalSeconds) < 2;
    }

    public async Task<string> ApplyAsync(string requestJson, CancellationToken cancellationToken = default)
    {
        var req = JsonNode.Parse(requestJson) as JsonObject ?? throw new ArgumentException("Ungültige Anfrage.");
        var plan = LoadPlan(req["planId"]?.GetValue<string>());
        var roots = plan.Roots.Select(ValidateRoot).ToList();   // re-checked now, not trusted from the file
        var skip = new HashSet<string>((req["skipIds"] as JsonArray)?.Select(n => n?.GetValue<string>() ?? "") ?? []);
        var del = new HashSet<string>((req["deleteIds"] as JsonArray)?.Select(n => n?.GetValue<string>() ?? "") ?? []);
        var map = new Dictionary<string, string?>();
        if (req["folderMap"] is JsonObject fm) foreach (var kv in fm) map[kv.Key] = kv.Value is null ? null : kv.Value.GetValue<string>();

        var errors = new List<object>();
        var runId = Guid.NewGuid().ToString("N");
        var moves = new List<object>();
        var createdDirs = new List<string>();
        int moved = 0, skipped = 0, deleted = 0;
        var deleteDeclined = false;

        // 1. marked for deletion -> Recycle Bin, after a confirmation window of its own
        var toDelete = new List<(PlanItem Item, string Full)>();
        foreach (var it in plan.Items.Where(i => del.Contains(i.Id)))
        {
            var full = Path.GetFullPath(Path.Combine(it.Root, it.Rel));
            if (!roots.Contains(it.Root, StringComparer.OrdinalIgnoreCase) || !PathUtil.IsUnder(full, it.Root) || full.Equals(it.Root, StringComparison.OrdinalIgnoreCase)) { errors.Add(new { name = it.Name, message = "Nicht erlaubt." }); continue; }
            if (!Unchanged(it, full)) { errors.Add(new { name = it.Name, message = "Hat sich seit der Analyse geändert oder fehlt." }); continue; }
            toDelete.Add((it, full));
        }
        if (toDelete.Count > 0)
        {
            var lines = toDelete.Take(15).Select(d => (d.Item.IsDir ? "Ordner: " : "Datei: ") + d.Item.Name).ToList();
            if (toDelete.Count > 15) lines.Add("… und " + (toDelete.Count - 15) + " weitere");
            lines.Add("Alles geht in den Papierkorb und kann dort wiederhergestellt werden.");
            var ok = await confirmation.ConfirmAsync(new ConfirmationRequest("LaptopCheck: Ordnen", toDelete.Count + " Element(e) in den Papierkorb legen?", lines, null, ConfirmationRequest.RemoveWord), cancellationToken);
            if (!ok) deleteDeclined = true;
            else foreach (var (it, full) in toDelete)
            {
                try { recycle.Recycle(full, it.IsDir); deleted++; }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException) { errors.Add(new { name = it.Name, message = ex.Message }); }
            }
        }

        // 2. moves: never overwrite, never leave the root, never delete
        foreach (var it in plan.Items)
        {
            if (it.Action is not ("move" or "duplicate") || del.Contains(it.Id)) continue;
            if (skip.Contains(it.Id)) { skipped++; continue; }
            var target = it.Target;
            if (map.TryGetValue(it.Root + "|" + it.Target, out var mapped)) target = mapped ?? "";
            var clean = CleanTarget(target);
            if (clean is null) { skipped++; continue; }
            var full = Path.GetFullPath(Path.Combine(it.Root, it.Rel));
            if (!roots.Contains(it.Root, StringComparer.OrdinalIgnoreCase) || !PathUtil.IsUnder(full, it.Root) || full.Equals(it.Root, StringComparison.OrdinalIgnoreCase)) { errors.Add(new { name = it.Name, message = "Nicht erlaubt." }); continue; }
            var targetDir = Path.GetFullPath(Path.Combine(it.Root, clean));
            if (!PathUtil.IsUnder(targetDir, it.Root) || targetDir.Equals(it.Root, StringComparison.OrdinalIgnoreCase)) { errors.Add(new { name = it.Name, message = "Zielordner nicht erlaubt." }); continue; }
            if (it.IsDir && PathUtil.IsUnder(targetDir, full)) { errors.Add(new { name = it.Name, message = "Ein Ordner kann nicht in sich selbst verschoben werden." }); continue; }
            if (!Unchanged(it, full)) { errors.Add(new { name = it.Name, message = "Hat sich seit der Analyse geändert oder fehlt." }); continue; }
            if (string.Equals(Path.GetDirectoryName(full), targetDir, StringComparison.OrdinalIgnoreCase)) { skipped++; continue; }
            try
            {
                for (var d = targetDir; !Directory.Exists(d) && PathUtil.IsUnder(d, it.Root); d = Path.GetDirectoryName(d)!) createdDirs.Add(d);
                Directory.CreateDirectory(targetDir);
                var dest = Unique(Path.Combine(targetDir, it.Name), it.IsDir);
                if (it.IsDir) Directory.Move(full, dest); else File.Move(full, dest);
                moves.Add(new { from = full, to = dest, isDir = it.IsDir });
                moved++;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { errors.Add(new { name = it.Name, message = ex.Message }); }
        }

        var run = new { id = runId, at = _now(), planId = plan.Id, moves, createdDirs = createdDirs.Distinct().ToList(), deleted, undoneAt = (DateTime?)null };
        AtomicFile.WriteText(Path.Combine(Dir, "run-" + runId + ".json"), JsonSerializer.Serialize(run, Json));
        return JsonSerializer.Serialize(new { runId, moved, skipped, deleted, deleteDeclined, errors }, Json);
    }

    // ---------------------------------------------------------------- runs and undo
    public string Runs()
    {
        var list = new DirectoryInfo(Dir).GetFiles("run-*.json").OrderByDescending(f => f.LastWriteTimeUtc).Take(20).Select<FileInfo, object?>(f =>
        {
            try
            {
                var o = JsonNode.Parse(AtomicFile.ReadText(f.FullName)!)!.AsObject();
                return new { id = o["id"]?.GetValue<string>(), at = o["at"]?.GetValue<DateTime>(), moved = (o["moves"] as JsonArray)?.Count ?? 0, deleted = o["deleted"]?.GetValue<int>() ?? 0, undone = o["undoneAt"] is not null };
            }
            catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException) { return null; }
        }).Where(x => x is not null);
        return JsonSerializer.Serialize(list, Json);
    }

    public string Undo(string requestJson)
    {
        var id = (JsonNode.Parse(requestJson) as JsonObject)?["runId"]?.GetValue<string>();
        if (id is null || !Id32.IsMatch(id)) throw new ArgumentException("Unbekannter Durchlauf.");
        var file = Path.Combine(Dir, "run-" + id + ".json");
        if (!File.Exists(file)) throw new ArgumentException("Diesen Durchlauf gibt es nicht.");
        var run = JsonNode.Parse(AtomicFile.ReadText(file)!)!.AsObject();
        if (run["undoneAt"] is not null) throw new ArgumentException("Dieser Durchlauf wurde schon rückgängig gemacht.");
        int restored = 0, skipped = 0;
        foreach (var m in (run["moves"] as JsonArray ?? []).Reverse())
        {
            var from = m!["from"]!.GetValue<string>(); var to = m["to"]!.GetValue<string>(); var isDir = m["isDir"]?.GetValue<bool>() ?? false;
            try
            {
                if ((isDir ? !Directory.Exists(to) : !File.Exists(to)) || File.Exists(from) || Directory.Exists(from)) { skipped++; continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(from)!);
                if (isDir) Directory.Move(to, from); else File.Move(to, from);
                restored++;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { skipped++; }
        }
        // folders this run created are removed again, but only while they are empty
        foreach (var d in (run["createdDirs"] as JsonArray ?? []).Select(n => n!.GetValue<string>()).OrderByDescending(s => s.Length))
        {
            try { if (Directory.Exists(d) && !Directory.EnumerateFileSystemEntries(d).Any()) Directory.Delete(d, false); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
        run["undoneAt"] = _now();
        AtomicFile.WriteText(file, run.ToJsonString());
        return JsonSerializer.Serialize(new { restored, skipped }, Json);
    }
}
