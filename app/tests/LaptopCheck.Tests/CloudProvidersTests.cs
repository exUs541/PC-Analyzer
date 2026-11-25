using System.Text.Json.Nodes;
using LaptopCheck.Core;
using LaptopCheck.Scan;
using LaptopCheck.Scan.Files;
using LaptopCheck.Scan.Real;

namespace LaptopCheck.Tests;

/// <summary>
/// Google Drive that streams to a virtual drive while an old mirror folder is still lying in the profile: that folder is a leftover,
/// not a cloud (nothing is synced there any more), and must never make local files look "already in the cloud".
/// </summary>
public sealed class CloudProvidersTests : IDisposable
{
    readonly string _base = Path.Combine(Path.GetTempPath(), "lc-cloud-" + Guid.NewGuid().ToString("N"));
    string Home => Path.Combine(_base, "home");
    string LocalAppData => Path.Combine(Home, "AppData", "Local");
    string VirtualDrive => Path.Combine(_base, "G");
    string OldMirror => Path.Combine(Home, "My Drive");

    public void Dispose()
    {
        try { Directory.Delete(_base, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    ScanEnvironment Env() => new()
    {
        UserProfile = Home, LocalAppData = LocalAppData, AppData = Path.Combine(Home, "AppData", "Roaming"),
        ProgramData = Path.Combine(_base, "ProgramData"), SystemRoot = Path.Combine(_base, "Windows"), SystemDrive = _base, Temp = Path.Combine(_base, "Temp"),
    };

    FakeProbe Probe(bool streamed)
    {
        var p = new FakeProbe();
        if (streamed)
        {
            Directory.CreateDirectory(Path.Combine(VirtualDrive, "Meine Ablage"));
            p.DriveList.Add(new DriveEntry(VirtualDrive, "Google Drive"));
        }
        return p;
    }

    void Accounts(int n)
    {
        for (var i = 0; i < n; i++) Directory.CreateDirectory(Path.Combine(LocalAppData, "Google", "DriveFS", (100000000000000000L + i).ToString()));
        Directory.CreateDirectory(Path.Combine(LocalAppData, "Google", "DriveFS", "Logs"));   // not an account
    }

    static string ModeOf(List<CloudProviders.Provider> found, string root) => found.Single(p => p.Root.Equals(root, StringComparison.OrdinalIgnoreCase)).Mode;

    [Fact]
    public void A_streamed_drive_plus_a_profile_folder_with_one_account_means_the_folder_is_a_leftover()
    {
        Accounts(1);
        Directory.CreateDirectory(OldMirror);

        var found = CloudProviders.Detect(Env(), Probe(streamed: true), []);

        Assert.Equal("stream", ModeOf(found, Path.Combine(VirtualDrive, "Meine Ablage")));
        Assert.Equal(CloudProviders.LeftoverMode, ModeOf(found, OldMirror));
        var by = found.Single(p => p.Root == OldMirror).DetectedBy;
        Assert.Contains("folder in profile: My Drive", by);
        Assert.Contains("left over", by);
    }

    [Fact]
    public void Two_accounts_may_mirror_one_and_stream_the_other_so_the_folder_stays_a_mirror()
    {
        Accounts(2);
        Directory.CreateDirectory(OldMirror);

        var found = CloudProviders.Detect(Env(), Probe(streamed: true), []);

        Assert.Equal("mirror", ModeOf(found, OldMirror));
    }

    [Fact]
    public void Without_a_streamed_drive_the_profile_folder_is_a_real_mirror()
    {
        Accounts(1);
        Directory.CreateDirectory(OldMirror);

        var found = CloudProviders.Detect(Env(), Probe(streamed: false), []);

        Assert.Equal("mirror", ModeOf(found, OldMirror));
        Assert.DoesNotContain(found, p => p.Mode == CloudProviders.LeftoverMode);
    }

    [Fact]
    public void Other_providers_are_not_touched()
    {
        Accounts(1);
        Directory.CreateDirectory(OldMirror);
        Directory.CreateDirectory(Path.Combine(Home, "OneDrive"));
        Directory.CreateDirectory(Path.Combine(Home, "Dropbox"));

        var found = CloudProviders.Detect(Env(), Probe(streamed: true), []);

        Assert.Equal("sync", ModeOf(found, Path.Combine(Home, "OneDrive")));
        Assert.Equal("sync", ModeOf(found, Path.Combine(Home, "Dropbox")));
    }

    [Fact]
    public void Only_numeric_folders_count_as_accounts()
    {
        Assert.Equal(0, CloudProviders.DriveAccountCount(LocalAppData));          // Drive for desktop not installed
        Accounts(3);
        Assert.Equal(3, CloudProviders.DriveAccountCount(LocalAppData));          // "Logs" is ignored
        Assert.Equal(0, CloudProviders.DriveAccountCount(""));
    }

    [Fact]
    public void The_files_scan_reports_the_leftover_but_does_not_treat_it_as_cloud()
    {
        Accounts(1);
        // the old mirror holds a document that ALSO lies in Documents: it must not count as "already in the cloud"
        Directory.CreateDirectory(Path.Combine(OldMirror, "Steuer"));
        File.WriteAllBytes(Path.Combine(OldMirror, "Steuer", "steuer.pdf"), new byte[3000]);
        Directory.CreateDirectory(Path.Combine(Home, "Documents", "Steuer"));
        File.WriteAllBytes(Path.Combine(Home, "Documents", "Steuer", "steuer.pdf"), new byte[3000]);

        var context = new FilesContext { Env = Env(), Probe = Probe(streamed: true), Registry = new FakeRegistry(), Processes = new RealProcessRunner() };
        var result = FilesScan.Run(context, new FilesScanOptions([], [], SecondsPerRoot: 10, SkipRepos: true, SkipDataDirs: true));

        var providers = ((JsonArray)result["providers"]!).OfType<JsonObject>().ToList();
        Assert.Contains(providers, p => (string?)p["mode"] == CloudProviders.LeftoverMode && (string?)p["root"] == OldMirror);

        var roots = ((JsonArray)result["roots"]!).OfType<JsonObject>().ToList();
        Assert.DoesNotContain(roots, r => ((string?)r["path"])!.StartsWith(OldMirror, StringComparison.OrdinalIgnoreCase));   // not even scanned
        var cloud = roots.Where(r => (string?)r["kind"] == "cloud").Select(r => (string?)r["mode"]).ToList();
        Assert.Equal(["stream"], cloud);

        var docs = ((JsonArray)result["docs"]!).OfType<JsonObject>().Where(d => ((string?)d["p"])!.EndsWith("steuer.pdf")).ToList();
        Assert.All(docs, d => Assert.Null(d["cloud"]));
    }
}
