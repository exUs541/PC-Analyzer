using System.Runtime.InteropServices;
using System.Text;

namespace LaptopCheck.GitHub;

public sealed record StoredCredential(string Target, string User, string Secret);

/// <summary>The Windows Credential Manager: where Git Credential Manager and GitHub Desktop keep their GitHub login.</summary>
public interface ICredentialStore
{
    /// <summary>Generic credentials whose target matches the filter (e.g. "git:https://github.com*") and whose secret looks like a token.</summary>
    IReadOnlyList<StoredCredential> Find(string filter);
}

public sealed class Win32CredentialStore : ICredentialStore
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CREDENTIAL
    {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredEnumerate(string? filter, int flags, out int count, out IntPtr credentials);

    [DllImport("advapi32.dll")]
    static extern void CredFree(IntPtr buffer);

    static bool LooksLikeToken(string s)
    {
        if (s.Length is < 20 or > 255) return false;
        foreach (var c in s)
        {
            if (!(char.IsAsciiLetterOrDigit(c) || c == '_')) return false;
        }
        return true;
    }

    /// <summary>The secret is stored as UTF-16 by Git Credential Manager and as UTF-8 by GitHub Desktop: both are tried.</summary>
    public IReadOnlyList<StoredCredential> Find(string filter)
    {
        var list = new List<StoredCredential>();
        if (!CredEnumerate(filter, 0, out var count, out var p)) return list;
        try
        {
            for (var i = 0; i < count; i++)
            {
                var cp = Marshal.ReadIntPtr(p, i * IntPtr.Size);
                var c = Marshal.PtrToStructure<CREDENTIAL>(cp);
                if (c.CredentialBlobSize <= 0 || c.CredentialBlob == IntPtr.Zero) continue;
                var b = new byte[c.CredentialBlobSize];
                Marshal.Copy(c.CredentialBlob, b, 0, b.Length);
                string? secret = null;
                if (b.Length % 2 == 0)
                {
                    var u = Encoding.Unicode.GetString(b);
                    if (LooksLikeToken(u)) secret = u;
                }
                if (secret is null)
                {
                    var u8 = Encoding.UTF8.GetString(b);
                    if (LooksLikeToken(u8)) secret = u8;
                }
                if (secret is not null) list.Add(new StoredCredential(c.TargetName ?? "", c.UserName ?? "", secret));
            }
        }
        finally
        {
            CredFree(p);
        }
        return list;
    }
}
