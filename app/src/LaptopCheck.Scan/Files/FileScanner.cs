using System.Diagnostics;
using LaptopCheck.Scan.Sections;

namespace LaptopCheck.Scan.Files;

public sealed class ExtStat
{
    public long Files;
    public long Bytes;
    public long Newest;
    public long CloudFiles;
    public Dictionary<string, int> Dirs = [];
}

public sealed class FolderAgg
{
    public FolderAgg(string path, int depth)
    {
        Path = path;
        Depth = depth;
        OldestTicks = long.MaxValue;
    }

    public string Path { get; }
    public int Depth { get; }
    public long Files;
    public long Bytes;
    public long OnlineFiles;
    public long OnlineBytes;
    public long MatchFiles;
    public long MatchBytes;
    public long NewestTicks;
    public long OldestTicks;
    public long[] CatFiles = new long[FileScanner.CatCount];
    public long[] CatBytes = new long[FileScanner.CatCount];
}

public sealed class FileRec
{
    public required string Path { get; init; }
    public long Size { get; init; }
    public long Ticks { get; init; }
    public int Cat { get; init; }
    public string? CloudPath { get; init; }
}

public sealed class Dupe
{
    public required string Name { get; init; }
    public long Size { get; init; }
    public int Count;
    public bool InCloud;
    public bool InLocal;
    public List<string> Paths { get; } = [];
}

public sealed class RootResult
{
    public required string Path { get; init; }
    public required string Label { get; init; }
    public required string Kind { get; init; }
    public string? Provider { get; init; }
    public long Files;
    public long Bytes;
    public long OnlineBytes;
    public bool Partial;
    public double Seconds;
    public long RootFiles;
    public int MaxDepth;
    public long EmptyDirs;
    public long NativeDocs;
    public List<FolderAgg> Folders { get; } = [];
    public Dictionary<string, int> NameIssueCounts { get; } = [];
    public List<string> NameIssueSamples { get; } = [];
    public List<string> TopFolders { get; } = [];
}

/// <summary>
/// The directory walker of the files scan: per folder statistics, file types, documents, big files, duplicates and the
/// name+size index that tells which local files also exist in the cloud. Tolerant to access-denied errors, time-boxed per root.
/// Cloud roots must be scanned first (they feed the match index).
/// </summary>
public sealed class FileScanner(long bigThreshold, int dupeMinSize, int maxDocs, int maxKeys)
{
    public const int CatCount = 12;
    const int CatPdf = 3;
    const int CatOther = 11;

    public static readonly string[] CatNames =
        ["documents", "spreadsheets", "presentations", "pdf", "images", "video", "audio", "archives", "installers", "code", "data", "other"];

    static readonly Dictionary<string, int> ExtCat = BuildExt();

    static Dictionary<string, int> BuildExt()
    {
        var d = new Dictionary<string, int>(StringComparer.Ordinal);
        void Put(int cat, string list)
        {
            foreach (var e in list.Split(' ', StringSplitOptions.RemoveEmptyEntries)) d["." + e] = cat;
        }
        Put(0, "doc docx dot dotx odt rtf txt md pages wpd gdoc tex");
        Put(1, "xls xlsx xlsm xlsb ods csv numbers gsheet");
        Put(2, "ppt pptx pps ppsx odp key gslides");
        Put(3, "pdf");
        Put(4, "jpg jpeg png gif bmp webp heic heif tif tiff svg raw cr2 cr3 nef arw dng psd ai xcf ico");
        Put(5, "mp4 mkv avi mov wmv webm flv m4v mpg mpeg 3gp mts");
        Put(6, "mp3 wav flac m4a aac ogg wma opus mid");
        Put(7, "zip rar 7z tar gz tgz bz2 xz iso img vhd vhdx");
        Put(8, "exe msi msix appx appxbundle msixbundle dmg pkg apk");
        Put(9, "js ts jsx tsx py cs java c cpp h hpp html htm css scss json xml yml yaml ps1 psm1 sh bat cmd php rb go rs sql ipynb vue");
        Put(10, "db sqlite sqlite3 mdb accdb dat bak log");
        return d;
    }

    static readonly string[] Native = [".gdoc", ".gsheet", ".gslides", ".gform", ".gdraw", ".gmap", ".gsite", ".gjam", ".gscript"];

    static readonly string[] IssueWords =
        ["unbenannt", "untitled", "neuer ordner", "new folder", "kopie von", "copy of", " - kopie", " - copy", "neues dokument", "new document"];

    readonly Dictionary<string, Dupe> _dupes = [];
    readonly Dictionary<string, ExtStat> _exts = [];
    readonly Dictionary<string, string> _cloudKeys = [];

    public List<FileRec> Docs { get; } = [];
    public List<FileRec> Big { get; } = [];

    public static int CategoryOf(string? ext) => ext is not null && ExtCat.TryGetValue(ext, out var c) ? c : CatOther;

    static bool IsNativeDoc(string ext) => Array.IndexOf(Native, ext) >= 0;

