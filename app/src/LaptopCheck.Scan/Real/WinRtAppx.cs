using Windows.ApplicationModel;
using Windows.Management.Deployment;

namespace LaptopCheck.Scan.Real;

/// <summary>Store (MSIX) apps of the current user, read from the same Windows API Get-AppxPackage uses.</summary>
public sealed class WinRtAppx : IAppxSource
{
    // Store-signed inbox apps that Windows refuses to remove. The Windows runtime API has no flag for this (Get-AppxPackage
    // reports it as NonRemovable), so the known ones are listed; every other protected app is System-signed or in SystemApps.
    static readonly HashSet<string> ProtectedInbox = new(StringComparer.OrdinalIgnoreCase)
    {
        "Microsoft.SecHealthUI", "Microsoft.DesktopAppInstaller",
    };

    public IReadOnlyList<AppxPackageInfo> GetPackages()
    {
        var windir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var manager = new PackageManager();
        var list = new List<AppxPackageInfo>();
        foreach (var p in manager.FindPackagesForUser(string.Empty))
        {
            try
            {
                var v = p.Id.Version;
                string? path = null;
                try { path = p.InstalledPath; } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Runtime.InteropServices.COMException) { }
                var isSystem = p.SignatureKind == PackageSignatureKind.System;
                list.Add(new AppxPackageInfo
                {
                    Name = p.Id.Name,
                    FullName = p.Id.FullName,
                    FamilyName = p.Id.FamilyName,
                    Version = $"{v.Major}.{v.Minor}.{v.Build}.{v.Revision}",
                    Architecture = p.Id.Architecture.ToString(),
                    Publisher = p.Id.Publisher,
                    PublisherDisplayName = SafeText(() => p.PublisherDisplayName),
                    InstalledPath = path,
                    IsFramework = p.IsFramework,
                    IsResource = p.IsResourcePackage,
                    IsSystem = isSystem,
                    NonRemovable = isSystem
                                   || ProtectedInbox.Contains(p.Id.Name)
                                   || (path is not null && path.StartsWith(Path.Combine(windir, "SystemApps"), StringComparison.OrdinalIgnoreCase)),
                    StartApps = p.IsFramework || p.IsResourcePackage ? [] : StartApps(p),
                });
            }
            catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or IOException or UnauthorizedAccessException or InvalidOperationException)
            {
                // a package that cannot be read is left out, like Get-AppxPackage does
            }
        }
        return list;
    }

    static IReadOnlyList<AppxApp> StartApps(Package p)
    {
        try
        {
            var entries = p.GetAppListEntriesAsync().AsTask().GetAwaiter().GetResult();
            return entries.Select(e => new AppxApp(e.DisplayInfo.DisplayName, e.AppUserModelId)).ToList();
        }
        catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or InvalidOperationException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    static string? SafeText(Func<string> read)
    {
        try { return read(); }
        catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or InvalidOperationException) { return null; }
    }
}
