using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using LaptopCheck.Core;
using LaptopCheck.Scan.Real;
using LaptopCheck.Scan.Sections;

namespace LaptopCheck.Scan;

/// <summary>
/// Collects raw facts about hardware, Windows and installed software. READ-ONLY: nothing on the PC is changed.
/// Every section is isolated: a failing section becomes an entry in warnings instead of aborting the scan.
/// This only COLLECTS; all interpretation happens in the dashboard (web/*.js).
/// </summary>
public static class LaptopScanner
{
    public static ScanContext CreateContext(ScanOptions options, Action<string>? progress = null) => new()
    {
        Wmi = new Win32Wmi(),
        Registry = new Win32Registry(),
        Processes = new RealProcessRunner(),
        Probe = new RealSystemProbe(),
        Appx = new WinRtAppx(),
        Env = ScanEnvironment.FromThisPc(),
        Options = options,
        Progress = progress,
    };

    public static async Task<JsonObject> RunAsync(ScanContext c)
    {
        var sw = Stopwatch.StartNew();
        var o = c.Options;

        // the slow, independent parts start right away and run beside the quick ones
        var memoryTask = Task.Run(() => c.Section<JsonObject?>("memory", () => HardwareSections.Memory(c), null));
        var foldersTask = Task.Run(() => o.Quick ? J.A([]) : c.Section("folders", () => SystemSections.Folders(c), J.A([])));
        var wingetTask = Task.Run(() => o.NoWinget || o.Quick ? null : c.Section<JsonArray?>("updates", () => WingetSections.Updates(c), null));

        var system = c.Section<JsonObject?>("system", () => HardwareSections.Device(c), null);
        var os = c.Section<JsonObject?>("os", () => HardwareSections.Os(c), null);
        var cpu = c.Section("cpu", () => HardwareSections.Cpu(c), J.A([]));
        var gpu = c.Section("gpu", () => HardwareSections.Gpu(c), J.A([]));
        var disks = c.Section("disks", () => HardwareSections.Disks(c), J.A([]));
        var volumes = c.Section("volumes", () => HardwareSections.Volumes(c), J.A([]));
        var battery = c.Section<JsonObject?>("battery", () => HardwareSections.Battery(c), null);
        var network = c.Section("network", () => HardwareSections.Network(c), J.A([]));
        var security = c.Section<JsonObject?>("security", () => SecuritySections.Security(c), null);
        var power = c.Section<JsonObject?>("power", () => SecuritySections.PowerPlan(c), null);
        var startup = c.Section("startup", () => SystemSections.Startup(c), J.A([]));
        var procs = c.Section("processes", () => SystemSections.Processes(c), J.A([]));

        var software = new List<JsonObject>();
        var ignored = 0;
        var reg = c.Section<SoftwareSections.RegistryResult?>("software", () => SoftwareSections.FromRegistry(c), null);
        if (reg is not null) { software.AddRange(reg.Items); ignored = reg.IgnoredUpdates; }
        software.AddRange(c.Section("software-store", () => SoftwareSections.FromStore(c), []));
        if (!o.SkipSizes && !o.Quick) c.Section("software-sizes", () => { SoftwareSections.AddFolderSizes(software); return 0; }, 0);

        var shortcuts = c.Section("shortcuts", () => SoftwareSections.Shortcuts(c), J.A([]));
        var usage = c.Section<UsageSections.Evidence?>("usage", () => UsageSections.Collect(c), null);

        var memory = await memoryTask;
        var folders = await foldersTask;
        var updates = await wingetTask;
        sw.Stop();

        return J.O(
            ("schema", 1),
            ("collectedAt", c.Now().ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture)),
            ("durationSec", Math.Round(sw.Elapsed.TotalSeconds, 1)),
            ("collector", J.O(
                ("version", AppInfo.Version),
                ("engine", "native"),
                ("runtime", System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription),
                ("isAdmin", c.Env.IsAdmin),
                ("computerName", c.Env.ComputerName),
                ("userName", c.Env.UserName),
                ("options", J.O(("quick", o.Quick), ("noWinget", o.NoWinget), ("skipSizes", o.SkipSizes))))),
            ("system", system),
            ("os", os),
            ("cpu", cpu),
            ("memory", memory),
            ("gpu", gpu),
            ("disks", disks),
            ("volumes", volumes),
            ("battery", battery),
            ("network", network),
            ("security", security),
            ("powerPlan", power),
            ("startup", startup),
            ("processes", procs),
            ("folders", folders),
            ("software", J.A(software)),
            ("ignoredUpdates", ignored),
            ("shortcuts", shortcuts),
            ("usage", J.A(usage?.Entries ?? [])),
            ("usageCounts", usage?.Counts),
            ("updates", updates),
            ("warnings", c.WarningsJson()));
    }
}
