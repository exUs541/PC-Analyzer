using System.Globalization;
using LaptopCheck.Core;

namespace LaptopCheck.Scan;

/// <summary>One WMI object: property name (case-insensitive) to value. Date properties are already DateTime.</summary>
public sealed class WmiRow : Dictionary<string, object?>
{
    public WmiRow() : base(StringComparer.OrdinalIgnoreCase) { }

    public object? Raw(string name) => TryGetValue(name, out var v) ? v : null;
    public string? Clean(string name) => Val.Clean(Raw(name));
    public string? Text(string name) => Raw(name) is { } v ? Convert.ToString(v, CultureInfo.InvariantCulture) : null;
    public long? Long(string name) => Val.LongOrNull(Raw(name));
    public int Int(string name) => Val.Int0(Raw(name));
    public bool? Bool(string name) => Raw(name) is bool b ? b : null;
    public DateTime? Date(string name) => Raw(name) as DateTime?;

    /// <summary>Numbers of an array property (e.g. ChassisTypes), empty when missing.</summary>
    public IReadOnlyList<long> Numbers(string name) =>
        Raw(name) is System.Collections.IEnumerable e and not string
            ? e.Cast<object?>().Select(Val.LongOrNull).Where(x => x.HasValue).Select(x => x!.Value).ToList()
            : [];

    /// <summary>Path that Related/Invoke need ("__PATH" of the WMI object).</summary>
    public string? Path => Text("__PATH");
}

/// <summary>Windows Management Instrumentation (the data Get-CimInstance used to read).</summary>
public interface IWmi
{
    IReadOnlyList<WmiRow> Query(string wql, string ns = @"root\cimv2");
    IReadOnlyList<WmiRow> Related(string path, string relatedClass);
    /// <summary>Calls a method without arguments and returns its output parameters.</summary>
    WmiRow Invoke(string path, string method);
}

public enum RegHive { LocalMachine, CurrentUser }
public enum RegView { Default, Registry32, Registry64 }

public interface IRegKey : IDisposable
{
    string[] GetValueNames();
    string[] GetSubKeyNames();
    /// <summary>The value (REG_DWORD as int, REG_QWORD as long, REG_BINARY as byte[], REG_SZ as string), null when missing.</summary>
    object? GetValue(string name);
    IRegKey? OpenSubKey(string name);
    /// <summary>Last write time of the key (local time), null when unknown.</summary>
    DateTime? LastWriteTime { get; }
}

public interface IRegistry
{
    IRegKey? Open(RegHive hive, string subKey, RegView view = RegView.Default);
}

public sealed record ProcInfo(string Name, long WorkingSetBytes, double CpuSeconds);

public sealed record ShortcutTarget(string Target, string Arguments);

public sealed record TpmDeviceInfo(bool Present, string? SpecVersion);

/// <summary>Things only the shell or the OS can tell.</summary>
public interface ISystemProbe
{
    /// <summary>1 = BIOS, 2 = UEFI, 0 = unknown.</summary>
    int FirmwareType();
    long? RecycleBinBytes();
    /// <summary>TPM presence and version as far as a normal user can see it, null when unknown.</summary>
    TpmDeviceInfo? Tpm();
    ShortcutTarget? ReadShortcut(string lnkPath);
    IReadOnlyList<ProcInfo> Processes();
    /// <summary>Mounted drives that are ready, with their volume labels (virtual drives of cloud services show up here).</summary>
    IReadOnlyList<DriveEntry> Drives();
    /// <summary>The program Windows opens files of this extension with (".blend" gives "blender.exe"), or null.</summary>
    string? FileHandler(string extension);
}

public sealed record DriveEntry(string Name, string Label);

public sealed record AppxApp(string Name, string AppUserModelId);

public sealed class AppxPackageInfo
{
    public required string Name { get; init; }
    public required string FullName { get; init; }
    public required string FamilyName { get; init; }
    public required string Version { get; init; }
    public required string Architecture { get; init; }
    public string? Publisher { get; init; }
    public string? PublisherDisplayName { get; init; }
    public string? InstalledPath { get; init; }
    public bool IsFramework { get; init; }
    public bool IsResource { get; init; }
    public bool IsSystem { get; init; }
    public bool NonRemovable { get; init; }
    public IReadOnlyList<AppxApp> StartApps { get; init; } = [];
}

/// <summary>Microsoft Store (MSIX) apps of the current user.</summary>
public interface IAppxSource
{
    IReadOnlyList<AppxPackageInfo> GetPackages();
}

/// <summary>Folders and facts about this PC that are not in WMI or the registry.</summary>
public sealed record ScanEnvironment
{
    public bool IsAdmin { get; init; }
    public string ComputerName { get; init; } = "";
    public string UserName { get; init; } = "";
    public string AppData { get; init; } = "";
    public string LocalAppData { get; init; } = "";
    public string ProgramData { get; init; } = "";
    public string UserProfile { get; init; } = "";
    public string SystemRoot { get; init; } = "";
    public string ProgramFiles { get; init; } = "";
    public string ProgramFilesX86 { get; init; } = "";
    public string SystemDrive { get; init; } = "";
    public string Temp { get; init; } = "";
    public string MyDocuments { get; init; } = "";
    public string MyPictures { get; init; } = "";
    public string MyVideos { get; init; } = "";
    public string MyMusic { get; init; } = "";
    public string Desktop { get; init; } = "";
    public string Locale { get; init; } = "";
    /// <summary>Folders named by the OneDrive environment variables (OneDrive, OneDriveConsumer, OneDriveCommercial).</summary>
    public IReadOnlyDictionary<string, string> CloudEnvVars { get; init; } = new Dictionary<string, string>();

    public static ScanEnvironment FromThisPc() => new()
    {
        IsAdmin = LaptopCheck.Core.StateBuilder.IsAdmin(),
        ComputerName = Environment.MachineName,
        UserName = Environment.UserName,
        AppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        LocalAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        ProgramData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        UserProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        SystemRoot = Environment.GetFolderPath(Environment.SpecialFolder.Windows),
        ProgramFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
        ProgramFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
        SystemDrive = Environment.GetEnvironmentVariable("SystemDrive") ?? "C:",
        Temp = Path.GetTempPath().TrimEnd('\\'),
        MyDocuments = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        MyPictures = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
        MyVideos = Environment.GetFolderPath(Environment.SpecialFolder.MyVideos),
        MyMusic = Environment.GetFolderPath(Environment.SpecialFolder.MyMusic),
        Desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
        Locale = CultureInfo.CurrentCulture.Name,
        CloudEnvVars = new[] { "OneDrive", "OneDriveConsumer", "OneDriveCommercial" }
            .Select(n => (Name: n, Value: Environment.GetEnvironmentVariable(n)))
            .Where(x => !string.IsNullOrEmpty(x.Value))
            .ToDictionary(x => x.Name, x => x.Value!),
    };
}

public sealed record ScanOptions(bool Quick = false, bool NoWinget = false, bool SkipSizes = false);
