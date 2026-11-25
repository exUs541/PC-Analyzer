using LaptopCheck.Scan;

namespace LaptopCheck.App;

/// <summary>
/// --data-dir &lt;folder&gt;   keep the data somewhere else (tests)
/// --web-root &lt;folder&gt;   serve another dashboard folder (development)
/// --port &lt;n&gt;            preferred port (0 = any free port)
/// --no-window          server only, prints LC_URL=... (tests, headless)
/// --scan-only          scan, store the snapshot, exit (with --out &lt;file&gt; also a copy there)
/// --scan-files-only    files scan (settings from config.json), store files.json, exit (with --out also a copy)
/// --quick --no-winget --skip-sizes   scan options (also used by the dashboard's scan button)
/// --version            print the version and exit
/// </summary>
internal sealed record CliOptions(string? DataDir, string? WebRoot, int? Port, bool NoWindow, bool ShowVersion, bool ScanOnly, string? OutFile, ScanOptions Scan, bool FilesScanOnly = false)
{
    public static CliOptions Parse(string[] args)
    {
        string? data = null, web = null, outFile = null;
        int? port = null;
        bool noWindow = false, version = false, scanOnly = false, quick = false, noWinget = false, skipSizes = false, filesOnly = false;
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--data-dir" when i + 1 < args.Length: data = args[++i]; break;
                case "--web-root" when i + 1 < args.Length: web = args[++i]; break;
                case "--out" when i + 1 < args.Length: outFile = args[++i]; break;
                case "--port" when i + 1 < args.Length && int.TryParse(args[i + 1], out var p): port = p; i++; break;
                case "--no-window": noWindow = true; break;
                case "--version": version = true; break;
                case "--scan-only": scanOnly = true; break;
                case "--scan-files-only": filesOnly = true; break;
                case "--quick": quick = true; break;
                case "--no-winget": noWinget = true; break;
                case "--skip-sizes": skipSizes = true; break;
            }
        }
        return new CliOptions(data, web, port, noWindow, version, scanOnly, outFile, new ScanOptions(quick, noWinget, skipSizes), filesOnly);
    }
}
