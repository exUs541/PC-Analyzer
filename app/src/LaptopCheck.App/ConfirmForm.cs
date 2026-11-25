using LaptopCheck.Core;

namespace LaptopCheck.App;

/// <summary>
/// The window that stands between a click in the dashboard and anything being removed: it lists exactly what would happen and only
/// lets "Ausführen" through when the word is typed exactly (and the statement ticked, where there is one). Escape or Abbrechen
/// means nothing happens.
/// </summary>
internal sealed class ConfirmForm : Form
{
    readonly ConfirmationRequest _request;
    readonly CheckBox? _box;
    readonly TextBox _typed = new() { Dock = DockStyle.Top };
    readonly Button _ok = new() { Text = "Ausführen", Enabled = false, DialogResult = DialogResult.OK, AutoSize = true, Padding = new Padding(14, 4, 14, 4) };

    public ConfirmForm(ConfirmationRequest request)
    {
        _request = request;
        Text = request.Title;
        StartPosition = FormStartPosition.CenterParent;
        ClientSize = new Size(820, 560);
        MinimumSize = new Size(560, 380);
        ShowInTaskbar = true;
        MinimizeBox = false;
        Padding = new Padding(14);

        var heading = new Label { Text = request.Heading, Dock = DockStyle.Top, AutoSize = true, Font = new Font(Font, FontStyle.Bold), MaximumSize = new Size(780, 0), Padding = new Padding(0, 0, 0, 10) };
        var list = new TextBox
        {
            Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Dock = DockStyle.Fill,
            Text = string.Join(Environment.NewLine, request.Lines), Font = new Font(FontFamily.GenericMonospace, 9f), BackColor = SystemColors.Window,
        };

        var bottom = new Panel { Dock = DockStyle.Bottom, AutoSize = true, Padding = new Padding(0, 10, 0, 0) };
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Padding = new Padding(0, 10, 0, 0) };
        var cancel = new Button { Text = "Abbrechen", DialogResult = DialogResult.Cancel, AutoSize = true, Padding = new Padding(14, 4, 14, 4) };
        buttons.Controls.Add(cancel);
        buttons.Controls.Add(_ok);

        var prompt = new Label
        {
            Text = $"Zum Fortfahren tippe  {request.RequiredWord}  und drücke Enter. Alles andere bricht ab.",
            Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(0, 10, 0, 4),
        };
        _typed.TextChanged += (_, _) => Refresh_();
        bottom.Controls.Add(buttons);
        bottom.Controls.Add(_typed);
        bottom.Controls.Add(prompt);

        if (request.CheckboxText is not null)
        {
            _box = new CheckBox { Text = request.CheckboxText, Dock = DockStyle.Top, AutoSize = true, MaximumSize = new Size(780, 0), Padding = new Padding(0, 6, 0, 0) };
            _box.CheckedChanged += (_, _) => Refresh_();
            bottom.Controls.Add(_box);
        }

        Controls.Add(list);
        Controls.Add(bottom);
        Controls.Add(heading);
        AcceptButton = _ok;      // Enter only counts while the button is enabled
        CancelButton = cancel;   // Escape
        Shown += (_, _) =>
        {
            TopMost = true;
            Activate();
            _typed.Focus();
            TopMost = false;
        };
    }

    /// <summary>The one question that counts: right now, is everything the request asks for in place?</summary>
    public bool Satisfied => _request.IsSatisfiedBy(_box?.Checked ?? false, _typed.Text);

    void Refresh_() => _ok.Enabled = Satisfied;

    /// <summary>
    /// A disabled button is not a lock: other programs can still "click" it (Windows UI Automation, window messages).
    /// So "OK" only closes the window when the conditions really hold at that moment.
    /// </summary>
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (DialogResult == DialogResult.OK && !Satisfied)
        {
            e.Cancel = true;
            DialogResult = DialogResult.None;
            return;
        }
        base.OnFormClosing(e);
    }
}

/// <summary>Shows the confirmation window on the UI thread. Without a window (server-only run) nothing is ever confirmed.</summary>
internal sealed class FormConfirmation : IConfirmation
{
    public Form? Owner { get; set; }

    public Task<bool> ConfirmAsync(ConfirmationRequest request, CancellationToken cancellationToken = default)
    {
        var owner = Owner;
        if (owner is not { IsHandleCreated: true })
        {
            Program.LogError("confirmation", "no window to ask in: answer is no (" + request.Title + ")");
            return Task.FromResult(false);
        }
        var tcs = new TaskCompletionSource<bool>();
        owner.BeginInvoke(() =>
        {
            try
            {
                using var dialog = new ConfirmForm(request);
                var result = dialog.ShowDialog(owner);
                var confirmed = result == DialogResult.OK && dialog.Satisfied;   // asked a second time, in case the window was closed in an unexpected way
                Program.LogError("confirmation", $"{request.Title}: window closed with {result}{(confirmed ? " (confirmed)" : "")}");
                tcs.SetResult(confirmed);
            }
            catch (Exception ex)
            {
                // whatever goes wrong with the window, the answer is "no" and the reason is not lost
                Program.LogError("confirmation window", ex);
                tcs.TrySetResult(false);
            }
        });
        return tcs.Task;
    }
}