    /// <summary>Why a name looks like leftover mess ("Unbenannt", "Kopie von", "foo (1)"), or null.</summary>
    internal static string? IssueOf(string name)
    {
        var lower = name.ToLowerInvariant();
        foreach (var w in IssueWords)
        {
            if (lower.Contains(w, StringComparison.Ordinal)) return w;
        }
        var dot = lower.LastIndexOf('.');
        var stem = dot > 0 ? lower[..dot] : lower;
        if (stem.Length > 4 && stem.EndsWith(')'))
        {
            var open = stem.LastIndexOf(" (", StringComparison.Ordinal);
            if (open > 0 && stem.Length - open <= 6) return "numbered copy (1)";
        }
        return null;
    }

    static void NoteIssue(RootResult res, string issue, string path)
    {
        res.NameIssueCounts[issue] = res.NameIssueCounts.GetValueOrDefault(issue) + 1;
        if (res.NameIssueSamples.Count < 40) res.NameIssueSamples.Add(path);
    }

    /// <summary>Per file extension: how many files, how much space, newest file, and the folders holding most of them.</summary>
    void NoteExt(string ext, long len, long ticks, bool isCloud, string dir)
    {
        if (ext.Length < 2 || ext.Length > 12) return;
        if (!_exts.TryGetValue(ext, out var s))
        {
            if (_exts.Count >= 5000) return;
            s = new ExtStat();
            _exts[ext] = s;
        }
        if (isCloud) { s.CloudFiles++; return; }
        s.Files++;
        s.Bytes += len;
        if (ticks > s.Newest) s.Newest = ticks;
        if (s.Dirs.TryGetValue(dir, out var n)) s.Dirs[dir] = n + 1;
        else if (s.Dirs.Count < 200) s.Dirs[dir] = 1;
    }

    public List<KeyValuePair<string, ExtStat>> TopExts(int max) =>
        _exts.OrderByDescending(kv => kv.Value.Bytes).Take(max).ToList();

    sealed class Frame
    {
        public required string Dir;
        public int Depth;
        public FolderAgg? A1;
        public FolderAgg? A2;
    }

    static void Merge(FolderAgg? a, long n, long b, long on, long onb, long mf, long mb, long newest, long oldest, long[] cf, long[] cb)
    {
        if (a is null || n == 0) return;
        a.Files += n; a.Bytes += b; a.OnlineFiles += on; a.OnlineBytes += onb; a.MatchFiles += mf; a.MatchBytes += mb;
        if (newest > a.NewestTicks) a.NewestTicks = newest;
        if (oldest < a.OldestTicks) a.OldestTicks = oldest;
        for (var i = 0; i < CatCount; i++) { a.CatFiles[i] += cf[i]; a.CatBytes[i] += cb[i]; }
    }

