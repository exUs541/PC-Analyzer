using LaptopCheck.Core;

namespace LaptopCheck.App;

/// <summary>The Windows folder window, shown on the dashboard's window thread. Without a window (server-only run) nothing is picked.</summary>
internal sealed class FormFolderPicker : IFolderPicker
{
    public Form? Owner { get; set; }

    public string? Pick(string title, string? startPath)
    {
        var owner = Owner;
        if (owner is not { IsHandleCreated: true }) return null;
        string? chosen = null;
        try
        {
            owner.Invoke(() =>
            {
                using var dialog = new FolderBrowserDialog { Description = title, UseDescriptionForTitle = true, ShowNewFolderButton = false };
                if (!string.IsNullOrWhiteSpace(startPath) && Directory.Exists(startPath)) dialog.InitialDirectory = startPath;
                if (dialog.ShowDialog(owner) == DialogResult.OK && Directory.Exists(dialog.SelectedPath)) chosen = dialog.SelectedPath;
            });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ObjectDisposedException or System.ComponentModel.Win32Exception)
        {
            Program.LogError("folder picker", ex);
        }
        return chosen;
    }
}
