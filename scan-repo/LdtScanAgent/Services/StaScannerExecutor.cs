using System.Collections.Concurrent;
using LdtScanAgent.Models;

namespace LdtScanAgent.Services;

/// <summary>
/// Marshals all WIA / COM work onto a single STA thread.
///
/// WIA is single-threaded COM. Calling it from arbitrary thread-pool threads
/// (which is what Kestrel hands you) causes intermittent RPC_E_WRONG_THREAD,
/// hangs, and "works sometimes" behavior. Everything goes through one STA
/// worker so the COM apartment stays consistent across the lifetime of the
/// agent.
///
/// A SemaphoreSlim provides fast-fail behavior when the scanner is already
/// in use — callers can either wait briefly (typical) or get a `scanner_busy`
/// rejection instantly.
/// </summary>
public sealed class StaScannerExecutor : IDisposable
{
    private readonly BlockingCollection<Action> _queue = new();
    private readonly Thread _worker;
    private readonly SemaphoreSlim _semaphore = new(1, 1);
    private volatile bool _busy;

    public bool IsBusy => _busy;

    public StaScannerExecutor()
    {
        _worker = new Thread(WorkerLoop)
        {
            IsBackground = true,
            Name = "Wia-STA-Worker",
        };
        _worker.SetApartmentState(ApartmentState.STA);
        _worker.Start();
        Log.Info("STA worker started");
    }

    private void WorkerLoop()
    {
        foreach (var job in _queue.GetConsumingEnumerable())
        {
            try { job(); }
            catch (Exception ex) { Log.Error("STA worker uncaught", ex); }
        }
        Log.Info("STA worker exited");
    }

    /// <summary>
    /// Acquire the scanner lock, then post <paramref name="work"/> to the STA
    /// thread and await its result.
    /// </summary>
    /// <param name="work">Synchronous WIA work. Receives the same CT for
    /// in-flight cancellation checks (e.g. between feeder pages).</param>
    /// <param name="acquireTimeout">How long to wait for the lock before
    /// throwing <see cref="ScannerBusyException"/>. Defaults to 0 = fail fast.</param>
    public async Task<T> RunAsync<T>(
        Func<CancellationToken, T> work,
        TimeSpan? acquireTimeout = null,
        CancellationToken ct = default)
    {
        var timeout = acquireTimeout ?? TimeSpan.Zero;
        if (!await _semaphore.WaitAsync(timeout, ct).ConfigureAwait(false))
            throw new ScannerBusyException();

        try
        {
            var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (!_queue.TryAdd(() =>
            {
                _busy = true;
                try
                {
                    if (ct.IsCancellationRequested) { tcs.TrySetCanceled(ct); return; }
                    tcs.TrySetResult(work(ct));
                }
                catch (OperationCanceledException) { tcs.TrySetCanceled(ct); }
                catch (Exception ex) { tcs.TrySetException(ex); }
                finally { _busy = false; }
            }))
            {
                tcs.TrySetException(new InvalidOperationException("STA queue is shut down."));
            }
            return await tcs.Task.ConfigureAwait(false);
        }
        finally
        {
            _semaphore.Release();
        }
    }

    public Task<T> RunAsync<T>(Func<T> work, TimeSpan? acquireTimeout = null, CancellationToken ct = default)
        => RunAsync<T>(_ => work(), acquireTimeout, ct);

    public void Dispose()
    {
        try { _queue.CompleteAdding(); } catch { }
        try { _worker.Join(TimeSpan.FromSeconds(3)); } catch { }
        try { _queue.Dispose(); } catch { }
        try { _semaphore.Dispose(); } catch { }
    }
}
