using System.Globalization;
using System.Management;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LaptopCheck.Core;

namespace LaptopCheck.Scan.Sections;

/// <summary>Protection, encryption, update state and the active power plan.</summary>
internal static partial class SecuritySections
{
    [GeneratedRegex(@"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s+\((.+?)\)")]
    private static partial Regex PowerScheme();

    static bool IsWmiFailure(Exception ex) => ex is ManagementException or UnauthorizedAccessException or InvalidOperationException;

    public static JsonObject Security(ScanContext c)
    {
        var r = new JsonObject();

        try
        {
            var mp = c.Wmi.Query("SELECT * FROM MSFT_MpComputerStatus", @"root\Microsoft\Windows\Defender").FirstOrDefault()
                     ?? throw new InvalidOperationException("keine Daten");
            r["defender"] = J.O(
                ("serviceEnabled", mp.Bool("AMServiceEnabled")),
                ("antivirusEnabled", mp.Bool("AntivirusEnabled")),
                ("realTime", mp.Bool("RealTimeProtectionEnabled")),
                ("tamperProtected", mp.Bool("IsTamperProtected")),
                ("signatureUpdated", Val.Iso(mp.Date("AntivirusSignatureLastUpdated"), c.Now())),
                ("quickScanEnd", Val.Iso(mp.Date("QuickScanEndTime"), c.Now())),
                ("fullScanEnd", Val.Iso(mp.Date("FullScanEndTime"), c.Now())));
        }
        catch (Exception ex) when (IsWmiFailure(ex))
        {
            r["defender"] = null;
            c.Warn("security", "Defender status: " + ex.Message);
        }

        var av = new List<JsonNode?>();
        try
        {
            foreach (var p in c.Wmi.Query("SELECT * FROM AntiVirusProduct", "root/SecurityCenter2"))
            {
                var st = p.Int("productState");
                av.Add(J.O(("name", p.Text("displayName")), ("enabled", (st & 0x1000) != 0), ("upToDate", (st & 0x10) == 0)));
            }
        }
        catch (Exception ex) when (IsWmiFailure(ex)) { }
        r["antivirus"] = J.A(av);

        var fw = new List<JsonNode?>();
        try
        {
            foreach (var p in c.Wmi.Query("SELECT * FROM MSFT_NetFirewallProfile", @"root\StandardCimv2"))
            {
                var enabled = p.Raw("Enabled") switch { bool b => b, string s => s == "True", var o => Val.LongOrNull(o) == 1 };
                fw.Add(J.O(("profile", p.Text("Name")), ("enabled", enabled)));
            }
        }
        catch (Exception ex) when (IsWmiFailure(ex)) { }
        r["firewall"] = J.A(fw);

        // Secure Boot state is readable without admin rights (Confirm-SecureBootUEFI needs admin)
        r["secureBoot"] = J.N(c.RegValue(RegHive.LocalMachine, @"SYSTEM\CurrentControlSet\Control\SecureBoot\State", "UEFISecureBootEnabled"));

        r["tpm"] = Tpm(c);

        var bl = new List<JsonNode?>();
        if (c.Env.IsAdmin)
        {
            try
            {
                foreach (var v in c.Wmi.Query("SELECT * FROM Win32_EncryptableVolume", @"root\CIMV2\Security\MicrosoftVolumeEncryption"))
                {
                    var path = v.Path;
                    var protection = path is null ? null : c.Wmi.Invoke(path, "GetProtectionStatus").Long("ProtectionStatus");
                    var conversion = path is null ? null : c.Wmi.Invoke(path, "GetConversionStatus").Long("ConversionStatus");
                    bl.Add(J.O(("mount", v.Text("DriveLetter")), ("status", ConversionName(conversion)), ("protection", ProtectionName(protection))));
                }
            }
            catch (Exception ex) when (IsWmiFailure(ex)) { }
        }
        r["bitlocker"] = J.A(bl);

        var pending = c.RegKeyExists(RegHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending")
                      || c.RegKeyExists(RegHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired")
                      || c.RegValue(RegHive.LocalMachine, @"SYSTEM\CurrentControlSet\Control\Session Manager", "PendingFileRenameOperations") is not null;
        r["pendingReboot"] = pending;

        string? lastHotfix = null;
        var hotfixCount = 0;
        try
        {
            var fixes = c.Wmi.Query("SELECT * FROM Win32_QuickFixEngineering");
            hotfixCount = fixes.Count;
            var dates = fixes.Select(f => ParseInstalledOn(f.Raw("InstalledOn"))).Where(d => d.HasValue).Select(d => d!.Value).ToList();
            if (dates.Count > 0) lastHotfix = Val.Iso(dates.Max(), c.Now());
        }
        catch (Exception ex) when (IsWmiFailure(ex)) { }
        r["lastHotfix"] = lastHotfix;
        r["hotfixCount"] = hotfixCount;

        var wu = c.RegValue(RegHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\Results\Install", "LastSuccessTime");
        string? wuIso = null;
        if (wu is not null
            && DateTime.TryParse(Convert.ToString(wu, CultureInfo.InvariantCulture), CultureInfo.InvariantCulture, DateTimeStyles.None, out var wuTime))
        {
            wuIso = Val.Iso(DateTime.SpecifyKind(wuTime, DateTimeKind.Utc).ToLocalTime(), c.Now());
        }
        r["lastUpdateInstall"] = wuIso;
        return r;
    }

    static JsonObject? Tpm(ScanContext c)
    {
        try
        {
            var rows = c.Wmi.Query("SELECT * FROM Win32_Tpm", @"root\cimv2\Security\MicrosoftTpm");
            if (rows.Count == 0) return J.O(("present", false), ("ready", false), ("specVersion", null));
            var t = rows[0];
            var ready = (t.Bool("IsEnabled_InitialValue") ?? false) && (t.Bool("IsActivated_InitialValue") ?? false) && (t.Bool("IsOwned_InitialValue") ?? false);
            return J.O(("present", true), ("ready", ready), ("specVersion", t.Text("SpecVersion")));
        }
        catch (Exception ex) when (IsWmiFailure(ex))
        {
            // the WMI class is for administrators only; the TPM Base Services still tell presence and version
            var info = c.Probe.Tpm();
            return info is null ? null : J.O(("present", info.Present), ("ready", null), ("specVersion", info.SpecVersion));
        }
    }

    static string ConversionName(long? code) => code switch
    {
        0 => "FullyDecrypted", 1 => "FullyEncrypted", 2 => "EncryptionInProgress", 3 => "DecryptionInProgress",
        4 => "EncryptionSuspended", 5 => "DecryptionSuspended", _ => "Unknown",
    };

    static string ProtectionName(long? code) => code switch { 0 => "Off", 1 => "On", _ => "Unknown" };

    /// <summary>InstalledOn is text in the language of the PC (or a hexadecimal file time on some builds).</summary>
    internal static DateTime? ParseInstalledOn(object? raw)
    {
        if (raw is DateTime dt) return dt;
        var s = Convert.ToString(raw, CultureInfo.InvariantCulture)?.Trim();
        if (string.IsNullOrEmpty(s)) return null;
        if (DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return d;
        if (DateTime.TryParse(s, CultureInfo.CurrentCulture, DateTimeStyles.None, out d)) return d;
        if (long.TryParse(s.TrimStart('0', 'x', 'X'), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var ft) && ft > 0)
        {
            try { return DateTime.FromFileTimeUtc(ft).ToLocalTime(); }
            catch (ArgumentOutOfRangeException) { return null; }
        }
        return null;
    }

    public static JsonObject? PowerPlan(ScanContext c)
    {
        var result = c.Processes.Run("powercfg.exe", ["/getactivescheme"], TimeSpan.FromSeconds(15), RealProcessRunner.OemEncoding());
        var m = PowerScheme().Match(result.Output);
        return m.Success ? J.O(("guid", m.Groups[1].Value.ToLowerInvariant()), ("name", m.Groups[2].Value)) : null;
    }
}
