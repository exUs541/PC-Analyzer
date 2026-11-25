using System.Management;

namespace LaptopCheck.Scan.Real;

public sealed class Win32Wmi : IWmi
{
    static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);

    public IReadOnlyList<WmiRow> Query(string wql, string ns = @"root\cimv2")
    {
        var scope = new ManagementScope(ns, new ConnectionOptions { Impersonation = ImpersonationLevel.Impersonate, Timeout = Timeout });
        scope.Connect();
        using var searcher = new ManagementObjectSearcher(scope, new ObjectQuery(wql), new System.Management.EnumerationOptions { Timeout = Timeout });
        var rows = new List<WmiRow>();
        using var results = searcher.Get();
        foreach (ManagementBaseObject mo in results)
        {
            using (mo) rows.Add(ToRow(mo));
        }
        return rows;
    }

    public IReadOnlyList<WmiRow> Related(string path, string relatedClass)
    {
        using var mo = new ManagementObject(path);
        var rows = new List<WmiRow>();
        foreach (ManagementBaseObject related in mo.GetRelated(relatedClass))
        {
            using (related) rows.Add(ToRow(related));
        }
        return rows;
    }

    public WmiRow Invoke(string path, string method)
    {
        using var mo = new ManagementObject(path);
        using var output = mo.InvokeMethod(method, null, null);
        return output is null ? new WmiRow() : ToRow(output);
    }

    static WmiRow ToRow(ManagementBaseObject mo)
    {
        var row = new WmiRow();
        foreach (var p in mo.Properties)
        {
            object? v;
            try
            {
                v = p.Value;
                if (v is string s && p.Type == CimType.DateTime) v = ParseDate(s);
            }
            catch (ManagementException)
            {
                v = null;
            }
            row[p.Name] = v;
        }
        if (mo is ManagementObject m) row["__PATH"] = m.Path.Path;
        return row;
    }

    static DateTime? ParseDate(string s)
    {
        try { return ManagementDateTimeConverter.ToDateTime(s); }
        catch (ArgumentOutOfRangeException) { return null; }
        catch (ArgumentException) { return null; }
    }
}