    /// <summary>Walks one root. kind = "local" or "cloud".</summary>
    public RootResult ScanRoot(string root, string label, string kind, string? provider, int maxSeconds)
    {
        var res = new RootResult { Path = root, Label = label, Kind = kind, Provider = provider };
        var sw = Stopwatch.StartNew();
        var isCloud = kind == "cloud";
        var rootAgg = new FolderAgg(root, 0);
        res.Folders.Add(rootAgg);
        var stack = new Stack<Frame>();
        stack.Push(new Frame { Dir = root, Depth = 0 });

        while (stack.Count > 0)
        {
            if (sw.Elapsed.TotalSeconds > maxSeconds) { res.Partial = true; break; }
            var f = stack.Pop();
            if (f.Depth > res.MaxDepth) res.MaxDepth = f.Depth;
            DirectoryInfo di;
            try { di = new DirectoryInfo(f.Dir); }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { continue; }

            long n = 0, b = 0, on = 0, onb = 0, mf = 0, mb = 0, newest = 0, oldest = long.MaxValue;
            var cf = new long[CatCount];
            var cb = new long[CatCount];
            var childDirs = 0;

            try
            {
                foreach (var fi in di.EnumerateFiles())
                {
                    var name = fi.Name;
                    if (name is "desktop.ini" or "Thumbs.db" or ".DS_Store") continue;
                    long len;
                    try { len = fi.Length; } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { continue; }
                    var ticks = fi.LastWriteTimeUtc.Ticks;
                    var attr = (int)fi.Attributes;
                    var online = (attr & 0x400000) != 0 || (attr & 0x1000) != 0 || (attr & 0x40000) != 0;   // cloud placeholders: content not on this PC
                    var ext = fi.Extension.ToLowerInvariant();
                    var cat = CategoryOf(ext);
                    n++; b += len;
                    if (online) { on++; onb += len; }
                    if (ticks > newest) newest = ticks;
                    if (ticks < oldest) oldest = ticks;
                    cf[cat]++; cb[cat] += len;
                    NoteExt(ext, len, ticks, isCloud, f.Dir);
                    if (f.Depth == 0) res.RootFiles++;
                    if (IsNativeDoc(ext)) res.NativeDocs++;

                    string? key = null;
                    if (len >= 1024 || isCloud) key = len + "|" + name.ToLowerInvariant();
                    if (isCloud)
                    {
                        if (key is not null && _cloudKeys.Count < maxKeys) _cloudKeys.TryAdd(key, fi.FullName);
                        var issue = IssueOf(name);
                        if (issue is not null) NoteIssue(res, issue, fi.FullName);
                    }
                    else
                    {
                        string? cp = null;
                        if (key is not null && _cloudKeys.Count > 0 && _cloudKeys.TryGetValue(key, out cp)) { mf++; mb += len; }
                        if (cat <= CatPdf && Docs.Count < maxDocs * 4)
                            Docs.Add(new FileRec { Path = fi.FullName, Size = len, Ticks = ticks, Cat = cat, CloudPath = cp });
                        if (len >= bigThreshold && Big.Count < 20000)
                            Big.Add(new FileRec { Path = fi.FullName, Size = len, Ticks = ticks, Cat = cat, CloudPath = cp });
                    }

                    if (len >= dupeMinSize)
                    {
                        var dk = len + "|" + name.ToLowerInvariant();
                        if (!_dupes.TryGetValue(dk, out var d) && _dupes.Count < maxKeys)
                        {
                            d = new Dupe { Name = name, Size = len };
                            _dupes[dk] = d;
                        }
                        if (d is not null)
                        {
                            d.Count++;
                            if (isCloud) d.InCloud = true; else d.InLocal = true;
                            if (d.Paths.Count < 5) d.Paths.Add(fi.FullName);
                        }
                    }
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }

            try
            {
                foreach (var sd in di.EnumerateDirectories())
                {
                    childDirs++;
                    if (((int)sd.Attributes & 0x400) != 0) continue;   // junctions / symlinks: do not follow
                    if (isCloud)
                    {
                        var issue = IssueOf(sd.Name);
                        if (issue is not null) NoteIssue(res, issue, sd.FullName);
                    }
                    var c = new Frame { Dir = sd.FullName, Depth = f.Depth + 1 };
                    if (c.Depth == 1)
                    {
                        c.A1 = new FolderAgg(c.Dir, 1);
                        res.Folders.Add(c.A1);
                        if (res.TopFolders.Count < 200) res.TopFolders.Add(sd.Name);
                    }
                    else c.A1 = f.A1;
                    if (c.Depth == 2)
                    {
                        c.A2 = new FolderAgg(c.Dir, 2);
                        res.Folders.Add(c.A2);
                    }
                    else if (c.Depth > 2) c.A2 = f.A2;
                    stack.Push(c);
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }

            if (n == 0 && childDirs == 0 && f.Depth > 0) res.EmptyDirs++;
            Merge(rootAgg, n, b, on, onb, mf, mb, newest, oldest, cf, cb);
            Merge(f.A1, n, b, on, onb, mf, mb, newest, oldest, cf, cb);
            Merge(f.A2, n, b, on, onb, mf, mb, newest, oldest, cf, cb);
            res.Files += n; res.Bytes += b; res.OnlineBytes += onb;
        }
        res.Seconds = sw.Elapsed.TotalSeconds;
        return res;
    }

    /// <summary>Names that exist more than once, biggest waste first.</summary>
    public List<Dupe> TopDupes(int max) => _dupes.Values
        .Where(d => d.Count >= 2)
        .OrderByDescending(d => (long)(d.Count - 1) * d.Size)
        .Take(max).ToList();

    /// <summary>Newest documents first.</summary>
    public List<FileRec> TopDocs(int max) => Docs.OrderByDescending(d => d.Ticks).Take(max).ToList();

    /// <summary>Biggest files first.</summary>
    public List<FileRec> TopBig(int max) => Big.OrderByDescending(d => d.Size).Take(max).ToList();

    /// <summary>Total size of a folder tree (junctions are not followed). Partial = true when the time budget ran out.</summary>
    public static (long Bytes, bool Partial) DirSize(string path, int maxSeconds) => SystemSections.FolderSizeCapped(path, maxSeconds);

    /// <summary>Finds git working copies below the given roots (a folder that contains ".git"). Does not descend into repos.</summary>
    public static List<string> FindGitRepos(IEnumerable<string> roots, int maxDepth, int maxSeconds, IEnumerable<string> skipNames)
    {
        var found = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var skip = new HashSet<string>(skipNames, StringComparer.OrdinalIgnoreCase);
        var sw = Stopwatch.StartNew();
        foreach (var root in roots)
        {
            var stack = new Stack<(string Dir, int Depth)>();
            stack.Push((root, 0));
            while (stack.Count > 0)
            {
                if (sw.Elapsed.TotalSeconds > maxSeconds) return found;
                var (dir, depth) = stack.Pop();
                try
                {
                    var g = Path.Combine(dir, ".git");
                    if (Directory.Exists(g) || File.Exists(g))
                    {
                        if (seen.Add(dir)) found.Add(dir);
                        continue;
                    }
                    if (depth >= maxDepth) continue;
                    foreach (var sd in new DirectoryInfo(dir).EnumerateDirectories())
                    {
                        if ((sd.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                        if (skip.Contains(sd.Name)) continue;
                        stack.Push((sd.FullName, depth + 1));
                    }
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { }
            }
        }
        return found;
    }
}
