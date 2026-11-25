using System.Security.Cryptography;
using System.Text;

namespace LaptopCheck.App;

/// <summary>One running app per data folder; a second start brings the first window to the front instead.</summary>
internal sealed class SingleInstance : IDisposable
{
    readonly Mutex _mutex;
    readonly EventWaitHandle _activate;
    readonly CancellationTokenSource _stop = new();

    SingleInstance(Mutex mutex, EventWaitHandle activate, bool isFirst)
    {
        _mutex = mutex;
        _activate = activate;
        IsFirst = isFirst;
    }

    public bool IsFirst { get; }

    public static SingleInstance Create(string dataDir)
    {
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(dataDir.ToLowerInvariant())))[..16];
        var mutex = new Mutex(true, $@"Local\LaptopCheck-{key}", out var created);
        var activate = new EventWaitHandle(false, EventResetMode.AutoReset, $@"Local\LaptopCheck-activate-{key}");
        return new SingleInstance(mutex, activate, created);
    }

    public void SignalFirst() => _activate.Set();

    public void ListenForActivation(Action onActivate)
    {
        var thread = new Thread(() =>
        {
            var handles = new[] { _activate, _stop.Token.WaitHandle };
            while (WaitHandle.WaitAny(handles) == 0) onActivate();
        }) { IsBackground = true, Name = "LaptopCheck-activate" };
        thread.Start();
    }

    public void Dispose()
    {
        _stop.Cancel();
        if (IsFirst) _mutex.ReleaseMutex();
        _mutex.Dispose();
        _activate.Dispose();
        _stop.Dispose();
    }
}
