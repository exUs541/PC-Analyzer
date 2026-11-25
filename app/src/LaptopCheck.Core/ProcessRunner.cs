using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace LaptopCheck.Core;

public sealed record ProcessResult(int ExitCode, string Output, bool TimedOut);

/// <summary>Runs console programs (powercfg, winget, git, gh) and returns what they printed. A seam so tests need no real programs.</summary>
public interface IProcessRunner
{
    ProcessResult Run(string file, IReadOnlyList<string> args, TimeSpan timeout, Encoding? encoding = null);

    /// <summary>Like <see cref="Run"/>, but feeds <paramref name="input"/> to the program and sets extra environment variables.</summary>
    ProcessResult RunWithInput(string file, IReadOnlyList<string> args, string input, TimeSpan timeout, IReadOnlyDictionary<string, string>? environment = null);

    /// <summary>Full path of an executable found on PATH, or null.</summary>
    string? FindOnPath(string exeName);
}

public sealed class RealProcessRunner : IProcessRunner
{
    /// <summary>Console programs such as powercfg write in the OEM code page of the system language.</summary>
    public static Encoding OemEncoding()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        try { return Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.OEMCodePage); }
        catch (ArgumentException) { return Encoding.UTF8; }
    }

    public ProcessResult Run(string file, IReadOnlyList<string> args, TimeSpan timeout, Encoding? encoding = null) =>
        Execute(file, args, null, timeout, null, encoding ?? Encoding.UTF8);

    public ProcessResult RunWithInput(string file, IReadOnlyList<string> args, string input, TimeSpan timeout, IReadOnlyDictionary<string, string>? environment = null) =>
        Execute(file, args, input, timeout, environment, Encoding.UTF8);

    static ProcessResult Execute(string file, IReadOnlyList<string> args, string? input, TimeSpan timeout, IReadOnlyDictionary<string, string>? environment, Encoding enc)
    {
        var psi = new ProcessStartInfo(file)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = input is not null,
            CreateNoWindow = true,
            StandardOutputEncoding = enc,
            StandardErrorEncoding = enc,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        if (environment is not null)
        {
            foreach (var (k, v) in environment) psi.Environment[k] = v;
        }

        using var p = Process.Start(psi) ?? throw new InvalidOperationException("could not start " + file);
        if (input is not null)
        {
            p.StandardInput.Write(input);
            p.StandardInput.Close();
        }
        var stdout = p.StandardOutput.ReadToEndAsync();
        _ = p.StandardError.ReadToEndAsync();
        if (!p.WaitForExit(timeout))
        {
            try { p.Kill(true); } catch (InvalidOperationException) { }
            return new ProcessResult(-1, "", true);
        }
        p.WaitForExit();
        return new ProcessResult(p.ExitCode, stdout.GetAwaiter().GetResult(), false);
    }

    public string? FindOnPath(string exeName)
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var full = Path.Combine(dir.Trim().Trim('"'), exeName);
                if (File.Exists(full)) return full;
            }
            catch (ArgumentException) { }
        }
        return null;
    }
}
