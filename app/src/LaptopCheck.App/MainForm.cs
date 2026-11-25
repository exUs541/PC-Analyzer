using System.Diagnostics;
using System.Runtime.InteropServices;
using LaptopCheck.Server;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LaptopCheck.App;

/// <summary>The app window: the dashboard inside WebView2, which Windows already ships.</summary>
internal sealed class MainForm : Form
{
    readonly LcServer _server;
    readonly string _userDataDir;
    readonly WebView2 _web = new() { Dock = DockStyle.Fill };

    readonly Action _onDashboardLoaded;

    public MainForm(LcServer server, string userDataDir, Action onDashboardLoaded)
    {
        _server = server;
        _userDataDir = userDataDir;
        _onDashboardLoaded = onDashboardLoaded;
        Text = "LaptopCheck";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1360, 900);
        MinimumSize = new Size(900, 600);
        Controls.Add(_web);
        Load += async (_, _) => await InitAsync();
    }

    /// <summary>Called when a second start of the app asks for this window.</summary>
    public void ShowFront()
    {
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    async Task InitAsync()
    {
        CoreWebView2Environment env;
        try
        {
            env = await CoreWebView2Environment.CreateAsync(null, _userDataDir);
            await _web.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex) when (ex is WebView2RuntimeNotFoundException or InvalidOperationException or COMException)
        {
            ShowInBrowserInstead();
            return;
        }

        var core = _web.CoreWebView2;
        core.Settings.AreDevToolsEnabled = Debugger.IsAttached;
        core.Settings.IsStatusBarEnabled = false;
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            OpenExternal(e.Uri);
        };
        core.NavigationStarting += (_, e) =>
        {
            if (e.Uri.StartsWith(_server.Url, StringComparison.OrdinalIgnoreCase)) return;
            e.Cancel = true;
            OpenExternal(e.Uri);
        };
        // a start only counts as working once the dashboard has really loaded (see StartupGuard)
        core.NavigationCompleted += (_, e) =>
        {
            if (e.IsSuccess) _onDashboardLoaded();
        };
        core.Navigate(_server.Url);
    }

    /// <summary>Only web links leave the app, and only to the default browser.</summary>
    static void OpenExternal(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps)) return;
        Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
    }

    void ShowInBrowserInstead()
    {
        _web.Visible = false;
        var label = new Label
        {
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            Text = "Das Windows-Bauteil für das App-Fenster (WebView2) fehlt.\nLaptopCheck läuft deshalb im Browser.\n\nSchließe dieses Fenster, um LaptopCheck zu beenden.",
        };
        Controls.Add(label);
        OpenExternal(_server.Url);
        _onDashboardLoaded();
    }
}
