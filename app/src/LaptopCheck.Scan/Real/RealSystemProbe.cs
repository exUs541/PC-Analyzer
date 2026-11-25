using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LaptopCheck.Scan.Real;

public sealed class RealSystemProbe : ISystemProbe
{
    [DllImport("kernel32.dll")]
    static extern bool GetFirmwareType(out uint firmwareType);

    // default packing: the 64-bit Windows headers give this struct 24 bytes (a 20 byte layout makes the call fail with E_INVALIDARG)
    [StructLayout(LayoutKind.Sequential)]
    struct SHQUERYRBINFO
    {
        public int cbSize;
        public long i64Size;
        public long i64NumItems;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHQueryRecycleBin(string? pszRootPath, ref SHQUERYRBINFO info);

    [StructLayout(LayoutKind.Sequential)]
    struct TPM_DEVICE_INFO
    {
        public uint structVersion;
        public uint tpmVersion;      // 1 = TPM 1.2, 2 = TPM 2.0
        public uint tpmInterfaceType;
        public uint tpmImpRevision;
    }

    [DllImport("tbs.dll")]
    static extern uint Tbsi_GetDeviceInfo(uint size, out TPM_DEVICE_INFO info);

    const uint TbsETpmNotFound = 0x8028400F;

    /// <summary>The TPM Base Services tell whether a TPM exists and its version without administrator rights.</summary>
    public TpmDeviceInfo? Tpm()
    {
        try
        {
            var rc = Tbsi_GetDeviceInfo((uint)Marshal.SizeOf<TPM_DEVICE_INFO>(), out var info);
            if (rc == 0) return new TpmDeviceInfo(true, info.tpmVersion == 2 ? "2.0" : info.tpmVersion == 1 ? "1.2" : null);
            return rc == TbsETpmNotFound ? new TpmDeviceInfo(false, null) : null;
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException) { return null; }
    }

    dynamic? _wsh;

    public int FirmwareType()
    {
        try { return GetFirmwareType(out var t) ? (int)t : 0; }
        catch (EntryPointNotFoundException) { return 0; }
    }

    public long? RecycleBinBytes()
    {
        var info = new SHQUERYRBINFO { cbSize = Marshal.SizeOf<SHQUERYRBINFO>() };
        return SHQueryRecycleBin(null, ref info) == 0 ? info.i64Size : null;
    }

    /// <summary>Reads a Start Menu shortcut through the Windows Script Host, like the old collector did.</summary>
    public ShortcutTarget? ReadShortcut(string lnkPath)
    {
        try
        {
            _wsh ??= Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!);
            dynamic link = _wsh!.CreateShortcut(lnkPath);
            string target = link.TargetPath ?? "";
            string args = link.Arguments ?? "";
            return target.Length > 0 ? new ShortcutTarget(target, args) : null;
        }
        catch (COMException) { return null; }
        catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) { return null; }
    }

    [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
    static extern uint AssocQueryString(uint flags, uint str, string pszAssoc, string? pszExtra, System.Text.StringBuilder pszOut, ref uint pcchOut);

    public string? FileHandler(string extension)
    {
        try
        {
            var sb = new System.Text.StringBuilder(1024);
            uint len = 1024;
            return AssocQueryString(0, 2, extension, null, sb, ref len) == 0 && sb.Length > 0 ? sb.ToString() : null;   // 2 = ASSOCSTR_EXECUTABLE
        }
        catch (EntryPointNotFoundException) { return null; }
    }

    public IReadOnlyList<DriveEntry> Drives()
    {
        var list = new List<DriveEntry>();
        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (d.IsReady) list.Add(new DriveEntry(d.Name, d.VolumeLabel ?? ""));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
        return list;
    }

    public IReadOnlyList<ProcInfo> Processes()
    {
        var list = new List<ProcInfo>();
        foreach (var p in Process.GetProcesses())
        {
            using (p)
            {
                try
                {
                    double cpu = 0;
                    try { cpu = p.TotalProcessorTime.TotalSeconds; } catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException) { }
                    list.Add(new ProcInfo(p.ProcessName, p.WorkingSet64, cpu));
                }
                catch (InvalidOperationException) { }
            }
        }
        return list;
    }
}
