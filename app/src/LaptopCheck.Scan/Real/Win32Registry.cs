using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace LaptopCheck.Scan.Real;

public sealed class Win32Registry : IRegistry
{
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int RegQueryInfoKey(SafeRegistryHandle hKey, StringBuilder? lpClass, IntPtr lpcbClass, IntPtr lpReserved,
        IntPtr lpcSubKeys, IntPtr lpcbMaxSubKeyLen, IntPtr lpcbMaxClassLen, IntPtr lpcValues, IntPtr lpcbMaxValueNameLen,
        IntPtr lpcbMaxValueLen, IntPtr lpcbSecurityDescriptor, out long lpftLastWriteTime);

    public IRegKey? Open(RegHive hive, string subKey, RegView view = RegView.Default)
    {
        try
        {
            var h = hive == RegHive.LocalMachine ? RegistryHive.LocalMachine : RegistryHive.CurrentUser;
            var v = view switch { RegView.Registry32 => RegistryView.Registry32, RegView.Registry64 => RegistryView.Registry64, _ => RegistryView.Default };
            using var root = RegistryKey.OpenBaseKey(h, v);
            var key = root.OpenSubKey(subKey);
            return key is null ? null : new Key(key);
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException or ArgumentException)
        {
            return null;
        }
    }

    sealed class Key(RegistryKey key) : IRegKey
    {
        public string[] GetValueNames() => key.GetValueNames();
        public string[] GetSubKeyNames() => key.GetSubKeyNames();
        public object? GetValue(string name) => key.GetValue(name);

        public IRegKey? OpenSubKey(string name)
        {
            try
            {
                var sub = key.OpenSubKey(name);
                return sub is null ? null : new Key(sub);
            }
            catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException)
            {
                return null;
            }
        }

        public DateTime? LastWriteTime
        {
            get
            {
                var r = RegQueryInfoKey(key.Handle, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero,
                    IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out var ft);
                return r == 0 && ft > 0 ? DateTime.FromFileTimeUtc(ft).ToLocalTime() : null;
            }
        }

        public void Dispose() => key.Dispose();
    }
}
