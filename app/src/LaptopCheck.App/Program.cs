using System.Runtime.InteropServices;
using LaptopCheck.Core;
using LaptopCheck.Cleanup;
using LaptopCheck.GitHub;
using LaptopCheck.Scan;
using LaptopCheck.Scan.Real;
using LaptopCheck.Scan.Files;
using LaptopCheck.Scan.Space;
using LaptopCheck.Server;
using LaptopCheck.Update;
using Velopack;

namespace LaptopCheck.App;

internal static class Program
{
    [DllImport("kernel32.dll")]
    static extern bool AttachConsole(int processId);

    // one client for the whole run; every request sets its own time limit
    static readonly HttpClient Http = new() { Timeout = Timeout.InfiniteTimeSpan };

    [STAThread]
    static int Main(string[] args)
    {
        // the installer/updater calls the app with special arguments (install, update, uninstall); this handles them and exits
        VelopackApp.Build().Run();

        var cli = CliOptions.Parse(args);
        if (cli.NoWindow || cli.ShowVersion || cli.ScanOnly || cli.FilesScanOnly) AttachConsole(-1);

        if (cli.ShowVersion)
        {
            Console.WriteLine(AppInfo.Version);
            return 0;
        }

        var data = DataPaths.Resolve(cli.DataDir);
        InstallErrorLog(data);
        var scanner = new ScanService(data, cli.Scan, progress: cli.ScanOnly ? area => Console.WriteLine("  scanning: " + area) : null);

        var files = new FilesScanService(data, progress: cli.FilesScanOnly ? what => Console.WriteLine("  scanning: " + what) : null);
        var space = new SpaceScanService(data);
        var processes = new RealProcessRunner();
        var github = new GitHubService(data, new GitHubAuth(data, new Win32CredentialStore(), processes), processes, Http);
        var confirmation = new FormConfirmation();
        var folderPicker = new FormFolderPicker();
        var cleanup = new CleanupService(new CleanupContext
        {
            Data = data, Env = ScanEnvironment.FromThisPc(), Probe = new RealSystemProbe(), Registry = new Win32Registry(),
            Recycle = new RealRecycleBin(), Launcher = new RealLauncher(), Confirmation = confirmation,
        });

        if (cli.ScanOnly) return ScanOnly(cli, data, scanner);
        if (cli.FilesScanOnly) return FilesScanOnly(cli, data, files);

        var webRoot = cli.WebRoot ?? Path.Combine(AppContext.BaseDirectory, "web");
        if (!Directory.Exists(webRoot))
        {
            MessageBox.Show($"Die Programmdateien sind unvollständig: Der Ordner \"{webRoot}\" fehlt.", "LaptopCheck", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }

        using var instance = SingleInstance.Create(data.Dir);
        if (!instance.IsFirst)
        {
            instance.SignalFirst();
            return 0;
        }

        MainForm? form = null;
        using var done = new ManualResetEventSlim();
        void RequestExit()
        {
            done.Set();
            var f = form;
            if (f is { IsHandleCreated: true }) f.BeginInvoke(f.Close);
        }

        // updates: only a real installation (Setup.exe) can update itself; a plain run of the program files just says so
        var engine = new VelopackUpdateEngine(
            AppInfo.RepositoryUrl,
            () => new GitHubAuth(data, new Win32CredentialStore(), processes).Candidates().Select(c => c.Token).Distinct().ToList(),
            Environment.GetEnvironmentVariable("LC_UPDATE_SOURCE"),
            restartArgs: args);   // after "update now" the app comes back the way it was started
        var updates = new UpdateService(data, engine, RequestExit, log: msg => LogInfo("update", msg));
        var guard = new StartupGuard(data, engine.CurrentVersion);
        updates.NoteStart();
        if (guard.ShouldRepair(guard.RegisterStart()) && RepairByUpdate(updates, showMessage: !cli.NoWindow)) return 0;

        var server = LcServer.StartAsync(new LcServerOptions
        {
            Data = data,
            WebRoot = webRoot,
            PreferredPort = cli.Port ?? 48765,
            Scanner = scanner,
            Files = files,
            Space = space,
            GitHub = github,
            Cleanup = cleanup,
            Update = updates,
            Organize = new OrganizeService(data, new RealRecycleBin(), confirmation),
            Compare = new CompareService(data),
            FolderPicker = folderPicker,
            OnShutdownRequested = RequestExit,
        }).GetAwaiter().GetResult();

        using var updateLoop = new CancellationTokenSource();
        _ = updates.RunAsync(updateLoop.Token);
        try
        {
            if (cli.NoWindow)
            {
                guard.MarkHealthy();
                Console.WriteLine("LC_URL=" + server.Url);
                Console.Out.Flush();
                done.Wait();
                return 0;
            }

            ApplicationConfiguration.Initialize();
            var userDataDir = Path.Combine(Path.GetDirectoryName(data.Dir)!, "webview2");
            form = new MainForm(server, userDataDir, guard.MarkHealthy);
            confirmation.Owner = form;
            folderPicker.Owner = form;
            instance.ListenForActivation(() =>
            {
                var f = form;
                if (f is { IsHandleCreated: true }) f.BeginInvoke(f.ShowFront);
            });
            Application.Run(form);
            return 0;
        }
        finally
        {
            updateLoop.Cancel();
            server.DisposeAsync().AsTask().GetAwaiter().GetResult();
            updates.ApplyPendingOnExit();   // last: a loaded update installs itself as soon as this process has ended
        }
    }

    /// <summary>
    /// Three starts of this version in a row never got the dashboard up: look for a newer version right now, because that is
    /// the likeliest fix. Returns true when one was found and is being installed (this start ends then).
    /// </summary>
    static bool RepairByUpdate(UpdateService updates, bool showMessage)
    {
        LogError("repair", "3 starts in a row did not reach the dashboard; looking for an update");
        var offer = updates.CheckAndDownloadAsync(force: true).GetAwaiter().GetResult();
        if (offer is null)
        {
            if (showMessage) MessageBox.Show(
                "LaptopCheck konnte in letzter Zeit mehrfach nicht richtig starten.\n\nEs gibt aber noch keine neuere Version, die das beheben könnte. " +
                "Die Details stehen in data\\app-errors.log. LaptopCheck startet jetzt trotzdem noch einmal.",
                "LaptopCheck", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }
        updates.ApplyPendingOnExit(restart: true);
        return true;
    }

    /// <summary>What goes wrong in the background must leave a trace: data\app-errors.log (and the app keeps running).</summary>
    static void InstallErrorLog(DataPaths data)
    {
        ErrorLogPaths = data;
        AppDomain.CurrentDomain.UnhandledException += (_, e) => LogError("unhandled", e.ExceptionObject);
        TaskScheduler.UnobservedTaskException += (_, e) => LogError("task", e.Exception);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => LogError("window", e.Exception);
    }

    static DataPaths? ErrorLogPaths;

    internal static void LogError(string kind, object? what) => Append("app-errors.log", kind, what);

    /// <summary>Things worth knowing that are not errors (an update was loaded, the app was updated): data\app.log.</summary>
    internal static void LogInfo(string kind, object? what) => Append("app.log", kind, what);

    static void Append(string file, string kind, object? what)
    {
        if (ErrorLogPaths is null) return;
        try { File.AppendAllText(ErrorLogPaths.Of(file), $"[{DateTime.Now:yyyy-MM-ddTHH:mm:ss}] {kind}: {what}{Environment.NewLine}"); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    static int FilesScanOnly(CliOptions cli, DataPaths data, FilesScanService files)
    {
        Console.WriteLine("LaptopCheck: scanning files (read-only) ...");
        files.RunAsync().GetAwaiter().GetResult();
        if (cli.OutFile is not null) File.Copy(data.Files, cli.OutFile, true);
        Console.WriteLine("Written to " + (cli.OutFile ?? data.Files));
        return 0;
    }

    static int ScanOnly(CliOptions cli, DataPaths data, ScanService scanner)
    {
        Console.WriteLine("LaptopCheck: scanning (read-only) ...");
        scanner.RunAsync(quick: false).GetAwaiter().GetResult();
        if (cli.OutFile is not null) File.Copy(data.Snapshot, cli.OutFile, true);
        Console.WriteLine("Written to " + (cli.OutFile ?? data.Snapshot));
        return 0;
    }
}
