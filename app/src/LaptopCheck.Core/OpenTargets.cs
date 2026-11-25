namespace LaptopCheck.Core;

public sealed record OpenTarget(string File, string? Args = null);

/// <summary>
/// "Open this place in Windows" buttons of the dashboard. The page may only pick one of these fixed, harmless
/// entries by id; nothing the page sends is ever executed. Keep the ids in sync with LC.OPEN_TARGETS in web/knowledge.js.
/// </summary>
public static class OpenTargets
{
    static readonly Dictionary<string, OpenTarget> Table = new(StringComparer.Ordinal)
    {
        ["startup-apps"] = new("ms-settings:startupapps"),
        ["task-manager"] = new("taskmgr.exe"),
        ["apps-features"] = new("ms-settings:appsfeatures"),
        ["storage"] = new("ms-settings:storagesense"),
        ["disk-cleanup"] = new("cleanmgr.exe"),
        ["windows-update"] = new("ms-settings:windowsupdate"),
        ["windows-security"] = new("windowsdefender:"),
        ["firewall"] = new("control.exe", "firewall.cpl"),
        ["uac"] = new("UserAccountControlSettings.exe"),
        ["device-manager"] = new("devmgmt.msc"),
        ["msconfig"] = new("msconfig.exe"),
        ["power"] = new("ms-settings:powersleep"),
        ["bitlocker"] = new("control.exe", "/name Microsoft.BitLockerDriveEncryption"),
        ["terminal"] = new("powershell.exe", "-NoExit"),
    };

    public static IReadOnlyCollection<string> Ids => Table.Keys;

    public static bool TryGet(string id, out OpenTarget target) => Table.TryGetValue(id, out target!);
}
