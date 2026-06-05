using System.Reflection;
using System.Windows.Forms;
using LdtScanAgent.Services;
using LdtScanAgent.Tray;

namespace LdtScanAgent;

public static class Program
{
    // A named, machine-wide mutex prevents two copies of the agent from
    // fighting over port 7878. The "Global\" prefix scopes it across sessions
    // so a user launching it while it's already running as another user is
    // also detected.
    private const string MutexName = "Global\\LdtScanAgent_v1_singleton";

    [STAThread]
    public static void Main(string[] args)
    {
        using var singleton = new Mutex(initiallyOwned: true, MutexName, out bool createdNew);
        if (!createdNew)
        {
            MessageBox.Show(
                "LDT Scan Agent is already running. Check the system tray.",
                "LDT Scan Agent",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        StaScannerExecutor? executor = null;
        Task? serverTask = null;
        try
        {
            ApplicationConfiguration.Initialize();
            var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "unknown";
            Log.Info(new string('=', 70));
            Log.Info($"LDT Scan Agent v{version} starting — host={Environment.MachineName} pid={Environment.ProcessId}");

            executor = new StaScannerExecutor();

            // Capture the executor for the closure so we can pass it to RunAsync.
            var execRef = executor;
            serverTask = Task.Run(async () =>
            {
                try { await HttpServer.RunAsync(args, execRef); }
                catch (Exception ex) { Log.Error("HTTP server task crashed", ex); }
            });

            using var trayIcon = new ScanAgentTrayIcon();
            Application.Run();
            Log.Info("Tray exit requested — shutting down");
        }
        catch (Exception ex)
        {
            Log.Error("Fatal startup error", ex);
            MessageBox.Show(
                $"LDT Scan Agent failed to start:\n\n{ex.Message}\n\nLog file:\n{Log.TodayFile}",
                "LDT Scan Agent",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        finally
        {
            try { HttpServer.Stop(); } catch (Exception ex) { Log.Error("HttpServer.Stop threw", ex); }
            try { executor?.Dispose(); } catch (Exception ex) { Log.Error("Executor dispose threw", ex); }
            try { serverTask?.Wait(TimeSpan.FromSeconds(2)); } catch { /* already logged */ }
            Log.Info("Shutdown complete");

            try { singleton.ReleaseMutex(); } catch { /* may already be released */ }
        }
    }
}
